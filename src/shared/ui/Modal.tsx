import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type ModalProps = { title: string; onClose: () => void; children: ReactNode; wide?: boolean };

/** Accessible dialog: focuses the first field, closes on Esc or backdrop click,
 *  and restores focus to the trigger on unmount. */
export function Modal({ title, onClose, children, wide }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus the first real field once on open — never the close button — and
  // restore focus to the trigger on unmount. Runs only on mount so typing
  // (which re-renders the parent) never yanks focus back into the dialog.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([aria-label='Fechar'])")?.focus();
    return () => previous?.focus();
  }, []);
  // Close on Escape; re-bind only when the handler identity changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal${wide ? " wide-modal" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Fechar" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
