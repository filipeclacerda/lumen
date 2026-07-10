import { createPortal } from "react-dom";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  description?: string;
  dismissible?: boolean;
  wide?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
};
const focusable =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack: symbol[] = [];
export function OverlayDialog({
  title,
  description,
  children,
  onClose,
  dismissible = true,
  wide,
  initialFocus,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = Symbol("overlay");
    stack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTarget = initialFocus?.current ?? dialog.current?.querySelector<HTMLElement>(focusable);
    focusTarget?.focus();
    const isTop = () => stack[stack.length - 1] === token;
    const onKey = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        if (dismissible) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>(focusable) ?? [])];
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = stack.indexOf(token);
      if (index >= 0) stack.splice(index, 1);
      document.body.style.overflow = stack.length ? "hidden" : bodyOverflow;
      if (previous?.isConnected) {
        previous.focus();
      } else if (stack.length) {
        // A nested dialog may have been opened from a control that was removed
        // while it was open. Return to the still-mounted parent dialog instead.
        const parent = document.querySelector<HTMLElement>('[role="dialog"]');
        parent?.querySelector<HTMLElement>(focusable)?.focus();
      }
    };
    // Dialog lifecycle must not restart when parent callbacks rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      className="overlay-dialog__backdrop"
      onMouseDown={(e) => {
        if (stack[stack.length - 1] && e.target === e.currentTarget && dismissible) closeRef.current();
      }}
    >
      <div
        ref={dialog}
        className={`overlay-dialog${wide ? " wide-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <div className="overlay-dialog__head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Fechar"
            onClick={() => closeRef.current()}
            disabled={!dismissible}
          >
            <X size={16} />
          </button>
        </div>
        <div className="overlay-dialog__body">
          {description && <p id={descriptionId}>{description}</p>}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
