import { describe, expect, it } from "vitest";
import type { Category, ImportCandidate } from "../../shared/types";
import {
  batchCategoryAssignments,
  batchCategoryMatchKey,
  batchCategorySuggestions,
  removeBatchCategoryChoicesForSession,
  syncBatchCategoryChoiceCandidate,
  updateBatchCategoryChoices,
} from "./batchCategoryLearning";

const categories: Category[] = [
  { id: "food", name: "Alimentação", kind: "expense", sortOrder: 1, isSystem: false },
  { id: "health", name: "Saúde", kind: "expense", sortOrder: 2, isSystem: false },
  { id: "salary", name: "Salário", kind: "income", sortOrder: 3, isSystem: false },
  { id: "transfers", name: "Transferências", kind: "transfer", sortOrder: 4, isSystem: true },
];

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    sourceRow: 1,
    date: "2026-07-01",
    description: "PADARIA CENTRAL",
    normalizedDescription: "PADARIA CENTRAL",
    amountInCents: -1_000,
    merchantKey: "PADARIA CENTRAL",
    categorySuggestions: [],
    duplicateStatus: "new",
    warnings: [],
    included: true,
    ...overrides,
  };
}

describe("aprendizado temporário de categorias no lote", () => {
  it("coloca a escolha do usuário no topo sem pré-selecionar a categoria", () => {
    const firstFile = candidate({ sourceRow: 4 });
    const choices = updateBatchCategoryChoices([], "session-1", [firstFile], categories[0]);
    const nextFile = candidate({ sourceRow: 9 });

    const suggestions = batchCategorySuggestions(nextFile, choices, categories, false);

    expect(suggestions[0]).toEqual({
      categoryId: "food",
      categoryName: "Alimentação",
      source: "batch_choice",
      reason: "Escolhida por você neste lote",
    });
    expect(nextFile.suggestedCategoryId).toBeUndefined();
  });

  it("agrupa automaticamente o mesmo estabelecimento nas próximas faturas", () => {
    const choices = updateBatchCategoryChoices([], "session-1", [candidate()], categories[0]);

    expect(
      batchCategoryAssignments(
        [candidate({ sourceRow: 8 }), candidate({ sourceRow: 9, merchantKey: "OUTRA LOJA" })],
        choices,
        categories,
        true,
      ),
    ).toEqual([{ categoryId: "food", sourceRows: [8] }]);
  });

  it("mantém PIX e lançamentos já categorizados fora do agrupamento automático", () => {
    const choices = updateBatchCategoryChoices([], "session-1", [candidate()], categories[0]);

    expect(
      batchCategoryAssignments(
        [candidate({ sourceRow: 8, isPix: true }), candidate({ sourceRow: 9, suggestedCategoryId: "health" })],
        choices,
        categories,
        false,
      ),
    ).toEqual([]);
  });

  it("ordena por frequência e usa a escolha mais recente no empate", () => {
    let choices = updateBatchCategoryChoices([], "session-1", [candidate({ sourceRow: 1 })], categories[0]);
    choices = updateBatchCategoryChoices(choices, "session-1", [candidate({ sourceRow: 2 })], categories[1]);

    expect(batchCategorySuggestions(candidate(), choices, categories, false).map((item) => item.categoryId)).toEqual([
      "health",
      "food",
    ]);

    choices = updateBatchCategoryChoices(choices, "session-2", [candidate({ sourceRow: 3 })], categories[0]);
    expect(batchCategorySuggestions(candidate(), choices, categories, false).map((item) => item.categoryId)).toEqual([
      "food",
      "health",
    ]);
  });

  it("substitui, limpa, desativa e restaura o voto da mesma linha", () => {
    const selected = candidate({ sourceRow: 7 });
    let choices = updateBatchCategoryChoices([], "session-1", [selected], categories[0]);
    choices = updateBatchCategoryChoices(choices, "session-1", [selected], categories[1]);

    expect(choices).toHaveLength(1);
    expect(choices[0].categoryId).toBe("health");

    choices = syncBatchCategoryChoiceCandidate(choices, "session-1", { ...selected, included: false });
    expect(batchCategorySuggestions(candidate(), choices, categories, false)).toEqual([]);

    choices = syncBatchCategoryChoiceCandidate(choices, "session-1", { ...selected, included: true });
    expect(batchCategorySuggestions(candidate(), choices, categories, false)[0].categoryId).toBe("health");

    choices = updateBatchCategoryChoices(choices, "session-1", [selected], undefined);
    expect(choices).toEqual([]);
  });

  it("remove somente as escolhas pertencentes ao arquivo descartado", () => {
    let choices = updateBatchCategoryChoices([], "session-1", [candidate({ sourceRow: 1 })], categories[0]);
    choices = updateBatchCategoryChoices(choices, "session-2", [candidate({ sourceRow: 2 })], categories[1]);

    const remaining = removeBatchCategoryChoicesForSession(choices, "session-1");

    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe("session-2");
  });

  it("separa direção, valida compatibilidade e não transforma transferência em atalho", () => {
    const debit = candidate({ sourceRow: 1 });
    let choices = updateBatchCategoryChoices([], "session-1", [debit], categories[0]);
    choices = updateBatchCategoryChoices(choices, "session-1", [candidate({ sourceRow: 2 })], categories[2]);
    choices = updateBatchCategoryChoices(choices, "session-1", [candidate({ sourceRow: 3 })], categories[3]);

    expect(batchCategorySuggestions(candidate({ amountInCents: 1_000 }), choices, categories, false)).toEqual([]);
    expect(batchCategorySuggestions(candidate(), choices, categories, false).map((item) => item.categoryId)).toEqual([
      "food",
    ]);

    const refund = candidate({
      sourceRow: 4,
      description: "ESTORNO PADARIA CENTRAL",
      normalizedDescription: "PADARIA CENTRAL",
      amountInCents: 1_000,
    });
    const refundChoices = updateBatchCategoryChoices([], "session-2", [refund], categories[0]);
    expect(batchCategorySuggestions(refund, refundChoices, categories, false)[0].categoryId).toBe("food");
  });

  it("usa descrição PIX exata, mas mantém cada ocorrência como decisão independente", () => {
    const firstPix = candidate({
      sourceRow: 11,
      isPix: true,
      merchantKey: "",
      description: "PIX RECEBIDO MARIA SILVA",
      normalizedDescription: "PIX RECEBIDO MARIA SILVA",
    });
    const samePix = { ...firstPix, sourceRow: 23 };
    const otherPix = { ...firstPix, sourceRow: 24, normalizedDescription: "PIX RECEBIDO JOAO SILVA" };
    const choices = updateBatchCategoryChoices([], "session-1", [firstPix], categories[0]);

    expect(batchCategoryMatchKey(firstPix)).toBe(batchCategoryMatchKey(samePix));
    expect(batchCategoryMatchKey(firstPix)).not.toBe(batchCategoryMatchKey(otherPix));
    expect(batchCategorySuggestions(samePix, choices, categories, false)[0].categoryId).toBe("food");
    expect(batchCategorySuggestions(otherPix, choices, categories, false)).toEqual([]);
    expect(choices[0].sourceRow).toBe(11);
  });

  it("elimina duplicatas e limita a lista final a três sugestões", () => {
    const current = candidate({
      categorySuggestions: [
        { categoryId: "food", categoryName: "Alimentação", source: "vocabulary", reason: "Vocabulário" },
        { categoryId: "health", categoryName: "Saúde", source: "vocabulary", reason: "Vocabulário" },
        { categoryId: "salary", categoryName: "Salário", source: "category_name", reason: "Nome" },
      ],
    });
    let choices = updateBatchCategoryChoices([], "session-1", [candidate({ sourceRow: 1 })], categories[0]);
    choices = updateBatchCategoryChoices(choices, "session-1", [candidate({ sourceRow: 2 })], categories[1]);

    const suggestions = batchCategorySuggestions(current, choices, categories, false);

    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((item) => item.categoryId)).toEqual(["health", "food", "salary"]);
    expect(suggestions.filter((item) => item.categoryId === "food")).toHaveLength(1);
  });
});
