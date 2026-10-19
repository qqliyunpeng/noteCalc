import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { readClipboard } from "../lib/clipboard";

type EditableField = HTMLInputElement | HTMLTextAreaElement;

interface ContextMenuItemProps {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect(): void;
}

function ContextMenuItem({ label, shortcut, disabled, onSelect }: ContextMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="tick" />
      <span className="label">{label}</span>
      {shortcut ? <span className="shortcut">{shortcut}</span> : null}
    </button>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface EditContextMenuOptions {
  /**
   * Custom paste path for editors that keep their own undo history (the note
   * editor does). Without it the text is inserted through the browser.
   */
  onPaste?(text: string, target: EditableField): void;
  /** Called after a command changed the field's value or selection. */
  onCommand?(): void;
}

/**
 * Replaces the webview's native context menu on a text field with the app's
 * edit commands. The native menu carries a "writing direction" submenu that
 * means nothing here, and it cannot be trimmed item by item.
 */
export function useEditContextMenu({ onPaste, onCommand }: EditContextMenuOptions = {}) {
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<EditableField | null>(null);

  /** Opens the menu at the pointer, acting on `target`. */
  const openMenu = useCallback(
    (
      event: { preventDefault(): void; clientX: number; clientY: number },
      target: EditableField | null,
    ) => {
      event.preventDefault();
      if (!target) return;
      target.focus();
      targetRef.current = target;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        hasSelection: target.selectionStart !== target.selectionEnd,
      });
    },
    [],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<EditableField>) => openMenu(event, event.currentTarget),
    [openMenu],
  );

  useEffect(() => {
    if (!menu) return undefined;
    const closeOnMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Consume the key so an enclosing widget (a find bar, the editor) does
      // not also react to the Escape that only dismisses this menu.
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
    };
    document.addEventListener("mousedown", closeOnMouseDown);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnMouseDown);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menu]);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    // Keep a menu opened near the window edge on screen.
    const margin = 4;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${clamp(menu.x, margin, Math.max(margin, window.innerWidth - width - margin))}px`;
    element.style.top = `${clamp(menu.y, margin, Math.max(margin, window.innerHeight - height - margin))}px`;
  }, [menu]);

  const runCommand = useCallback(
    (command: "undo" | "redo" | "cut" | "copy" | "selectAll") => {
      setMenu(null);
      const target = targetRef.current;
      if (!target) return;
      target.focus();
      if (command === "selectAll") {
        target.select();
        onCommand?.();
        return;
      }
      try {
        document.execCommand(command);
      } catch {
        /* Leave the field alone when the webview refuses the command. */
      }
      onCommand?.();
    },
    [onCommand],
  );

  const paste = useCallback(async () => {
    setMenu(null);
    const text = await readClipboard();
    const target = targetRef.current;
    if (!target) return;
    target.focus();
    if (text === null) {
      try {
        document.execCommand("paste");
      } catch {
        /* The Ctrl+V shortcut still works when the clipboard is locked. */
      }
      return;
    }
    if (onPaste) {
      onPaste(text, target);
      return;
    }
    if (document.execCommand("insertText", false, text)) return;
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    target.setRangeText(text, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }, [onPaste]);

  return {
    onContextMenu,
    openMenu,
    menu: menu ? (
      <div
        className="context-menu"
        ref={menuRef}
        style={{ left: menu.x, top: menu.y }}
        role="menu"
        onContextMenu={(event) => event.stopPropagation()}
      >
        <ContextMenuItem
          label="撤销"
          shortcut="Ctrl+Z"
          onSelect={() => runCommand("undo")}
        />
        <ContextMenuItem
          label="重做"
          shortcut="Ctrl+Y"
          onSelect={() => runCommand("redo")}
        />
        <div className="menu-sep" />
        <ContextMenuItem
          label="剪切"
          shortcut="Ctrl+X"
          disabled={!menu.hasSelection}
          onSelect={() => runCommand("cut")}
        />
        <ContextMenuItem
          label="复制"
          shortcut="Ctrl+C"
          disabled={!menu.hasSelection}
          onSelect={() => runCommand("copy")}
        />
        <ContextMenuItem
          label="粘贴"
          shortcut="Ctrl+V"
          onSelect={() => void paste()}
        />
        <div className="menu-sep" />
        <ContextMenuItem
          label="全选"
          shortcut="Ctrl+A"
          onSelect={() => runCommand("selectAll")}
        />
      </div>
    ) : null,
  };
}
