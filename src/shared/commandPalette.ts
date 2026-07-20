import { normalizeText } from "./format";

const STORAGE_KEY = "lumen-command-palette-recent";
const RECENT_LIMIT = 5;

export type CommandTarget = Readonly<{
  id: string;
  label: string;
  description: string;
  keywords: ReadonlyArray<string>;
  to: string;
}>;

export function commandScore(query: string, target: Pick<CommandTarget, "label" | "description" | "keywords">) {
  const needle = normalizeText(query.trim());
  if (!needle) return 1;
  const label = normalizeText(target.label);
  const description = normalizeText(target.description);
  const keywords = target.keywords.map(normalizeText);
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 80;
  if (label.includes(needle)) return 60;
  if (keywords.some((keyword) => keyword === needle)) return 50;
  if (keywords.some((keyword) => keyword.includes(needle))) return 40;
  if (description.includes(needle)) return 20;
  return 0;
}

export function readRecentCommandIds(allowedIds: ReadonlySet<string>): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((value): value is string => typeof value === "string" && allowedIds.has(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function rememberCommandId(id: string, allowedIds: ReadonlySet<string>): string[] {
  if (!allowedIds.has(id)) return readRecentCommandIds(allowedIds);
  const recent = [id, ...readRecentCommandIds(allowedIds).filter((value) => value !== id)].slice(0, RECENT_LIMIT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  return recent;
}
