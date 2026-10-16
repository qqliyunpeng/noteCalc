//! Expression evaluation, ported from `calculator_core.py`.

use std::collections::HashMap;
use std::sync::OnceLock;

use super::parser::{CalcResult, Node, Parser};
use super::units::find_unit;
use super::value::{convert_unit, is_unit_value, number_from, number_of, ListStyle, Value};

pub fn constants() -> &'static HashMap<String, f64> {
    static CONSTANTS: OnceLock<HashMap<String, f64>> = OnceLock::new();
    CONSTANTS.get_or_init(|| {
        let mut table = HashMap::new();
        table.insert("pi".to_string(), std::f64::consts::PI);
        table.insert("PI".to_string(), std::f64::consts::PI);
        table.insert("e".to_string(), std::f64::consts::E);
        table.insert("E".to_string(), std::f64::consts::E);
        table
    })
}

pub fn function_names() -> &'static [&'static str] {
    &[
        "sqrt", "cbrt", "abs", "sign", "ceil", "floor", "round", "sin", "cos", "tan", "asin",
        "acos", "atan", "atan2", "log", "log2", "log10", "exp", "pow", "max", "min", "mod",
    ]
}

fn map_vector<F>(value: &Value, operation: &F) -> CalcResult<Value>
where
    F: Fn(&Value) -> CalcResult<Value>,
{
    match value {
        Value::List(items, style) => {
            let mut mapped = Vec::with_capacity(items.len());
            for item in items {
                mapped.push(map_vector(item, operation)?);
            }
            Ok(Value::List(mapped, *style))
        }
        other => operation(other),
    }
}

/// Punctuation of the first list among `arguments`: element-wise results echo
/// the first array they were built from.
fn list_style_of(arguments: &[Value]) -> Option<ListStyle> {
    arguments.iter().find_map(|argument| match argument {
        Value::List(_, style) => Some(*style),
        _ => None,
    })
}

fn domain_error(name: &str) -> String {
    format!("函数 {name} 的参数超出定义域")
}

fn arity_error(name: &str) -> String {
    format!("函数 {name} 的参数数量不正确")
}

fn evaluate_scalar(name: &str, arguments: &[f64]) -> CalcResult<f64> {
    let first = arguments.first().copied().unwrap_or(f64::NAN);
    match name {
        "sqrt" => {
            if first < 0.0 {
                return Err(domain_error(name));
            }
            Ok(first.sqrt())
        }
        "cbrt" => Ok(first.abs().powf(1.0 / 3.0).copysign(first)),
        "abs" => Ok(first.abs()),
        "sign" => Ok(if first > 0.0 {
            1.0
        } else if first < 0.0 {
            -1.0
        } else {
            0.0
        }),
        "ceil" => Ok(first.ceil()),
        "floor" => Ok(first.floor()),
        "round" => Ok(first.round_ties_even()),
        "sin" => Ok(first.sin()),
        "cos" => Ok(first.cos()),
        "tan" => Ok(first.tan()),
        "asin" => {
            if first.abs() > 1.0 {
                return Err(domain_error(name));
            }
            Ok(first.asin())
        }
        "acos" => {
            if first.abs() > 1.0 {
                return Err(domain_error(name));
            }
            Ok(first.acos())
        }
        "atan" => Ok(first.atan()),
        "atan2" => Ok(first.atan2(arguments[1])),
        "log" => {
            if first <= 0.0 {
                return Err(domain_error(name));
            }
            Ok(first.ln())
        }
        "log2" => {
            if first <= 0.0 {
                return Err(domain_error(name));
            }
            Ok(first.log2())
        }
        "log10" => {
            if first <= 0.0 {
                return Err(domain_error(name));
            }
            Ok(first.log10())
        }
        "exp" => Ok(first.exp()),
        "pow" => Ok(first.powf(arguments[1])),
        "max" => Ok(arguments.iter().copied().fold(f64::NEG_INFINITY, f64::max)),
        "min" => Ok(arguments.iter().copied().fold(f64::INFINITY, f64::min)),
        "mod" => {
            let divisor = arguments[1];
            if divisor == 0.0 {
                return Ok(f64::NAN);
            }
            let remainder = first % divisor;
            if remainder != 0.0 && (remainder < 0.0) != (divisor < 0.0) {
                Ok(remainder + divisor)
            } else {
                Ok(remainder)
            }
        }
        _ => Err(format!("未知函数：{name}")),
    }
}

