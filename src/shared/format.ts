export const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** Parses a Brazilian-formatted amount ("-1.234,56") into integer cents, or null. */
export const parseMoneyToCents = (input: string): number | null => {
  const clean = input.trim().replace(/\s|R\$/g, "");
  if (!clean) return null;
  let normalized: string;
  if (clean.includes(",")) {
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(clean)) {
    // No comma but every dot group has exactly 3 digits (e.g. "1.234", "1.234.567"):
    // in pt-BR that's a thousands separator, not a decimal point, so strip the dots.
    normalized = clean.replace(/\./g, "");
  } else {
    normalized = clean;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

/** Formats a string of digits into a Brazilian currency mask ("-1.234,56"). */
export const maskCurrency = (value: string): string => {
  const isNegative = value.includes("-");
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  if (isNaN(num)) return "";
  const cents = (num / 100).toFixed(2);
  const formatted = cents.replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return isNegative && num > 0 ? "-" + formatted : formatted;
};

/** Renders integer cents as an editable Brazilian decimal string ("-1.234,56"). */
export const centsToInput = (cents: number) => {
  const isNegative = cents < 0;
  const formatted = maskCurrency(Math.abs(cents).toString());
  return isNegative && formatted ? "-" + formatted : formatted;
};

/** Lowercases and strips diacritics, for accent-insensitive text comparisons. */
export const normalizeText = (value: string): string => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Suggests a rule-matching pattern from a transaction description by stripping
 * dates, installment markers ("PARC 02/06") and long digit runs (card/document
 * numbers) that would otherwise make the rule too specific to ever match again. */
export const suggestRulePattern = (description: string): string =>
  description
    .toUpperCase()
    .replace(/\bPARC(ELA)?\.?\s*\d{1,2}\/\d{1,2}\b/g, " ")
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, " ")
    .replace(/\d{4,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Today's date as YYYY-MM-DD in local time, for date inputs. */
export const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
