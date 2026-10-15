//! Acceptance suite for the ported engine.
//!
//! The repository's `cargo test` target cannot link on this machine (MinGW
//! toolchain quirk, see README), so the same assertions run from the app binary
//! itself: `notecalc.exe --check`.

use std::collections::HashMap;

use super::document::{calculate_document, looks_like_expression, LineResult};
use super::eval::evaluate_expression;
use super::value::{format_value, Value};

fn numeric(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => Some(*number),
        _ => None,
    }
}

fn numeric_list(value: &Value) -> Option<Vec<f64>> {
    match value {
        Value::List(items) => items.iter().map(numeric).collect(),
        _ => None,
    }
}

fn render(expr: &str, precision: u32) -> Result<String, String> {
    let value = evaluate_expression(expr, None).map_err(|error| format!("{expr} → {error}"))?;
    Ok(format_value(&value, precision))
}

fn expect_number(expr: &str, expected: f64) -> Result<(), String> {
    let value = evaluate_expression(expr, None)?;
    let actual = numeric(&value).ok_or_else(|| format!("{expr} → 不是数字"))?;
    if (actual - expected).abs() <= 1e-10_f64.max(1e-10 * expected.abs()) {
        Ok(())
    } else {
        Err(format!("{expr} → 得到 {actual}，期望 {expected}"))
    }
}

fn expect_text(expr: &str, expected: &str) -> Result<(), String> {
    let actual = render(expr, 4)?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{expr} → 得到 {actual}，期望 {expected}"))
    }
}

fn expect_list(expr: &str, expected: &[f64]) -> Result<(), String> {
    let value = evaluate_expression(expr, None)?;
    let actual = numeric_list(&value).ok_or_else(|| format!("{expr} → 不是数组"))?;
    if actual.len() == expected.len()
        && actual
            .iter()
            .zip(expected.iter())
            .all(|(left, right)| (left - right).abs() <= 1e-10)
    {
        Ok(())
    } else {
        Err(format!("{expr} → 得到 {actual:?}，期望 {expected:?}"))
    }
}

fn expect_unit(expr: &str, unit: &str, expected: f64) -> Result<(), String> {
    let value = evaluate_expression(expr, None)?;
    match value {
        Value::Unit(number, actual_unit) => {
            if actual_unit == unit && (number - expected).abs() <= 1e-9 {
                Ok(())
            } else {
                Err(format!(
                    "{expr} → 得到 {number} {actual_unit}，期望 {expected} {unit}"
                ))
            }
        }
        other => Err(format!("{expr} → 不是带单位的值：{other:?}")),
    }
}

fn expect_types(content: &str, expected: &[&str]) -> Result<(), String> {
    let (results, _) = calculate_document(content, 4)?;
    let actual: Vec<&str> = results.iter().map(|result| result.kind).collect();
    if actual == expected {
        Ok(())
    } else {
        Err(format!("得到 {actual:?}，期望 {expected:?}"))
    }
}

fn expect_line_result(
    content: &str,
    index: usize,
    kind: &str,
    result: Option<&str>,
) -> Result<(), String> {
    let (results, _) = calculate_document(content, 4)?;
    let line: &LineResult = results
        .get(index)
        .ok_or_else(|| format!("第 {index} 行不存在（共 {} 行）", results.len()))?;
    if line.kind != kind {
        return Err(format!("第 {index} 行类型为 {}，期望 {kind}", line.kind));
    }
    if line.result.as_deref() != result {
        return Err(format!(
            "第 {index} 行结果为 {:?}，期望 {:?}",
            line.result, result
        ));
    }
    Ok(())
}

fn expect_error(content: &str, needle: &str) -> Result<(), String> {
    let (results, _) = calculate_document(content, 4)?;
    let line = results
        .iter()
        .find(|line| line.kind == "error")
        .ok_or_else(|| format!("没有错误行：{content}"))?;
    let error = line.error.clone().unwrap_or_default();
    if error.contains(needle) {
        Ok(())
    } else {
        Err(format!("错误信息 {error:?} 不含 {needle:?}"))
    }
}

fn expect_scope(content: &str, expected: &[(&str, f64)]) -> Result<(), String> {
    let (_, scope) = calculate_document(content, 4)?;
    for (name, value) in expected {
        match scope.get(*name).and_then(numeric) {
            Some(actual) if (actual - value).abs() <= 1e-10 => {}
            Some(actual) => return Err(format!("{name} = {actual}，期望 {value}")),
            None => return Err(format!("作用域缺少 {name}")),
        }
    }
    Ok(())
}

