export type LineType =
  | "expression"
  | "assignment"
  | "equation"
  | "unit_conversion"
  | "error"
  | "normal"
  | "comment"
  | "title"
  | "subtitle"
  | "empty"
  | "completion"
  | "continuation";

/** One row of engine output; mirrors `LineResult` in calculator_core.py. */
export interface LineResult {
  line: string;
  type: LineType;
  result: string | null;
  error: string | null;
  isCorrect: boolean | null;
  variable: string | null;
}

export interface EvaluateOutcome {
  results: LineResult[];
  scope: Record<string, unknown>;
}

export interface NoteDocument {
  path: string;
  content: string;
}

export interface CalcMetadata {
  functions: string[];
  constants: string[];
  /** Unit names and aliases, lower-cased by the engine. */
  units: string[];
}

export type BadgeTone = "lighter" | "light" | "standard";

export const BADGE_TONES: BadgeTone[] = ["lighter", "light", "standard"];

export const BADGE_TONE_LABELS: Record<BadgeTone, string> = {
  lighter: "更淡",
  light: "柔和",
  standard: "标准",
};

export interface SessionTab {
  path: string | null;
  content: string;
  savedText: string;
  fontSize: number;
}

export interface WindowGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
}

export interface SessionState {
  tabs: SessionTab[];
  activeTab: number;
  precision: number;
  showHex: boolean;
  showBinary: boolean;
  badgeTone: BadgeTone;
  fontSize: number;
  darkMode: boolean;
  window: WindowGeometry | null;
}

export const DEFAULT_SESSION: SessionState = {
  tabs: [],
  activeTab: 0,
  precision: 4,
  showHex: false,
  showBinary: false,
  badgeTone: "light",
  fontSize: 13,
  darkMode: true,
  window: null,
};

export interface Badge {
  label: string;
  copyValue: string | null;
  kind: "primary" | "hex" | "binary";
}

export interface TabState {
  id: string;
  path: string | null;
  content: string;
  savedText: string;
  fontSize: number;
  results: LineResult[];
  scopeSize: number;
  stats: string;
  documentError: string | null;
  findOpen: boolean;
  findMode: "find" | "replace";
  caretLine: number;
}