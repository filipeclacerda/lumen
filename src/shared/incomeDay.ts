import type { IncomeDayRule } from "./types";

export const FIFTH_BUSINESS_DAY: IncomeDayRule = "fifth_business_day";

export const incomeDayOptions = [
  { value: "", label: "Não definido" },
  { value: FIFTH_BUSINESS_DAY, label: "5º dia útil do mês" },
  ...Array.from({ length: 30 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
  { value: "31", label: "Último dia do mês" },
];

export function incomeDaySelection(incomeDay?: number, incomeDayRule?: IncomeDayRule) {
  return incomeDayRule === FIFTH_BUSINESS_DAY ? FIFTH_BUSINESS_DAY : incomeDay ? String(incomeDay) : "";
}

export function parseIncomeDaySelection(value: string): {
  incomeDay?: number;
  incomeDayRule?: IncomeDayRule;
} {
  if (value === FIFTH_BUSINESS_DAY) return { incomeDayRule: FIFTH_BUSINESS_DAY };
  return { incomeDay: value ? Number(value) : undefined };
}
