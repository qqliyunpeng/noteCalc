import type { CalcMetadata } from "./types";

/** Port of `NoteHighlighter.highlightBlock` from editor_widget.py. */

export type TokenClass =
  | "comment"
  | "title"
  | "subtitle"
  | "number"
  | "variable"
  | "function"
  | "constant"
  | "unit"
  | "operator"
  | null;

export interface Segment {
  text: string;
  cls: TokenClass;
}

const IDENTIFIER_PATTERN = /[A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*|°[CF]/g;
const NUMBER_PATTERN = /\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;
const OPERATOR_PATTERN = /[+\-*/^%=]/g;
const ASSIGNMENT_PATTERN = /^(\s*)([A-Za-z_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff]*)\s*=(?!=)/;

export interface HighlightIndex {
  functions: Set<string>;
  constants: Set<string>;
  units: Set<string>;
}

export function buildIndex(metadata: CalcMetadata): HighlightIndex {
  return {
    functions: new Set(metadata.functions),
    constants: new Set(metadata.constants),
    units: new Set(metadata.units),
  };
}

export const EMPTY_INDEX: HighlightIndex = buildIndex({
  functions: [],
  constants: [],
  units: [],
});

function fill(classes: TokenClass[], start: number, end: number, cls: TokenClass): void {
  for (let index = start; index < end && index < classes.length; index += 1) {
    classes[index] = cls;
  }
}

export function highlightLine(text: string, index: HighlightIndex): Segment[] {
  if (!text) return [];

  const stripped = text.replace(/^\s+/, "");
  if (stripped.startsWith("//")) return [{ text, cls: "comment" }];
  if (stripped.startsWith("# ")) return [{ text, cls: "title" }];
  if (stripped.startsWith("## ")) return [{ text, cls: "subtitle" }];

  const classes: TokenClass[] = new Array<TokenClass>(text.length).fill(null);

  for (const match of text.matchAll(IDENTIFIER_PATTERN)) {
    const name = match[0];
    const start = match.index ?? 0;
    const suffix = text.slice(start + name.length).replace(/^\s+/, "");
    const lower = name.toLowerCase();
    let cls: TokenClass;
    if (index.functions.has(name) && suffix.startsWith("(")) cls = "function";
    else if (index.constants.has(name)) cls = "constant";
    else if (lower === "to" || index.units.has(lower)) cls = "unit";
    else cls = "variable";
    fill(classes, start, start + name.length, cls);
  }

  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const start = match.index ?? 0;
    fill(classes, start, start + match[0].length, "number");
  }

  const assignment = ASSIGNMENT_PATTERN.exec(text);
  if (assignment) {
    const start = assignment[1].length;
    fill(classes, start, start + assignment[2].length, "variable");
  }

  for (const match of text.matchAll(OPERATOR_PATTERN)) {
    const start = match.index ?? 0;
    fill(classes, start, start + 1, "operator");
  }

  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (let position = 0; position < text.length; position += 1) {
    const cls = classes[position] ?? null;
    if (current && current.cls === cls) {
      current.text += text[position];
      continue;
    }
    current = { text: text[position], cls };
    segments.push(current);
  }
  return segments;
}