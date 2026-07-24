import type { ReactNode } from "react";
import { OverlayDialog } from "./OverlayDialog";

type ModalProps = { title: string; onClose: () => void; children: ReactNode; className?: string; wide?: boolean };
/** Backwards-compatible modal API backed by the shared accessible dialog. */
export function Modal({ title, onClose, children, className, wide }: ModalProps) {
  return (
    <OverlayDialog title={title} onClose={onClose} className={className} wide={wide}>
      {children}
    </OverlayDialog>
  );
}
