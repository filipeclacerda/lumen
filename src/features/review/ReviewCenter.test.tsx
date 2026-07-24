// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewCenter, type DataQualityReview } from "./ReviewCenter";

afterEach(cleanup);

function review(overrides: Partial<DataQualityReview> = {}): DataQualityReview {
  return {
    totalCount: 8,
    uncategorized: {
      totalCount: 6,
      items: [
        {
          id: "tx-1",
          title: "Mercado do bairro",
          description: "Sem categoria em Conta principal",
          date: "2026-07-20",
          amountInCents: -12_350,
          actionPath: "/transactions?uncategorized=1",
          actionLabel: "Escolher categoria",
        },
      ],
    },
    pendingTransactions: {
      totalCount: 1,
      items: [
        {
          id: "tx-2",
          title: "Conta de luz",
          description: "A confirmar em Conta principal",
          date: "2026-07-21",
          amountInCents: -8_000,
          actionPath: "/transactions?status=pending",
          actionLabel: "Revisar lançamento",
        },
      ],
    },
    accountReconciliations: {
      totalCount: 1,
      items: [
        {
          id: "account-1",
          title: "Conta principal",
          description: "Saldo ainda não conferido",
          date: null,
          amountInCents: null,
          actionPath: "/accounts",
          actionLabel: "Conferir saldo",
        },
      ],
    },
    cardPaymentReconciliations: { totalCount: 0, items: [] },
    ...overrides,
  };
}

function renderCenter(loadReview = vi.fn().mockResolvedValue(review())) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ReviewCenter loadReview={loadReview} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ReviewCenter", () => {
  it("resume as pendências em blocos com ações diretas", async () => {
    renderCenter();

    expect(screen.getByRole("heading", { name: "Pendências" })).toBeTruthy();
    expect(await screen.findByText("8 pendências encontradas")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Escolher categorias" })).toBeTruthy();
    expect(screen.getByText("Mais 5 para ver depois")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Escolher categoria" }).getAttribute("href")).toBe(
      "/transactions?uncategorized=1",
    );
    expect(screen.getByRole("link", { name: "Revisar lançamento" }).getAttribute("href")).toBe(
      "/transactions?status=pending&focus=tx-2",
    );
    expect(screen.getByRole("link", { name: "Conferir saldo" }).getAttribute("href")).toBe("/accounts");
    expect(screen.getByText("Nenhuma pendência aqui")).toBeTruthy();
  });

  it("mostra um estado simples quando está tudo em ordem", async () => {
    renderCenter(
      vi.fn().mockResolvedValue(
        review({
          totalCount: 0,
          uncategorized: { totalCount: 0, items: [] },
          pendingTransactions: { totalCount: 0, items: [] },
          accountReconciliations: { totalCount: 0, items: [] },
          cardPaymentReconciliations: { totalCount: 0, items: [] },
        }),
      ),
    );

    expect(await screen.findByRole("heading", { name: "Tudo em ordem" })).toBeTruthy();
    expect(screen.queryByText(/pendências encontradas/)).toBeNull();
  });

  it("oferece nova tentativa quando a verificação falha", async () => {
    const loadReview = vi.fn().mockRejectedValue(new Error("falha"));
    renderCenter(loadReview);

    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível verificar as pendências.");
    expect((screen.getByRole("button", { name: "Tentar novamente" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
