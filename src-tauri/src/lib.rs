//! noteCalc — Tauri backend.
//!
//! The whole calculator lives in Rust (`calc`), so the webview only renders
//! what the engine produces. File dialogs and session storage are handled here
//! too, which keeps the frontend free of filesystem endpoints.

mod calc;
mod session;
mod theme;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteDocument {
    path: String,
    content: String,
}

fn read_text(path: &Path) -> Result<String, String> {
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    // Python opens notes with `utf-8-sig`, which drops a leading BOM.
    Ok(raw
        .strip_prefix('\u{feff}')
        .unwrap_or(raw.as_str())
        .to_string())
}

fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if let Some(directory) = path.parent() {
        if !directory.as_os_str().is_empty() && !directory.exists() {
            std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        }
    }
    std::fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn evaluate(content: String, precision: u32) -> Result<serde_json::Value, String> {
    let (results, scope) = calc::document::calculate_document(&content, precision)?;
    let scope_json: serde_json::Map<String, serde_json::Value> = scope
        .iter()
        .map(|(name, value)| (name.clone(), calc::value::to_json(value)))
        .collect();
    Ok(serde_json::json!({ "results": results, "scope": scope_json }))
}

#[tauri::command]
fn calc_metadata() -> serde_json::Value {
    calc::metadata()
}

#[tauri::command]
fn read_document(path: String) -> Result<NoteDocument, String> {
    let path = PathBuf::from(&path);
    let content = read_text(&path)?;
    Ok(NoteDocument {
        path: path.to_string_lossy().to_string(),
        content,
    })
}

#[tauri::command]
fn write_document(path: String, content: String) -> Result<(), String> {
    write_text(Path::new(&path), &content)
}

#[tauri::command]
async fn open_documents(
    app: AppHandle,
    directory: Option<String>,
) -> Result<Vec<NoteDocument>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let mut builder = app.dialog().file().set_title("打开计算笔记");
    if let Some(directory) = directory.filter(|value| !value.is_empty()) {
        builder = builder.set_directory(directory);
    }
    builder
        .add_filter("计算笔记", &["ncalc", "txt"])
        .add_filter("所有文件", &["*"])
        .pick_files(move |paths| {
            let _ = sender.send(paths);
        });

    let selected = receiver
        .recv()
        .map_err(|error| error.to_string())?
        .unwrap_or_default();
    let mut documents = Vec::with_capacity(selected.len());
    for file_path in selected {
        let path = file_path.into_path().map_err(|error| error.to_string())?;
        let content = read_text(&path)?;
        documents.push(NoteDocument {
            path: path.to_string_lossy().to_string(),
            content,
        });
    }
    Ok(documents)
}

#[tauri::command]
async fn save_document_as(
    app: AppHandle,
    suggested: String,
    content: String,
) -> Result<Option<String>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("保存计算笔记")
        .set_file_name(suggested)
        .add_filter("计算笔记", &["ncalc"])
        .add_filter("文本文件", &["txt"])
        .save_file(move |path| {
            let _ = sender.send(path);
        });

    let Some(file_path) = receiver.recv().map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let mut path = file_path.into_path().map_err(|error| error.to_string())?;
    if path.extension().is_none() {
        path.set_extension("ncalc");
    }
    write_text(&path, &content)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn export_results(
    app: AppHandle,
    content: String,
    precision: u32,
) -> Result<Option<String>, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title("导出计算结果")
        .set_file_name("计算结果.txt")
        .add_filter("文本文件", &["txt"])
        .save_file(move |path| {
            let _ = sender.send(path);
        });

    let Some(file_path) = receiver.recv().map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|error| error.to_string())?;

    let (results, _) = calc::document::calculate_document(&content, precision)?;
    let mut output = Vec::with_capacity(results.len());
    for result in &results {
        let suffix = match result.kind {
            "error" => format!("错误：{}", result.error.clone().unwrap_or_default()),
            "equation" => format!(
                "{}，左侧结果 {}",
                if result.is_correct == Some(true) {
                    "正确"
                } else {
                    "错误"
                },
                result.result.clone().unwrap_or_default()
            ),
            _ => result.result.clone().unwrap_or_default(),
        };
        output.push(format!("{}\t{}", result.line, suffix).trim_end().to_string());
    }
    write_text(&path, &output.join("\n"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_session(app: AppHandle) -> Option<session::SessionState> {
    session::load(&app)
}

#[tauri::command]
fn save_session(app: AppHandle, session: session::SessionState) -> Result<(), String> {
    session::save(&app, &session)
}

fn apply_window_geometry(app: &AppHandle) {
    let Some(geometry) = session::load(app).and_then(|state| state.window) else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let width = geometry.width.clamp(760.0, 30000.0);
    let height = geometry.height.clamp(520.0, 30000.0);
    resize_client_area(&window, width, height);
    if (-8000..8000).contains(&geometry.x) && (-8000..8000).contains(&geometry.y) {
        let _ = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y));
    }
    if geometry.maximized {
        let _ = window.maximize();
    }
}

/// Restores the saved client size.
///
/// `set_size` takes a client size, but on Windows it lands a caption height off
/// the first time an undecorated window is resized, which made the saved size
/// creep on every launch. Feed the measurement back until the client area
/// matches; the window is still hidden, so no intermediate size is ever shown.
fn resize_client_area(window: &tauri::WebviewWindow, width: f64, height: f64) {
    let mut target_width = width;
    let mut target_height = height;
    for _ in 0..3 {
        let _ = window.set_size(tauri::PhysicalSize::new(target_width, target_height));
        let Ok(actual) = window.inner_size() else {
            return;
        };
        let offset_x = f64::from(actual.width) - width;
        let offset_y = f64::from(actual.height) - height;
        if offset_x.abs() <= 0.5 && offset_y.abs() <= 0.5 {
            return;
        }
        target_width -= offset_x;
        target_height -= offset_y;
    }
}

/// Runs the engine acceptance suite and returns a process exit code.
pub fn run_engine_check() -> i32 {
    calc::selfcheck::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            evaluate,
            calc_metadata,
            read_document,
            write_document,
            open_documents,
            save_document_as,
            export_results,
            load_session,
            save_session,
            theme::system_caption,
        ])
        .setup(|app| {
            // The window starts hidden (see tauri.conf.json) so restored
            // geometry is applied before the first frame is visible.
            let handle = app.handle().clone();
            apply_window_geometry(&handle);
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}