fn evaluate_function(name: &str, arguments: &[Value]) -> CalcResult<Value> {
    if !function_names().contains(&name) {
        return Err(format!("未知函数：{name}"));
    }

    let mut vector_lengths: Vec<usize> = Vec::new();
    for argument in arguments {
        if let Value::List(items, _) = argument {
            if !vector_lengths.contains(&items.len()) {
                vector_lengths.push(items.len());
            }
        }
    }
    if vector_lengths.len() > 1 {
        return Err("数组长度必须一致".to_string());
    }
    if let Some(length) = vector_lengths.first().copied() {
        let style = list_style_of(arguments).unwrap_or_default();
        let mut results = Vec::with_capacity(length);
        for index in 0..length {
            let mut element_arguments = Vec::with_capacity(arguments.len());
            for argument in arguments {
                match argument {
                    Value::List(items, _) => element_arguments.push(items[index].clone()),
                    other => element_arguments.push(other.clone()),
                }
            }
            results.push(evaluate_function(name, &element_arguments)?);
        }
        return Ok(Value::List(results, style));
    }

    let mut numeric_arguments = Vec::with_capacity(arguments.len());
    for argument in arguments {
        numeric_arguments.push(number_of(argument)?);
    }

    let count = numeric_arguments.len();
    let expected = match name {
        "atan2" | "pow" | "mod" => Some((2, 2)),
        "max" | "min" => Some((1, usize::MAX)),
        _ => Some((1, 1)),
    };
    if let Some((minimum, maximum)) = expected {
        if count < minimum || count > maximum {
            return Err(arity_error(name));
        }
    }

    Ok(Value::Number(evaluate_scalar(name, &numeric_arguments)?))
}

pub fn evaluate_node(node: &Node, scope: &HashMap<String, Value>) -> CalcResult<Value> {
    match node {
        Node::Number(number) => Ok(Value::Number(*number)),
        Node::Vector(items, style) => {
            let mut values = Vec::with_capacity(items.len());
            for item in items {
                values.push(evaluate_node(item, scope)?);
            }
            Ok(Value::List(values, *style))
        }
        Node::Variable(name) => {
            if let Some(constant) = constants().get(name) {
                return Ok(Value::Number(*constant));
            }
            if let Some(value) = scope.get(name) {
                return Ok(value.clone());
            }
            Err(format!("未定义变量：{name}"))
        }
        Node::Unary(operator, operand) => {
            let value = evaluate_node(operand, scope)?;
            map_vector(&value, &|item: &Value| match item {
                Value::Unit(number, unit) => Ok(Value::Unit(
                    if *operator == '-' { -number } else { *number },
                    unit,
                )),
                other => {
                    let number = number_from(other);
                    Ok(Value::Number(if *operator == '-' { -number } else { number }))
                }
            })
        }
        Node::Percent(inner) => {
            let value = evaluate_node(inner, scope)?;
            map_vector(&value, &|item: &Value| {
                Ok(Value::Number(number_of(item)? / 100.0))
            })
        }
        Node::Function(name, argument_nodes) => {
            let mut arguments = Vec::with_capacity(argument_nodes.len());
            for argument in argument_nodes {
                arguments.push(evaluate_node(argument, scope)?);
            }
            evaluate_function(name, &arguments)
        }
        Node::Unit(inner, unit_name) => {
            let value = evaluate_node(inner, scope)?;
            let unit = find_unit(unit_name)
                .ok_or_else(|| format!("未知单位：{unit_name}"))?
                .name;
            map_vector(&value, &|item: &Value| match item {
                Value::Unit(number, source_unit) => convert_unit(*number, source_unit, unit),
                other => Ok(Value::Unit(number_from(other), unit)),
            })
        }
        Node::Convert(inner, target_name) => {
            let value = evaluate_node(inner, scope)?;
            let target = target_name.clone();
            let convert = move |item: &Value| match item {
                Value::Unit(number, source_unit) => convert_unit(*number, source_unit, &target),
                _ => Err(format!("当前值没有单位，无法转换为 {target}")),
            };
            map_vector(&value, &convert)
        }
        Node::Binary(operator, left, right) => {
            let left_value = evaluate_node(left, scope)?;
            let right_value = evaluate_node(right, scope)?;
            evaluate_binary(*operator, &left_value, &right_value)
        }
    }
}

