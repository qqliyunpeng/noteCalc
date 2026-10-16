//! Line/document level state machine, ported from `calculator_core.py`.
//!
//! The Python original leans on `re` for a handful of tiny patterns; they are
//! matched by hand here so the engine stays free of the `regex` crate, whose
//! MinGW import library overflows the linker's `.drectve` budget.

use std::collections::HashMap;

use serde::Serialize;

use super::eval::{constants, evaluate_expression, function_names};
use super::parser::normalize_expression;
use super::value::{format_value, values_equal, Value};

/// `\s` of Python's `re`, which uses the same `White_Space` property as
/// `char::is_whitespace`.
fn is_space(character: char) -> bool {
    character.is_whitespace()
}

/// `\d` of Python's `re` (Unicode decimal digits). `char::is_numeric` also
/// accepts the `Nl`/`No` categories, which never occur in notebook input.
fn is_digit(character: char) -> bool {
    character.is_numeric()
}

/// `[A-Za-z_\u3400-\u9fff]`
fn is_ascii_identifier_start(character: char) -> bool {
    character == '_'
        || character.is_ascii_alphabetic()
        || ('\u{3400}'..='\u{9fff}').contains(&character)
}

/// `[A-Za-z0-9_\u3400-\u9fff]`
fn is_ascii_identifier_body(character: char) -> bool {
    is_ascii_identifier_start(character) || character.is_ascii_digit()
}

/// `[A-Za-z°\u3400-\u9fff²]`
fn is_unit_character(character: char) -> bool {
    character.is_ascii_alphabetic()
        || character == '°'
        || character == '²'
        || ('\u{3400}'..='\u{9fff}').contains(&character)
}

/// `\w` as used by the word boundaries below.
fn is_word_character(character: char) -> bool {
    character == '_' || character.is_alphanumeric()
}

/// `^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*$`
fn is_identifier(text: &str) -> bool {
    match text.chars().next() {
        Some(first) if is_ascii_identifier_start(first) => {}
        _ => return false,
    }
    text.chars().skip(1).all(is_ascii_identifier_body)
}

/// Byte offset just past a leading identifier run, or `None` when the text does
/// not start with one.
fn identifier_prefix(text: &str) -> Option<usize> {
    let mut end = None;
    for (position, character) in text.char_indices() {
        let accepted = if position == 0 {
            is_ascii_identifier_start(character)
        } else {
            is_ascii_identifier_body(character)
        };
        if !accepted {
            return end;
        }
        end = Some(position + character.len_utf8());
    }
    end
}

/// The `\s*(.+)$` tail of an assignment, including its backtracking quirk: when
/// everything left is whitespace, Python's `\s*` has to give one character back
/// so that `.+` can match it.
fn assignment_value(rest: &str) -> &str {
    let trimmed = rest.trim_start_matches(is_space);
    if !trimmed.is_empty() {
        return trimmed;
    }
    match rest.chars().last() {
        Some(last) => &rest[rest.len() - last.len_utf8()..],
        None => "",
    }
}

/// `^(IDENT)\s*=\s*(.+)$` with `re.DOTALL`, used as `match`/`fullmatch`.
fn match_assignment(text: &str) -> Option<(&str, &str)> {
    let identifier_end = identifier_prefix(text)?;
    let rest = text[identifier_end..].trim_start_matches(is_space);
    let rest = rest.strip_prefix('=')?;
    Some((&text[..identifier_end], assignment_value(rest)))
}

/// `\d`, unanchored.
fn contains_digit(text: &str) -> bool {
    text.chars().any(is_digit)
}

/// `\bto\b` with `re.IGNORECASE`; both implementations use Unicode word
/// boundaries.
fn contains_to_keyword(text: &str) -> bool {
    let characters: Vec<char> = text.chars().collect();
    for (position, character) in characters.iter().enumerate() {
        if !character.eq_ignore_ascii_case(&'t') {
            continue;
        }
        let is_o = characters
            .get(position + 1)
            .is_some_and(|next| next.eq_ignore_ascii_case(&'o'));
        if !is_o {
            continue;
        }
        let before_is_word = position > 0 && is_word_character(characters[position - 1]);
        let after_is_word = characters
            .get(position + 2)
            .is_some_and(|next| is_word_character(*next));
        if !before_is_word && !after_is_word {
            return true;
        }
    }
    false
}

