import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  NO_SYSTEM_CAPTION,
  fetchSystemCaption,
  isTauri,
  isWindowFocused,
  isWindowMaximized,
  onWindowFocusChanged,
  windowAction,
  type SystemCaption,
} from "../lib/ipc";
import { IconClose, IconMaximize, IconMinimize, IconRestore, Mark } from "./Icons";

interface TitleBarProps {
  /** Current document name, without the dirty marker. */
  documentName: string;
  /** Unsaved-changes marker, shown before the document name. */
  dirty: boolean;
  /** Full path, used as a tooltip. */
  path: string | null;
  preview: boolean;
  onRequestClose: () => void;
}

type CaptionVars = CSSProperties & Record<`--${string}`, string>;

export function TitleBar({ documentName, dirty, path, preview, onRequestClose }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  // `decorations: false` took the OS caption away, so the active/inactive look
  // Windows, macOS and the Linux desktop themes give a window is drawn here.
  const [focused, setFocused] = useState(true);
  // What the desktop reports about its own colours; a missing accent or caption
  // leaves the bar on the app's accent and panel.
  const [system, setSystem] = useState<SystemCaption>(NO_SYSTEM_CAPTION);

  const refreshCaption = useCallback(() => {
    void fetchSystemCaption().then(setSystem);
  }, []);

  useEffect(() => {
    refreshCaption();
  }, [refreshCaption]);

  useEffect(() => {
    let alive = true;
    isWindowMaximized()
      .then((value) => {
        if (alive) setMaximized(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void onWindowFocusChanged((next) => {
      setFocused(next);
      // The accent can change in the OS settings while the app stays open.
      if (next) refreshCaption();
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
      // Focus events only report changes, and the window was focused before
      // this listener existed, so read the current state once. Asking after
      // the listener is live keeps a real event from being overwritten.
      void isWindowFocused()
        .then((value) => {
          if (!disposed) setFocused(value);
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refreshCaption]);

  const toggle = async () => {
    await windowAction("toggle-maximize");
    setMaximized(await isWindowMaximized().catch(() => false));
  };

  const drag = isTauri ? { "data-tauri-drag-region": true } : {};
  const caption = system.caption;
  // The accent drives the bar's own hairline; the caption colours exist only
  // where the desktop fills captions.
  const captionVars: CaptionVars | undefined =
    system.accent || caption
      ? {
          ...(system.accent ? { "--titlebar-accent": system.accent } : {}),
          ...(caption
            ? { "--caption-bg": caption.background, "--caption-ink": caption.foreground }
            : {}),
        }
      : undefined;

  return (
    <header
      className="titlebar"
      data-focused={focused ? "true" : "false"}
      data-caption={caption ? "accent" : undefined}
      style={captionVars}
    >
      <div className="drag" {...drag}>
        <span className="mark" {...drag}>
          <Mark size={17} />
        </span>
        <span className="name" {...drag}>
          noteCalc
        </span>
        <span className="doc" {...drag} title={path ?? "未保存文件"}>
          {dirty ? <i className="dirty-dot" {...drag} /> : null}
          <span className="doc-name" {...drag}>
            {documentName}
          </span>
        </span>
        {preview ? (
          <span className="chip preview" {...drag}>
            浏览器预览 · 结果仅供参考
          </span>
        ) : null}
      </div>
      <div className="win-btns">
        <button type="button" title="最小化" onClick={() => windowAction("minimize")}>
          <IconMinimize size={15} />
        </button>
        <button type="button" title={maximized ? "还原" : "最大化"} onClick={toggle}>
          {maximized ? <IconRestore size={14} /> : <IconMaximize size={13} />}
        </button>
        <button type="button" className="close" title="关闭" onClick={onRequestClose}>
          <IconClose size={15} />
        </button>
      </div>
    </header>
  );
}