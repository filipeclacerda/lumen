// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountsCards } from "./AccountsCards";
import type { BalanceCheckpoint, ReconciliationPreview } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  accountBalanceSummaries: vi.fn(),
  cardPaymentReconciliations: vi.fn(),
  creditCardInvoicesPage: vi.fn(),
  reconciliationPreview: vi.fn(),
  recordBalanceCheckpoint: vi.fn(),
  reconcileCardPayment: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    accountBalanceSummaries: mocks.accountBalanceSummaries,
    cardPaymentReconciliations: mocks.cardPaymentReconciliations,
    creditCardInvoicesPage: mocks.creditCardInvoicesPage,
    reconciliationPreview: mocks.reconciliationPreview,
    recordBalanceCheckpoint: mocks.recordBalanceCheckpoint,
    reconcileCardPayment: mocks.reconcileCardPayment,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    mocks.accountBalanceSummaries.mockResolvedValue([]);
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

describe("AccountsCards balance reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([
      { id: "bank-1", name: "Conta corrente", kind: "checking", balanceInCents: 100_000 },
      { id: "card-1", name: "Cartão principal", kind: "credit_card", balanceInCents: -20_000 },
    ]);
    mocks.accountBalanceSummaries.mockResolvedValue([
      {
        accountId: "bank-1",
        realizedBalanceInCents: 100_000,
        pendingBalanceInCents: 100_000,
        forecastBalanceInCents: 100_000,
        minimumBalanceInCents: 100_000,
        scheduledCount: 0,
        needsReconciliation: true,
      },
    ]);
    mocks.creditCardInvoicesPage.mockResolvedValue({ items: [], totalCount: 0 });
    mocks.cardPaymentReconciliations.mockResolvedValue([]);
    mocks.recordBalanceCheckpoint.mockResolvedValue({
      id: "checkpoint-1",
      accountId: "bank-1",
      asOfDate: "2026-07-10",
      balanceInCents: 100_000,
      source: "reconciliation",
      createdAt: "2026-07-10T12:00:00Z",
    });
  });

  afterEach(cleanup);

  async function fillAndPreview(differenceInCents: number) {
    mocks.reconciliationPreview.mockResolvedValue({
      accountId: "bank-1",
      asOfDate: "2026-07-10",
      reportedBalanceInCents: 100_000,
      calculatedBalanceInCents: 100_000 - differenceInCents,
      differenceInCents,
    });
    renderAccounts();
    await screen.findByRole("button", { name: "Conferir saldo" });
    expect(screen.queryByRole("button", { name: "Conferir saldo" })?.textContent).toBe("Conferir saldo");
    expect(screen.getAllByRole("button", { name: "Conferir saldo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Conferir saldo" }));
    fireEvent.change(screen.getByLabelText("Data do saldo"), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("Saldo informado"), { target: { value: "1000,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver diferença" }));
    await waitFor(() =>
      expect(mocks.reconciliationPreview).toHaveBeenCalledWith({
        accountId: "bank-1",
        asOfDate: "2026-07-10",
        balanceInCents: 100_000,
        source: "reconciliation",
      }),
    );
  }

  it("mostra uma prévia sem diferença e bloqueia cliques rápidos ao confirmar", async () => {
    const checkpoint = deferred<BalanceCheckpoint>();
    mocks.recordBalanceCheckpoint.mockReturnValueOnce(checkpoint.promise);
    await fillAndPreview(0);

    expect(screen.getByText("Precisa conferir")).toBeTruthy();
    const preview = await screen.findByLabelText("Prévia da conferência");
    expect(preview.textContent).toContain("Saldo informado");
    expect(preview.textContent).toContain("Saldo calculado");
    expect(preview.textContent).toContain("Diferença");
    expect(preview.textContent).toContain("R$ 0,00");

    const confirm = screen.getByRole("button", { name: "Confirmar conferência" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.recordBalanceCheckpoint).toHaveBeenCalledWith({
        accountId: "bank-1",
        asOfDate: "2026-07-10",
        balanceInCents: 100_000,
        source: "reconciliation",
      }),
    );
    expect(mocks.recordBalanceCheckpoint).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Confirmando…" }) as HTMLButtonElement).disabled).toBe(true);
    checkpoint.resolve({
      id: "checkpoint-1",
      accountId: "bank-1",
      asOfDate: "2026-07-10",
      balanceInCents: 100_000,
      source: "reconciliation",
      createdAt: "2026-07-10T12:00:00Z",
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Saldo conferido com sucesso."));
  });

  it("expõe diferença não zero sem oferecer criação de ajuste", async () => {
    mocks.accountBalanceSummaries.mockResolvedValue([
      {
        accountId: "bank-1",
        realizedBalanceInCents: 100_000,
        pendingBalanceInCents: 100_000,
        forecastBalanceInCents: 100_000,
        minimumBalanceInCents: 100_000,
        scheduledCount: 0,
        lastReconciledAt: "2026-07-10",
        needsReconciliation: false,
      },
    ]);
    await fillAndPreview(2_500);

    expect(screen.getByText("Conferido em 10/07")).toBeTruthy();
    const preview = await screen.findByLabelText("Prévia da conferência");
    expect(preview.textContent).toContain("R$ 25,00");
    expect(screen.queryByRole("button", { name: /ajuste/i })).toBeNull();
    expect(screen.getByText(/A diferença é apenas informativa e não cria receita, despesa ou ajuste/i)).toBeTruthy();
  });

  it("ignora respostas fora de ordem e confirma exatamente o snapshot exibido", async () => {
    const first = deferred<ReconciliationPreview>();
    const second = deferred<ReconciliationPreview>();
    mocks.reconciliationPreview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderAccounts();
    fireEvent.click(await screen.findByRole("button", { name: "Conferir saldo" }));

    const date = screen.getByLabelText("Data do saldo");
    const balance = screen.getByLabelText("Saldo informado");
    fireEvent.change(date, { target: { value: "2026-07-10" } });
    fireEvent.change(balance, { target: { value: "1000,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver diferença" }));

    fireEvent.change(date, { target: { value: "2026-07-11" } });
    fireEvent.change(balance, { target: { value: "1200,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver diferença" }));
    second.resolve({
      accountId: "bank-1",
      asOfDate: "2026-07-11",
      reportedBalanceInCents: 120_000,
      calculatedBalanceInCents: 110_000,
      differenceInCents: 10_000,
      latestCheckpoint: null,
    });
    expect((await screen.findByLabelText("Prévia da conferência")).textContent).toContain("R$ 100,00");

    first.resolve({
      accountId: "bank-1",
      asOfDate: "2026-07-10",
      reportedBalanceInCents: 100_000,
      calculatedBalanceInCents: 99_999,
      differenceInCents: 1,
      latestCheckpoint: null,
    });
    await waitFor(() => expect(screen.getByLabelText("Prévia da conferência").textContent).not.toContain("R$ 0,01"));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar conferência" }));
    await waitFor(() =>
      expect(mocks.recordBalanceCheckpoint).toHaveBeenCalledWith({
        accountId: "bank-1",
        asOfDate: "2026-07-11",
        balanceInCents: 120_000,
        source: "reconciliation",
      }),
    );
  });

  it("mostra a projeção de 30 dias e alerta quando o saldo mínimo pode ficar negativo", async () => {
    mocks.accountBalanceSummaries.mockResolvedValue([
      {
        accountId: "bank-1",
        realizedBalanceInCents: 100_000,
        pendingBalanceInCents: 80_000,
        forecastBalanceInCents: -5_000,
        minimumBalanceInCents: -12_000,
        minimumBalanceDate: "2026-08-03",
        scheduledCount: 2,
        lastReconciledAt: "2026-07-10",
        needsReconciliation: false,
      },
    ]);

    renderAccounts();

    expect(
      await screen.findByText(
        (_, element) => element?.tagName === "SMALL" && element.textContent === "Em 30 dias: -R$ 50,00 · 2 previstos",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Atenção: saldo pode ficar negativo em 03/08.")).toBeTruthy();
  });

  it("abre a conferência pela URL e remove o parâmetro consumido", async () => {
    renderAccounts("/accounts?balance=bank-1");

    expect(await screen.findByText("Conferir saldo de Conta corrente")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Localização atual").textContent).toBe("/accounts"));
  });
});
