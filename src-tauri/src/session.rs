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
    /// Binary badges with a space every four digits, e.g. `0b1011 1111`.
    pub group_binary: bool,
    pub badge_tone: String,
    /// Minimum gap between a line's last character and its badges, in character cells.
    pub badge_gap_chars: f64,
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
            group_binary: false,
            badge_tone: "light".to_string(),
            badge_gap_chars: 4.0,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Sessions without the setting, and those still holding the old pixel-based
    /// `badgeGap`, must both load on the character-cell default.
    #[test]
    fn missing_or_stale_badge_gap_falls_back_to_the_default() {
        let legacy = r#"{"tabs":[],"activeTab":0,"precision":4,"showHex":false,
            "showBinary":false,"badgeTone":"light","fontSize":15.0,"darkMode":true,"window":null}"#;
        let state: SessionState = serde_json::from_str(legacy).expect("legacy session parses");
        assert_eq!(state.badge_gap_chars, 4.0);

        let stale = r#"{"tabs":[],"activeTab":0,"precision":4,"showHex":false,"showBinary":false,
            "badgeTone":"light","badgeGap":14,"fontSize":15.0,"darkMode":true,"window":null}"#;
        let state: SessionState = serde_json::from_str(stale).expect("stale session parses");
        assert_eq!(state.badge_gap_chars, 4.0);
    }

    #[test]
    fn group_binary_defaults_to_off_and_is_stored_as_camel_case() {
        let legacy = r#"{"tabs":[],"activeTab":0,"precision":4,"showHex":false,"showBinary":false,
            "badgeTone":"light","fontSize":15.0,"darkMode":true,"window":null}"#;
        let state: SessionState = serde_json::from_str(legacy).expect("legacy session parses");
        assert!(!state.group_binary);

        let state = SessionState {
            group_binary: true,
            ..SessionState::default()
        };
        let raw = serde_json::to_string(&state).expect("session serialises");
        assert!(raw.contains(r#""groupBinary":true"#));
    }

    #[test]
    fn badge_gap_chars_is_stored_as_camel_case() {
        let state = SessionState {
            badge_gap_chars: 3.0,
            ..SessionState::default()
        };
        let raw = serde_json::to_string(&state).expect("session serialises");
        assert!(raw.contains(r#""badgeGapChars":3.0"#));
        let parsed: SessionState = serde_json::from_str(&raw).expect("session parses");
        assert_eq!(parsed.badge_gap_chars, 3.0);
    }
}
