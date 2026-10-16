import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { badgeColors, resultBadges, resultText } from "../lib/badges";
import { highlightLine, type HighlightIndex } from "../lib/highlight";
import {
  EDITOR_FONT_STACK,
  fontString,
  lineWidth,
  measure,
  TAB_COLUMNS,
  tabStopWidth,
} from "../lib/measure";
import {
  BADGE_GAP_STEP,
  BADGE_TONE_LABELS,
  BADGE_TONES,
  clampBadgeGapChars,
  MAX_BADGE_GAP_CHARS,
  MIN_BADGE_GAP_CHARS,
  type BadgeTone,
  type LineResult,
} from "../lib/types";
import { MenuNumberRow } from "./MenuNumberRow";

const PAD_X = 12;
const PAD_Y = 9;
const MIN_FONT = 10;
const MAX_FONT = 38;
const BADGE_GAP = 6;

/**
 * Pairs that enclose a selection when the character is typed over one. Both
 * halves of a bracket pair are listed, so typing `)` over a selection wraps it
 * just like `(` (the way IntelliJ's smart brace handling does); the symmetric
 * quotes pair with themselves.
 */
const WRAP_PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"],
  ")": ["(", ")"],
  "[": ["[", "]"],
  "]": ["[", "]"],
  "{": ["{", "}"],
  "}": ["{", "}"],
  "'": ["'", "'"],
  '"': ['"', '"'],
  "`": ["`", "`"],
};

export interface EditorHandle {
  focus(): void;
  select(start: number, end: number): void;
  reveal(offset: number): void;
  exec(command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll"): boolean;
  selection(): { start: number; end: number };
  replaceRange(start: number, end: number, text: string, caret?: number): void;
  scrollToLine(line: number): void;
  copyCurrentLineResult(): boolean;
}

interface NoteEditorProps {
  content: string;
  results: LineResult[];
  index: HighlightIndex;
  fontSize: number;
  darkMode: boolean;
  showHex: boolean;
  showBinary: boolean;
  badgeTone: BadgeTone;
  badgeGapChars: number;
  onChange(content: string): void;
  onFontSizeChange(fontSize: number): void;
  onCopy(value: string, label: string): void;
  onToggleHex(value: boolean): void;
  onToggleBinary(value: boolean): void;
  onToneChange(tone: BadgeTone): void;
  onBadgeGapChange(gapChars: number): void;
}

interface OverlayLineProps {
  text: string;
  index: HighlightIndex;
  fontSize: number;
  stride: number;
  current: boolean;
  bracketStart: number;
  bracketEnd: number;
  ghost: string | null;
}

/** One painted source line. Memoised so typing only repaints affected rows. */
const OverlayLine = memo(function OverlayLine({
  text,
  index,
  fontSize,
  stride,
  current,
  bracketStart,
  bracketEnd,
  ghost,
}: OverlayLineProps) {
  const runs = useMemo(() => {
    const classes: (string | null)[] = [];
    for (const segment of highlightLine(text, index)) {
      const cls = segment.cls ? `tok-${segment.cls}` : null;
      for (let position = 0; position < segment.text.length; position += 1) {
        classes.push(cls);
      }
    }
    if (bracketStart >= 0 && bracketStart < classes.length) classes[bracketStart] = "bracket";
    if (bracketEnd >= 0 && bracketEnd < classes.length) classes[bracketEnd] = "bracket";

    const output: { text: string; cls: string | null }[] = [];
    let buffer = "";
    let cls: string | null = null;
    for (let position = 0; position < text.length; position += 1) {
      const next = classes[position] ?? null;
      if (buffer && next === cls) {
        buffer += text[position];
        continue;
      }
      if (buffer) output.push({ text: buffer, cls });
      buffer = text[position];
      cls = next;
    }
    if (buffer) output.push({ text: buffer, cls });
    return output;
  }, [text, index, bracketStart, bracketEnd]);

  return (
    <div
      className={current ? "ov-line current" : "ov-line"}
      style={{ height: stride, lineHeight: `${stride}px`, fontSize }}
    >
      {runs.map((run, position) =>
        run.cls ? (
          <span key={position} className={run.cls}>
            {run.text}
          </span>
        ) : (
          <span key={position}>{run.text}</span>
        ),
      )}
      {ghost ? <span className="ghost">{ghost}</span> : null}
    </div>
  );
});

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let position = 0; position < content.length; position += 1) {
    if (content[position] === "\n") starts.push(position + 1);
  }
  return starts;
}

