import type { EvaluateOutcome, LineResult, LineType } from "./types";

/**
 * Browser-only preview stub.
 *
 * The real engine is a Rust command, so a plain browser tab cannot compute
 * anything. Rather than pretending, this returns canned results for the
 * welcome document's lines and marks everything else as plain text; the UI
 * shows a "预览" badge whenever this path is active.
 */

const CANNED: Record<string, { type: LineType; result?: string; isCorrect?: boolean }> = {
  "2 + 2": { type: "expression", result: "4" },
  "5 * 10": { type: "expression", result: "50" },
  "100 / 4": { type: "expression", result: "25" },
  "2^3": { type: "expression", result: "8" },
  "价格 = 99.5": { type: "assignment", result: "99.5" },
  "数量 = 5": { type: "assignment", result: "5" },
  "小计 = 价格 * 数量": { type: "assignment", result: "497.5" },
  "税率 = 13%": { type: "assignment", result: "0.13" },
  "含税价格 = 小计 * (1 + 税率)": { type: "assignment", result: "562.175" },
  "距离 = 10 km": { type: "assignment", result: "10 km" },
  "距离 to m": { type: "unit_conversion", result: "10000 m" },
  "5 kg to g": { type: "unit_conversion", result: "5000 g" },
  "32 °F to °C": { type: "unit_conversion", result: "0 °C" },
  "sin(PI / 4)": { type: "expression", result: "0.7071" },
  "sqrt(16) = 4": { type: "equation", result: "16", isCorrect: true },
  "max(12, 35, 9)": { type: "expression", result: "35" },
};

export function demoEvaluate(content: string, _precision: number): EvaluateOutcome {
  const results: LineResult[] = content.split("\n").map((rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    const stripped = line.trim();
    const canned = CANNED[stripped];
    if (canned) {
      return {
        line,
        type: canned.type,
        result: canned.result ?? null,
        error: null,
        isCorrect: canned.isCorrect ?? null,
        variable: null,
      };
    }
    return {
      line,
      type: previewType(stripped),
      result: null,
      error: null,
      isCorrect: null,
      variable: null,
    };
  });
  return { results, scope: {} };
}

function previewType(stripped: string): LineType {
  if (!stripped) return "empty";
  if (stripped.startsWith("//")) return "comment";
  if (stripped.startsWith("## ")) return "subtitle";
  if (stripped.startsWith("# ")) return "title";
  // Anything the engine would have to compute stays unlabelled in preview mode.
  return "normal";
}