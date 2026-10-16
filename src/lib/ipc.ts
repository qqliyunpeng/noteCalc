import { invoke } from "@tauri-apps/api/core";
import { demoEvaluate } from "./demo";
import type {
  CalcMetadata,
  EvaluateOutcome,
  NoteDocument,
  SessionState,
  WindowGeometry,
} from "./types";

/** True when running inside the Tauri webview (vs. a plain browser tab). */
export const isTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

/**
 * The calculator itself lives in Rust. Outside Tauri the editor stays usable
 * but results come from a small preview stub, so the UI can be inspected in a
 * browser without pretending the engine is available.
 */
export async function evaluate(content: string, precision: number): Promise<EvaluateOutcome> {
  if (!isTauri) return demoEvaluate(content, precision);
  return invoke<EvaluateOutcome>("evaluate", { content, precision });
}

export async function fetchMetadata(): Promise<CalcMetadata> {
  if (!isTauri) return { functions: [], constants: [], units: [] };
  return invoke<CalcMetadata>("calc_metadata");
}

export async function loadSession(): Promise<SessionState | null> {
  if (!isTauri) return readPreviewSession();
  return invoke<SessionState | null>("load_session");
}

export async function saveSession(session: SessionState): Promise<void> {
  if (!isTauri) {
    writePreviewSession(session);
    return;
  }
  await invoke("save_session", { session });
}

export async function openDocuments(directory: string | null): Promise<NoteDocument[]> {
  if (!isTauri) throw new Error("浏览器预览模式不支持打开文件");
  return invoke<NoteDocument[]>("open_documents", { directory });
}

export async function readDocument(path: string): Promise<NoteDocument> {
  if (!isTauri) throw new Error("浏览器预览模式不支持读取文件");
  return invoke<NoteDocument>("read_document", { path });
}

export async function writeDocument(path: string, content: string): Promise<void> {
  if (!isTauri) throw new Error("浏览器预览模式不支持保存文件");
  await invoke("write_document", { path, content });
}

export async function saveDocumentAs(
  suggested: string,
  content: string,
): Promise<string | null> {
  if (!isTauri) throw new Error("浏览器预览模式不支持另存为");
  return invoke<string | null>("save_document_as", { suggested, content });
}

export async function exportResults(content: string, precision: number): Promise<string | null> {
  if (!isTauri) throw new Error("浏览器预览模式不支持导出");
  return invoke<string | null>("export_results", { content, precision });
}

export type WindowAction = "minimize" | "toggle-maximize" | "destroy";

export async function windowAction(action: WindowAction): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (action === "minimize") await win.minimize();
  else if (action === "toggle-maximize") await win.toggleMaximize();
  // `destroy` tears the window down without asking again — `close` would emit
  // another close request and loop back into the unsaved-tabs prompt forever.
  else await win.destroy();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isMaximized();
}

export interface CaptionColours {
  /** `#rrggbb` the focused caption is filled with. */
  background: string;
  /** `#rrggbb` text and icons on that fill. */
  foreground: string;
}

export interface SystemCaption {
  /** `#rrggbb` accent the desktop exposes, when it has one. */
  accent: string | null;
  /**
   * Fill the desktop gives a focused caption. Only Windows fills one, and only
   * while "show accent colour on title bars and window borders" is on; the
   * other desktops keep captions neutral and report `null` here.
   */
  caption: CaptionColours | null;
}

/** No colours from the desktop — the title bar keeps the app's own. */
export const NO_SYSTEM_CAPTION: SystemCaption = { accent: null, caption: null };

/**
 * The colours the desktop gives a focused caption, and its accent.
 *
 * Each platform is asked in its own place (Windows registry, macOS defaults,
 * GNOME/KDE settings). A desktop that exposes none, and a backend that cannot
 * answer at all, are not errors — the title bar then keeps the app's own
 * colours.
 */
export async function fetchSystemCaption(): Promise<SystemCaption> {
  if (!isTauri) return NO_SYSTEM_CAPTION;
  try {
    return await invoke<SystemCaption>("system_caption");
  } catch {
    return NO_SYSTEM_CAPTION;
  }
}

/** Whether the window currently holds OS focus. */
export async function isWindowFocused(): Promise<boolean> {
  if (!isTauri) return document.hasFocus();
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isFocused();
}

/**
 * Report every OS focus change, so the self-drawn title bar can mirror the
 * active/inactive caption that `decorations: false` took away.
 *
 * The listener only fires on changes, and the window is already focused by the
 * time the UI mounts, so pair it with `isWindowFocused()` for the first read.
 */
export async function onWindowFocusChanged(
  handler: (focused: boolean) => void,
): Promise<() => void> {
  if (!isTauri) {
    const focus = () => handler(true);
    const blur = () => handler(false);
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().onFocusChanged(({ payload }) => handler(payload));
}

/**
 * Window size and position for session restore.
 *
 * Width and height are the client size, matching what Rust restores through
 * `set_size`. Saving `outerSize()` here mixed the two, so the window crept
 * larger by a frame on every launch.
 */
export async function windowGeometry(): Promise<WindowGeometry | null> {
  if (!isTauri) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [size, position, maximized] = await Promise.all([
    win.innerSize(),
    win.outerPosition(),
    win.isMaximized(),
  ]);
  return {
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    maximized,
  };
}

/**
 * Listen for the OS close request so the app can prompt about dirty tabs.
 *
 * The handler resolves to `true` once the window may really go away: the Tauri
 * wrapper only destroys the window when the event was *not* prevented, so the
 * window has to be torn down here after the prompt has been answered.
 */
export async function onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  if (!isTauri) return () => undefined;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  return window.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await handler()) await window.destroy();
  });
}

const PREVIEW_KEY = "notebookcalc.preview.session";

function readPreviewSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}

function writePreviewSession(session: SessionState): void {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(session));
  } catch {
    /* storage disabled — the preview simply does not persist */
  }
}