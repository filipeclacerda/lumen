// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetPage } from "./BudgetPage";
import type { BudgetOverview } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  categories: vi.fn(),
  financialTargets: vi.fn(),
  budgetOverview: vi.fn(),
  saveFinancialTarget: vi.fn(),
  saveFinancialTargetOverride: vi.fn(),
  deleteFinancialTarget: vi.fn(),
}));

vi.mock("../../shared/api", () => ({ api: mocks }));
vi.mock("../../shared/ui/CategorySelect", () => ({
  CategorySelect: ({
    value,
    onChange,
    categories,
  }: {
    value?: string;
    onChange: (value?: string) => void;
    categories: { id: string; name: string }[];
  }) => (
    <select aria-label="Categoria" value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">Selecione</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../../shared/ui/MoneyInput", () => ({
  MoneyInput: ({ defaultCents, onChange }: { defaultCents?: number; onChange: (value: number | null) => void }) => (
    <input
      aria-label="Limite mensal"
      defaultValue={defaultCents ?? ""}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
    />
  ),
}));

function renderBudget() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BudgetPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const emptyOverview = {
  categories: [],
  totals: { limitInCents: 0, spentInCents: 0 },
  hasOverlappingScopes: false,
} satisfies BudgetOverview;

const expenseCategory = {
  id: "home",
  name: "Casa",
  kind: "expense" as const,
  sortOrder: 1,
  isSystem: false,
};

describe("BudgetPage category scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.categories.mockResolvedValue([expenseCategory]);
    mocks.financialTargets.mockResolvedValue([]);
    mocks.budgetOverview.mockResolvedValue(emptyOverview);
    mocks.saveFinancialTarget.mockResolvedValue("target-home");
    mocks.saveFinancialTargetOverride.mockResolvedValue(undefined);
    mocks.deleteFinancialTarget.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("permite incluir subcategorias com uma explicação simples", async () => {
    renderBudget();
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar categoria ao orçamento" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Categoria" }), {
      target: { value: "home" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Limite mensal" }), {
      target: { value: "50000" },
    });
    const include = screen.getByRole("checkbox", { name: /Incluir subcategorias/ });
    expect((include as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Também soma os gastos das categorias/)).toBeTruthy();
    fireEvent.click(include);
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() =>
      expect(mocks.saveFinancialTarget).toHaveBeenCalledWith({
        kind: "category",
        categoryId: "home",
        amountInCents: 50000,
        enabled: true,
        includeDescendants: true,
      }),
    );
  });

  it("deixa claro quando um limite já inclui subcategorias", async () => {
    mocks.financialTargets.mockResolvedValue([
      {
        id: "target-home",
        kind: "category",
        categoryId: "home",
        categoryName: "Casa",
        amountInCents: 100_000,
        enabled: true,
        includeDescendants: true,
        overrides: [],
      },
    ]);
    mocks.budgetOverview.mockResolvedValue({
      categories: [
        {
          targetId: "target-home",
          categoryId: "home",
          categoryName: "Casa",
          includeDescendants: true,
          limitInCents: 100_000,
          spentInCents: 30_000,
          remainingInCents: 70_000,
          progressPercent: 30,
          projectedInCents: 45_000,
          status: "ok",
        },
      ],
      totals: { limitInCents: 100_000, spentInCents: 30_000 },
      hasOverlappingScopes: false,
    } satisfies BudgetOverview);

    renderBudget();

    expect(await screen.findByText("Inclui as subcategorias")).toBeTruthy();
  });

  it("does not present an aggregated available envelope when scopes overlap", async () => {
    const overlapOverview = {
      categories: [
        {
          targetId: "target-home",
          categoryId: "home",
          categoryName: "Casa",
          includeDescendants: true,
          limitInCents: 100_000,
          spentInCents: 30_000,
          remainingInCents: 70_000,
          progressPercent: 30,
          projectedInCents: 45_000,
          status: "ok",
        },
      ],
      totals: { limitInCents: 100_000, spentInCents: 30_000 },
      hasOverlappingScopes: true,
    } satisfies BudgetOverview;
    mocks.budgetOverview.mockResolvedValue(overlapOverview);

    renderBudget();

    expect(await screen.findByText("Casa")).toBeTruthy();
    expect(screen.queryByText("Disponível")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("não é somado");
    expect(screen.getByText((content) => content.includes("700,00 restantes"))).toBeTruthy();
  });
});
