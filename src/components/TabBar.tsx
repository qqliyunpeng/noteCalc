import { useState } from "react";
import { IconClose, IconPlus } from "./Icons";
import type { TabState } from "../lib/types";

interface TabBarProps {
  tabs: TabState[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (from: number, to: number) => void;
}

function baseName(path: string | null): string {
  if (!path) return "未命名.ncalc";
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function documentName(tab: TabState | undefined): string {
  return baseName(tab?.path ?? null);
}

export function isDirty(tab: TabState | undefined): boolean {
  return tab ? tab.content !== tab.savedText : false;
}

export function TabBar({ tabs, activeId, onActivate, onClose, onNew, onReorder }: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className="tabbar">
      <div className="tab-strip">
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const dirty = isDirty(tab);
          return (
            <div
              key={tab.id}
              className={active ? "tab active" : "tab"}
              draggable
              title={tab.path ?? "未保存文件"}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  onReorder(dragIndex, index);
                  setDragIndex(index);
                }
              }}
            >
              {dirty ? <i className="dirty-dot" /> : null}
              <span className="tab-label">{baseName(tab.path)}</span>
              <button
                type="button"
                className="tab-close"
                title="关闭标签"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-new" title="新建计算笔记 (Ctrl+N)" onClick={onNew}>
        <IconPlus size={14} />
      </button>
    </div>
  );
}