import type { ReactNode } from "react";
import { OverlayDialog } from "./OverlayDialog";

type ModalProps = { title: string; onClose: () => void; children: ReactNode; wide?: boolean };
/** Backwards-compatible modal API backed by the shared accessible dialog. */
export function Modal({ title, onClose, children, wide }: ModalProps) {
  return (
    <OverlayDialog title={title} onClose={onClose} wide={wide}>
      {children}
    </OverlayDialog>
  );
}