function locateLine(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
}

/**
 * Port of `InlineResultEditor._matching_bracket_positions`, extended to quotes.
 * `"` and `'` delimit a list just like brackets do, but both of their ends are
 * the same character, so they follow their own rule: the partner is picked by
 * parity, an even number of that quote before it opening the pair and an odd
 * number closing it. The count stops at the line boundaries, so a stray quote
 * on another line can never flip the pairing.
 */
function matchBrackets(content: string, offset: number): number[] {
  const opening = "([{";
  const closing = ")]}";
  const quotes = "\"'";
  let position = -1;
  for (const candidate of [offset, offset - 1]) {
    if (
      candidate >= 0 &&
      candidate < content.length &&
      `()[]{}${quotes}`.includes(content[candidate])
    ) {
      position = candidate;
      break;
    }
  }
  if (position < 0) return [];
  const bracket = content[position];
  if (quotes.includes(bracket)) return matchQuote(content, position, bracket);
  const openingIndex = opening.indexOf(bracket);
  const forward = openingIndex >= 0;
  const target = forward ? closing[openingIndex] : opening[closing.indexOf(bracket)];
  let depth = 0;
  if (forward) {
    for (let index = position; index < content.length; index += 1) {
      if (content[index] === bracket) depth += 1;
      else if (content[index] === target) {
        depth -= 1;
        if (depth === 0) return [position, index];
      }
    }
  } else {
    for (let index = position; index >= 0; index -= 1) {
      if (content[index] === bracket) depth += 1;
      else if (content[index] === target) {
        depth -= 1;
        if (depth === 0) return [index, position];
      }
    }
  }
  return [position];
}

/** Partner of a symmetric quote character, searched inside its own line. */
function matchQuote(content: string, position: number, quote: string): number[] {
  const lineStart = content.lastIndexOf("\n", position - 1) + 1;
  const newline = content.indexOf("\n", position);
  const lineEnd = newline < 0 ? content.length : newline;

  let seen = 0;
  for (let index = lineStart; index < position; index += 1) {
    if (content[index] === quote) seen += 1;
  }

  const forward = seen % 2 === 0;
  const step = forward ? 1 : -1;
  for (let index = position + step; index >= lineStart && index < lineEnd; index += step) {
    if (content[index] === quote) return forward ? [position, index] : [index, position];
  }
  return [position];
}

