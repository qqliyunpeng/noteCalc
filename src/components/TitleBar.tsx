import { useEffect, useState } from "react";
import { isTauri, isWindowMaximized, windowAction } from "../lib/ipc";
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

export function TitleBar({ documentName, dirty, path, preview, onRequestClose }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

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

  const toggle = async () => {
    await windowAction("toggle-maximize");
    setMaximized(await isWindowMaximized().catch(() => false));
  };

  const drag = isTauri ? { "data-tauri-drag-region": true } : {};

  return (
    <header className="titlebar">
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