//! Tokenizer and recursive-descent parser, ported from `calculator_core.py`.

use super::units::find_unit;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenKind {
    Number,
    Identifier,
    To,
    Operator,
    Percent,
    LParen,
    RParen,
    LBracket,
    RBracket,
    LBrace,
    RBrace,
    Comma,
    Eof,
}

impl TokenKind {
    pub fn label(self) -> &'static str {
        match self {
            TokenKind::Number => "NUMBER",
            TokenKind::Identifier => "IDENTIFIER",
            TokenKind::To => "TO",
            TokenKind::Operator => "OPERATOR",
            TokenKind::Percent => "PERCENT",
            TokenKind::LParen => "LPAREN",
            TokenKind::RParen => "RPAREN",
            TokenKind::LBracket => "LBRACKET",
            TokenKind::RBracket => "RBRACKET",
            TokenKind::LBrace => "LBRACE",
            TokenKind::RBrace => "RBRACE",
            TokenKind::Comma => "COMMA",
            TokenKind::Eof => "EOF",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Token {
    pub kind: TokenKind,
    pub value: String,
    pub position: usize,
}

#[derive(Clone, Debug)]
pub enum Node {
    Number(f64),
    Vector(Vec<Node>),
    Variable(String),
    Unary(char, Box<Node>),
    Percent(Box<Node>),
    Function(String, Vec<Node>),
    Unit(Box<Node>, String),
    Convert(Box<Node>, String),
    Binary(char, Box<Node>, Box<Node>),
}

pub type CalcResult<T> = Result<T, String>;

pub fn normalize_expression(expression: &str) -> String {
    expression
        .chars()
        .map(|character| match character {
            '×' => '*',
            '÷' => '/',
            '−' => '-',
            '＋' => '+',
            '（' => '(',
            '）' => ')',
            '［' => '[',
            '］' => ']',
            '｛' => '{',
            '｝' => '}',
            '，' => ',',
            other => other,
        })
        .collect()
}

fn is_identifier_start(character: char) -> bool {
    character == '_' || character.is_alphabetic() || ('\u{3400}'..='\u{9fff}').contains(&character)
}

fn is_identifier_body(character: char) -> bool {
    is_identifier_start(character) || character.is_numeric()
}

fn parse_number_literal(text: &str) -> CalcResult<f64> {
    let lower = text.to_lowercase();
    if let Some(hex_digits) = lower.strip_prefix("0x") {
        let value = u128::from_str_radix(hex_digits, 16)
            .map_err(|_| format!("无法识别的数字“{text}”"))?;
        return Ok(value as f64);
    }
    text.parse::<f64>()
        .map_err(|_| format!("无法识别的数字“{text}”"))
}

pub fn tokenize(expression: &str) -> CalcResult<Vec<Token>> {
    let normalized = normalize_expression(expression);
    let characters: Vec<char> = normalized.chars().collect();
    let length = characters.len();
    let mut tokens: Vec<Token> = Vec::new();
    let mut position = 0usize;

    while position < length {
        let character = characters[position];
        if character.is_whitespace() {
            position += 1;
            continue;
        }
        if character == '0'
            && position + 1 < length
            && (characters[position + 1] == 'x' || characters[position + 1] == 'X')
        {
            let start = position;
            position += 2;
            let digit_start = position;
            while position < length && characters[position].is_ascii_hexdigit() {
                position += 1;
            }
            if digit_start == position {
                return Err(format!("十六进制数缺少数字（位置 {}）", start + 1));
            }
            tokens.push(Token {
                kind: TokenKind::Number,
                value: characters[start..position].iter().collect(),
                position: start,
            });
            continue;
        }
        if character.is_numeric()
            || (character == '.'
                && position + 1 < length
                && characters[position + 1].is_numeric())
        {
            let start = position;
            let mut has_dot = false;
            while position < length {
                let current = characters[position];
                if current.is_numeric() {
                    position += 1;
                } else if current == '.' && !has_dot {
                    has_dot = true;
                    position += 1;
                } else {
                    break;
                }
            }
            if position < length && (characters[position] == 'e' || characters[position] == 'E') {
                let exponent_position = position;
                position += 1;
                if position < length && (characters[position] == '+' || characters[position] == '-')
                {
                    position += 1;
                }
                let exponent_start = position;
                while position < length && characters[position].is_numeric() {
                    position += 1;
                }
                if exponent_start == position {
                    position = exponent_position;
                }
            }
            tokens.push(Token {
                kind: TokenKind::Number,
                value: characters[start..position].iter().collect(),
                position: start,
            });
            continue;
        }
        if is_identifier_start(character) {
            let start = position;
            position += 1;
            while position < length && is_identifier_body(characters[position]) {
                position += 1;
            }
            let word: String = characters[start..position].iter().collect();
            let kind = if word.to_lowercase() == "to" {
                TokenKind::To
            } else {
                TokenKind::Identifier
            };
            tokens.push(Token {
                kind,
                value: word,
                position: start,
            });
            continue;
        }
        if character == '°' {
            let start = position;
            position += 1;
            while position < length && characters[position].is_alphabetic() {
                position += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Identifier,
                value: characters[start..position].iter().collect(),
                position: start,
            });
            continue;
        }
        let kind = match character {
            '+' | '-' | '*' | '/' | '^' => Some(TokenKind::Operator),
            '%' => Some(TokenKind::Percent),
            '(' => Some(TokenKind::LParen),
            ')' => Some(TokenKind::RParen),
            '[' => Some(TokenKind::LBracket),
            ']' => Some(TokenKind::RBracket),
            '{' => Some(TokenKind::LBrace),
            '}' => Some(TokenKind::RBrace),
            ',' => Some(TokenKind::Comma),
            _ => None,
        };
        if let Some(kind) = kind {
            tokens.push(Token {
                kind,
                value: character.to_string(),
                position,
            });
            position += 1;
            continue;
        }
        return Err(format!("无法识别字符“{character}”（位置 {}）", position + 1));
    }

    if tokens.len() > 500 {
        return Err("表达式过于复杂，最多支持 500 个元素".to_string());
    }
    tokens.push(Token {
        kind: TokenKind::Eof,
        value: String::new(),
        position,
    });
    Ok(tokens)
}

pub struct Parser {
    tokens: Vec<Token>,
    index: usize,
}

impl Parser {
    pub fn parse(expression: &str) -> CalcResult<Node> {
        let mut parser = Parser {
            tokens: tokenize(expression)?,
            index: 0,
        };
        let node = parser.parse_conversion()?;
        if parser.peek().kind != TokenKind::Eof {
            let token = parser.peek().clone();
            return Err(format!(
                "意外内容“{}”（位置 {}）",
                token.value,
                token.position + 1
            ));
        }
        Ok(node)
    }

