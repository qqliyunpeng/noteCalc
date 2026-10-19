//! Keyboard shortcuts claimed by the platform webview.

/// WebView2 maps Ctrl+J to its "Show Downloads" pane. noteCalc never shows
/// downloads, so that one accelerator is consumed before the webview acts on
/// it; Ctrl+F, Ctrl+P and the other browser shortcuts keep their behaviour.
#[cfg(windows)]
pub fn suppress_webview_ctrl_j(window: &tauri::WebviewWindow) {
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_CONTROL, VK_J, VK_MENU, VK_SHIFT,
    };

    let _ = window.with_webview(|webview| {
        let controller = webview.controller();
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(|_controller, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN;
            let mut key = 0u32;
            unsafe {
                args.KeyEventKind(&mut kind)?;
                args.VirtualKey(&mut key)?;
            }
            if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                && key == u32::from(VK_J)
                && unsafe { GetKeyState(i32::from(VK_CONTROL)) } < 0
                && unsafe { GetKeyState(i32::from(VK_SHIFT)) } >= 0
                && unsafe { GetKeyState(i32::from(VK_MENU)) } >= 0
            {
                unsafe {
                    args.SetHandled(true)?;
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        unsafe {
            let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
        }
    });
}