pub fn evaluate_binary(operator: char, left: &Value, right: &Value) -> CalcResult<Value> {
    if let Value::List(left_items, style) = left {
        if let Value::List(right_items, _) = right {
            if left_items.len() != right_items.len() {
                return Err("数组长度必须一致".to_string());
            }
            let mut results = Vec::with_capacity(left_items.len());
            for (left_item, right_item) in left_items.iter().zip(right_items.iter()) {
                results.push(evaluate_binary(operator, left_item, right_item)?);
            }
            return Ok(Value::List(results, *style));
        }
        let mut results = Vec::with_capacity(left_items.len());
        for left_item in left_items {
            results.push(evaluate_binary(operator, left_item, right)?);
        }
        return Ok(Value::List(results, *style));
    }
    if let Value::List(right_items, style) = right {
        let mut results = Vec::with_capacity(right_items.len());
        for right_item in right_items {
            results.push(evaluate_binary(operator, left, right_item)?);
        }
        return Ok(Value::List(results, *style));
    }

    let left_unit = is_unit_value(left);
    let right_unit = is_unit_value(right);

    if left_unit && right_unit {
        let (Value::Unit(left_number, left_unit_name), Value::Unit(right_number, right_unit_name)) =
            (left, right)
        else {
            unreachable!()
        };
        let left_definition = find_unit(left_unit_name);
        let right_definition = find_unit(right_unit_name);
        let (Some(left_definition), Some(right_definition)) = (left_definition, right_definition)
        else {
            return Err(format!(
                "无法对 {left_unit_name} 和 {right_unit_name} 进行运算"
            ));
        };
        if left_definition.category != right_definition.category {
            return Err(format!(
                "无法对 {left_unit_name} 和 {right_unit_name} 进行运算"
            ));
        }
        let left_base = left_definition.to_base(*left_number);
        let right_base = right_definition.to_base(*right_number);
        if operator == '+' || operator == '-' {
            let base_result = if operator == '+' {
                left_base + right_base
            } else {
                left_base - right_base
            };
            return Ok(Value::Unit(
                left_definition.from_base(base_result),
                left_unit_name,
            ));
        }
        if operator == '/' {
            if right_base == 0.0 {
                return Err("除数不能为零".to_string());
            }
            return Ok(Value::Number(left_base / right_base));
        }
        return Err(format!("不支持单位之间的“{operator}”运算"));
    }

    if let Value::Unit(number, unit) = left {
        let numeric_right = number_from(right);
        if operator == '*' {
            return Ok(Value::Unit(number * numeric_right, unit));
        }
        if operator == '/' {
            if numeric_right == 0.0 {
                return Err("除数不能为零".to_string());
            }
            return Ok(Value::Unit(number / numeric_right, unit));
        }
        return Err(format!("不支持带单位数值的“{operator}”运算"));
    }

    if let Value::Unit(number, unit) = right {
        if operator == '*' {
            return Ok(Value::Unit(number_from(left) * number, unit));
        }
        return Err(format!("不支持带单位数值的“{operator}”运算"));
    }

    let left_number = number_from(left);
    let right_number = number_from(right);
    match operator {
        '+' => Ok(Value::Number(left_number + right_number)),
        '-' => Ok(Value::Number(left_number - right_number)),
        '*' => Ok(Value::Number(left_number * right_number)),
        '/' => {
            if right_number == 0.0 {
                return Err("除数不能为零".to_string());
            }
            Ok(Value::Number(left_number / right_number))
        }
        '^' => Ok(Value::Number(left_number.powf(right_number))),
        other => Err(format!("未知运算符：{other}")),
    }
}

pub fn evaluate_expression(
    expression: &str,
    scope: Option<&HashMap<String, Value>>,
) -> CalcResult<Value> {
    if expression.chars().count() > 50000 {
        return Err("表达式过长".to_string());
    }
    let node = Parser::parse(expression)?;
    let empty = HashMap::new();
    evaluate_node(&node, scope.unwrap_or(&empty))
}
