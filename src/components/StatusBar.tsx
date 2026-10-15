import { IconBook, IconHelp } from "./Icons";

interface StatusBarProps {
  message: string;
  darkMode: boolean;
  helpOpen: boolean;
  onToggleTheme: () => void;
  onToggleHelp: () => void;
}

export function StatusBar({
  message,
  darkMode,
  helpOpen,
  onToggleTheme,
  onToggleHelp,
}: StatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-msg" title={message}>
        {message}
      </span>
      <span className="status-tools">
        <button type="button" className={helpOpen ? "on" : ""} onClick={onToggleHelp} title="语法帮助 (F1)">
          <IconBook size={14} />
          语法
        </button>
        <button type="button" onClick={onToggleTheme} title="切换主题 (Ctrl+Shift+D)">
          {darkMode ? "浅色" : "深色"}
        </button>
        <span className="status-hint" title="帮助面板里列出了全部语法">
          <IconHelp size={13} />
        </span>
      </span>
    </footer>
  );
}