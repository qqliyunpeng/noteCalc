import { useCallback, useEffect, useRef, useState } from "react";
import { IconClose, IconSearch } from "./Icons";
import type { EditorHandle } from "./NoteEditor";

interface FindReplaceBarProps {
  content: string;
  editor: () => EditorHandle | null;
  replaceMode: boolean;
  onChange: (content: string, caret?: number) => void;
  onMessage: (message: string) => void;
  onClose: () => void;
}

interface Match {
  start: number;
  end: number;
}

/** Port of `FindReplaceBar` from editor_widget.py. */
export function FindReplaceBar({
  content,
  editor,
  replaceMode,
  onChange,
  onMessage,
  onClose,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const findInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const selected = editor()?.selection();
    if (selected && selected.end > selected.start) {
      const text = content.slice(selected.start, selected.end);
      if (text && !text.includes("\n")) setQuery(text);
    }
    findInput.current?.focus();
    findInput.current?.select();
    // Only prefill when the bar appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = useCallback(
    (from: number, backward: boolean): Match | null => {
      if (!query) return null;
      const haystack = caseSensitive ? content : content.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      if (!backward) {
        let index = haystack.indexOf(needle, from);
        if (index < 0) index = haystack.indexOf(needle, 0);
        return index < 0 ? null : { start: index, end: index + query.length };
      }
      let index = haystack.lastIndexOf(needle, Math.max(0, from));
      if (index < 0) index = haystack.lastIndexOf(needle);
      return index < 0 ? null : { start: index, end: index + query.length };
    },
    [caseSensitive, content, query],
  );

  const find = useCallback(
    (backward = false) => {
      if (!query) return false;
      const handle = editor();
      const selection = handle?.selection() ?? { start: 0, end: 0 };
      const from = backward ? selection.start : selection.end;
      const match = locate(from, backward);
      if (!match) {
        onMessage(`未找到：${query}`);
        return false;
      }
      handle?.select(match.start, match.end);
      handle?.reveal(match.start);
      onMessage(`已找到：${query}`);
      return true;
    },
    [editor, locate, onMessage, query],
  );

  const replaceCurrent = useCallback(() => {
    if (!query) return false;
    const handle = editor();
    const selection = handle?.selection() ?? { start: 0, end: 0 };
    const selected = content.slice(selection.start, selection.end) ?? "";
    const matches = caseSensitive
      ? selected === query
      : selected.toLowerCase() === query.toLowerCase();
    if (matches) {
      onChange(
        `${content.slice(0, selection.start)}${replacement}${content.slice(selection.end)}`,
        selection.start + replacement.length,
      );
    }
    window.setTimeout(() => find(false), 0);
    return true;
  }, [caseSensitive, content, editor, find, onChange, query, replacement]);

  const replaceAll = useCallback(() => {
    if (!query) return 0;
    const haystack = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    let output = "";
    let index = 0;
    let count = 0;
    for (;;) {
      const found = haystack.indexOf(needle, index);
      if (found < 0) break;
      output += content.slice(index, found) + replacement;
      index = found + needle.length;
      count += 1;
    }
    if (!count) {
      onMessage(`未找到：${query}`);
      return 0;
    }
    output += content.slice(index);
    onChange(output);
    onMessage(`${count} 处已替换`);
    return count;
  }, [caseSensitive, content, onChange, onMessage, query, replacement]);

  return (
    <div className="find-bar">
      <span className="find-icon">
        <IconSearch size={13} />
      </span>
      <input
        ref={findInput}
        className="find-input"
        placeholder="查找"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            find(event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {replaceMode ? (
        <input
          className="find-input replace"
          placeholder="替换为"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
      ) : null}
      <label className="find-case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => setCaseSensitive(event.target.checked)}
        />
        区分大小写
      </label>
      <button type="button" onClick={() => find(true)}>
        上一个
      </button>
      <button type="button" onClick={() => find(false)}>
        下一个
      </button>
      {replaceMode ? (
        <>
          <button type="button" onClick={replaceCurrent}>
            替换
          </button>
          <button type="button" onClick={replaceAll}>
            全部替换
          </button>
        </>
      ) : null}
      <button type="button" className="find-close" title="关闭查找栏 (Esc)" onClick={onClose}>
        <IconClose size={12} />
      </button>
    </div>
  );
}