//! System colours the webview cannot read on its own.
//!
//! The title bar is self-drawn (`decorations: false`), so the accent a desktop
//! gives a focused caption has to be asked for here instead of inherited. Each
//! platform keeps that colour somewhere of its own; a desktop that cannot be
//! asked simply leaves the title bar on the app's own colours.
//!
//! Blink cannot help either: its `AccentColor` system colour reports a built-in
//! blue on Windows rather than the user's accent, so the value has to come from
//! the platform. Command output is handed to the parsers below, which are plain
//! string work and covered by unit tests — the platform branches themselves can
//! only be exercised on that platform.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionColours {
    /// `#rrggbb` the focused caption is filled with.
    pub background: String,
    /// `#rrggbb` text and icons on that fill.
    pub foreground: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCaption {
    /// The desktop's accent, `#rrggbb`, when it has one. The title bar draws its
    /// own accent line with it.
    pub accent: Option<String>,
    /// `None` while the desktop keeps captions neutral, which is every desktop
    /// except Windows with "show accent colour on title bars and window
    /// borders" turned on.
    pub caption: Option<CaptionColours>,
}

#[tauri::command]
pub fn system_caption() -> SystemCaption {
    let accent = accent();
    let caption = match accent {
        Some(ref background) if fills_captions() => Some(CaptionColours {
            foreground: caption_ink(background),
            background: background.clone(),
        }),
        _ => None,
    };
    SystemCaption { accent, caption }
}

/// Black or white, the way a desktop picks caption text: on the accent's
/// perceived brightness. No desktop exposes the choice it made, and this rule
/// reproduces it — `#00b7c3` keeps black text, `#0078d4` gets white.
fn caption_ink(background: &str) -> String {
    match rgb(background) {
        Some((red, green, blue)) if 0.299 * red + 0.587 * green + 0.114 * blue > 127.5 => {
            "#000000".to_string()
        }
        _ => "#ffffff".to_string(),
    }
}

fn rgb(value: &str) -> Option<(f64, f64, f64)> {
    let digits = value.trim().trim_start_matches('#');
    if digits.len() != 6 {
        return None;
    }
    let value = u32::from_str_radix(digits, 16).ok()?;
    Some((
        f64::from((value >> 16) & 0xff),
        f64::from((value >> 8) & 0xff),
        f64::from(value & 0xff),
    ))
}

/// Components are 0-1, the unit `defaults` uses for colours.
#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn hex(red: f64, green: f64, blue: f64) -> String {
    let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(red),
        channel(green),
        channel(blue)
    )
}

/// `defaults read -g AppleHighlightColor` writes either `r g b Name` with 0-1
/// components or an `#rrggbb` string, depending on how the accent was picked.
#[cfg(any(target_os = "macos", test))]
fn apple_accent(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with('#') && text.len() >= 7 {
        return Some(text[..7].to_lowercase());
    }
    let components: Vec<f64> = text
        .split_whitespace()
        .take(3)
        .filter_map(|part| part.parse().ok())
        .collect();
    match components[..] {
        [red, green, blue] => Some(hex(red, green, blue)),
        _ => None,
    }
}

/// GNOME 47+ names its accent after one of libadwaita's nine colours.
#[cfg(any(target_os = "linux", test))]
fn gnome_accent(name: &str) -> Option<String> {
    let colour = match name.trim().trim_matches(['\'', '"']) {
        "blue" => "#3584e4",
        "teal" => "#2190a4",
        "green" => "#3a944a",
        "yellow" => "#c88800",
        "orange" => "#ed5b00",
        "red" => "#e62d42",
        "pink" => "#d56199",
        "purple" => "#9141ac",
        "slate" => "#6f8396",
        _ => return None,
    };
    Some(colour.to_string())
}

