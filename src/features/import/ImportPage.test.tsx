// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category, CreditCardImportPreview, ImportCandidate } from "../../shared/types";
import {
  CardImportCommitNotice,
  cardPaymentReconciliationPath,
  CreditCardImportItems,
  CreditCardImportTotals,
  creditCardCategorizationCandidates,
  groupPendingCandidates,
  ImportReviewGroups,
  summarizeSuggestions,
} from "./ImportPage";

const categories: Category[] = [
  {
    id: "food",
    name: "Alimentacao",
    color: "#c2410c",
    icon: "utensils",
    kind: "expense",
    sortOrder: 0,
    isSystem: false,
  },
  {
    id: "salary",
    name: "Salario",
    kind: "income",
    sortOrder: 1,
    isSystem: false,
  },
];

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    sourceRow: 1,
    date: "2026-07-01",
    description: "Compra sintetica",
    normalizedDescription: "COMPRA SINTETICA",
    amountInCents: -1_000,
    merchantKey: "COMPRA SINTETICA",
    categorySuggestions: [],
    duplicateStatus: "new",
    warnings: [],
    included: true,
    ...overrides,
  };
}

function creditCardPreview(): CreditCardImportPreview {
  return {
    sessionId: "session-card",
    fileName: "fatura-sintetica.csv",
    accountId: "card-1",
    dueDate: "2026-07-10",
    purchasesInCents: 10_000,
    creditsInCents: 2_000,
    paymentsInCents: 5_000,
    totalInCents: 8_000,
    items: [
      {
        candidate: candidate({
          sourceRow: 1,
          description: "Compra sintetica",
          amountInCents: -10_000,
        }),
        rawAmountInCents: 10_000,
        lineKind: "purchase",
        included: true,
        isPayment: false,
      },
      {
        candidate: candidate({
          sourceRow: 2,
          description: "Estorno sintetico",
          amountInCents: 2_000,
        }),
        rawAmountInCents: -2_000,
        lineKind: "refund",
        included: true,
        isPayment: false,
      },
      {
        candidate: candidate({
          sourceRow: 3,
          description: "Pagamento de fatura",
          amountInCents: 5_000,
        }),
        rawAmountInCents: -5_000,
        lineKind: "payment",
        included: true,
        isPayment: true,
      },
    ],
  };
}

afterEach(cleanup);

describe("prévia da fatura", () => {
  it("separa pagamentos anteriores dos itens que precisam de categoria", () => {
    const preview = creditCardPreview();

    expect(creditCardCategorizationCandidates(preview).map((item) => item.sourceRow)).toEqual([1, 2]);
    expect(summarizeSuggestions(creditCardCategorizationCandidates(preview)).pending).toBe(2);
  });

  it("mostra o total da fatura sem misturar pagamentos anteriores", () => {
    render(<CreditCardImportTotals preview={creditCardPreview()} />);

    expect(screen.getByText("Compras")).toBeTruthy();
    expect(screen.getByText("Créditos e estornos")).toBeTruthy();
    expect(screen.getByText("Total desta fatura")).toBeTruthy();
    expect(screen.getByText(/Pagamento anterior detectado/)).toBeTruthy();
    expect(screen.getByText(/não altera esta fatura/)).toBeTruthy();
  });

  it("mantém pagamentos incluídos em detalhes recolhidos e permite excluí-los", () => {
    const onUpdate = vi.fn();

    render(
      <CreditCardImportItems
        items={creditCardPreview().items}
        paymentsInCents={5_000}
        categories={categories}
        onUpdate={onUpdate}
      />,
    );

    const summary = screen.getByText(/Pagamentos anteriores \(1\)/).closest("summary");
    const details = summary?.closest("details");
    expect(details?.open).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Incluir Pagamento de fatura" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Incluir Pagamento de fatura" })).toHaveProperty("checked", true);

    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Pagamento de fatura" }));

    expect(onUpdate).toHaveBeenCalledWith(3, false, undefined);
  });

  it("oferece a conciliação do primeiro pagamento depois do commit", () => {
    const onReview = vi.fn();

    render(
      <CardImportCommitNotice
        summary={{ invoiceId: "invoice-1", paymentTransactionIds: ["payment/1", "payment-2"] }}
        onReview={onReview}
      />,
    );

    expect(screen.getByText("2 pagamentos anteriores detectados")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revisar conciliação" }));

    expect(onReview).toHaveBeenCalledWith("payment/1");
    expect(cardPaymentReconciliationPath("payment/1")).toBe("/accounts?reconcile=payment%2F1");
  });
});

