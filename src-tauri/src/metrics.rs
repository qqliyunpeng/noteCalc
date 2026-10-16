//! Window chrome metrics the webview cannot read on its own.
//!
//! The title bar, the menu strip and the tab strip are self-drawn
//! (`decorations: false`, HTML), so the sizes a desktop gives its own chrome
//! never reach the layout by themselves: a webview inherits colours and the
//! device pixel ratio from the operating system, but no metric, and CSS has no
//! system keyword for a caption's or a menu bar's height. Windows answers for
//! all three — the frame it reserves above a standard window's client area,
//! `SM_CYMENU` with its menu font, and `SM_CYSMSIZE` for a tab — while macOS and
//! Linux draw that chrome through whatever the desktop picked and expose nothing
//! to read, so both stand on the values those desktops use, by convention.
//!
//! Everything is returned in logical CSS pixels, the unit the webview lays out
//! in, so a window on a scaled display keeps the same chrome at every zoom level.

use serde::Serialize;

/// Sizes for the self-drawn window chrome, in logical CSS pixels.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeMetrics {
    /// Height of the title bar row: the caption a standard window is given.
    pub title_height: f64,
    /// Row height of the menu strip, its bottom hairline included.
    pub menu_height: f64,
    /// Label size inside that strip.
    pub menu_font_size: f64,
    /// Height of one tab; the strip around it is the stylesheet's own padding.
    pub tab_height: f64,
    /// `true` when the desktop measured these values, `false` when they are the
    /// app's own value for that desktop.
    pub measured: bool,
}

/// Windows draws all three rows: the caption is the room it keeps above a
/// standard window's client area, `SM_CYMENU` is the menu strip with the menu
/// font (-12 for the usual 9pt) as its label, and `SM_CYSMSIZE` is the height of
/// the small controls a tab row is made of. Each is asked for at the window's
/// DPI, which `scale` carries, and divided back down to logical pixels so the
/// chrome keeps its size at every zoom level.
#[cfg(windows)]
pub fn chrome_metrics(scale: f64) -> ChromeMetrics {
    measured(scale).unwrap_or(ChromeMetrics {
        title_height: 31.0,
        menu_height: 20.0,
        menu_font_size: 12.0,
        tab_height: 22.0,
        measured: false,
    })
}

/// macOS keeps a window's menus in the menu bar along the top of the screen and
/// draws its own captions and tabs, so a strip inside the window has nothing
/// native to sit next to: 28pt is the title bar it gives a standard window, and
/// 24pt with the 13pt system UI font is what the screen menu bar uses.
#[cfg(target_os = "macos")]
pub fn chrome_metrics(_scale: f64) -> ChromeMetrics {
    ChromeMetrics {
        title_height: 28.0,
        menu_height: 24.0,
        menu_font_size: 13.0,
        tab_height: 28.0,
        measured: false,
    }
}

/// Linux leaves titles, menu bars and tabs to the toolkit each desktop picked
/// (GTK, KDE, Qt) and exposes no metric for them. A 30px title, a 26px strip
/// with a 13px label and 28px tabs sit in the middle of what those themes use;
/// the desktop fonts there (KDE 10pt, GNOME 11pt) are a step above the 12px
/// Windows menus use.
#[cfg(all(not(windows), not(target_os = "macos")))]
pub fn chrome_metrics(_scale: f64) -> ChromeMetrics {
    ChromeMetrics {
        title_height: 30.0,
        menu_height: 26.0,
        menu_font_size: 13.0,
        tab_height: 28.0,
        measured: false,
    }
}

