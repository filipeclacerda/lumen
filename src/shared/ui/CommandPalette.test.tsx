// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, OPEN_COMMAND_PALETTE_EVENT } from "./CommandPalette";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  categories: vi.fn(),
  rules: vi.fn(),
  listTransactions: vi.fn(),
}));

vi.mock("../api", () => ({
  api: {
    accounts: mocks.accounts,
    categories: mocks.categories,
    rules: mocks.rules,
    listTransactions: mocks.listTransactions,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Localização atual">{`${location.pathname}${location.search}`}</output>;
}

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CommandPalette", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.accounts.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.rules.mockResolvedValue([]);
    mocks.listTransactions.mockResolvedValue({ items: [] });
  });

  afterEach(cleanup);

  it("focuses the search field and supports arrow navigation", async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Buscar ações, páginas ou dados" })),
    );
    expect(screen.getByText("Ações rápidas")).toBeTruthy();
    expect(screen.getByText("Visão geral")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Nova receita/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens from the titlebar search event", async () => {
    renderPalette();
    window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Buscar ações, páginas ou dados" })).toBeTruthy());
  });

  it("opens a quick-action intent and stores only its command id", async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByRole("option", { name: /Nova receita/ }));

    expect(screen.getByLabelText("Localização atual").textContent).toBe("/transactions?action=new&type=income");
    expect(localStorage.getItem("lumen-command-palette-recent")).toBe('["action:new-income"]');
  });

  it("includes rich transaction results only after three characters", async () => {
    mocks.listTransactions.mockResolvedValue({
      items: [
        {
          id: "tx-1",
          accountId: "account-1",
          accountName: "Conta principal",
          accountKind: "checking",
          date: "2026-07-20",
          description: "Mercado do bairro",
          amountInCents: -12345,
          category: "Mercado",
          status: "cleared",
          isTransferLeg: false,
        },
      ],
    });
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Buscar ações, páginas ou dados" });

    fireEvent.change(input, { target: { value: "me" } });
    expect(screen.getByText("Digite 3 caracteres para incluir transações")).toBeTruthy();
    expect(mocks.listTransactions).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "mercado" } });
    expect(await screen.findByRole("option", { name: /Mercado do bairro/ })).toBeTruthy();
    expect(screen.getByText("20/07/2026 · Conta principal · Mercado")).toBeTruthy();
    expect(mocks.listTransactions).toHaveBeenCalledWith({ search: "mercado", limit: 8 });
  });
});