/// `[+\-*/^%()\[\]{},]|\bto\b` with `re.IGNORECASE`, unanchored.
fn contains_operator(text: &str) -> bool {
    text.chars().any(|character| {
        matches!(
            character,
            '+' | '-' | '*' | '/' | '^' | '%' | '(' | ')' | '[' | ']' | '{' | '}' | ','
        )
    }) || contains_to_keyword(text)
}

/// `^[\d.]+\s*[A-Za-z°\u3400-\u9fff²]+$`. The three character classes are
/// disjoint, so the split needs no backtracking.
fn is_number_unit_literal(text: &str) -> bool {
    let mut characters = text.char_indices().peekable();
    let mut digits = 0usize;
    while let Some((_, character)) = characters.peek() {
        if !is_digit(*character) && *character != '.' {
            break;
        }
        digits += 1;
        characters.next();
    }
    if digits == 0 {
        return false;
    }
    while let Some((_, character)) = characters.peek() {
        if !is_space(*character) {
            break;
        }
        characters.next();
    }
    let mut units = 0usize;
    for (_, character) in characters {
        if !is_unit_character(character) {
            return false;
        }
        units += 1;
    }
    units > 0
}

/// `^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*\s*=\s*[\[({]`
fn starts_assignment_vector(text: &str) -> bool {
    let identifier_end = match identifier_prefix(text) {
        Some(end) => end,
        None => return false,
    };
    let rest = text[identifier_end..].trim_start_matches(is_space);
    let rest = match rest.strip_prefix('=') {
        Some(rest) => rest,
        None => return false,
    };
    matches!(
        rest.trim_start_matches(is_space).chars().next(),
        Some('[' | '(' | '{' | '"' | '\'')
    )
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineResult {
    pub line: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub result: Option<String>,
    pub error: Option<String>,
    pub is_correct: Option<bool>,
    pub variable: Option<String>,
}

impl LineResult {
    fn plain(line: &str, kind: &'static str) -> Self {
        LineResult {
            line: line.to_string(),
            kind,
            result: None,
            error: None,
            is_correct: None,
            variable: None,
        }
    }

    fn failed(line: &str, error: String, variable: Option<String>) -> Self {
        LineResult {
            line: line.to_string(),
            kind: "error",
            result: None,
            error: Some(error),
            is_correct: None,
            variable,
        }
    }
}

pub fn split_inline_assignments(expression: &str) -> Option<Vec<(String, String)>> {
    let mut parts: Vec<String> = Vec::new();
    let mut start = 0usize;
    let mut stack: Vec<char> = Vec::new();
    for (position, character) in expression.char_indices() {
        match character {
            // Quotes delimit lists too, so a separator inside them separates
            // elements rather than assignments.
            '"' | '\'' => {
                if stack.last() == Some(&character) {
                    stack.pop();
                } else {
                    stack.push(character);
                }
            }
            '(' | '[' | '{' => stack.push(character),
            ')' | ']' | '}' => {
                let opening = match character {
                    ')' => '(',
                    ']' => '[',
                    _ => '{',
                };
                if stack.last() == Some(&opening) {
                    stack.pop();
                }
            }
            ',' | ';' | '\u{ff0c}' | '\u{ff1b}' if stack.is_empty() => {
                parts.push(expression[start..position].trim().to_string());
                start = position + character.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(expression[start..].trim().to_string());

    if parts.len() < 2 || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    let mut assignments = Vec::with_capacity(parts.len());
    for part in &parts {
        let (variable, value) = match_assignment(part)?;
        let variable = variable.to_string();
        let value = value.to_string();
        if value.contains('=') {
            return None;
        }
        assignments.push((variable, value));
    }
    Some(assignments)
}

pub fn looks_like_expression(line: &str, scope: &HashMap<String, Value>) -> bool {
    if contains_digit(line) && contains_operator(line) {
        return true;
    }
    // `"100 200` is an unterminated list, not prose; an apostrophe inside a
    // line (`it's 3`) does not start it and stays text.
    if line.starts_with('"') || line.starts_with('\'') {
        return true;
    }
    if scope.contains_key(line) || constants().contains_key(line) {
        return true;
    }
    if function_names()
        .iter()
        .any(|name| line.starts_with(&format!("{name}(")))
    {
        return true;
    }
    is_number_unit_literal(line)
}

pub fn bracket_balance(expression: &str) -> i32 {
    let mut stack: Vec<char> = Vec::new();
    let mut quote: Option<char> = None;
    for character in normalize_expression(expression).chars() {
        if let Some(opening) = quote {
            if character == opening {
                quote = None;
            }
            continue;
        }
        match character {
            '"' | '\'' => quote = Some(character),
            '(' | '[' | '{' => stack.push(character),
            ')' | ']' | '}' => {
                let opening = match character {
                    ')' => '(',
                    ']' => '[',
                    _ => '{',
                };
                if stack.last() != Some(&opening) {
                    return -1;
                }
                stack.pop();
            }
            _ => {}
        }
    }
    stack.len() as i32 + i32::from(quote.is_some())
}

pub fn can_start_multiline_expression(line: &str, scope: &HashMap<String, Value>) -> bool {
    let stripped = line.trim();
    if looks_like_expression(stripped, scope) {
        return true;
    }
    if starts_assignment_vector(stripped) {
        return true;
    }
    if stripped == "(" || stripped == "[" || stripped == "{" {
        return true;
    }
    match stripped.chars().next() {
        Some('"') | Some('\'') => true,
        Some(first) if first == '(' || first == '[' || first == '{' => stripped.contains(','),
        _ => false,
    }
}

pub fn calculate_expression_line(
    expression: &str,
    display_line: &str,
    scope: &mut HashMap<String, Value>,
    precision: u32,
) -> LineResult {
    let stripped = expression.trim();
    if stripped.is_empty() {
        return LineResult::plain(display_line, "empty");
    }
    if stripped.starts_with("//") {
        return LineResult::plain(display_line, "comment");
    }
    if stripped.starts_with("## ") {
        return LineResult::plain(display_line, "subtitle");
    }
    if stripped.starts_with("# ") {
        return LineResult::plain(display_line, "title");
    }

    if let Some(inline_assignments) = split_inline_assignments(stripped) {
        let mut updated_scope = scope.clone();
        let mut last_variable: Option<String> = None;
        let mut last_value: Option<Value> = None;
        for (variable, assigned_expression) in inline_assignments {
            let evaluated = evaluate_expression(&assigned_expression, Some(&updated_scope));
            match evaluated {
                Err(error) => {
                    return LineResult::failed(display_line, error, Some(variable));
                }
                Ok(value) => {
                    updated_scope.insert(variable.clone(), value.clone());
                    last_variable = Some(variable);
                    last_value = Some(value);
                }
            }
        }
        scope.extend(updated_scope);
        return LineResult {
            line: display_line.to_string(),
            kind: "assignment",
            result: Some(format_value(
                last_value.as_ref().expect("assignment produced a value"),
                precision,
            )),
            error: None,
            is_correct: None,
            variable: last_variable,
        };
    }

    if let Some((variable, assigned_expression)) = match_assignment(stripped) {
        let variable = variable.to_string();
        if !assigned_expression.contains('=') {
            let evaluated = evaluate_expression(assigned_expression, Some(scope));
            match evaluated {
                Err(error) => {
                    return LineResult::failed(display_line, error, Some(variable));
                }
                Ok(value) => {
                    scope.insert(variable.clone(), value.clone());
                    return LineResult {
                        line: display_line.to_string(),
                        kind: "assignment",
                        result: Some(format_value(&value, precision)),
                        error: None,
                        is_correct: None,
                        variable: Some(variable),
                    };
                }
            }
        }
    }

    if stripped.ends_with('=') && stripped.matches('=').count() == 1 {
        let left_expression = stripped[..stripped.len() - 1].trim();
        if !left_expression.is_empty() && !is_identifier(left_expression) {
            match evaluate_expression(left_expression, Some(scope)) {
                Err(error) => return LineResult::failed(display_line, error, None),
                Ok(value) => {
                    return LineResult {
                        line: display_line.to_string(),
                        kind: "completion",
                        result: Some(format_value(&value, precision)),
                        error: None,
                        is_correct: None,
                        variable: None,
                    }
                }
            }
        }
    }

    if stripped.contains('=') {
        if let Some((left_expression, right_expression)) = stripped.split_once('=') {
            let left_expression = left_expression.trim();
            let right_expression = right_expression.trim();
            if !left_expression.is_empty()
                && !right_expression.is_empty()
                && !is_identifier(left_expression)
            {
                let left = evaluate_expression(left_expression, Some(scope));
                let right = evaluate_expression(right_expression, Some(scope));
                match (left, right) {
                    (Ok(left), Ok(right)) => {
                        return LineResult {
                            line: display_line.to_string(),
                            kind: "equation",
                            result: Some(format_value(&left, precision)),
                            error: None,
                            is_correct: Some(values_equal(&left, &right)),
                            variable: None,
                        }
                    }
                    (Err(error), _) => return LineResult::failed(display_line, error, None),
                    (_, Err(error)) => return LineResult::failed(display_line, error, None),
                }
            }
        }
    }

    match evaluate_expression(stripped, Some(scope)) {
        Ok(value) => {
            let kind = if contains_to_keyword(stripped) {
                "unit_conversion"
            } else {
                "expression"
            };
            LineResult {
                line: display_line.to_string(),
                kind,
                result: Some(format_value(&value, precision)),
                error: None,
                is_correct: None,
                variable: None,
            }
        }
        Err(error) => {
            if looks_like_expression(stripped, scope) {
                LineResult::failed(display_line, error, None)
            } else {
                LineResult::plain(display_line, "normal")
            }
        }
    }
}

pub fn calculate_document(
    content: &str,
    precision: u32,
) -> Result<(Vec<LineResult>, HashMap<String, Value>), String> {
    let lines: Vec<&str> = content.split('\n').collect();
    if lines.len() > 2000 {
        return Err("笔记不能超过 2000 行".to_string());
    }
    let mut scope: HashMap<String, Value> = HashMap::new();
    let mut results: Vec<LineResult> = Vec::with_capacity(lines.len());
    let mut pending: Vec<String> = Vec::new();

    for raw_line in lines {
        let line = raw_line.trim_end_matches('\r');
        let stripped = line.trim();
        if !pending.is_empty() {
            if stripped.is_empty() {
                pending.clear();
                results.push(LineResult::plain(line, "empty"));
                continue;
            }
            pending.push(line.to_string());
            results.push(LineResult::plain(line, "continuation"));
            let combined = pending.join("\n");
            if bracket_balance(&combined) <= 0 {
                let last = results.len() - 1;
                results[last] = calculate_expression_line(&combined, line, &mut scope, precision);
                pending.clear();
            }
            continue;
        }
        if stripped.is_empty()
            || stripped.starts_with("//")
            || stripped.starts_with("# ")
            || stripped.starts_with("## ")
        {
            results.push(calculate_expression_line(line, line, &mut scope, precision));
            continue;
        }
        if bracket_balance(line) > 0 && can_start_multiline_expression(line, &scope) {
            pending.push(line.to_string());
            results.push(LineResult::plain(line, "continuation"));
            continue;
        }
        results.push(calculate_expression_line(line, line, &mut scope, precision));
    }

    if !pending.is_empty() && !results.is_empty() {
        let last = results.len() - 1;
        results[last] = LineResult {
            line: results[last].line.clone(),
            kind: "error",
            result: None,
            error: Some("多行表达式未闭合".to_string()),
            is_correct: None,
            variable: None,
        };
    }

    Ok((results, scope))
}