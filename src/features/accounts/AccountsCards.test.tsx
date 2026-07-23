// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsCards } from "./AccountsCards";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  cardPaymentReconciliations: vi.fn(),
  creditCardInvoicesPage: vi.fn(),
  reconcileCardPayment: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    cardPaymentReconciliations: mocks.cardPaymentReconciliations,
    creditCardInvoicesPage: mocks.creditCardInvoicesPage,
    reconcileCardPayment: mocks.reconcileCardPayment,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Localização atual">{`${location.pathname}${location.search}`}</output>;
}

function renderAccounts(initialEntry = "/accounts") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <AccountsCards />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function reconciliation(overrides: Record<string, unknown> = {}) {
  return {
    paymentTransactionId: "card-payment-1",
    cardAccountId: "card-1",
    cardAccountName: "Cartão principal",
    date: "2026-07-05",
    description: "Pagamento de fatura",
    amountInCents: 34_2853,
    invoiceCandidates: [
      {
        id: "invoice-1",
        accountName: "Cartão principal",
        dueDate: "2026-07-05",
        totalInCents: 34_2853,
        distanceInDays: 0,
      },
    ],
    bankCandidates: [
      {
        transactionId: "bank-payment-1",
        accountName: "Conta corrente",
        date: "2026-07-05",
        description: "PAGAMENTO CARTAO",
        amountInCents: -34_2853,
        distanceInDays: 0,
      },
    ],
    state: "pending",
    ...overrides,
  };
}

describe("AccountsCards card payment reconciliations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([]);
    mocks.creditCardInvoicesPage.mockResolvedValue({ items: [], totalCount: 0 });
    mocks.cardPaymentReconciliations.mockResolvedValue([reconciliation()]);
    mocks.reconcileCardPayment.mockResolvedValue({
      id: "link-1",
      debitTransactionId: "bank-payment-1",
      creditTransactionId: "card-payment-1",
      invoiceId: "invoice-1",
    });
  });

  afterEach(cleanup);

  it("abre o pagamento solicitado, pré-seleciona candidatos únicos e só concilia após confirmação", async () => {
    renderAccounts("/accounts?reconcile=card-payment-1");

    const invoiceSelect = await screen.findByRole("combobox", {
      name: "Fatura anterior para Pagamento de fatura",
    });
    const bankSelect = screen.getByRole("combobox", {
      name: "Débito bancário para Pagamento de fatura",
    });

    expect(invoiceSelect.textContent).toContain("Cartão principal");
    expect(bankSelect.textContent).toContain("Conta corrente");
    expect(mocks.reconcileCardPayment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Localização atual").textContent).toBe("/accounts"));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar conciliação" }));

    await waitFor(() =>
      expect(mocks.reconcileCardPayment).toHaveBeenCalledWith("card-payment-1", "invoice-1", "bank-payment-1"),
    );
  });

  it("não pré-seleciona candidatos ambíguos", async () => {
    mocks.cardPaymentReconciliations.mockResolvedValue([
      reconciliation({
        invoiceCandidates: [
          {
            id: "invoice-1",
            accountName: "Cartão principal",
            dueDate: "2026-07-05",
            totalInCents: 34_2853,
            distanceInDays: 0,
          },
          {
            id: "invoice-2",
            accountName: "Cartão principal",
            dueDate: "2026-07-06",
            totalInCents: 34_2853,
            distanceInDays: 1,
          },
        ],
        bankCandidates: [
          {
            transactionId: "bank-payment-1",
            accountName: "Conta corrente",
            date: "2026-07-05",
            description: "PAGAMENTO CARTAO",
            amountInCents: -34_2853,
            distanceInDays: 0,
          },
          {
            transactionId: "bank-payment-2",
            accountName: "Conta secundária",
            date: "2026-07-06",
            description: "PAGAMENTO FATURA",
            amountInCents: -34_2853,
            distanceInDays: 1,
          },
        ],
      }),
    ]);

    renderAccounts();
    fireEvent.click(await screen.findByRole("button", { name: /Pagamento de fatura/ }));

    expect(screen.getByRole("combobox", { name: "Fatura anterior para Pagamento de fatura" }).textContent).toContain(
      "Não vincular uma fatura agora",
    );
    expect(screen.getByRole("combobox", { name: "Débito bancário para Pagamento de fatura" }).textContent).toContain(
      "Não vincular um débito agora",
    );
    expect(screen.getByRole("button", { name: "Confirmar conciliação" }).hasAttribute("disabled")).toBe(true);
  });
});
