// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionForm } from "./TransactionForm";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  categories: vi.fn(),
  createCreditCardInstallments: vi.fn(),
  createTransaction: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    accounts: mocks.accounts,
    categories: mocks.categories,
    createCreditCardInstallments: mocks.createCreditCardInstallments,
    createTransaction: mocks.createTransaction,
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

function renderForm(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TransactionForm onClose={onClose} initialType="expense" />
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
});
