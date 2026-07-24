// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyErrorBoundary } from "./LazyErrorBoundary";

function RejectedLazyContent(): never {
  throw new Error("chunk indisponível");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LazyErrorBoundary", () => {
  it("replaces a rejected lazy subtree with a recoverable ErrorState", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();

    render(
      <LazyErrorBoundary variant="page" message="Não foi possível carregar a tela." reload={reload}>
        <RejectedLazyContent />
      </LazyErrorBoundary>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar a tela.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