/** Port of `InlineResultEditor._calculate_alignment` (grouped result column). */
function computeAlignment(
  lines: string[],
  results: LineResult[],
  font: string,
  tabStop: number,
): number[] {
  const widths = new Array<number>(lines.length).fill(0);
  const threshold = measure("M", font) * 7;
  let group: [number, number][] = [];
  let previous: number | null = null;

  const finish = () => {
    if (!group.length) return;
    const widest = group.reduce((widest, entry) => Math.max(widest, entry[1]), 0);
    for (const [index] of group) widths[index] = widest;
    group = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const result = results[index];
    if (!result || !resultText(result)) {
      finish();
      previous = null;
      continue;
    }
    const width = lineWidth(lines[index], font, tabStop);
    if (previous !== null && Math.abs(width - previous) > threshold) finish();
    group.push([index, width]);
    previous = width;
  }
  finish();
  return widths;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export const NoteEditor = forwardRef<EditorHandle, NoteEditorProps>(function NoteEditor(
  {
    content,
    results,
    index,
    fontSize,
    darkMode,
    showHex,
    showBinary,
    badgeTone,
    badgeGapChars,
    onChange,
    onFontSizeChange,
    onCopy,
    onToggleHex,
    onToggleBinary,
    onToneChange,
    onBadgeGapChange,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const badgeLayerRef = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [caret, setCaret] = useState({ offset: 0, line: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => content.split("\n"), [content]);
  const starts = useMemo(() => computeLineStarts(content), [content]);
  const stride = useMemo(() => Math.max(fontSize + 8, Math.round(fontSize * 1.55)), [fontSize]);
  const font = useMemo(() => fontString(fontSize), [fontSize]);
  const badgeFont = useMemo(
    () => fontString(Math.max(10, Math.round(fontSize * 0.92))),
    [fontSize],
  );
  const badgeHeight = useMemo(
    () => Math.min(22, Math.max(18, Math.round(fontSize * 1.25))),
    [fontSize],
  );
  const tabStop = useMemo(() => tabStopWidth(font), [font]);
  const gapChars = clampBadgeGapChars(badgeGapChars);
  /** The gap is stored in character cells, so it grows with the font like the tab grid. */
  const badgeGapPx = useMemo(() => gapChars * measure(" ", font), [gapChars, font]);
  const alignedWidths = useMemo(
    () => computeAlignment(lines, results, font, tabStop),
    [lines, results, font, tabStop],
  );
  const gutterWidth = useMemo(
    () => Math.round(16 + measure("9", font) * Math.max(1, String(lines.length).length)),
    [font, lines.length],
  );

  const bracketColumns = useMemo(() => {
    const offsets = matchBrackets(content, caret.offset);
    return offsets.map((offset) => {
      const line = locateLine(starts, offset);
      return { line, column: offset - starts[line] };
    });
  }, [content, caret.offset, starts]);

  const completion = useMemo(() => {
    const result = results[caret.line];
    if (!result || result.type !== "completion" || !result.result) return null;
    const line = lines[caret.line] ?? "";
    if (caret.offset !== starts[caret.line] + line.length) return null;
    if (dismissed === `${caret.line}:${line}`) return null;
    return result.result;
  }, [results, caret, lines, starts, dismissed]);

  const badgeRows = useMemo(() => {
    const rows: { line: number; left: number; items: ReturnType<typeof resultBadges> }[] = [];
    for (let position = 0; position < lines.length; position += 1) {
      const result = results[position];
      if (!result) continue;
      const items = resultBadges(result, showHex, showBinary);
      if (!items.length) continue;
      rows.push({ line: position, left: PAD_X + alignedWidths[position] + badgeGapPx, items });
    }
    return rows;
  }, [lines, results, showHex, showBinary, alignedWidths, badgeGapPx]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const shift = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    if (overlayRef.current) overlayRef.current.style.transform = shift;
    if (badgeLayerRef.current) badgeLayerRef.current.style.transform = shift;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-textarea.scrollTop}px)`;
  }, []);

  const updateCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const offset = textarea.selectionStart;
    setCaret((previous) =>
      previous.offset === offset
        ? previous
        : { offset, line: locateLine(computeLineStarts(textarea.value), offset) },
    );
  }, []);

  useLayoutEffect(() => {
    syncScroll();
  }, [syncScroll, content, stride, fontSize]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const caretOffset = pendingCaret.current;
    const selection = pendingSelection.current;
    if (!textarea || (caretOffset === null && !selection)) return;
    pendingCaret.current = null;
    pendingSelection.current = null;
    const [start, end] = selection ?? [caretOffset as number, caretOffset as number];
    textarea.setSelectionRange(start, end);
    setCaret({ offset: start, line: locateLine(computeLineStarts(textarea.value), start) });
  }, [content]);

  const insertText = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      // Inserting through the editor command keeps the browser's undo stack
      // intact (assigning `value` would drop the whole history); the Python
      // original's `insertText` stays undoable too.
      if (document.execCommand("insertText", false, text)) {
        pendingCaret.current = null;
        onChange(textarea.value);
        return;
      }
      pendingCaret.current = start + text.length;
      onChange(`${content.slice(0, start)}${text}${content.slice(end)}`);
    },
    [content, onChange],
  );

  /**
   * Encloses the selection in the pair the typed character belongs to. The
   * selection itself is kept, so picking another character still replaces the
   * text and a second bracket nests one more pair around it.
   */
  const wrapSelection = useCallback(
    (key: string): boolean => {
      const pair = WRAP_PAIRS[key];
      const textarea = textareaRef.current;
      if (!pair || !textarea) return false;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start === end) return false;
      const inner = end - start;
      const wrapped = `${pair[0]}${textarea.value.slice(start, end)}${pair[1]}`;
      pendingSelection.current = [start + pair[0].length, start + pair[0].length + inner];
      // Inserting through the editor command keeps the whole wrap as one undo
      // step, exactly like `insertText`; a manual splice is the fallback for
      // when the command refuses or drops the selection's line breaks.
      const next = `${textarea.value.slice(0, start)}${wrapped}${textarea.value.slice(end)}`;
      if (document.execCommand("insertText", false, wrapped) && textarea.value === next) {
        onChange(textarea.value);
        return true;
      }
      onChange(next);
      return true;
    },
    [onChange],
  );

  const forwardWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      // 徽标浮在 textarea 之上（见 app.css 的 .badge-layer），滚轮落在徽标上时找不到
      // textarea 这个可滚动祖先，这里把滚动手动转过去，免得光标停在徽标上滚不动。
      textarea.scrollTop += event.deltaY;
      textarea.scrollLeft += event.deltaX;
      syncScroll();
    },
    [syncScroll],
  );

  const copyLineResult = useCallback(
    (line: number) => {
      const result = results[line];
      if (!result || result.result === null || result.result === undefined) return false;
      onCopy(result.result, resultText(result));
      return true;
    },
    [results, onCopy],
  );

  useImperativeHandle(
    ref,
    (): EditorHandle => ({
      focus: () => textareaRef.current?.focus(),
      select: (start, end) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(start, end);
        updateCaret();
      },
      reveal: (offset) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const line = locateLine(computeLineStarts(textarea.value), offset);
        if (line * stride < textarea.scrollTop) textarea.scrollTop = line * stride;
        else if ((line + 1) * stride > textarea.scrollTop + textarea.clientHeight) {
          textarea.scrollTop = (line + 1) * stride - textarea.clientHeight;
        }
        syncScroll();
      },
      exec: (command) => {
        const textarea = textareaRef.current;
        if (!textarea) return false;
        textarea.focus();
        if (command === "selectAll") {
          textarea.select();
          return true;
        }
        try {
          return document.execCommand(command);
        } catch {
          return false;
        }
      },
      selection: () => {
        const textarea = textareaRef.current;
        if (!textarea) return { start: 0, end: 0 };
        return { start: textarea.selectionStart, end: textarea.selectionEnd };
      },
      replaceRange: (start, end, text, caretOffset) => {
        pendingCaret.current = caretOffset ?? start + text.length;
        onChange(`${content.slice(0, start)}${text}${content.slice(end)}`);
      },
      scrollToLine: (line) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.scrollTop = Math.max(0, line * stride - textarea.clientHeight / 2);
        syncScroll();
      },
      copyCurrentLineResult: () => copyLineResult(caret.line),
    }),
    [content, caret.line, copyLineResult, onChange, stride, syncScroll, updateCaret],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!event.deltaY) return;
      onFontSizeChange(clamp(fontSize + (event.deltaY < 0 ? 1 : -1), MIN_FONT, MAX_FONT));
    };
    textarea.addEventListener("wheel", onWheel, { passive: false });
    return () => textarea.removeEventListener("wheel", onWheel);
  }, [fontSize, onFontSizeChange]);

  useEffect(() => {
    if (!menu) return undefined;
    // mousedown 先于 click 触发。若在这里无条件关闭菜单，条目会在 click 派发前被卸载，
    // 菜单里的点击就永远执行不到。因此菜单内部的 mousedown 必须放行。
    const close = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // `editor_widget.py` accepts a completion with Tab or Right (no modifiers);
    // Tab still indents by a tab stop when there is nothing to accept.
    const plainKey = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    // A bracket or quote typed over a selection encloses it instead of wiping
    // it. Shift stays allowed because `(` and `"` sit behind it on most
    // layouts; an empty selection keeps the plain browser behaviour.
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing &&
      wrapSelection(event.key)
    ) {
      event.preventDefault();
      return;
    }
    if (completion && plainKey && (event.key === "Tab" || event.key === "ArrowRight")) {
      event.preventDefault();
      insertText(` ${completion}`);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      insertText("\t");
      return;
    }
    if (event.key === "Escape" && completion) {
      event.preventDefault();
      setDismissed(`${caret.line}:${lines[caret.line] ?? ""}`);
      return;
    }
    if (event.key.toLowerCase() === "c" && event.ctrlKey && event.shiftKey) {
      if (copyLineResult(caret.line)) event.preventDefault();
    }
  };

  return (
    <div className="note-editor">
      <div className="gutter" style={{ width: gutterWidth }} aria-hidden="true">
        <div className="gutter-inner" ref={gutterRef}>
          {lines.map((_, position) => (
            <div
              className={position === caret.line ? "gutter-line current" : "gutter-line"}
              key={position}
              style={{
                height: stride,
                lineHeight: `${stride}px`,
                fontSize: Math.max(10, fontSize - 2),
              }}
            >
              {position + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="code-area">
        <pre className="code-overlay" aria-hidden="true">
          <div className="overlay-inner" ref={overlayRef}>
            {lines.map((text, position) => (
              <OverlayLine
                key={position}
                text={text}
                index={index}
                fontSize={fontSize}
                stride={stride}
                current={position === caret.line}
                bracketStart={
                  bracketColumns[0] && bracketColumns[0].line === position
                    ? bracketColumns[0].column
                    : -1
                }
                bracketEnd={
                  bracketColumns[1] && bracketColumns[1].line === position
                    ? bracketColumns[1].column
                    : -1
                }
                ghost={position === caret.line && completion ? ` ${completion}    Tab 接受` : null}
              />
            ))}
          </div>
        </pre>
        <div className="badge-layer" ref={badgeLayerRef} onWheel={forwardWheel}>
          {badgeRows.map((row) => {
            const result = results[row.line];
            return (
              <div
                className="badge-row"
                key={row.line}
                style={{ top: PAD_Y + row.line * stride, left: row.left, height: stride }}
              >
                {row.items.map((badge, position) => {
                  const colors = badgeColors(badge.kind, result, darkMode, badgeTone);
                  return (
                    <button
                      type="button"
                      className="badge"
                      key={`${badge.kind}-${position}`}
                      title={badge.copyValue ? `单击复制：${badge.copyValue}` : badge.label}
                      style={{
                        background: colors.background,
                        color: colors.foreground,
                        height: badgeHeight,
                        marginRight: BADGE_GAP,
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (badge.copyValue !== null) onCopy(badge.copyValue, badge.label);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ x: event.clientX, y: event.clientY });
                      }}
                    >
                      <i className="accent" style={{ background: colors.accent }} />
                      <span className="badge-text" style={{ font: badgeFont }}>
                        {badge.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <textarea
          ref={textareaRef}
          className="code-input"
          value={content}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          placeholder="输入表达式，例如：价格 = 99.5"
          style={{
            fontFamily: EDITOR_FONT_STACK,
            fontSize,
            lineHeight: `${stride}px`,
            padding: `${PAD_Y}px ${PAD_X}px`,
            tabSize: TAB_COLUMNS,
          }}
          onChange={(event) => {
            onChange(event.target.value);
            updateCaret();
          }}
          onScroll={syncScroll}
          onSelect={updateCaret}
          onClick={updateCaret}
          onKeyUp={updateCaret}
          onKeyDown={handleKeyDown}
        />
      </div>
      {menu ? (
        <div className="badge-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setMenu(null);
              onToggleHex(!showHex);
            }}
          >
            <span className="tick">{showHex ? "✓" : ""}</span>
            <span className="label">整数/数组结果显示十六进制</span>
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setMenu(null);
              onToggleBinary(!showBinary);
            }}
          >
            <span className="tick">{showBinary ? "✓" : ""}</span>
            <span className="label">整数/数组结果显示二进制</span>
          </button>
          <div className="menu-sep" />
          <div className="menu-caption">结果框显示强度</div>
          <div className="tone-group">
            {BADGE_TONES.map((tone) => (
              <button
                type="button"
                key={tone}
                className={tone === badgeTone ? "tone on" : "tone"}
                onClick={() => {
                  setMenu(null);
                  onToneChange(tone);
                }}
              >
                {BADGE_TONE_LABELS[tone]}
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <div className="menu-caption">结果到本行最后一个字符的最小距离</div>
          <MenuNumberRow
            label="结果间距（字符）"
            value={gapChars}
            min={MIN_BADGE_GAP_CHARS}
            max={MAX_BADGE_GAP_CHARS}
            step={BADGE_GAP_STEP}
            onChange={onBadgeGapChange}
          />
        </div>
      ) : null}
    </div>
  );
});