/// `kreadconfig6 --file kdeglobals --group General --key AccentColor` writes the
/// accent as `61,174,233` with 0-255 components, or as `#3daee9`.
#[cfg(any(target_os = "linux", test))]
fn kde_accent(text: &str) -> Option<String> {
    let text = text.trim();
    if text.starts_with('#') {
        return (text.len() >= 7).then(|| text[..7].to_lowercase());
    }
    let components: Vec<f64> = text
        .split(',')
        .filter_map(|part| part.trim().parse().ok())
        .collect();
    match components[..] {
        [red, green, blue] => Some(hex(red / 255.0, green / 255.0, blue / 255.0)),
        _ => None,
    }
}

/// `ColorPrevalence` is the "show accent colour on title bars and window
/// borders" switch; `AccentColor` is the accent itself, stored as `0xAABBGGRR`.
#[cfg(windows)]
const DWM: &str = r"Software\Microsoft\Windows\DWM";

#[cfg(windows)]
fn accent() -> Option<String> {
    let abgr = dword(DWM, "AccentColor")?;
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        abgr & 0xff,
        (abgr >> 8) & 0xff,
        (abgr >> 16) & 0xff
    ))
}

/// Only Windows fills captions with the accent, and only while its switch is on.
#[cfg(windows)]
fn fills_captions() -> bool {
    dword(DWM, "ColorPrevalence").unwrap_or(0) == 1
}

/// macOS and Linux keep their window captions neutral whatever the accent is,
/// so only the title bar's own accent line takes the colour there.
#[cfg(not(windows))]
fn fills_captions() -> bool {
    false
}

#[cfg(windows)]
fn dword(subkey: &str, name: &str) -> Option<u32> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let subkey = wide(subkey);
    let name = wide(name);
    let mut data = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            std::ptr::addr_of_mut!(data).cast(),
            &mut size,
        )
    };
    // A missing key or a value of another type simply means "no accent".
    (status == 0).then_some(data)
}

#[cfg(target_os = "macos")]
fn accent() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleHighlightColor"])
        .output()
        .ok()?;
    apple_accent(&String::from_utf8_lossy(&output.stdout))
}

/// GNOME keeps the accent in gsettings, KDE in kdeglobals: ask both, the first
/// that answers wins. A desktop that keeps it elsewhere leaves the title bar on
/// the app's own colours.
#[cfg(target_os = "linux")]
fn accent() -> Option<String> {
    command(
        "gsettings",
        &["get", "org.gnome.desktop.interface", "accent-color"],
    )
    .and_then(|text| gnome_accent(&text))
    .or_else(|| {
        ["kreadconfig6", "kreadconfig5"].iter().find_map(|tool| {
            command(
                tool,
                &[
                    "--file",
                    "kdeglobals",
                    "--group",
                    "General",
                    "--key",
                    "AccentColor",
                ],
            )
            .and_then(|text| kde_accent(&text))
        })
    })
}

#[cfg(target_os = "linux")]
fn command(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caption_ink_follows_brightness() {
        // Windows' own captions: black on the light cyan, white on a dark blue.
        assert_eq!(caption_ink("#00b7c3"), "#000000");
        assert_eq!(caption_ink("#0078d4"), "#ffffff");
        assert_eq!(caption_ink("not a colour"), "#ffffff");
    }

    #[test]
    fn apple_colours_parse() {
        assert_eq!(
            apple_accent("0.968627 0.831373 1.000000 Purple\n").as_deref(),
            Some("#f7d4ff")
        );
        assert_eq!(apple_accent("#3DAEE9\n").as_deref(), Some("#3daee9"));
        assert_eq!(apple_accent("").as_deref(), None);
    }

    #[test]
    fn gnome_names_map_to_its_palette() {
        assert_eq!(gnome_accent("'teal'\n").as_deref(), Some("#2190a4"));
        assert_eq!(gnome_accent("'none'").as_deref(), None);
    }

    #[test]
    fn kde_colours_parse() {
        assert_eq!(kde_accent("61,174,233\n").as_deref(), Some("#3daee9"));
        assert_eq!(kde_accent("#3DAEE9").as_deref(), Some("#3daee9"));
        assert_eq!(kde_accent("").as_deref(), None);
    }
}