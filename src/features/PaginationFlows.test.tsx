// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditCardInvoicePage, TransactionPage } from "../shared/types";
import { AccountsCards } from "./accounts/AccountsCards";
import { Transactions } from "./transactions/Transactions";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  categories: vi.fn(),
  creditCardInvoicesPage: vi.fn(),
  listTransactions: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    categories: mocks.categories,
    creditCardInvoicesPage: mocks.creditCardInvoicesPage,
    listTransactions: mocks.listTransactions,
  },
}));
vi.mock("../shared/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Localização atual">{`${location.pathname}${location.search}`}</output>;
}

function renderScreen(component: React.ReactNode, initialEntry = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        {component}
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("paginated screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.creditCardInvoicesPage.mockResolvedValue({ items: [], totalCount: 0 });
    mocks.listTransactions.mockResolvedValue({ items: [], totalCount: 0 });
  });

  afterEach(cleanup);

  it("consumes the new-income intent and opens the matching transaction form", async () => {
    renderScreen(<Transactions />, "/transactions?action=new&type=income");

    const dialog = await screen.findByRole("dialog", { name: "Nova transação" });
    expect(dialog.querySelector("button.active")?.textContent).toBe("Receita");
    await waitFor(() => expect(screen.getByLabelText("Localização atual").textContent).toBe("/transactions"));
  });

  it("consumes the new-account intent before opening the account dialog", async () => {
    renderScreen(<AccountsCards />, "/accounts?action=new");

    expect(await screen.findByRole("dialog", { name: "Nova conta" })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Localização atual").textContent).toBe("/accounts"));
  });

  it("keeps the transaction page and rows visible while the next page loads", async () => {
    let resolveSecondPage!: (page: TransactionPage) => void;
    const secondPage = new Promise<TransactionPage>((resolve) => {
      resolveSecondPage = resolve;
    });
    mocks.listTransactions
      .mockResolvedValueOnce({
        items: [
          {
            id: "transaction-1",
            accountId: "account-1",
            accountName: "Conta principal",
            accountKind: "checking",
            date: "2026-07-01",
            description: "Primeira página",
            amountInCents: -1200,
            status: "cleared",
            isTransferLeg: false,
          },
        ],
        totalCount: 26,
      })
      .mockReturnValueOnce(secondPage);

    renderScreen(<Transactions />);
    await screen.findByText("Primeira página");
    fireEvent.click(screen.getByRole("button", { name: "Ir para a página 2" }));

    await waitFor(() =>
      expect(mocks.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, offset: 25 })),
    );
    expect(screen.getByRole("button", { name: "Ir para a página 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Primeira página")).toBeTruthy();

    resolveSecondPage({
      items: [
        {
          id: "transaction-26",
          accountId: "account-1",
          accountName: "Conta principal",
          accountKind: "checking",
          date: "2026-07-02",
          description: "Segunda página",
          amountInCents: -3400,
          status: "cleared",
          isTransferLeg: false,
        },
      ],
      totalCount: 26,
    });
    await screen.findByText("Segunda página");
  });

  it("keeps the invoice page and rows visible while the next page loads", async () => {
    let resolveSecondPage!: (page: CreditCardInvoicePage) => void;
    const secondPage = new Promise<CreditCardInvoicePage>((resolve) => {
      resolveSecondPage = resolve;
    });
    mocks.creditCardInvoicesPage
      .mockResolvedValueOnce({
        items: [
          {
            id: "invoice-1",
            accountId: "card-1",
            accountName: "Cartão da primeira página",
            dueDate: "2026-07-10",
            purchasesInCents: 10000,
            creditsInCents: 0,
            totalInCents: 10000,
            status: "open",
          },
        ],
        totalCount: 11,
      })
      .mockReturnValueOnce(secondPage);

    renderScreen(<AccountsCards />);
    await screen.findByText("Cartão da primeira página");
    fireEvent.click(screen.getByRole("button", { name: "Ir para a página 2" }));

    await waitFor(() =>
      expect(mocks.creditCardInvoicesPage).toHaveBeenCalledWith({
        limit: 10,
        offset: 10,
      }),
    );
    expect(screen.getByRole("button", { name: "Ir para a página 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Cartão da primeira página")).toBeTruthy();

    resolveSecondPage({
      items: [
        {
          id: "invoice-11",
          accountId: "card-1",
          accountName: "Cartão da segunda página",
          dueDate: "2026-08-10",
          purchasesInCents: 20000,
          creditsInCents: 0,
          totalInCents: 20000,
          status: "open",
        },
      ],
      totalCount: 11,
    });
    await screen.findByText("Cartão da segunda página");
  });
});
