import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FindReplaceBar } from "./components/FindReplaceBar";
import { HelpPanel } from "./components/HelpPanel";
import { MenuBar, type MenuDefinition } from "./components/MenuBar";
import { MenuNumberRow } from "./components/MenuNumberRow";
import { Modal } from "./components/Modal";
import { NoteEditor, type EditorHandle } from "./components/NoteEditor";
import { StatusBar } from "./components/StatusBar";
import { TabBar, documentName, isDirty } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import { readClipboard, writeClipboard } from "./lib/clipboard";
import { EXAMPLE_CONTENT } from "./lib/example";
import { buildIndex } from "./lib/highlight";
import {
  evaluate,
  exportResults as exportResultsCommand,
  fetchChromeMetrics,
  fetchMetadata,
  isTauri,
  loadSession,
  onCloseRequested,
  openDocuments,
  readDocument,
  saveDocumentAs,
  saveSession,
  windowAction,
  windowGeometry,
  writeDocument,
} from "./lib/ipc";
import {
  BADGE_GAP_STEP,
  BADGE_TONE_LABELS,
  BADGE_TONES,
  clampBadgeGapChars,
  DEFAULT_BADGE_GAP_CHARS,
  MAX_BADGE_GAP_CHARS,
  MIN_BADGE_GAP_CHARS,
  type BadgeTone,
  type CalcMetadata,
  type SessionState,
  type TabState,
} from "./lib/types";
const RECALC_DELAY = 120;
const AUTOSAVE_DELAY = 700;
const FLASH_MS = 2500;
const DEFAULT_FONT_SIZE = 15;
const MAX_PRECISION = 12;

let tabSequence = 0;

