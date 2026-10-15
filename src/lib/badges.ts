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
): [string, "hex" | "binary"][] {
  if (!value || !/^-?\d+$/.test(value)) return [];
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return [];
  const values: [string, "hex" | "binary"][] = [];
  const prefix = number < 0 ? "-" : "";
  if (showHex) values.push([`${prefix}0x${Math.abs(number).toString(16).toUpperCase()}`, "hex"]);
  if (showBinary) values.push([`${prefix}0b${Math.abs(number).toString(2)}`, "binary"]);
  return values;
}

export function resultBadges(
  result: LineResult,
  showHex: boolean,
  showBinary: boolean,
): Badge[] {
  const label = resultText(result);
  if (!label) return [];
  const copyValue =
    result.result !== null && result.result !== undefined && result.type !== "error"
      ? result.result
      : null;
  const badges: Badge[] = [{ label, copyValue, kind: "primary" }];
  if (copyValue !== null) {
    for (const [value, kind] of integerBaseValues(copyValue, showHex, showBinary)) {
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