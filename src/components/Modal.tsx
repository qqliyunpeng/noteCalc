import type { ReactNode } from "react";

export interface ModalButton {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}

interface ModalProps {
  title: string;
  children: ReactNode;
  buttons: ModalButton[];
  onDismiss?: () => void;
}

export function Modal({ title, children, buttons, onDismiss }: ModalProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">
          {buttons.map((button) => (
            <button
              type="button"
              key={button.label}
              className={
                button.primary ? "btn primary" : button.danger ? "btn danger" : "btn"
              }
              autoFocus={button.primary}
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}