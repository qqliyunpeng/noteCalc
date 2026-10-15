//! Session persistence: open tabs, editor preferences and window geometry.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub path: Option<String>,
    pub content: String,
    pub saved_text: String,
    pub font_size: f64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub width: f64,
    pub height: f64,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionState {
    pub tabs: Vec<SessionTab>,
    pub active_tab: usize,
    pub precision: u32,
    pub show_hex: bool,
    pub show_binary: bool,
    pub badge_tone: String,
    pub font_size: f64,
    pub dark_mode: bool,
    pub window: Option<WindowGeometry>,
}

impl Default for SessionState {
    fn default() -> Self {
        SessionState {
            tabs: Vec::new(),
            active_tab: 0,
            precision: 4,
            show_hex: false,
            show_binary: false,
            badge_tone: "light".to_string(),
            font_size: 11.0,
            dark_mode: true,
            window: None,
        }
    }
}

fn session_path(app: &AppHandle) -> Option<PathBuf> {
    let directory = app.path().app_data_dir().ok()?;
    Some(directory.join("session.json"))
}

pub fn load(app: &AppHandle) -> Option<SessionState> {
    let path = session_path(app)?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<SessionState>(&raw).ok()
}

pub fn save(app: &AppHandle, state: &SessionState) -> Result<(), String> {
    let path = session_path(app).ok_or_else(|| "无法定位应用数据目录".to_string())?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_string(state).map_err(|error| error.to_string())?;
    std::fs::write(path, payload).map_err(|error| error.to_string())
}