/// The desktop's own numbers, or `None` when it cannot answer.
#[cfg(windows)]
fn measured(scale: f64) -> Option<ChromeMetrics> {
    use windows_sys::Win32::UI::HiDpi::{GetSystemMetricsForDpi, SystemParametersInfoForDpi};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        NONCLIENTMETRICSW, SM_CYMENU, SM_CYSMSIZE, SPI_GETNONCLIENTMETRICS,
    };

    // All of these answer in pixels for the DPI they are asked about, so asking
    // for the window's own DPI keeps the rows right on a scaled monitor. The
    // argument is clamped to the range Windows itself accepts.
    let dpi = (scale * 96.0).round().clamp(48.0, 768.0) as u32;

    let mut non_client = NONCLIENTMETRICSW::default();
    non_client.cbSize = std::mem::size_of::<NONCLIENTMETRICSW>() as u32;
    let answered = unsafe {
        SystemParametersInfoForDpi(
            SPI_GETNONCLIENTMETRICS,
            non_client.cbSize,
            std::ptr::addr_of_mut!(non_client).cast(),
            0,
            dpi,
        )
    };
    if answered == 0 {
        return None;
    }

    let title = caption(dpi)?;
    let strip = unsafe { GetSystemMetricsForDpi(SM_CYMENU, dpi) };
    let tab = unsafe { GetSystemMetricsForDpi(SM_CYSMSIZE, dpi) };
    // A character height is negative, which is the font size menus are drawn at.
    let label = -non_client.lfMenuFont.lfHeight;
    if strip <= 0 || tab <= 0 || label <= 0 {
        return None;
    }

    Some(ChromeMetrics {
        title_height: logical(f64::from(title), scale),
        menu_height: logical(f64::from(strip), scale),
        menu_font_size: logical(f64::from(label), scale),
        tab_height: logical(f64::from(tab), scale),
        measured: true,
    })
}

/// How much room Windows keeps above a standard window's client area: the
/// caption and its frame, as tall as the current theme and DPI draw them. Asking
/// for it instead of adding up `SM_CYCAPTION` and the frame metrics separately
/// keeps the title bar the same height as a window the desktop draws itself,
/// which is what the app sits next to.
#[cfg(windows)]
fn caption(dpi: u32) -> Option<i32> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::HiDpi::AdjustWindowRectExForDpi;
    use windows_sys::Win32::UI::WindowsAndMessaging::WS_OVERLAPPEDWINDOW;

    let mut frame = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let ok = unsafe { AdjustWindowRectExForDpi(&mut frame, WS_OVERLAPPEDWINDOW, 0, 0, dpi) };
    if ok == 0 {
        return None;
    }
    (frame.top < 0).then_some(-frame.top)
}

/// Pixels for the window's DPI, back to the logical pixels the webview lays out
/// in.
///
/// Rounded to a tenth: the menu strip at 175% is 19.4 of them, and seventeen
/// digits of that help nobody.
#[cfg(any(windows, test))]
fn logical(pixels: f64, scale: f64) -> f64 {
    if !(scale.is_finite() && scale > 0.0) {
        return pixels;
    }
    ((pixels / scale) * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_pixels_come_back_as_logical_ones() {
        // `SM_CYMENU` on a 100%, 125%, 150% and 175% desktop.
        assert_eq!(logical(20.0, 1.0), 20.0);
        assert_eq!(logical(25.0, 1.25), 20.0);
        assert_eq!(logical(30.0, 1.5), 20.0);
        assert_eq!(logical(34.0, 1.75), 19.4);
        // The menu font: 9pt, so 12px at 96 DPI and 18px at 144.
        assert_eq!(logical(12.0, 1.0), 12.0);
        assert_eq!(logical(18.0, 1.5), 12.0);
        // The caption a standard window is given, and one tab.
        assert_eq!(logical(31.0, 1.0), 31.0);
        assert_eq!(logical(39.0, 1.25), 31.2);
        assert_eq!(logical(22.0, 1.0), 22.0);
    }

    #[test]
    fn a_scale_that_cannot_be_divided_leaves_the_pixels_alone() {
        assert_eq!(logical(20.0, 0.0), 20.0);
        assert_eq!(logical(20.0, f64::NAN), 20.0);
    }
}
