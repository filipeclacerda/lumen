import type { Category, ImportCandidate } from "../../shared/types";
import { normalizeText } from "../../shared/format";

export type BatchCategoryChoice = {
  decisionKey: string;
  sessionId: string;
  sourceRow: number;
  matchKey: string;
  categoryId: string;
  categoryName: string;
  included: boolean;
  sequence: number;
};

export type BatchCategorySuggestion = Omit<ImportCandidate["categorySuggestions"][number], "source"> & {
  source: ImportCandidate["categorySuggestions"][number]["source"] | "batch_choice";
};

function decisionKey(sessionId: string, sourceRow: number) {
  return `${sessionId}:${sourceRow}`;
}

function normalizedIdentity(value: string) {
  return normalizeText(value).trim().replace(/\s+/g, " ");
}

export function batchCategoryMatchKey(candidate: ImportCandidate): string | undefined {
  const identity = normalizedIdentity(
    candidate.isPix
      ? candidate.normalizedDescription || candidate.description
      : candidate.merchantKey || candidate.normalizedDescription || candidate.description,
  );
  if (!identity) return undefined;
  const direction = candidate.amountInCents >= 0 ? "credit" : "debit";
  return `${candidate.isPix ? "pix" : "merchant"}:${identity}:${direction}`;
}

export function updateBatchCategoryChoices(
  current: BatchCategoryChoice[],
  sessionId: string,
  candidates: ImportCandidate[],
  category?: Pick<Category, "id" | "name">,
): BatchCategoryChoice[] {
  const affected = new Set(candidates.map((candidate) => decisionKey(sessionId, candidate.sourceRow)));
  const remaining = current.filter((choice) => !affected.has(choice.decisionKey));
  if (!category) return remaining;

  let sequence = current.reduce((latest, choice) => Math.max(latest, choice.sequence), 0);
  const replacements = candidates.flatMap((candidate): BatchCategoryChoice[] => {
    const matchKey = batchCategoryMatchKey(candidate);
    if (!matchKey) return [];
    sequence += 1;
    return [
      {
        decisionKey: decisionKey(sessionId, candidate.sourceRow),
        sessionId,
        sourceRow: candidate.sourceRow,
        matchKey,
        categoryId: category.id,
        categoryName: category.name,
        included: candidate.included && candidate.duplicateStatus !== "exact",
        sequence,
      },
    ];
  });
  return [...remaining, ...replacements];
}

export function syncBatchCategoryChoiceCandidate(
  current: BatchCategoryChoice[],
  sessionId: string,
  candidate: ImportCandidate,
): BatchCategoryChoice[] {
  const key = decisionKey(sessionId, candidate.sourceRow);
  const matchKey = batchCategoryMatchKey(candidate);
  if (!matchKey) return current.filter((choice) => choice.decisionKey !== key);
  return current.map((choice) =>
    choice.decisionKey === key
      ? {
          ...choice,
          matchKey,
          included: candidate.included && candidate.duplicateStatus !== "exact",
        }
      : choice,
  );
}

export function removeBatchCategoryChoicesForSession(current: BatchCategoryChoice[], sessionId: string) {
  return current.filter((choice) => choice.sessionId !== sessionId);
}

function isRefund(candidate: ImportCandidate) {
  return /estorno|reembolso|devolucao|devolução|credito compra|crédito compra/i.test(candidate.description);
}

function categoryCompatible(candidate: ImportCandidate, category: Category, creditCard: boolean) {
  if (category.kind === "transfer") return false;
  if (creditCard) return category.kind === "expense" || category.kind === "investment";
  if (category.kind === "income") return candidate.amountInCents > 0;
  if (category.kind === "expense" || category.kind === "investment") {
    return candidate.amountInCents < 0 || isRefund(candidate);
  }
  return false;
}

export function batchCategorySuggestions(
  candidate: ImportCandidate,
  choices: BatchCategoryChoice[],
  categories: Category[],
  creditCard: boolean,
): BatchCategorySuggestion[] {
  const matchKey = batchCategoryMatchKey(candidate);
  if (!matchKey) return candidate.categorySuggestions;

  const ranked = new Map<string, { count: number; latest: number }>();
  for (const choice of choices) {
    if (!choice.included || choice.matchKey !== matchKey) continue;
    const current = ranked.get(choice.categoryId) ?? { count: 0, latest: 0 };
    current.count += 1;
    current.latest = Math.max(current.latest, choice.sequence);
    ranked.set(choice.categoryId, current);
  }

  const learned: BatchCategorySuggestion[] = [...ranked.entries()]
    .flatMap(([categoryId, rank]) => {
      const category = categories.find((item) => item.id === categoryId);
      if (!category || !categoryCompatible(candidate, category, creditCard)) return [];
      return [
        {
          categoryId,
          categoryName: category.name,
          source: "batch_choice" as const,
          reason: "Escolhida por você neste lote",
          rank,
          sortOrder: category.sortOrder,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.rank.count - left.rank.count ||
        right.rank.latest - left.rank.latest ||
        left.sortOrder - right.sortOrder ||
        left.categoryName.localeCompare(right.categoryName, "pt-BR"),
    )
    .map((item) => ({
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      source: item.source,
      reason: item.reason,
    }));

  const seen = new Set<string>();
  return [...learned, ...candidate.categorySuggestions]
    .filter((suggestion) => {
      if (seen.has(suggestion.categoryId)) return false;
      seen.add(suggestion.categoryId);
      return true;
    })
    .slice(0, 3);
}
