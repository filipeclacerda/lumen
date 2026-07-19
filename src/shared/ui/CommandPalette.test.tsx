// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

vi.mock("../api", () => ({
  api: {
    categories: vi.fn().mockResolvedValue([]),
    rules: vi.fn().mockResolvedValue([]),
    listTransactions: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

describe("CommandPalette", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the search field when opened", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Buscar ou navegar" })),
    );
    expect(screen.queryByText("route")).toBeNull();
    expect(screen.getByText("Visão geral")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Transações" }).getAttribute("aria-selected")).toBe("true");

    await Promise.resolve();
    expect(screen.getByRole("option", { name: "Transações" }).getAttribute("aria-selected")).toBe("true");
  });
});
