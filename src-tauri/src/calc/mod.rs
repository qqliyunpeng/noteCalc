//! Safe expression engine for the offline calculation notebook.
//!
//! Ported line by line from the Python reference implementation
//! (`calculator_core.py`) so the desktop app keeps the exact same behaviour,
//! including its Chinese diagnostics.

pub mod document;
pub mod eval;
pub mod parser;
pub mod selfcheck;
pub mod units;
pub mod value;

use serde_json::json;

/// Names the editor needs for syntax highlighting.
pub fn metadata() -> serde_json::Value {
    let mut constants: Vec<String> = eval::constants().keys().cloned().collect();
    constants.sort();
    let mut units = units::unit_names();
    units.sort();
    json!({
        "functions": eval::function_names(),
        "constants": constants,
        "units": units,
    })
}