import { useEffect, useRef, useState } from "react";

export type MenuEntry =
  | {
      kind: "action";
      label: string;
      shortcut?: string;
      onSelect: () => void;
      checked?: boolean;
      disabled?: boolean;
    }
  | { kind: "separator"; key?: string }
  | { kind: "custom"; key: string; render: () => React.ReactNode };

export interface MenuDefinition {
  label: string;
  entries: MenuEntry[];
}

interface MenuBarProps {
  menus: MenuDefinition[];
}

const ACTIVATION_KEYS = new Set(["Enter", " "]);

export function MenuBar({ menus }: MenuBarProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openIndex === null) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenIndex(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenIndex(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex]);

  return (
    <div className="menubar" ref={rootRef}>
      {menus.map((menu, index) => {
        const open = openIndex === index;
        return (
          <div className="menu-root" key={menu.label}>
            <button
              type="button"
              className={open ? "menu-title open" : "menu-title"}
              onClick={() => setOpenIndex(open ? null : index)}
              onMouseEnter={() => {
                if (openIndex !== null) setOpenIndex(index);
              }}
            >
              {menu.label}
            </button>
            {open ? (
              <div className="menu-drop" role="menu">
                {menu.entries.map((entry, entryIndex) => {
                  if (entry.kind === "separator") {
                    return <div className="menu-sep" key={entry.key ?? `sep-${entryIndex}`} />;
                  }
                  if (entry.kind === "custom") {
                    return (
                      <div className="menu-custom" key={entry.key}>
                        {entry.render()}
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      key={entry.label}
                      disabled={entry.disabled}
                      onClick={() => {
                        setOpenIndex(null);
                        entry.onSelect();
                      }}
                      onKeyDown={(event) => {
                        if (ACTIVATION_KEYS.has(event.key)) {
                          event.preventDefault();
                          setOpenIndex(null);
                          entry.onSelect();
                        }
                      }}
                    >
                      <span className="tick">{entry.checked ? "✓" : ""}</span>
                      <span className="label">{entry.label}</span>
                      {entry.shortcut ? <span className="shortcut">{entry.shortcut}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}