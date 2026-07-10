// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverlayDialog } from "./OverlayDialog";

describe("OverlayDialog", () => {
  it("announces, traps focus and restores trigger focus", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const close = vi.fn();
    const { unmount } = render(
      <OverlayDialog title="Excluir" onClose={close}>
        <input aria-label="Nome" />
        <button>Confirmar</button>
      </OverlayDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Excluir" })).toBeTruthy();
    const input = screen.getByLabelText("Nome");
    input.focus();
    fireEvent.change(input, { target: { value: "a" } });
    expect(document.activeElement).toBe(input);
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it("restores focus to the parent control when a nested dialog closes", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const { rerender } = render(
      <OverlayDialog title="Fora" onClose={outerClose}>
        <button>Abrir</button>
      </OverlayDialog>,
    );
    const parentControl = screen.getByRole("button", { name: "Abrir" });
    parentControl.focus();
    rerender(
      <>
        <OverlayDialog title="Fora" onClose={outerClose}>
          <button>Abrir</button>
        </OverlayDialog>
        <OverlayDialog title="Dentro" onClose={innerClose}>
          <button>Confirmar</button>
        </OverlayDialog>
      </>,
    );
    rerender(
      <OverlayDialog title="Fora" onClose={outerClose}>
        <button>Abrir</button>
      </OverlayDialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Abrir" }));
  });

  it("only the top nested dialog responds to Escape", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const { rerender } = render(
      <OverlayDialog title="Fora" onClose={outerClose}>
        <button>Abrir</button>
      </OverlayDialog>,
    );
    rerender(
      <>
        <OverlayDialog title="Fora" onClose={outerClose}>
          <button>Abrir</button>
        </OverlayDialog>
        <OverlayDialog title="Dentro" onClose={innerClose}>
          <button>Confirmar</button>
        </OverlayDialog>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).toHaveBeenCalledTimes(0);
  });
});
