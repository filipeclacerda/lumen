// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "./TransactionForm";
import type { Transaction, TransferDetails } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  categories: vi.fn(),
  createCreditCardInstallments: vi.fn(),
  createTransaction: vi.fn(),
  getTransferDetails: vi.fn(),
  updateTransfer: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    categories: mocks.categories,
    createCreditCardInstallments: mocks.createCreditCardInstallments,
    createTransaction: mocks.createTransaction,
    getTransferDetails: mocks.getTransferDetails,
    updateTransfer: mocks.updateTransfer,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../../shared/ui/Modal", () => ({
  Modal: ({ title, children }: { title: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("../../shared/ui/CalendarPicker", () => ({
  DatePicker: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => <input aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock("../../shared/ui/CategorySelect", () => ({
  CategorySelect: () => <div aria-label="Categoria" />,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderForm(onClose = vi.fn(), existing?: Transaction) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TransactionForm onClose={onClose} initialType="expense" existing={existing} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("TransactionForm parcelado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([
      { id: "card", name: "Cartão principal", kind: "credit_card", balanceInCents: 0 },
    ]);
    mocks.categories.mockResolvedValue([]);
    mocks.createCreditCardInstallments.mockResolvedValue({
      planId: "plan-1",
      transactionIds: ["tx-1", "tx-2", "tx-3"],
    });
  });

  afterEach(cleanup);

  it("mostra a divisão exata e envia um único plano parcelado", async () => {
    const onClose = renderForm();
    const installmentToggle = await screen.findByRole("checkbox", { name: /Parcelar esta compra/i });

    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "10000" } });
    fireEvent.change(screen.getByPlaceholderText(/Mercado/), { target: { value: "Notebook" } });
    fireEvent.click(installmentToggle);
    fireEvent.change(screen.getByLabelText("Número de parcelas"), { target: { value: "3" } });

    const preview = screen.getByRole("status");
    expect(preview.textContent).toContain("Total");
    expect(preview.textContent).toContain("1 ×");
    expect(preview.textContent).toContain("2 ×");
    expect(preview.textContent).toContain("editado individualmente");

    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() =>
      expect(mocks.createCreditCardInstallments).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "card",
          description: "Notebook",
          totalAmountInCents: 10_000,
          installmentCount: 3,
        }),
      ),
    );
    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith("3 parcelas adicionadas");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows backend installment errors in the standard form error flow", async () => {
    mocks.createCreditCardInstallments.mockRejectedValueOnce(new Error("Data da primeira parcela inválida"));
    const onClose = renderForm();
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "10000" } });
    fireEvent.change(screen.getByPlaceholderText(/Mercado/), { target: { value: "Notebook" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Parcelar esta compra/i }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText("Data da primeira parcela inválida")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TransactionForm transferência", () => {
  const existing: Transaction = {
    id: "transfer-debit",
    accountId: "bank-a",
    accountName: "Conta A",
    accountKind: "checking",
    date: "2026-07-01",
    description: "Reserva",
    amountInCents: -50_000,
    status: "cleared",
    isTransferLeg: true,
    linkedKind: "transfer",
  };
  const details: TransferDetails = {
    debitTransactionId: "transfer-debit",
    creditTransactionId: "transfer-credit",
    fromAccountId: "bank-a",
    toAccountId: "bank-b",
    date: "2026-07-02",
    amountInCents: 50_000,
    description: "Reserva",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.mockResolvedValue([
      { id: "bank-a", name: "Conta A", kind: "checking", balanceInCents: 0 },
      { id: "bank-b", name: "Conta B", kind: "savings", balanceInCents: 0 },
    ]);
    mocks.categories.mockResolvedValue([]);
    mocks.getTransferDetails.mockResolvedValue(details);
    mocks.updateTransfer.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("shows loading and an error with retry before rendering transfer fields", async () => {
    const first = deferred<TransferDetails>();
    mocks.getTransferDetails.mockReturnValueOnce(first.promise);
    renderForm(vi.fn(), existing);
    expect(screen.getByText("Carregando transferência…")).toBeTruthy();
    expect(screen.queryByLabelText("Data da transferência")).toBeNull();
    first.reject(new Error("falha"));

    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar a transferência");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByLabelText("Data da transferência")).toBeTruthy();
  });

  it("uses a synchronous submit lock for transfer updates", async () => {
    const saving = deferred<void>();
    mocks.updateTransfer.mockReturnValueOnce(saving.promise);
    renderForm(vi.fn(), existing);
    const submit = await screen.findByRole("button", { name: "Salvar transferência" });

    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mocks.updateTransfer).toHaveBeenCalledOnce();
    expect(mocks.updateTransfer).toHaveBeenCalledWith("transfer-debit", {
      fromAccountId: "bank-a",
      toAccountId: "bank-b",
      date: "2026-07-02",
      amountInCents: 50_000,
      description: "Reserva",
    });
    saving.resolve();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("Transferência atualizada"));
  });
});
