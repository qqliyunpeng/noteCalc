// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `notecalc.exe --check` runs the engine acceptance suite without
    // opening a window; see src/calc/selfcheck.rs.
    if std::env::args().any(|argument| argument == "--check") {
        std::process::exit(notecalc_lib::run_engine_check());
    }
    notecalc_lib::run();
}