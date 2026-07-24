// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../../shared/types";
import { Transactions } from "./Transactions";

const mocks = vi.hoisted(() => ({
  categories: vi.fn(),
  accounts: vi.fn(),
  listTransactions: vi.fn(),
  unlinkTransfer: vi.fn(),
  setTransferDeleted: vi.fn(),
  restoreTransactions: vi.fn(),
  setTransactionStatus: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    categories: mocks.categories,
    accounts: mocks.accounts,
    listTransactions: mocks.listTransactions,
    unlinkTransfer: mocks.unlinkTransfer,
    setTransferDeleted: mocks.setTransferDeleted,
    restoreTransactions: mocks.restoreTransactions,
    setTransactionStatus: mocks.setTransactionStatus,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("../../shared/quickStartGuide", () => ({ useQuickStartGuide: () => false }));
vi.mock("../../shared/ui/CategorySelect", () => ({
  CategorySelect: ({ disabled, "aria-label": ariaLabel }: { disabled?: boolean; "aria-label"?: string }) => (
    <button disabled={disabled} aria-label={ariaLabel}>
      Categoria
    </button>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const transfer: Transaction = {
  id: "transfer-1",
  accountId: "bank-a",
  accountName: "Conta A",
  accountKind: "checking",
  date: "2026-07-10",
  description: "Reserva",
  amountInCents: -20_000,
  category: "Transferências",
  status: "cleared",
  isTransferLeg: true,
  linkedKind: "transfer",
};

function renderTransactions(items: Transaction[] = [transfer]) {
  mocks.listTransactions.mockResolvedValue({ items, totalCount: items.length });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Transactions />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("Transactions protected mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.categories.mockResolvedValue([]);
    mocks.accounts.mockResolvedValue([
      { id: "bank-a", name: "Conta A", kind: "checking", balanceInCents: 0 },
      { id: "bank-b", name: "Conta B", kind: "savings", balanceInCents: 0 },
    ]);
    mocks.unlinkTransfer.mockResolvedValue(undefined);
    mocks.setTransferDeleted.mockResolvedValue(2);
    mocks.restoreTransactions.mockResolvedValue(1);
    mocks.setTransactionStatus.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("keeps the unlink modal after failure, retries, and blocks duplicate clicks", async () => {
    mocks.unlinkTransfer.mockRejectedValueOnce(new Error("vínculo ocupado"));
    renderTransactions();
    fireEvent.click(await screen.findByRole("button", { name: "Desvincular transferência Reserva" }));
    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("vínculo ocupado", "error"));
    expect(screen.getByRole("dialog", { name: "Desvincular transferência" })).toBeTruthy();

    const pending = deferred<void>();
    mocks.unlinkTransfer.mockReturnValueOnce(pending.promise);
    const retry = screen.getByRole("button", { name: "Desvincular" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(mocks.unlinkTransfer).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Desvinculando…" })).toBeTruthy();
    pending.resolve();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Desvincular transferência" })).toBeNull());
  });

  it("keeps delete and restore state on errors and retries each operation", async () => {
    mocks.setTransferDeleted.mockRejectedValueOnce(new Error("não excluiu"));
    renderTransactions();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir transferência Reserva" }));
    fireEvent.click(screen.getByRole("button", { name: "Mover os dois lançamentos" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("não excluiu", "error"));
    expect(screen.getByRole("dialog", { name: "Excluir transferência" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mover os dois lançamentos" }));
    await screen.findByRole("button", { name: "Desfazer" });
    expect(mocks.setTransferDeleted).toHaveBeenCalledTimes(2);

    mocks.setTransferDeleted.mockRejectedValueOnce(new Error("não restaurou"));
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith("não restaurou", "error"));
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy();

    const restoring = deferred<number>();
    mocks.setTransferDeleted.mockReturnValueOnce(restoring.promise);
    const retry = screen.getByRole("button", { name: "Desfazer" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(mocks.setTransferDeleted).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("button", { name: "Desfazendo…" })).toBeTruthy();
    restoring.resolve(2);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Desfazer" })).toBeNull());
  });

  it("locks pending confirmation and undo, and hides impossible actions for protected card payments", async () => {
    const pendingStatus = deferred<void>();
    mocks.setTransactionStatus.mockReturnValueOnce(pendingStatus.promise);
    const pending: Transaction = {
      ...transfer,
      id: "pending-1",
      description: "Agendada",
      isTransferLeg: false,
      linkedKind: undefined,
      status: "pending",
    };
    const protectedPayment: Transaction = {
      ...transfer,
      id: "payment-1",
      description: "Pagamento cartão",
      status: "pending",
      isTransferLeg: false,
      linkedKind: "credit_card_payment",
    };
    renderTransactions([pending, protectedPayment]);

    const confirm = await screen.findByRole("button", { name: "Confirmar lançamento" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.setTransactionStatus).toHaveBeenCalledOnce();
    pendingStatus.resolve();
    await screen.findByRole("button", { name: "Desfazer" });

    expect(screen.queryByRole("button", { name: "Editar Pagamento cartão" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir Pagamento cartão" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Confirmar lançamento" })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Selecionar Pagamento cartão" })).toHaveProperty("disabled", true);
  });

  it("gives each row category control a contextual accessible name", async () => {
    renderTransactions([
      {
        ...transfer,
        id: "groceries",
        description: "Mercado",
        date: "2026-07-11",
        isTransferLeg: false,
        linkedKind: undefined,
      },
      {
        ...transfer,
        id: "pharmacy",
        description: "Farmácia",
        date: "2026-07-12",
        isTransferLeg: false,
        linkedKind: undefined,
      },
    ]);

    expect(await screen.findByRole("button", { name: "Categoria de Mercado em 11/07/2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Categoria de Farmácia em 12/07/2026" })).toBeTruthy();
  });
});
