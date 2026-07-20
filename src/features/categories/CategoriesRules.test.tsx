// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoriesRules } from "./CategoriesRules";

const mocks = vi.hoisted(() => ({
  listMerchantsPage: vi.fn(),
  merchantAliases: vi.fn(),
  saveMerchantAlias: vi.fn(),
  deleteMerchantAlias: vi.fn(),
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
  },
}));
vi.mock("../../shared/ui/toast", () => ({ useToast: () => mocks.toast }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
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
  });

  afterEach(cleanup);

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
