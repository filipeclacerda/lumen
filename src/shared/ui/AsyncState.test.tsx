// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorState, EmptyState, LoadingState } from "./AsyncState";
describe("AsyncState", () => {
  it("exposes loading, empty and safe retry states", () => {
    const retry = vi.fn();
    render(
      <>
        <LoadingState />
        <EmptyState title="Sem dados" />
        <ErrorState onRetry={retry} />
      </>,
    );
    expect(screen.getByRole("status").textContent).toContain("Carregando");
    expect(screen.getByText("Sem dados")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("shows the Lumen logo only for page loading states", () => {
    const { rerender } = render(<LoadingState variant="page" />);
    expect(document.querySelector(".brand-logo")).toBeTruthy();
    rerender(<LoadingState variant="panel" />);
    expect(document.querySelector(".brand-logo")).toBeNull();
  });
});
