// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQuickStartGuideForTests, restartQuickStartGuide, useQuickStartGuide } from "../shared/quickStartGuide";
import type { CreditCardInvoicePage, TransactionPage } from "../shared/types";
import { AccountsCards } from "./accounts/AccountsCards";
import { Transactions } from "./transactions/Transactions";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  accountBalanceSummaries: vi.fn(),
  categories: vi.fn(),
  creditCardInvoicesPage: vi.fn(),
  cardPaymentReconciliations: vi.fn(),
  listTransactions: vi.fn(),
  setTransferDeleted: vi.fn(),
  unlinkTransfer: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    accountBalanceSummaries: mocks.accountBalanceSummaries,
    categories: mocks.categories,
    creditCardInvoicesPage: mocks.creditCardInvoicesPage,
    cardPaymentReconciliations: mocks.cardPaymentReconciliations,
    listTransactions: mocks.listTransactions,
    setTransferDeleted: mocks.setTransferDeleted,
    unlinkTransfer: mocks.unlinkTransfer,
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
    resetQuickStartGuideForTests();
    mocks.accounts.mockResolvedValue([]);
    mocks.accountBalanceSummaries.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.creditCardInvoicesPage.mockResolvedValue({ items: [], totalCount: 0 });
    mocks.cardPaymentReconciliations.mockResolvedValue([]);
    mocks.listTransactions.mockResolvedValue({ items: [], totalCount: 0 });
    mocks.setTransferDeleted.mockResolvedValue(2);
    mocks.unlinkTransfer.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("consumes the new-income intent and opens the matching transaction form", async () => {
    renderScreen(<Transactions />, "/transactions?action=new&type=income");

    const dialog = await screen.findByRole("dialog", { name: "Nova transação" });
    expect(dialog.querySelector("button.active")?.textContent).toBe("Receita");
    await waitFor(() => expect(screen.getByLabelText("Localização atual").textContent).toBe("/transactions"));
  });

  it("presents the detailed filters during the transaction guide and restores the closed state", async () => {
    restartQuickStartGuide();
    useQuickStartGuide.getState().goToStep(1);
    renderScreen(<Transactions />, "/transactions");

    await waitFor(() => expect(document.querySelector('[data-quick-guide="transactions-filter-panel"]')).toBeTruthy());
    expect(screen.getByRole("button", { name: "Filtros" }).getAttribute("aria-expanded")).toBe("true");

    useQuickStartGuide.getState().pause("complete");

    await waitFor(() => expect(document.querySelector('[data-quick-guide="transactions-filter-panel"]')).toBeNull());
    expect(screen.getByRole("button", { name: "Filtros" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps filters open after the guide when they were already open", async () => {
    renderScreen(<Transactions />, "/transactions");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(document.querySelector('[data-quick-guide="transactions-filter-panel"]')).toBeTruthy();

    restartQuickStartGuide();
    useQuickStartGuide.getState().goToStep(1);
    useQuickStartGuide.getState().pause("complete");

    await waitFor(() => expect(document.querySelector('[data-quick-guide="transactions-filter-panel"]')).toBeTruthy());
    expect(screen.getByRole("button", { name: "Filtros" }).getAttribute("aria-expanded")).toBe("true");
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

  it("offers a clear unlink flow only for account transfers", async () => {
    mocks.listTransactions.mockResolvedValue({
      items: [
        {
          id: "transfer-debit",
          accountId: "account-1",
          accountName: "Conta principal",
          accountKind: "checking",
          date: "2026-07-01",
          description: "Transferência para Reserva",
          amountInCents: -1200,
          categoryId: "transfers",
          status: "cleared",
          isTransferLeg: true,
          linkedKind: "transfer",
        },
      ],
      totalCount: 1,
    });

    renderScreen(<Transactions />);
    fireEvent.click(await screen.findByRole("button", { name: /Desvincular transferência/ }));
    expect(screen.getByText("Transformar em dois lançamentos separados?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));

    await waitFor(() => expect(mocks.unlinkTransfer).toHaveBeenCalledWith("transfer-debit"));
    expect(await screen.findByText(/As categorias anteriores dos dois lançamentos foram restauradas/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Excluir transferência/ }));
    expect(screen.getByText("Mover a transferência inteira para a lixeira?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mover os dois lançamentos" }));
    await waitFor(() => expect(mocks.setTransferDeleted).toHaveBeenCalledWith("transfer-debit", true));
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
            paymentsInCents: 0,
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
          paymentsInCents: 0,
          totalInCents: 20000,
          status: "open",
        },
      ],
      totalCount: 11,
    });
    await screen.findByText("Cartão da segunda página");
  });
});