describe("summarizeSuggestions", () => {
  it("contabiliza regras, historico, escolhas manuais e pendencias elegiveis", () => {
    const candidates = [
      candidate({ sourceRow: 1, suggestedCategoryId: "food", suggestionSource: "rule" }),
      candidate({ sourceRow: 2, suggestedCategoryId: "food", suggestionSource: "history" }),
      candidate({ sourceRow: 3, suggestedCategoryId: "food" }),
      candidate({ sourceRow: 4 }),
      candidate({ sourceRow: 5, duplicateStatus: "exact" }),
      candidate({ sourceRow: 6, included: false }),
    ];

    expect(summarizeSuggestions(candidates)).toEqual({
      rule: 1,
      history: 1,
      manual: 1,
      pending: 1,
    });
  });
});

describe("groupPendingCandidates", () => {
  it("agrupa por merchantKey e direcao do movimento", () => {
    const candidates = [
      candidate({ sourceRow: 2, merchantKey: "PADARIA CENTRAL", amountInCents: -1_200 }),
      candidate({ sourceRow: 8, merchantKey: "PADARIA CENTRAL", amountInCents: -800 }),
      candidate({ sourceRow: 9, merchantKey: "PADARIA CENTRAL", amountInCents: 500 }),
    ];

    const groups = groupPendingCandidates(candidates);
    const debitGroup = groups.find((group) => group.key === "PADARIA CENTRAL::debit");
    const creditGroup = groups.find((group) => group.key === "PADARIA CENTRAL::credit");

    expect(groups).toHaveLength(2);
    expect(debitGroup?.candidates.map((item) => item.sourceRow)).toEqual([2, 8]);
    expect(debitGroup?.totalInCents).toBe(-2_000);
    expect(creditGroup?.candidates.map((item) => item.sourceRow)).toEqual([9]);
  });

  it("mantem cada PIX em um grupo individual mesmo quando o favorecido e a direcao coincidem", () => {
    const groups = groupPendingCandidates([
      candidate({ sourceRow: 2, merchantKey: "MARIA SILVA", isPix: true }),
      candidate({ sourceRow: 8, merchantKey: "MARIA SILVA", isPix: true }),
      candidate({ sourceRow: 9, merchantKey: "MARIA SILVA" }),
      candidate({ sourceRow: 10, merchantKey: "MARIA SILVA" }),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.filter((group) => group.isPix).map((group) => group.candidates[0].sourceRow)).toEqual([2, 8]);
    expect(groups.find((group) => !group.isPix)?.candidates.map((item) => item.sourceRow)).toEqual([9, 10]);
  });
});

describe("ImportReviewGroups", () => {
  it("mostra um grupo por vez e permite navegar pela fila", async () => {
    const groups = groupPendingCandidates([
      candidate({ sourceRow: 1, merchantKey: "A MERCADO", description: "A Mercado" }),
      candidate({ sourceRow: 2, merchantKey: "B PADARIA", description: "B Padaria" }),
      candidate({ sourceRow: 3, merchantKey: "C FARMACIA", description: "C Farmacia" }),
    ]);

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "A MERCADO" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "B PADARIA" })).toBeNull();
    expect(screen.getByText("Grupo 1 de 3")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Posição na fila de revisão" }).getAttribute("aria-valuenow")).toBe(
      "1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Próximo grupo" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "B PADARIA" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "A MERCADO" })).toBeNull();
    expect(screen.getByText("Grupo 2 de 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grupo anterior" }).hasAttribute("disabled")).toBe(false);
  });

  it("aplica uma sugestao a todas as sourceRows do grupo", () => {
    const first = candidate({
      sourceRow: 3,
      merchantKey: "MERCADO BAIRRO",
      description: "Mercado Bairro loja 1",
      categorySuggestions: [
        {
          categoryId: "food",
          categoryName: "Alimentacao",
          source: "vocabulary",
          reason: "Termo frequente em compras de mercado",
        },
      ],
    });
    const second = candidate({
      sourceRow: 7,
      merchantKey: "MERCADO BAIRRO",
      description: "Mercado Bairro loja 2",
    });
    const groups = groupPendingCandidates([first, second]);
    const onApply = vi.fn().mockResolvedValue(undefined);

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: /Alimentacao/ }));

    const suggestionButton = screen.getByRole("button", { name: /Aplicar Alimentacao/ });
    expect(suggestionButton.getAttribute("data-kind")).toBe("expense");
    expect(suggestionButton.querySelector("svg")).toBeTruthy();
    expect(suggestionButton.querySelector(".import-suggestion-chip-icon")?.getAttribute("style")).toContain(
      "color: rgb(194, 65, 12)",
    );
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith([3, 7], "food", first);
  });

  it("informa quando nao existem grupos pendentes", () => {
    render(<ImportReviewGroups groups={[]} categories={categories} onApply={vi.fn()} />);

    expect(screen.getByText("Tudo pronto para confirmar")).toBeTruthy();
    expect(screen.getByText("Não há lançamentos incluídos aguardando categoria.")).toBeTruthy();
  });

  it("mantem o seletor completo evidente quando nao existe sugestao segura", () => {
    const groups = groupPendingCandidates([candidate({ merchantKey: "LOJA DESCONHECIDA" })]);

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={vi.fn()} />);

    expect(screen.getByText("Sem sugestão segura — procure na lista completa")).toBeTruthy();
    expect(screen.getByText("Escolha uma categoria")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Escolher categoria para LOJA DESCONHECIDA" })).toBeTruthy();
    expect(document.querySelector(".import-review-group-actions--manual-only")).toBeTruthy();
    expect(document.querySelector(".import-review-quick-actions")).toBeNull();
  });

  it("identifica PIX na copia e aplica sugestoes somente ao lancamento atual", () => {
    const pix = candidate({
      sourceRow: 12,
      merchantKey: "JOAO SILVA",
      isPix: true,
      categorySuggestions: [
        {
          categoryId: "food",
          categoryName: "Alimentacao",
          source: "similar_history",
          reason: "Categoria usada em um lançamento semelhante",
        },
      ],
    });
    const onApply = vi.fn().mockResolvedValue(undefined);

    render(<ImportReviewGroups groups={groupPendingCandidates([pix])} categories={categories} onApply={onApply} />);

    expect(screen.getByText("LANÇAMENTO PIX")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Aplicar Alimentacao/ }));
    expect(onApply).toHaveBeenCalledWith([12], "food", pix);
  });

  it("move o foco para o proximo grupo depois de aplicar uma sugestao", async () => {
    const suggestion = {
      categoryId: "food",
      categoryName: "Alimentacao",
      source: "vocabulary" as const,
      reason: "Termo frequente em compras",
    };
    const groups = groupPendingCandidates([
      candidate({ sourceRow: 1, merchantKey: "A MERCADO", categorySuggestions: [suggestion] }),
      candidate({ sourceRow: 2, merchantKey: "B MERCADO", categorySuggestions: [suggestion] }),
    ]);
    const onApply = vi.fn().mockResolvedValue(undefined);
    const view = render(<ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Alimentacao/ })[0]);
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    view.rerender(<ImportReviewGroups groups={groups.slice(1)} categories={categories} onApply={onApply} />);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Alimentacao/ })));
    expect(screen.getByText("Grupo 2 de 2")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Posição na fila de revisão" }).getAttribute("aria-valuenow")).toBe(
      "2",
    );
  });

  it("mantem o grupo atual e informa o erro quando a aplicacao falha", async () => {
    const suggestion = {
      categoryId: "food",
      categoryName: "Alimentacao",
      source: "vocabulary" as const,
      reason: "Termo frequente em compras",
    };
    const groups = groupPendingCandidates([
      candidate({ sourceRow: 1, merchantKey: "MERCADO TESTE", categorySuggestions: [suggestion] }),
    ]);
    const onApply = vi.fn().mockRejectedValue(new Error("sessão expirada"));

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar Alimentacao/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("sessão expirada");
    expect(screen.getByRole("heading", { name: "MERCADO TESTE" })).toBeTruthy();
  });
});
