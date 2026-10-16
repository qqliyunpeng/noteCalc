//! Values produced by the engine: numbers, unit-carrying numbers and vectors.

use serde_json::{json, Value as Json};

use super::units::{find_unit, UnitDefinition};

/// How the elements of a list literal were separated, so a result keeps the
/// same punctuation as the expression that produced it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListSeparator {
    Comma,
    Space,
}

/// The punctuation a list was written with: `[1, 2]`, `[1 2]`, `(1, 2)`,
/// `{1 2}`, `"1 2"` or `'1, 2'`. Results reuse it, so `"100 1000 10" / 5`
/// reads back as `"20 200 2"` instead of `[20, 200, 2]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ListStyle {
    pub open: char,
    pub close: char,
    pub separator: ListSeparator,
}

impl ListStyle {
    pub fn separator_text(self) -> &'static str {
        match self.separator {
            ListSeparator::Comma => ", ",
            ListSeparator::Space => " ",
        }
    }
}

/// Style of the lists the engine builds on its own: `[1, 2]`.
impl Default for ListStyle {
    fn default() -> Self {
        ListStyle {
            open: '[',
            close: ']',
            separator: ListSeparator::Comma,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Value {
    Number(f64),
    Unit(f64, &'static str),
    List(Vec<Value>, ListStyle),
}

pub fn is_unit_value(value: &Value) -> bool {
    matches!(value, Value::Unit(_, _))
}

pub fn convert_unit(number: f64, source_name: &str, target_name: &str) -> Result<Value, String> {
    let source: &UnitDefinition =
        find_unit(source_name).ok_or_else(|| format!("未知单位：{source_name}"))?;
    let target: &UnitDefinition =
        find_unit(target_name).ok_or_else(|| format!("未知单位：{target_name}"))?;
    if source.category != target.category {
        return Err(format!("无法从 {} 转换到 {}", source.name, target.name));
    }
    Ok(Value::Unit(
        target.from_base(source.to_base(number)),
        target.name,
    ))
}

/// Mirrors Python's `_number`: rejects vectors and unit-carrying numbers.
pub fn number_of(value: &Value) -> Result<f64, String> {
    match value {
        Value::List(_, _) => Err("此处需要单个数字".to_string()),
        Value::Unit(_, _) => Err("此处需要无单位数字".to_string()),
        Value::Number(number) => Ok(*number),
    }
}

pub fn number_from(value: &Value) -> f64 {
    match value {
        Value::Number(number) => *number,
        Value::Unit(number, _) => *number,
        Value::List(_, _) => f64::NAN,
    }
}

pub fn format_number(value: f64, precision: u32) -> String {
    if !value.is_finite() {
        return if value.is_nan() {
            "nan".to_string()
        } else if value > 0.0 {
            "inf".to_string()
        } else {
            "-inf".to_string()
        };
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value.fract() == 0.0 && value.abs() < 1e16 {
        return format!("{}", value as i64);
    }
    if value.abs() >= 1e15 || value.abs() < 1e-10 {
        return format_exponential(value, precision.max(1).saturating_sub(1) as usize);
    }
    let text = format!("{:.*}", precision as usize, value);
    if precision == 0 {
        return text;
    }
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `1.153e+18` / `1.000e-10`, matching Python's `f"{value:.3e}"`.
fn format_exponential(value: f64, places: usize) -> String {
    let text = format!("{value:.places$e}", places = places);
    let Some((mantissa, exponent)) = text.split_once('e') else {
        return text;
    };
    let Ok(exponent) = exponent.parse::<i32>() else {
        return text;
    };
    let sign = if exponent < 0 { '-' } else { '+' };
    format!("{mantissa}e{sign}{:02}", exponent.abs())
}

pub fn format_value(value: &Value, precision: u32) -> String {
    match value {
        Value::List(items, style) => {
            let parts: Vec<String> = items
                .iter()
                .map(|item| format_value(item, precision))
                .collect();
            format!(
                "{}{}{}",
                style.open,
                parts.join(style.separator_text()),
                style.close
            )
        }
        Value::Unit(number, unit) => {
            format!("{} {}", format_number(*number, precision), unit)
        }
        Value::Number(number) => format_number(*number, precision),
    }
}

pub fn values_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::List(left_items, _), Value::List(right_items, _)) => {
            left_items.len() == right_items.len()
                && left_items
                    .iter()
                    .zip(right_items.iter())
                    .all(|(left_item, right_item)| values_equal(left_item, right_item))
        }
        (Value::List(_, _), _) | (_, Value::List(_, _)) => false,
        (Value::Unit(left_number, left_unit), Value::Unit(right_number, right_unit)) => {
            let (Some(left_definition), Some(right_definition)) =
                (find_unit(left_unit), find_unit(right_unit))
            else {
                return false;
            };
            if left_definition.category != right_definition.category {
                return false;
            }
            close(
                left_definition.to_base(*left_number),
                right_definition.to_base(*right_number),
            )
        }
        (Value::Unit(_, _), _) | (_, Value::Unit(_, _)) => false,
        (Value::Number(left_number), Value::Number(right_number)) => {
            close(*left_number, *right_number)
        }
    }
}

/// Mirrors `math.isclose(rel_tol=1e-10, abs_tol=1e-10)`.
fn close(left: f64, right: f64) -> bool {
    let tolerance = (1e-10 * left.abs().max(right.abs())).max(1e-10);
    (left - right).abs() <= tolerance
}

pub fn to_json(value: &Value) -> Json {
    match value {
        Value::Number(number) => json!(number),
        Value::List(items, _) => Json::Array(items.iter().map(to_json).collect()),
        Value::Unit(number, unit) => json!({ "value": number, "unit": unit }),
    }
}
