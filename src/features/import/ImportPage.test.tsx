// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Category, CreditCardImportPreview, ImportCandidate } from "../../shared/types";
import { updateBatchCategoryChoices } from "./batchCategoryLearning";
import {
  CardImportCommitNotice,
  cardPaymentReconciliationPath,
  CreditCardImportItems,
  CreditCardImportTotals,
  creditCardCategorizationCandidates,
  groupPendingCandidates,
  importGuidePhaseForActiveScreen,
  importGuidePhaseForScreen,
  ImportReviewGroups,
  shouldHandoffCompleteGuideToImport,
  shouldOpenReviewTabForImportLesson,
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
  {
    id: "transfers",
    name: "Transferencias",
    icon: "arrow-left-right",
    kind: "transfer",
    sortOrder: 2,
    isSystem: true,
  },
  {
    id: "credit-card-payment",
    name: "Pagamento de fatura",
    icon: "credit-card",
    kind: "transfer",
    sortOrder: 3,
    isSystem: true,
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

describe("fase contextual do tutorial", () => {
  it("abre a aba Revisar somente para a última lição de categorias", () => {
    expect(
      shouldOpenReviewTabForImportLesson({
        activeGuide: "import",
        phase: "review",
        lessonId: "review-categories",
      }),
    ).toBe(true);
    expect(
      shouldOpenReviewTabForImportLesson({
        activeGuide: "import",
        phase: "review",
        lessonId: "review-confirm",
      }),
    ).toBe(false);
    expect(
      shouldOpenReviewTabForImportLesson({
        activeGuide: null,
        phase: "review",
        lessonId: "review-categories",
      }),
    ).toBe(false);
  });

  it("mantém a conclusão visível depois que o fluxo de importação é limpo", () => {
    expect(
      importGuidePhaseForScreen({
        currentPhase: "success",
        pendingCommit: false,
        hasPreview: false,
        hasConfiguration: false,
      }),
    ).toBe("success");
  });

  it("avança da configuração para a revisão quando a prévia da fatura fica disponível", () => {
    expect(
      importGuidePhaseForScreen({
        currentPhase: "configure",
        pendingCommit: false,
        hasPreview: true,
        hasConfiguration: false,
      }),
    ).toBe("review");
  });

  it("entrega a primeira etapa do tour completo à ajuda contextual quando o arquivo já foi lido", () => {
    expect(
      shouldHandoffCompleteGuideToImport({
        activeGuide: "complete",
        completeLessonId: "import-source",
        phase: "configure",
      }),
    ).toBe(true);
    expect(
      shouldHandoffCompleteGuideToImport({
        activeGuide: "complete",
        completeLessonId: "import-source",
        phase: "review",
      }),
    ).toBe(true);
  });

  it("mantém o tour completo enquanto a área de upload ainda é o alvo válido", () => {
    expect(
      shouldHandoffCompleteGuideToImport({
        activeGuide: "complete",
        completeLessonId: "import-source",
        phase: "choose",
      }),
    ).toBe(false);
    expect(
      shouldHandoffCompleteGuideToImport({
        activeGuide: "complete",
        completeLessonId: "transactions-list",
        phase: "configure",
      }),
    ).toBe(false);
  });

  it("ignora uma fase antiga concluída ao refazer o tour completo", () => {
    expect(
      importGuidePhaseForActiveScreen({
        activeGuide: "complete",
        currentPhase: "success",
        pendingCommit: false,
        hasPreview: false,
        hasConfiguration: false,
      }),
    ).toBe("choose");
    expect(
      importGuidePhaseForActiveScreen({
        activeGuide: "complete",
        currentPhase: "success",
        pendingCommit: false,
        hasPreview: false,
        hasConfiguration: true,
      }),
    ).toBe("configure");
  });
});

describe("prévia da fatura", () => {
  it("separa pagamentos anteriores dos itens que precisam de categoria", () => {
    const preview = creditCardPreview();

    expect(creditCardCategorizationCandidates(preview).map((item) => item.sourceRow)).toEqual([1, 2]);
    expect(summarizeSuggestions(creditCardCategorizationCandidates(preview)).pending).toBe(2);
  });

  it("usa o estado de inclusão do item da fatura na revisão e no aprendizado", () => {
    const preview = creditCardPreview();
    preview.items[0].included = false;

    const candidates = creditCardCategorizationCandidates(preview);

    expect(candidates[0].included).toBe(false);
    expect(summarizeSuggestions(candidates).pending).toBe(1);
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
    expect(screen.getByRole("button", { name: "Categoria da importação na linha 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Categoria da importação na linha 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Categoria da importação na linha 3" })).toHaveProperty("disabled", true);

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

  it("incorpora a escolha feita em outro arquivo sem reduzir a pendencia", () => {
    const previous = candidate({ sourceRow: 2, merchantKey: "PADARIA CENTRAL" });
    const choices = updateBatchCategoryChoices([], "session-previous", [previous], categories[0]);
    const current = candidate({ sourceRow: 8, merchantKey: "PADARIA CENTRAL" });

    const groups = groupPendingCandidates([current], choices, categories, false);

    expect(groups[0].suggestions[0]).toMatchObject({
      categoryId: "food",
      source: "batch_choice",
      reason: "Escolhida por você neste lote",
    });
    expect(summarizeSuggestions([current]).pending).toBe(1);
    expect(current.suggestedCategoryId).toBeUndefined();
  });
});

describe("ImportReviewGroups", () => {
  it("mostra somente o grupo atual sem navegacao manual pela fila", () => {
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
    expect(screen.queryByRole("button", { name: "Grupo anterior" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Próximo grupo" })).toBeNull();
    expect(
      document.querySelector('article.import-review-group[data-import-tutorial="review-category-group"]'),
    ).toBeTruthy();
    expect(document.querySelector(".import-review-category-picker[data-import-tutorial]")).toBeNull();
    expect(document.querySelector('[data-import-tutorial="review-categories"]')).toBeNull();
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
    expect(document.querySelector('[data-import-tutorial="review-categories-ready"]')).toBeTruthy();
  });

  it("mantem o seletor completo evidente quando nao existe sugestao segura", () => {
    const groups = groupPendingCandidates([candidate({ merchantKey: "LOJA DESCONHECIDA" })]);

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={vi.fn()} />);

    expect(screen.getByText("Sem sugestão segura — procure na lista completa")).toBeTruthy();
    expect(screen.getByText("Escolha uma categoria")).toBeTruthy();
    const categoryTrigger = screen.getByRole("button", { name: "Escolher categoria para LOJA DESCONHECIDA" });
    expect(categoryTrigger).toBeTruthy();
    expect(document.querySelector(".import-review-group-actions--manual-only")).toBeTruthy();
    expect(document.querySelector(".import-review-quick-actions")).toBeNull();
    fireEvent.click(categoryTrigger);
    expect(screen.getByRole("option", { name: "Transferencias" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Pagamento de fatura" })).toBeTruthy();
  });

  it("volta a ultima escolha pelo card seguinte e regride o progresso", async () => {
    const first = candidate({ sourceRow: 31, merchantKey: "A MERCADO" });
    const second = candidate({ sourceRow: 32, merchantKey: "B PADARIA" });
    const groups = groupPendingCandidates([first, second]);
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <ImportReviewGroups groups={groups} categories={categories} onApply={onApply} onUndo={onUndo} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Escolher categoria para A MERCADO" }));
    fireEvent.click(screen.getByRole("option", { name: "Alimentacao" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([31], "food", first));

    const undoChoice = {
      kind: "bank" as const,
      sessionId: "session-bank",
      groupKey: "A MERCADO::debit",
      label: "A MERCADO",
      sourceRows: [31],
      representative: first,
    };
    view.rerender(
      <ImportReviewGroups
        groups={groups.slice(1)}
        categories={categories}
        onApply={onApply}
        undoChoice={undoChoice}
        onUndo={onUndo}
      />,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "B PADARIA" })).toBeTruthy());
    expect(screen.getByText("Grupo 2 de 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à escolha anterior" }));
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith(undoChoice));

    view.rerender(<ImportReviewGroups groups={groups} categories={categories} onApply={onApply} onUndo={onUndo} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "A MERCADO" })).toBeTruthy());
    expect(screen.getByText("Grupo 1 de 2")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Posição na fila de revisão" }).getAttribute("aria-valuenow")).toBe(
      "1",
    );
  });

  it("permite voltar a ultima escolha depois de concluir toda a fila", async () => {
    const last = candidate({ sourceRow: 41, merchantKey: "ULTIMA LOJA" });
    const groups = groupPendingCandidates([last]);
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onUndo = vi.fn().mockResolvedValue(undefined);
    const undoChoice = {
      kind: "card" as const,
      sessionId: "session-card",
      groupKey: "ULTIMA LOJA::debit",
      label: "ULTIMA LOJA",
      sourceRows: [41],
      representative: last,
    };
    const view = render(
      <ImportReviewGroups groups={groups} categories={categories} onApply={onApply} onUndo={onUndo} creditCard />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Escolher categoria para ULTIMA LOJA" }));
    fireEvent.click(screen.getByRole("option", { name: "Alimentacao" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    view.rerender(
      <ImportReviewGroups
        groups={[]}
        categories={categories}
        onApply={onApply}
        undoChoice={undoChoice}
        onUndo={onUndo}
        creditCard
      />,
    );

    expect(screen.getByText("Tudo pronto para confirmar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à escolha anterior" }));
    await waitFor(() => expect(onUndo).toHaveBeenCalledWith(undoChoice));
  });

  it("mantem o botao de voltar quando o desfazer falha", async () => {
    const previous = candidate({ sourceRow: 51, merchantKey: "LOJA ANTERIOR" });
    const current = candidate({ sourceRow: 52, merchantKey: "LOJA ATUAL" });
    const undoChoice = {
      kind: "bank" as const,
      sessionId: "session-bank",
      groupKey: "LOJA ANTERIOR::debit",
      label: "LOJA ANTERIOR",
      sourceRows: [51],
      representative: previous,
    };
    const onUndo = vi.fn().mockRejectedValue(new Error("Sessão indisponível"));

    render(
      <ImportReviewGroups
        groups={groupPendingCandidates([current])}
        categories={categories}
        onApply={vi.fn()}
        undoChoice={undoChoice}
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Voltar à escolha anterior" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Sessão indisponível");
    expect(screen.getByRole("button", { name: "Voltar à escolha anterior" })).toBeTruthy();
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

  it("orienta PIX para conta propria sem decidir entre transferencia e pagamento de fatura", () => {
    const pix = candidate({
      sourceRow: 14,
      merchantKey: "PIX EMIT OUT IF MSM",
      description: "PIX.EMIT.OUT IF-MSM",
      isPix: true,
      isOwnAccountPix: true,
    });
    const onApply = vi.fn().mockResolvedValue(undefined);

    render(<ImportReviewGroups groups={groupPendingCandidates([pix])} categories={categories} onApply={onApply} />);

    expect(screen.getByText("Como você quer representar esse caminho?")).toBeTruthy();
    expect(screen.getByText(/Se a outra conta também está no Lumen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pagamento de fatura" }));
    expect(onApply).toHaveBeenCalledWith([14], "credit-card-payment", pix);
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
    const view = render(
      <div className="window-frame__content" data-testid="review-scroll">
        <ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />
      </div>,
    );
    const scroller = screen.getByTestId("review-scroll");
    scroller.scrollTop = 420;

    fireEvent.click(screen.getAllByRole("button", { name: /Alimentacao/ })[0]);
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    scroller.scrollTop = 0;
    view.rerender(
      <div className="window-frame__content" data-testid="review-scroll">
        <ImportReviewGroups groups={groups.slice(1)} categories={categories} onApply={onApply} />
      </div>,
    );

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Alimentacao/ })));
    expect(scroller.scrollTop).toBe(420);
    expect(screen.getByText("Grupo 2 de 2")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Posição na fila de revisão" }).getAttribute("aria-valuenow")).toBe(
      "2",
    );
  });

  it("mantem a posicao da tela ao escolher uma categoria pela lista completa", async () => {
    const first = candidate({ sourceRow: 61, merchantKey: "A LOJA" });
    const second = candidate({ sourceRow: 62, merchantKey: "B LOJA" });
    const groups = groupPendingCandidates([first, second]);
    const onApply = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <div className="window-frame__content" data-testid="manual-review-scroll">
        <ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />
      </div>,
    );
    const scroller = screen.getByTestId("manual-review-scroll");
    scroller.scrollTop = 360;

    fireEvent.click(screen.getByRole("button", { name: "Escolher categoria para A LOJA" }));
    fireEvent.click(screen.getByRole("option", { name: "Alimentacao" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([61], "food", first));
    scroller.scrollTop = 0;
    view.rerender(
      <div className="window-frame__content" data-testid="manual-review-scroll">
        <ImportReviewGroups groups={groups.slice(1)} categories={categories} onApply={onApply} />
      </div>,
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Escolher categoria para B LOJA" })),
    );
    expect(scroller.scrollTop).toBe(360);
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
    const onApply = vi.fn().mockRejectedValue({
      code: "VALIDATION",
      message: "Dados inválidos: categoria incompatível",
      recoverable: true,
    });

    render(<ImportReviewGroups groups={groups} categories={categories} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: /Aplicar Alimentacao/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("Dados inválidos: categoria incompatível");
    expect(screen.getByRole("heading", { name: "MERCADO TESTE" })).toBeTruthy();
  });
});
