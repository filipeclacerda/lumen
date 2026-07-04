/** Shared month/period helpers so every screen navigates dates the same way. */

/** Current month as "YYYY-MM" in local time. */
export const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/** Shifts a "YYYY-MM" month by `delta` months (negative goes back). */
export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(year, value - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Short label like "jun 26" for chart axes and compact UI. */
export function monthLabel(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
}

/** Long label like "JUNHO DE 2026" for page headers. */
export function monthTitle(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1)
    .toLocaleString("pt-BR", { month: "long", year: "numeric" })
    .toUpperCase();
}