    fn peek(&self) -> &Token {
        &self.tokens[self.index]
    }

    fn advance(&mut self) -> Token {
        let token = self.tokens[self.index].clone();
        self.index += 1;
        token
    }

    fn expect(&mut self, kind: TokenKind) -> CalcResult<Token> {
        let token = self.peek().clone();
        if token.kind != kind {
            return Err(format!(
                "需要 {}，但得到“{}”（位置 {}）",
                kind.label(),
                token.value,
                token.position + 1
            ));
        }
        Ok(self.advance())
    }

    fn has_whitespace_before_current(&self) -> bool {
        if self.index == 0 {
            return false;
        }
        let previous = &self.tokens[self.index - 1];
        self.peek().position > previous.position + previous.value.chars().count()
    }

    fn parse_conversion(&mut self) -> CalcResult<Node> {
        let left = self.parse_addition()?;
        if self.peek().kind == TokenKind::To {
            self.advance();
            let target = self.expect(TokenKind::Identifier)?;
            return Ok(Node::Convert(Box::new(left), target.value));
        }
        Ok(left)
    }

    fn parse_addition(&mut self) -> CalcResult<Node> {
        let mut left = self.parse_multiplication()?;
        while self.peek().kind == TokenKind::Operator
            && (self.peek().value == "+" || self.peek().value == "-")
        {
            let operator = self.advance().value.chars().next().unwrap_or('+');
            let right = self.parse_multiplication()?;
            left = Node::Binary(operator, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_multiplication(&mut self) -> CalcResult<Node> {
        let mut left = self.parse_unary()?;
        while self.peek().kind == TokenKind::Operator
            && (self.peek().value == "*" || self.peek().value == "/")
        {
            let operator = self.advance().value.chars().next().unwrap_or('*');
            let right = self.parse_unary()?;
            left = Node::Binary(operator, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> CalcResult<Node> {
        if self.peek().kind == TokenKind::Operator
            && (self.peek().value == "+" || self.peek().value == "-")
        {
            let operator = self.advance().value.chars().next().unwrap_or('-');
            let operand = self.parse_unary()?;
            return Ok(Node::Unary(operator, Box::new(operand)));
        }
        self.parse_power()
    }

    fn parse_power(&mut self) -> CalcResult<Node> {
        let base = self.parse_postfix()?;
        if self.peek().kind == TokenKind::Operator && self.peek().value == "^" {
            self.advance();
            let exponent = self.parse_unary()?;
            return Ok(Node::Binary('^', Box::new(base), Box::new(exponent)));
        }
        Ok(base)
    }

    fn parse_postfix(&mut self) -> CalcResult<Node> {
        let mut node = self.parse_primary()?;
        if self.peek().kind == TokenKind::Percent {
            self.advance();
            node = Node::Percent(Box::new(node));
        }
        if self.peek().kind == TokenKind::Identifier && find_unit(&self.peek().value).is_some() {
            let unit = self.advance().value;
            node = Node::Unit(Box::new(node), unit);
        }
        Ok(node)
    }

    fn parse_primary(&mut self) -> CalcResult<Node> {
        let token = self.peek().clone();
        if token.kind == TokenKind::Number {
            self.advance();
            return Ok(Node::Number(parse_number_literal(&token.value)?));
        }
        if token.kind == TokenKind::Identifier {
            self.advance();
            if self.peek().kind == TokenKind::LParen {
                self.advance();
                let mut arguments = Vec::new();
                if self.peek().kind != TokenKind::RParen {
                    arguments.push(self.parse_conversion()?);
                    while self.peek().kind == TokenKind::Comma {
                        self.advance();
                        arguments.push(self.parse_conversion()?);
                    }
                }
                self.expect(TokenKind::RParen)?;
                return Ok(Node::Function(token.value, arguments));
            }
            return Ok(Node::Variable(token.value));
        }
        if token.kind == TokenKind::LParen {
            self.advance();
            let node = self.parse_conversion()?;
            if self.peek().kind == TokenKind::Comma {
                let mut items = vec![node];
                while self.peek().kind == TokenKind::Comma {
                    self.advance();
                    items.push(self.parse_conversion()?);
                }
                self.expect(TokenKind::RParen)?;
                return Ok(Node::Vector(items));
            }
            self.expect(TokenKind::RParen)?;
            return Ok(node);
        }
        if token.kind == TokenKind::LBracket {
            self.advance();
            let mut items = Vec::new();
            if self.peek().kind != TokenKind::RBracket {
                items.push(self.parse_conversion()?);
                while self.peek().kind == TokenKind::Comma {
                    self.advance();
                    items.push(self.parse_conversion()?);
                }
            }
            self.expect(TokenKind::RBracket)?;
            return Ok(Node::Vector(items));
        }
        if token.kind == TokenKind::LBrace {
            self.advance();
            let mut items = Vec::new();
            if self.peek().kind != TokenKind::RBrace {
                items.push(self.parse_conversion()?);
                while self.peek().kind != TokenKind::RBrace {
                    if self.peek().kind == TokenKind::Comma {
                        self.advance();
                    } else if !(self.has_whitespace_before_current()
                        && matches!(
                            self.peek().kind,
                            TokenKind::Number
                                | TokenKind::Identifier
                                | TokenKind::LParen
                                | TokenKind::LBracket
                                | TokenKind::LBrace
                        ))
                    {
                        break;
                    }
                    items.push(self.parse_conversion()?);
                }
            }
            self.expect(TokenKind::RBrace)?;
            return Ok(Node::Vector(items));
        }
        Err(format!("表达式不完整（位置 {}）", token.position + 1))
    }
}