fn expect_scope_list(content: &str, name: &str, expected: &[f64]) -> Result<(), String> {
    let (_, scope) = calculate_document(content, 4)?;
    let actual = scope
        .get(name)
        .and_then(numeric_list)
        .ok_or_else(|| format!("作用域缺少数组 {name}"))?;
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{name} = {actual:?}，期望 {expected:?}"))
    }
}

pub fn run() -> i32 {
    let mut passed = 0usize;
    let mut failures: Vec<String> = Vec::new();

    macro_rules! case {
        ($name:expr, $body:block) => {{
            let outcome: Result<(), String> = (|| -> Result<(), String> { $body })();
            match outcome {
                Ok(()) => {
                    passed += 1;
                    println!("  ok   {}", $name);
                }
                Err(error) => {
                    println!("  FAIL {} → {error}", $name);
                    failures.push(format!("{} → {error}", $name));
                }
            }
        }};
    }

    println!("引擎自检（对照 test_calculator_core.py）");

    case!("运算符优先级与乘方", {
        expect_number("2 + 3 * 4", 14.0)?;
        expect_number("2^3^2", 512.0)?;
        expect_number("-2^2", -4.0)
    });
    case!("十六进制字面量", {
        expect_number("0x2D0", 720.0)?;
        expect_number("0x2D0 + 0X10", 736.0)?;
        expect_line_result("address = 0x2D0\naddress * 2", 0, "assignment", Some("720"))?;
        expect_line_result("address = 0x2D0\naddress * 2", 1, "expression", Some("1440"))?;
        expect_scope("address = 0x2D0\naddress * 2", &[("address", 720.0)])
    });
    case!("函数、常量与百分比", {
        expect_number("sin(PI / 2)", 1.0)?;
        expect_number("200 * 15%", 30.0)?;
        expect_number("max(1, 8, 3)", 8.0)
    });
    case!("中文变量", {
        expect_line_result(
            "价格 = 99.5\n数量 = 5\n总价 = 价格 * 数量",
            2,
            "assignment",
            Some("497.5"),
        )?;
        expect_scope("价格 = 99.5\n数量 = 5\n总价 = 价格 * 数量", &[("总价", 497.5)])
    });
    case!("行内多赋值（逗号/分号）", {
        let content = "x11=129, y11=240, x12=266, y12=432\nwidth=x12-x11; height=y12-y11";
        expect_line_result(content, 0, "assignment", Some("432"))?;
        expect_line_result(content, 1, "assignment", Some("192"))?;
        expect_scope(
            content,
            &[
                ("x11", 129.0),
                ("y11", 240.0),
                ("x12", 266.0),
                ("y12", 432.0),
                ("width", 137.0),
                ("height", 192.0),
            ],
        )
    });
    case!("括号内的分隔符不算多赋值", {
        expect_line_result("values=[1, 2, 3], maximum=max(1, 8, 3)", 0, "assignment", Some("8"))?;
        expect_scope_list("values=[1, 2, 3], maximum=max(1, 8, 3)", "values", &[1.0, 2.0, 3.0])?;
        expect_scope("values=[1, 2, 3], maximum=max(1, 8, 3)", &[("maximum", 8.0)])
    });
    case!("全角分隔符", {
        expect_scope("x=1，y=2；total=x+y", &[("x", 1.0), ("y", 2.0), ("total", 3.0)])
    });
    case!("单位换算", { expect_unit("5 kg to g", "g", 5000.0) });
    case!("温度换算", { expect_unit("32 °F to °C", "°C", 0.0) });
    case!("单位参与运算", {
        expect_unit("10 km / 2", "km", 5.0)?;
        expect_unit("2 m + 30 cm", "m", 2.3)
    });
    case!("等式校验", {
        let (results, _) = calculate_document("sqrt(16) = 4\n1 + 1 = 3", 4)?;
        if results[0].is_correct == Some(true) && results[1].is_correct == Some(false) {
            Ok(())
        } else {
            Err(format!("得到 {:?}/{:?}", results[0].is_correct, results[1].is_correct))
        }
    });
    case!("尾部等号补全", {
        expect_line_result("price = 12\ncount = 3\nprice * count =", 2, "completion", Some("36"))
    });
    case!("普通文字不报错", {
        expect_line_result("购物清单", 0, "normal", None)?;
        expect_line_result("### 三级标题", 0, "normal", None)
    });
    case!("除零报错", { expect_error("10 / 0", "零") });
    case!("圆括号向量逐元素运算", {
        expect_list("(100, 200, 300) / 10", &[10.0, 20.0, 30.0])
    });
    case!("方括号向量", {
        expect_list("[1, 2, 3] + 5", &[6.0, 7.0, 8.0])?;
        expect_list("[1, 2, 3] * [4, 5, 6]", &[4.0, 10.0, 18.0])
    });
    case!("花括号向量", {
        expect_list("{100, 200, 300} / 10", &[10.0, 20.0, 30.0])?;
        expect_list("｛1，2，3｝ + 1", &[2.0, 3.0, 4.0])
    });
    case!("花括号空白分隔", {
        expect_list("{680 88  1128  900} / 4", &[170.0, 22.0, 282.0, 225.0])
    });
    case!("函数逐元素作用", {
        expect_list("sqrt([1, 4, 9])", &[1.0, 2.0, 3.0])?;
        expect_list("pow([2, 3], 2)", &[4.0, 9.0])
    });
    case!("向量变量与格式化", {
        expect_scope_list("数据 = [100, 200, 300]\n数据 / 10", "数据", &[100.0, 200.0, 300.0])?;
        expect_line_result("数据 = [100, 200, 300]\n数据 / 10", 1, "expression", Some("[10, 20, 30]"))
    });
    case!("向量长度必须一致", { expect_error("[1, 2] + [3]", "长度") });
    case!("向量表达式跨行", {
        expect_types(
            "{100,\n200,\n300} / 10",
            &["continuation", "continuation", "expression"],
        )?;
        expect_line_result("{100,\n200,\n300} / 10", 2, "expression", Some("[10, 20, 30]"))
    });
    case!("跨行向量赋值", {
        let content = "数据 = [\n100,\n200\n]\n数据 / 10";
        expect_scope_list(content, "数据", &[100.0, 200.0])?;
        expect_line_result(content, 3, "assignment", Some("[100, 200]"))?;
        expect_line_result(content, 4, "expression", Some("[10, 20]"))
    });
    case!("空行取消续行", {
        expect_types("[100,\n\n2 + 3", &["continuation", "empty", "expression"])?;
        expect_line_result("[100,\n\n2 + 3", 2, "expression", Some("5"))
    });
    case!("未闭合的跨行表达式", { expect_error("[1,\n2", "未闭合") });
    case!("小数位设置", {
        let value = evaluate_expression("1 / 3", None)?;
        if format_value(&value, 4) == "0.3333" && format_value(&value, 6) == "0.333333" {
            Ok(())
        } else {
            Err(format!(
                "得到 {} / {}",
                format_value(&value, 4),
                format_value(&value, 6)
            ))
        }
    });
    case!("数字格式化", {
        expect_text("2 + 0.5", "2.5")?;
        expect_text("1 / 3", "0.3333")?;
        expect_text("100 / 7", "14.2857")?;
        expect_text("2^60", "1.153e+18")?;
        expect_text("1e3", "1000")
    });
    case!("排版行类型", {
        expect_types(
            "# 标题\n## 副标题\n// 注释\n\n2 + 2",
            &["title", "subtitle", "comment", "empty", "expression"],
        )
    });
    case!("范围与单位错误", {
        expect_error("sqrt(-1)", "定义域")?;
        expect_error("2 m + 3 kg", "无法对")?;
        expect_error("foo + 1", "未定义变量")
    });
    case!("普通文字判定", {
        let scope: HashMap<String, Value> = HashMap::new();
        if looks_like_expression("2 + 2", &scope)
            && !looks_like_expression("购物清单", &scope)
            && looks_like_expression("5 kg", &scope)
        {
            Ok(())
        } else {
            Err("looks_like_expression 判定不符".to_string())
        }
    });

    println!();
    if failures.is_empty() {
        println!("全部通过：{passed} 项");
        0
    } else {
        println!("{passed} 项通过，{} 项失败", failures.len());
        for failure in &failures {
            println!("  - {failure}");
        }
        1
    }
}