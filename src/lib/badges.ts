import type { Badge, BadgeTone, LineResult } from "./types";

/** Port of the badge helpers in editor_widget.py. */

export function resultText(result: LineResult): string {
  if (result.type === "completion") return "";
  if (result.type === "error") return `! ${result.error ?? ""}`;
  if (result.type === "equation") {
    return `${result.isCorrect ? "✓" : "✕"} ${result.isCorrect ? "=" : "≠"} ${result.result ?? ""}`;
  }
  if (result.result !== null && result.result !== undefined) return `= ${result.result}`;
  return "";
}

export function integerBaseValues(
  value: string | null,
  showHex: boolean,
  showBinary: boolean,
  groupBinary: boolean,
): [string, "hex" | "binary"][] {
  const integers = integerElements(value);
  if (!integers) return [];
  const values: [string, "hex" | "binary"][] = [];
  if (showHex) values.push([restateIntegers(integers, 16), "hex"]);
  if (showBinary) values.push([restateIntegers(integers, 2), "binary"]);
  if (groupBinary) values.push([restateIntegers(integers, 2, true), "binary"]);
  return values;
}

interface IntegerVector {
  numbers: number[];
  open: string;
  close: string;
  separator: string;
}

/**
 * Delimiter pairs a list result can wear, mirroring the literal it came from:
 * the engine echoes the brackets or quotes of the expression back into the
 * result, so `"100 1000 10" / 5` gives `"20 200 2"`.
 */
const LIST_DELIMITERS: [string, string][] = [
  ["[", "]"],
  ["{", "}"],
  ["(", ")"],
  ['"', '"'],
  ["'", "'"],
];

/** `[0x7B, 0x237]` / `"0x7B 0x237"` — the delimiters of the array restated. */
function restateIntegers(integers: IntegerVector, radix: 16 | 2, groupBinary = false): string {
  const text = integers.numbers
    .map((number) => baseText(number, radix, groupBinary))
    .join(integers.separator);
  return `${integers.open}${text}${integers.close}`;
}

/** Digits per group in the grouped binary badge, counted from the right. */
export const BINARY_GROUP_SIZE = 4;

/**
 * `-0x7B` / `0b1010`, the same shapes the Python badges printed. Grouped binary
 * spaces the digits every four, so `0b10111111` reads `0b1011 1111`; the badge
 * copies that same spaced text.
 */
function baseText(value: number, radix: 16 | 2, groupBinary = false): string {
  const digits = Math.abs(value).toString(radix);
  let text = radix === 16 ? digits.toUpperCase() : digits;
  if (radix === 2 && groupBinary) text = groupBinaryDigits(text);
  return `${value < 0 ? "-" : ""}0${radix === 16 ? "x" : "b"}${text}`;
}

/** `10111111` → `1011 1111`; the groups count from the right, like bit columns. */
function groupBinaryDigits(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= BINARY_GROUP_SIZE) {
    groups.unshift(digits.slice(Math.max(0, end - BINARY_GROUP_SIZE), end));
  }
  return groups.join(" ");
}

/**
 * Integers a badge can restate in another base: a lone integer, or every
 * element of a flat list such as `[123, 567, 100]` or `"123 567 100"` — the
 * delimiters and the separator are remembered so the restated value still
 * reads exactly like the result it mirrors. Decimals, units and nested lists
 * return null so the badges stay all-or-nothing per line.
 */
function integerElements(value: string | null): IntegerVector | null {
  if (!value) return null;
  let open = "";
  let close = "";
  let text = value;
  for (const [start, end] of LIST_DELIMITERS) {
    if (value.length >= 2 && value.startsWith(start) && value.endsWith(end)) {
      open = start;
      close = end;
      text = value.slice(1, -1);
      break;
    }
  }
  if (!text) return null;
  const separator = text.includes(", ") ? ", " : " ";
  const numbers: number[] = [];
  for (const part of text.split(separator)) {
    if (!/^-?\d+$/.test(part)) return null;
    const number = Number(part);
    if (!Number.isSafeInteger(number)) return null;
    numbers.push(number);
  }
  return { numbers, open, close, separator };
}

export function resultBadges(
  result: LineResult,
  showHex: boolean,
  showBinary: boolean,
  groupBinary: boolean,
): Badge[] {
  const label = resultText(result);
  if (!label) return [];
  const copyValue =
    result.result !== null && result.result !== undefined && result.type !== "error"
      ? result.result
      : null;
  const badges: Badge[] = [{ label, copyValue, kind: "primary" }];
  if (copyValue !== null) {
    for (const [value, kind] of integerBaseValues(copyValue, showHex, showBinary, groupBinary)) {
      badges.push({ label: value, copyValue: value, kind });
    }
  }
  return badges;
}

type Rgb = [number, number, number];

function parseColor(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function blend(source: Rgb, target: Rgb, ratio: number): Rgb {
  return [
    Math.round(source[0] + (target[0] - source[0]) * ratio),
    Math.round(source[1] + (target[1] - source[1]) * ratio),
    Math.round(source[2] + (target[2] - source[2]) * ratio),
  ];
}

function css(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

export interface BadgeColors {
  background: string;
  accent: string;
  foreground: string;
}

/** Port of `InlineResultEditor.badge_colors`. */
export function badgeColors(
  kind: Badge["kind"],
  result: LineResult,
  dark: boolean,
  tone: BadgeTone,
): BadgeColors {
  let colors: [string, string, string];
  if (kind === "hex") {
    colors = dark ? ["#172c4f", "#60a5fa", "#bfdbfe"] : ["#dbeafe", "#3b82f6", "#1e40af"];
  } else if (kind === "binary") {
    colors = dark ? ["#35204d", "#c084fc", "#e9d5ff"] : ["#f3e8ff", "#9333ea", "#6b21a8"];
  } else if (result.type === "error") {
    colors = dark ? ["#4d2428", "#ff6262", "#ffc1bf"] : ["#fde4e4", "#e54848", "#992c2a"];
  } else if (result.type === "equation" && result.isCorrect === false) {
    colors = dark ? ["#49391f", "#e7a932", "#ffd98f"] : ["#fff0cf", "#d58a08", "#805009"];
  } else {
    colors = dark ? ["#163d2b", "#20d66b", "#9af1b9"] : ["#d9f8e5", "#08b950", "#075f30"];
  }

  if (tone === "standard") {
    return { background: colors[0], accent: colors[1], foreground: colors[2] };
  }
  const backdrop = parseColor(dark ? "#11161c" : "#ffffff");
  const ratios = tone === "lighter" ? [0.68, 0.58, 0.48] : [0.5, 0.4, 0.32];
  const blended = colors.map((color, index) => blend(parseColor(color), backdrop, ratios[index]));
  return {
    background: css(blended[0]),
    accent: css(blended[1]),
    foreground: css(blended[2]),
  };
}
