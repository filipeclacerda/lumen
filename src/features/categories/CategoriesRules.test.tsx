// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesRules } from "./CategoriesRules";
import { api } from "../../shared/api";
import type { CategoryMergeImpact } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  listMerchantsPage: vi.fn(),
  merchantAliases: vi.fn(),
  saveMerchantAlias: vi.fn(),
  deleteMerchantAlias: vi.fn(),
  archiveCategory: vi.fn(),
  previewCategoryMerge: vi.fn(),
  mergeCategory: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("../../shared/api", () => ({
  api: {
    categories: vi.fn().mockResolvedValue([]),
    rules: vi.fn().mockResolvedValue([]),
    accounts: vi.fn().mockResolvedValue([]),
    listMerchantsPage: mocks.listMerchantsPage,
    merchantAliases: mocks.merchantAliases,
    saveMerchantAlias: mocks.saveMerchantAlias,
    deleteMerchantAlias: mocks.deleteMerchantAlias,
    archiveCategory: mocks.archiveCategory,
    previewCategoryMerge: mocks.previewCategoryMerge,
    mergeCategory: mocks.mergeCategory,
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

function renderPage(initialEntry = "/categories") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <CategoriesRules />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("CategoriesRules merchants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMerchantsPage.mockResolvedValue({
      items: [
        {
          merchant: "Mercado do bairro",
          merchantKey: "MERCADO ORIGINAL",
          originalName: "MERCADO ORIGINAL",
          alias: "Mercado do bairro",
          amountInCents: 12000,
          transactionCount: 4,
        },
      ],
      totalCount: 1,
    });
    mocks.merchantAliases.mockResolvedValue([
      { id: "alias-1", merchantKey: "MERCADO ORIGINAL", displayName: "Mercado do bairro" },
    ]);
    mocks.saveMerchantAlias.mockResolvedValue("alias-1");
    mocks.deleteMerchantAlias.mockResolvedValue(undefined);
    mocks.archiveCategory.mockResolvedValue(undefined);
    mocks.previewCategoryMerge.mockResolvedValue({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Mercado antigo",
      targetCategoryId: "category-2",
      targetCategoryName: "Mercado",
      movedTransactions: 4,
      movedRules: 1,
      movedRecurring: 1,
      movedTargets: 0,
      archivedTargets: 0,
      movedChildren: 0,
    });
    mocks.mergeCategory.mockResolvedValue({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Mercado antigo",
      targetCategoryId: "category-2",
      targetCategoryName: "Mercado",
      movedTransactions: 4,
      movedRules: 1,
      movedRecurring: 1,
      movedTargets: 0,
      archivedTargets: 0,
      movedChildren: 0,
    });
  });

  afterEach(cleanup);

  it("opens and filters the category tab from a command-palette destination", async () => {
    vi.mocked(api.categories).mockResolvedValueOnce([
      {
        id: "category-1",
        name: "Mercado",
        kind: "expense",
        sortOrder: 0,
        isSystem: false,
      },
      {
        id: "category-2",
        name: "Moradia",
        kind: "expense",
        sortOrder: 10,
        isSystem: false,
      },
    ]);
    renderPage("/categories?tab=categories&q=Mercado");

    expect((await screen.findByRole("tab", { name: "Categorias (2)" })).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Exibindo 1 resultado\(s\) para/)).toBeTruthy();
    expect(document.querySelectorAll(".category-tree-node")).toHaveLength(1);
  });

  it("offers a short merge flow and locks rapid destructive confirmation clicks", async () => {
    const merge = deferred<CategoryMergeImpact>();
    mocks.mergeCategory.mockReturnValueOnce(merge.promise);
    vi.mocked(api.categories).mockResolvedValueOnce([
      {
        id: "category-1",
        name: "Mercado antigo",
        kind: "expense",
        sortOrder: 0,
        isSystem: false,
      },
      {
        id: "category-2",
        name: "Mercado",
        kind: "expense",
        sortOrder: 10,
        isSystem: false,
      },
    ]);
    mocks.archiveCategory.mockRejectedValueOnce(new Error("categoria em uso"));
    renderPage("/categories?tab=categories");

    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Mercado antigo" }));
    await screen.findByRole("heading", { name: "Para onde vão os lançamentos?" });

    fireEvent.click(screen.getByRole("button", { name: "Categoria de destino" }));
    fireEvent.click(screen.getByRole("option", { name: "Mercado" }));
    await waitFor(() => expect(mocks.previewCategoryMerge).toHaveBeenCalledWith("category-1", "category-2"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("4 lançamento(s)"));

    const confirm = screen.getByRole("button", { name: "Unir categorias" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.mergeCategory).toHaveBeenCalledWith("category-1", "category-2"));
    expect(mocks.mergeCategory).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Unindo…" }) as HTMLButtonElement).disabled).toBe(true);
    merge.resolve({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Mercado antigo",
      targetCategoryId: "category-2",
      targetCategoryName: "Mercado",
      movedTransactions: 4,
      movedRules: 1,
      movedRecurring: 1,
      movedTargets: 0,
      archivedTargets: 0,
      movedChildren: 0,
    });
    expect(await screen.findByText(/Mercado antigo foi unida a Mercado/)).toBeTruthy();
  });

  it("keeps only the latest merge preview and confirms its exact snapshot", async () => {
    vi.mocked(api.categories).mockResolvedValueOnce([
      { id: "category-1", name: "Antiga", kind: "expense", sortOrder: 0, isSystem: false },
      { id: "category-2", name: "Destino A", kind: "expense", sortOrder: 10, isSystem: false },
      { id: "category-3", name: "Destino B", kind: "expense", sortOrder: 20, isSystem: false },
    ]);
    mocks.archiveCategory.mockRejectedValueOnce(new Error("em uso"));
    const first = deferred<CategoryMergeImpact>();
    const second = deferred<CategoryMergeImpact>();
    mocks.previewCategoryMerge.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPage("/categories?tab=categories");

    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Antiga" }));
    await screen.findByRole("heading", { name: "Para onde vão os lançamentos?" });
    fireEvent.click(screen.getByRole("button", { name: "Categoria de destino" }));
    fireEvent.click(screen.getByRole("option", { name: "Destino A" }));
    fireEvent.click(screen.getByRole("button", { name: /^Categoria de destino/ }));
    fireEvent.click(screen.getByRole("option", { name: "Destino B" }));

    second.resolve({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Antiga",
      targetCategoryId: "category-3",
      targetCategoryName: "Destino B",
      movedTransactions: 2,
      movedRules: 0,
      movedRecurring: 0,
      movedTargets: 1,
      archivedTargets: 1,
      movedChildren: 0,
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Destino B"));
    expect(screen.getByRole("alert").textContent).toContain("1 meta(s) conflitante(s)");

    first.resolve({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Antiga",
      targetCategoryId: "category-2",
      targetCategoryName: "Destino A",
      movedTransactions: 99,
      movedRules: 0,
      movedRecurring: 0,
      movedTargets: 0,
      archivedTargets: 0,
      movedChildren: 0,
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toContain("Destino A"));

    fireEvent.click(screen.getByRole("button", { name: "Unir categorias" }));
    await waitFor(() => expect(mocks.mergeCategory).toHaveBeenCalledWith("category-1", "category-3"));
  });

  it("invalidates an outstanding preview when the merge modal closes", async () => {
    vi.mocked(api.categories).mockResolvedValueOnce([
      { id: "category-1", name: "Antiga", kind: "expense", sortOrder: 0, isSystem: false },
      { id: "category-2", name: "Destino", kind: "expense", sortOrder: 10, isSystem: false },
    ]);
    mocks.archiveCategory.mockRejectedValueOnce(new Error("em uso"));
    const pending = deferred<CategoryMergeImpact>();
    mocks.previewCategoryMerge.mockReturnValueOnce(pending.promise);
    renderPage("/categories?tab=categories");

    fireEvent.click(await screen.findByRole("button", { name: "Arquivar Antiga" }));
    fireEvent.click(await screen.findByRole("button", { name: "Categoria de destino" }));
    fireEvent.click(screen.getByRole("option", { name: "Destino" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Unir categoria" })).toBeNull();

    pending.resolve({
      sourceCategoryId: "category-1",
      sourceCategoryName: "Antiga",
      targetCategoryId: "category-2",
      targetCategoryName: "Destino",
      movedTransactions: 1,
      movedRules: 0,
      movedRecurring: 0,
      movedTargets: 0,
      archivedTargets: 0,
      movedChildren: 0,
    });
    await Promise.resolve();
    expect(screen.queryByRole("dialog", { name: "Unir categoria" })).toBeNull();
    expect(mocks.mergeCategory).not.toHaveBeenCalled();
  });

  async function openMerchants() {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Estabelecimentos" }));
    await screen.findByText("Mercado do bairro");
  }

  it("shows alias context and links to the exact merchant transactions", async () => {
    await openMerchants();
    expect(screen.getByText("Original: MERCADO ORIGINAL")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ver lançamentos" }).getAttribute("href")).toBe(
      "/transactions?merchantKey=MERCADO%20ORIGINAL",
    );
    expect(mocks.listMerchantsPage).toHaveBeenCalledWith({
      search: undefined,
      sort: "transaction_count",
      limit: 10,
      offset: 0,
    });
  });

  it("keeps the requested page selected while an uncached page is loading", async () => {
    let resolveSecondPage: ((value: Awaited<ReturnType<typeof mocks.listMerchantsPage>>) => void) | undefined;
    const secondPage = new Promise<Awaited<ReturnType<typeof mocks.listMerchantsPage>>>((resolve) => {
      resolveSecondPage = resolve;
    });
    mocks.listMerchantsPage
      .mockResolvedValueOnce({
        items: [
          {
            merchant: "Mercado do bairro",
            merchantKey: "MERCADO ORIGINAL",
            originalName: "MERCADO ORIGINAL",
            alias: "Mercado do bairro",
            amountInCents: 12000,
            transactionCount: 4,
          },
        ],
        totalCount: 11,
      })
      .mockReturnValueOnce(secondPage);

    await openMerchants();
    fireEvent.click(screen.getByRole("button", { name: "Ir para a página 2" }));

    await waitFor(() =>
      expect(mocks.listMerchantsPage).toHaveBeenCalledWith({
        search: undefined,
        sort: "transaction_count",
        limit: 10,
        offset: 10,
      }),
    );
    expect(screen.getByRole("button", { name: "Ir para a página 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Mercado do bairro")).toBeTruthy();

    resolveSecondPage?.({
      items: [
        {
          merchant: "Padaria Central",
          merchantKey: "PADARIA CENTRAL",
          originalName: "PADARIA CENTRAL",
          amountInCents: 4500,
          transactionCount: 2,
        },
      ],
      totalCount: 11,
    });
    await screen.findByText("PADARIA CENTRAL");
  });

  it("saves with Enter and restores using the alias id", async () => {
    await openMerchants();
    fireEvent.click(screen.getByRole("button", { name: /Renomear/ }));
    const input = screen.getByRole("textbox", { name: "Nome personalizado" });
    fireEvent.change(input, { target: { value: "  Mercado Central  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.saveMerchantAlias).toHaveBeenCalledWith("MERCADO ORIGINAL", "Mercado Central"));

    fireEvent.click(screen.getByRole("button", { name: /Restaurar/ }));
    await waitFor(() => expect(mocks.deleteMerchantAlias).toHaveBeenCalledWith("alias-1"));
  });
});
