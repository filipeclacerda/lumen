// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringTransactions } from "./RecurringTransactions";

const mocks = vi.hoisted(() => ({
  recurringTransactions: vi.fn(),
  accounts: vi.fn(),
  categories: vi.fn(),
  saveRecurringTransaction: vi.fn(),
  setRecurringTransactionActive: vi.fn(),
  archiveRecurringTransaction: vi.fn(),
  syncRecurringTransactions: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    recurringTransactions: mocks.recurringTransactions,
    accounts: mocks.accounts,
    categories: mocks.categories,
    saveRecurringTransaction: mocks.saveRecurringTransaction,
    setRecurringTransactionActive: mocks.setRecurringTransactionActive,
    archiveRecurringTransaction: mocks.archiveRecurringTransaction,
    syncRecurringTransactions: mocks.syncRecurringTransactions,
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecurringTransactions />
    </QueryClientProvider>,
  );
}

describe("RecurringTransactions save guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recurringTransactions.mockResolvedValue([]);
    mocks.accounts.mockResolvedValue([{ id: "account-1", name: "Conta principal", kind: "checking" }]);
    mocks.categories.mockResolvedValue([]);
    mocks.setRecurringTransactionActive.mockResolvedValue(undefined);
    mocks.archiveRecurringTransaction.mockResolvedValue(undefined);
    mocks.syncRecurringTransactions.mockResolvedValue(0);
  });

  afterEach(cleanup);

  it("submits once while pending and unlocks after an error", async () => {
    const firstSave = deferred<string>();
    mocks.saveRecurringTransaction.mockImplementationOnce(() => firstSave.promise).mockResolvedValue("recurring-1");
    renderPage();

    const description = await screen.findByPlaceholderText("Ex.: Aluguel, Netflix, Salário");
    fireEvent.change(description, { target: { value: "Aluguel" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "1.000,00" } });

    const submit = screen.getByRole("button", { name: "Criar recorrência" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(mocks.saveRecurringTransaction).toHaveBeenCalledTimes(1);
    const pendingButton = screen.getByRole("button", { name: "Salvando…" });
    expect(pendingButton.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      firstSave.reject(new Error("Falha controlada"));
      await firstSave.promise.catch(() => undefined);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Falha controlada");
    const retry = screen.getByRole("button", { name: "Criar recorrência" });
    expect(retry.hasAttribute("disabled")).toBe(false);

    fireEvent.click(retry);
    await waitFor(() => expect(mocks.saveRecurringTransaction).toHaveBeenCalledTimes(2));
  });
});