function createTab(
  content = "",
  path: string | null = null,
  savedText = content,
  fontSize = DEFAULT_FONT_SIZE,
): TabState {
  tabSequence += 1;
  return {
    id: `tab-${tabSequence}`,
    path,
    content,
    savedText,
    fontSize,
    results: [],
    scopeSize: 0,
    stats: "就绪",
    documentError: null,
    findOpen: false,
    findMode: "find",
    caretLine: 0,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}

type UnsavedAnswer = "save" | "discard" | "cancel";

type ModalState =
  | { kind: "unsaved"; name: string; resolve: (answer: UnsavedAnswer) => void }
  | { kind: "alert"; title: string; message: string }
  | { kind: "about" };

export default function App() {
  const [ready, setReady] = useState(false);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState("");
  const [metadata, setMetadata] = useState<CalcMetadata>({ functions: [], constants: [], units: [] });
  const [precision, setPrecision] = useState(4);
  const [showHex, setShowHex] = useState(false);
  const [showBinary, setShowBinary] = useState(false);
  const [badgeTone, setBadgeTone] = useState<BadgeTone>("light");
  const [badgeGapChars, setBadgeGapChars] = useState(DEFAULT_BADGE_GAP_CHARS);
  const [darkMode, setDarkMode] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);

  const tabsRef = useRef<TabState[]>([]);
  const activeIdRef = useRef("");
  const precisionRef = useRef(4);
  const settingsRef = useRef({
    showHex: false,
    showBinary: false,
    badgeTone: "light" as BadgeTone,
    badgeGapChars: DEFAULT_BADGE_GAP_CHARS,
    darkMode: true,
  });
  const editors = useRef(new Map<string, EditorHandle>());
  const recalcTimers = useRef(new Map<string, number>());
  const autosaveTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  const modalRef = useRef<ModalState | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    precisionRef.current = precision;
  }, [precision]);
  useEffect(() => {
    settingsRef.current = { showHex, showBinary, badgeTone, badgeGapChars, darkMode };
  }, [showHex, showBinary, badgeTone, badgeGapChars, darkMode]);
  useEffect(() => {
    modalRef.current = modal;
  }, [modal]);
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);
  useEffect(() => {
    // The window chrome is self-drawn, so its sizes have to be asked for rather
    // than inherited (see `metrics.rs`). Until the answer arrives — and in a
    // browser preview, where there is none — the stylesheet's own sizes stand.
    void fetchChromeMetrics().then((chrome) => {
      if (!chrome) return;
      const root = document.documentElement;
      root.dataset.chrome = chrome.measured ? "system" : "platform";
      root.style.setProperty("--titlebar-h", `${chrome.titleHeight}px`);
      root.style.setProperty("--menubar-h", `${chrome.menuHeight}px`);
      root.style.setProperty("--menu-font-size", `${chrome.menuFontSize}px`);
      root.style.setProperty("--tab-h", `${chrome.tabHeight}px`);
    });
  }, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );
  const highlightIndex = useMemo(() => buildIndex(metadata), [metadata]);

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);

  const editorFor = useCallback((id: string) => editors.current.get(id) ?? null, []);

  const updateBadgeGapChars = useCallback((value: number) => {
    setBadgeGapChars(clampBadgeGapChars(value));
  }, []);

  const patchTab = useCallback((id: string, patch: Partial<TabState>) => {
    setTabs((previous) => previous.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const recompute = useCallback(async (tabId: string, contentOverride?: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const content = contentOverride ?? tab?.content;
    if (content === undefined) return;
    const started = performance.now();
    try {
      const outcome = await evaluate(content, precisionRef.current);
      const elapsed = performance.now() - started;
      const results = outcome.results;
      const calculated = results.filter(
        (row) => row.result !== null && row.result !== undefined,
      ).length;
      const errors = results.filter((row) => row.type === "error").length;
      const scopeSize = Object.keys(outcome.scope).length;
      const stats = `${results.length} 行 · ${calculated} 个结果 · ${scopeSize} 个变量 · ${errors} 个错误 · ${elapsed.toFixed(1)} ms`;
      setTabs((previous) =>
        previous.map((entry) =>
          entry.id === tabId
            ? { ...entry, results, scopeSize, stats, documentError: null }
            : entry,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTabs((previous) =>
        previous.map((entry) =>
          entry.id === tabId
            ? { ...entry, results: [], scopeSize: 0, documentError: message, stats: "计算失败" }
            : entry,
        ),
      );
    }
  }, []);

  const scheduleRecompute = useCallback(
    (tabId: string) => {
      const timers = recalcTimers.current;
      const existing = timers.get(tabId);
      if (existing !== undefined) window.clearTimeout(existing);
      timers.set(
        tabId,
        window.setTimeout(() => {
          timers.delete(tabId);
          void recompute(tabId);
        }, RECALC_DELAY),
      );
    },
    [recompute],
  );

  const persist = useCallback(async () => {
    const current = tabsRef.current;
    const index = current.findIndex((tab) => tab.id === activeIdRef.current);
    const session: SessionState = {
      tabs: current.map((tab) => ({
        path: tab.path,
        content: tab.content,
        savedText: tab.savedText,
        fontSize: tab.fontSize,
      })),
      activeTab: Math.max(0, index),
      precision: precisionRef.current,
      showHex: settingsRef.current.showHex,
      showBinary: settingsRef.current.showBinary,
      badgeTone: settingsRef.current.badgeTone,
      badgeGapChars: settingsRef.current.badgeGapChars,
      fontSize: index >= 0 ? current[index].fontSize : DEFAULT_FONT_SIZE,
      darkMode: settingsRef.current.darkMode,
      window: await windowGeometry(),
    };
    await saveSession(session).catch(() => undefined);
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void persist();
    }, AUTOSAVE_DELAY);
  }, [persist]);

  const updateContent = useCallback(
    (tabId: string, content: string) => {
      setTabs((previous) =>
        previous.map((tab) => (tab.id === tabId ? { ...tab, content } : tab)),
      );
      scheduleRecompute(tabId);
      scheduleAutosave();
    },
    [scheduleAutosave, scheduleRecompute],
  );

  /* ------------------------------- startup ------------------------------- */

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [session, meta] = await Promise.all([
        loadSession().catch(() => null),
        fetchMetadata().catch(() => null),
      ]);
      if (!alive) return;
      if (meta) setMetadata(meta);

      if (session && session.tabs.length) {
        setPrecision(session.precision ?? 4);
        setShowHex(Boolean(session.showHex));
        setShowBinary(Boolean(session.showBinary));
        setBadgeTone(session.badgeTone ?? "light");
        setBadgeGapChars(clampBadgeGapChars(session.badgeGapChars));
        setDarkMode(Boolean(session.darkMode));
        const restored: TabState[] = [];
        for (const entry of session.tabs) {
          let path = entry.path;
          let content = entry.content;
          let savedText = entry.savedText;
          if (path) {
            try {
              const document = await readDocument(path);
              content = document.content;
              savedText = document.content;
            } catch {
              path = null;
            }
          }
          restored.push(
            createTab(content, path, savedText, entry.fontSize || DEFAULT_FONT_SIZE),
          );
        }
        const index = Math.min(
          Math.max(0, session.activeTab ?? 0),
          Math.max(0, restored.length - 1),
        );
        tabsRef.current = restored;
        setTabs(restored);
        setActiveId(restored[index].id);
      } else {
        const tab = createTab(EXAMPLE_CONTENT);
        tabsRef.current = [tab];
        setTabs([tab]);
        setActiveId(tab.id);
        showFlash("欢迎使用 noteCalc · 这是示例笔记，可直接修改或另存");
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [showFlash]);

  useEffect(() => {
    if (!ready) return;
    for (const tab of tabs) void recompute(tab.id, tab.content);
    // Only the initial pass needs to fan out over every restored tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    void persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Display settings are session state too: the Python original only wrote them
  // on close, which loses them whenever the window is killed instead of closed.
  const settingsSeen = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!settingsSeen.current) {
      settingsSeen.current = true;
      return;
    }
    scheduleAutosave();
  }, [ready, precision, showHex, showBinary, badgeTone, badgeGapChars, darkMode, scheduleAutosave]);

  const lastPrecision = useRef(precision);
  useEffect(() => {
    if (lastPrecision.current === precision) return;
    lastPrecision.current = precision;
    for (const tab of tabsRef.current) void recompute(tab.id);
  }, [precision, recompute]);

  useEffect(() => {
    if (!ready) return;
    window.setTimeout(() => editorFor(activeIdRef.current)?.focus(), 0);
  }, [ready, editorFor]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void onCloseRequested(async () => {
      if (modalRef.current) return false;
      const canClose = await confirmEverything();
      if (!canClose) return false;
      await persist();
      return true;
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[0].id);
    }
  }, [tabs, activeId]);

  const name = documentName(activeTab);
  const dirty = isDirty(activeTab);
  useEffect(() => {
    document.title = `${dirty ? "*" : ""}${name} - noteCalc`;
  }, [dirty, name]);

  /* ------------------------------ documents ------------------------------ */

  const askUnsaved = useCallback((name: string) => {
    return new Promise<UnsavedAnswer>((resolve) => {
      setModal({ kind: "unsaved", name, resolve });
    });
  }, []);

  const showAlert = useCallback((title: string, message: string) => {
    setModal({ kind: "alert", title, message });
  }, []);

  const saveTabAs = useCallback(
    async (tab: TabState) => {
      try {
        const suggested = tab.path ?? "未命名.ncalc";
        const path = await saveDocumentAs(suggested, tab.content);
        if (!path) return false;
        setTabs((previous) =>
          previous.map((entry) =>
            entry.id === tab.id ? { ...entry, path, savedText: tab.content } : entry,
          ),
        );
        showFlash(`已保存：${path}`);
        void persist();
        return true;
      } catch (error) {
        showAlert("保存失败", `无法保存文件：\n${error instanceof Error ? error.message : error}`);
        return false;
      }
    },
    [persist, showAlert, showFlash],
  );

  const saveTab = useCallback(
    async (tab: TabState) => {
      if (!tab.path) return saveTabAs(tab);
      try {
        await writeDocument(tab.path, tab.content);
      } catch (error) {
        showAlert("保存失败", `无法保存文件：\n${error instanceof Error ? error.message : error}`);
        return false;
      }
      setTabs((previous) =>
        previous.map((entry) =>
          entry.id === tab.id ? { ...entry, savedText: tab.content } : entry,
        ),
      );
      showFlash(`已保存：${tab.path}`);
      void persist();
      return true;
    },
    [persist, saveTabAs, showAlert, showFlash],
  );

  const removeTab = useCallback(
    (id: string) => {
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      editors.current.delete(id);
      if (!remaining.length) {
        const fresh = createTab("", null, "");
        tabsRef.current = [fresh];
        setTabs([fresh]);
        setActiveId(fresh.id);
      } else {
        tabsRef.current = remaining;
        setTabs(remaining);
        if (activeIdRef.current === id) setActiveId(remaining[remaining.length - 1].id);
      }
      void persist();
    },
    [persist],
  );

  const confirmCloseTab = useCallback(
    async (tab: TabState): Promise<boolean> => {
      if (tab.content === tab.savedText) return true;
      const answer = await askUnsaved(documentName(tab));
      if (answer === "cancel") return false;
      if (answer === "save") return saveTab(tab);
      return true;
    },
    [askUnsaved, saveTab],
  );

  const confirmEverything = useCallback(async () => {
    for (const tab of tabsRef.current) {
      if (!(await confirmCloseTab(tab))) return false;
    }
    return true;
  }, [confirmCloseTab]);

  const newDocument = useCallback(() => {
    const fontSize = tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.fontSize;
    const tab = createTab("", null, "", fontSize ?? DEFAULT_FONT_SIZE);
    const next = [...tabsRef.current, tab];
    tabsRef.current = next;
    setTabs(next);
    setActiveId(tab.id);
    void persist();
  }, [persist]);

  const openDocument = useCallback(async () => {
    const current = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
    const directory = current?.path ? current.path.replace(/[\\/][^\\/]*$/, "") : null;
    try {
      const documents = await openDocuments(directory);
      if (!documents.length) return;
      const existing = [...tabsRef.current];
      let activate = activeIdRef.current;
      const added: TabState[] = [];
      for (const document of documents) {
        const normalized = normalizePath(document.path);
        const match = existing.find(
          (tab) => tab.path && normalizePath(tab.path) === normalized,
        );
        if (match) {
          activate = match.id;
          continue;
        }
        const tab = createTab(document.content, document.path, document.content);
        existing.push(tab);
        added.push(tab);
        activate = tab.id;
      }
      tabsRef.current = existing;
      setTabs(existing);
      setActiveId(activate);
      for (const tab of added) void recompute(tab.id, tab.content);
      void persist();
    } catch (error) {
      showAlert("打开失败", `无法打开文件：\n${error instanceof Error ? error.message : error}`);
    }
  }, [persist, recompute, showAlert]);

  const exportResults = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current);
    if (!tab) return;
    try {
      const path = await exportResultsCommand(tab.content, precisionRef.current);
      if (path) showFlash(`已导出：${path}`);
    } catch (error) {
      showAlert("导出失败", `无法导出文件：\n${error instanceof Error ? error.message : error}`);
    }
  }, [showAlert, showFlash]);

  const copyValue = useCallback(
    async (value: string, label: string) => {
      const ok = await writeClipboard(value);
      showFlash(ok ? `已复制结果：${value}` : `复制失败：${label}`);
    },
    [showFlash],
  );

  const pasteIntoEditor = useCallback(async () => {
    const handle = editorFor(activeIdRef.current);
    if (!handle) return;
    const text = await readClipboard();
    if (text === null) {
      showFlash("无法读取剪贴板，请直接使用 Ctrl+V");
      return;
    }
    const selection = handle.selection();
    handle.replaceRange(selection.start, selection.end, text);
  }, [editorFor, showFlash]);

  const runEditorCommand = useCallback(
    (command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll") => {
      if (command === "paste") {
        void pasteIntoEditor();
        return;
      }
      const handle = editorFor(activeIdRef.current);
      if (!handle?.exec(command)) showFlash("当前环境不支持该编辑操作，请使用键盘快捷键");
    },
    [editorFor, pasteIntoEditor, showFlash],
  );

  const switchTab = useCallback(
    (id: string) => {
      setActiveId(id);
      void recompute(id);
      window.setTimeout(() => editorFor(id)?.focus(), 0);
    },
    [editorFor, recompute],
  );

  const reorderTabs = useCallback((from: number, to: number) => {
    const current = [...tabsRef.current];
    const [moved] = current.splice(from, 1);
    if (!moved) return;
    current.splice(to, 0, moved);
    tabsRef.current = current;
    setTabs(current);
  }, []);


  /* ------------------------------ shortcuts ------------------------------ */

  const toggleTheme = useCallback(() => setDarkMode((value) => !value), []);
  const openFind = useCallback(
    (replace: boolean) => {
      patchTab(activeIdRef.current, {
        findOpen: true,
        findMode: replace ? "replace" : "find",
      });
    },
    [patchTab],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen((value) => !value);
        return;
      }
      if (modalRef.current) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        if (key === "d") {
          event.preventDefault();
          toggleTheme();
        } else if (key === "s") {
          event.preventDefault();
          const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current);
          if (tab) void saveTabAs(tab);
        }
        return;
      }
      const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current);
      if (key === "n") {
        event.preventDefault();
        newDocument();
      } else if (key === "o") {
        event.preventDefault();
        void openDocument();
      } else if (key === "s") {
        event.preventDefault();
        if (tab) void saveTab(tab);
      } else if (key === "f") {
        event.preventDefault();
        openFind(false);
      } else if (key === "h") {
        event.preventDefault();
        openFind(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newDocument, openDocument, openFind, saveTab, saveTabAs, toggleTheme]);

  /* -------------------------------- menus -------------------------------- */

  const menus: MenuDefinition[] = [
    {
      label: "文件",
      entries: [
        { kind: "action", label: "新建", shortcut: "Ctrl+N", onSelect: newDocument },
        { kind: "action", label: "打开", shortcut: "Ctrl+O", onSelect: () => void openDocument() },
        { kind: "separator" },
        {
          kind: "action",
          label: "保存",
          shortcut: "Ctrl+S",
          onSelect: () => {
            const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current);
            if (tab) void saveTab(tab);
          },
        },
        {
          kind: "action",
          label: "另存为",
          shortcut: "Ctrl+Shift+S",
          onSelect: () => {
            const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current);
            if (tab) void saveTabAs(tab);
          },
        },
        { kind: "separator" },
        { kind: "action", label: "导出结果", onSelect: () => void exportResults() },
      ],
    },
    {
      label: "编辑",
      entries: [
        { kind: "action", label: "撤销", shortcut: "Ctrl+Z", onSelect: () => runEditorCommand("undo") },
        { kind: "action", label: "重做", shortcut: "Ctrl+Y", onSelect: () => runEditorCommand("redo") },
        { kind: "separator", key: "edit-1" },
        { kind: "action", label: "剪切", shortcut: "Ctrl+X", onSelect: () => runEditorCommand("cut") },
        { kind: "action", label: "复制", shortcut: "Ctrl+C", onSelect: () => runEditorCommand("copy") },
        { kind: "action", label: "粘贴", shortcut: "Ctrl+V", onSelect: () => runEditorCommand("paste") },
        {
          kind: "action",
          label: "全选",
          shortcut: "Ctrl+A",
          onSelect: () => runEditorCommand("selectAll"),
        },
        { kind: "separator", key: "edit-2" },
        { kind: "action", label: "查找", shortcut: "Ctrl+F", onSelect: () => openFind(false) },
        { kind: "action", label: "替换", shortcut: "Ctrl+H", onSelect: () => openFind(true) },
        { kind: "separator", key: "edit-3" },
        {
          kind: "custom",
          key: "precision",
          render: () => (
            <div className="menu-row">
              <span>小数位</span>
              <span className="menu-stepper">
                <button
                  type="button"
                  onClick={() => setPrecision((value) => Math.max(0, value - 1))}
                  disabled={precision <= 0}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={MAX_PRECISION}
                  value={precision}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      setPrecision(Math.min(MAX_PRECISION, Math.max(0, Math.round(next))));
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setPrecision((value) => Math.min(MAX_PRECISION, value + 1))}
                  disabled={precision >= MAX_PRECISION}
                >
                  +
                </button>
              </span>
            </div>
          ),
        },
        {
          kind: "custom",
          key: "tone",
          render: () => (
            <div className="menu-row">
              <span>结果框强度</span>
              <span className="tone-group">
                {BADGE_TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    className={tone === badgeTone ? "tone on" : "tone"}
                    onClick={() => setBadgeTone(tone)}
                  >
                    {BADGE_TONE_LABELS[tone]}
                  </button>
                ))}
              </span>
            </div>
          ),
        },
        {
          kind: "custom",
          key: "badge-gap",
          render: () => (
            <MenuNumberRow
              label="结果间距（字符）"
              value={badgeGapChars}
              min={MIN_BADGE_GAP_CHARS}
              max={MAX_BADGE_GAP_CHARS}
              step={BADGE_GAP_STEP}
              onChange={updateBadgeGapChars}
            />
          ),
        },
        { kind: "separator", key: "edit-4" },
        {
          kind: "action",
          label: "整数/数组结果显示十六进制",
          checked: showHex,
          onSelect: () => setShowHex((value) => !value),
        },
        {
          kind: "action",
          label: "整数/数组结果显示二进制",
          checked: showBinary,
          onSelect: () => setShowBinary((value) => !value),
        },
      ],
    },
    {
      label: "视图",
      entries: [
        {
          kind: "action",
          label: "切换主题",
          shortcut: "Ctrl+Shift+D",
          onSelect: toggleTheme,
        },
        {
          kind: "action",
          label: "语法帮助",
          shortcut: "F1",
          checked: helpOpen,
          onSelect: () => setHelpOpen((value) => !value),
        },
      ],
    },
    {
      label: "帮助",
      entries: [{ kind: "action", label: "关于", onSelect: () => setModal({ kind: "about" }) }],
    },
  ];

  /* ------------------------------- rendering ------------------------------ */

  const statusMessage =
    flash ?? activeTab?.documentError ?? activeTab?.stats ?? (ready ? "就绪" : "正在载入会话…");

  let modalNode: ReactNode = null;
  if (modal?.kind === "unsaved") {
    const answer = modal.resolve;
    const close = (value: UnsavedAnswer) => {
      setModal(null);
      answer(value);
    };
    modalNode = (
      <Modal
        title="未保存的修改"
        onDismiss={() => close("cancel")}
        buttons={[
          { label: "保存", primary: true, onClick: () => close("save") },
          { label: "不保存", onClick: () => close("discard") },
          { label: "取消", onClick: () => close("cancel") },
        ]}
      >
        <p>{modal.name} 有未保存的修改。是否先保存？</p>
      </Modal>
    );
  } else if (modal?.kind === "alert") {
    modalNode = (
      <Modal
        title={modal.title}
        onDismiss={() => setModal(null)}
        buttons={[{ label: "确定", primary: true, onClick: () => setModal(null) }]}
      >
        <p className="pre">{modal.message}</p>
      </Modal>
    );
  } else if (modal?.kind === "about") {
    modalNode = (
      <Modal
        title="关于"
        onDismiss={() => setModal(null)}
        buttons={[{ label: "确定", primary: true, onClick: () => setModal(null) }]}
      >
        <p>{`noteCalc v${__APP_VERSION__}`}</p>
        <p>纯本地运行，不上传笔记内容。</p>
        <p>基于 Tauri 2 与 Rust 计算引擎；交互与结果展示参考 NoteCalc。</p>
      </Modal>
    );
  }

  return (
    <div className="app">
      <TitleBar
        documentName={name}
        dirty={dirty}
        path={activeTab?.path ?? null}
        preview={!isTauri}
        onRequestClose={() => {
          void (async () => {
            const canClose = await confirmEverything();
            if (!canClose) return;
            await persist();
            await windowAction("destroy");
          })();
        }}
      />
      <MenuBar menus={menus} />
      <div className="work">
        <div className="work-main">
          <TabBar
            tabs={tabs}
            activeId={activeTab?.id ?? ""}
            onActivate={switchTab}
            onClose={(id) => {
              const tab = tabsRef.current.find((entry) => entry.id === id);
              if (tab) {
                void (async () => {
                  if (await confirmCloseTab(tab)) removeTab(id);
                })();
              }
            }}
            onNew={newDocument}
            onReorder={reorderTabs}
          />
          <div className="pages">
            {tabs.map((tab) => {
              const visible = tab.id === activeTab?.id;
              return (
                <section className={visible ? "page" : "page hidden"} key={tab.id}>
                  <NoteEditor
                    ref={(handle) => {
                      if (handle) editors.current.set(tab.id, handle);
                      else editors.current.delete(tab.id);
                    }}
                    content={tab.content}
                    results={tab.results}
                    index={highlightIndex}
                    fontSize={tab.fontSize}
                    darkMode={darkMode}
                    showHex={showHex}
                    showBinary={showBinary}
                    badgeTone={badgeTone}
                    badgeGapChars={badgeGapChars}
                    onChange={(content) => updateContent(tab.id, content)}
                    onFontSizeChange={(fontSize) => {
                      patchTab(tab.id, { fontSize });
                      scheduleAutosave();
                    }}
                    onCopy={(value, label) => void copyValue(value, label)}
                    onToggleHex={setShowHex}
                    onToggleBinary={setShowBinary}
                    onToneChange={setBadgeTone}
                    onBadgeGapChange={updateBadgeGapChars}
                  />
                  {tab.findOpen ? (
                    <FindReplaceBar
                      content={tab.content}
                      editor={() => editorFor(tab.id)}
                      replaceMode={tab.findMode === "replace"}
                      onChange={(content, caret) => {
                        const handle = editorFor(tab.id);
                        if (caret !== undefined) {
                          handle?.replaceRange(0, tab.content.length, content, caret);
                        } else {
                          updateContent(tab.id, content);
                        }
                      }}
                      onMessage={showFlash}
                      onClose={() => {
                        patchTab(tab.id, { findOpen: false });
                        editorFor(tab.id)?.focus();
                      }}
                    />
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
        {helpOpen ? <HelpPanel onClose={() => setHelpOpen(false)} /> : null}
      </div>
      <StatusBar
        message={statusMessage}
        darkMode={darkMode}
        helpOpen={helpOpen}
        onToggleTheme={toggleTheme}
        onToggleHelp={() => setHelpOpen((value) => !value)}
      />
      {modalNode}
    </div>
  );
}
