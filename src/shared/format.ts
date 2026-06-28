export const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** Parses a Brazilian-formatted amount ("1.234,56") into integer cents, or null. */
export const parseMoneyToCents = (input: string): number | null => {
  const clean = input.trim().replace(/\s|R\$/g, "");
  if (!clean) return null;
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

/** Renders integer cents as an editable Brazilian decimal string ("1234,56"). */
export const centsToInput = (cents: number) => (Math.abs(cents) / 100).toFixed(2).replace(".", ",");

/** Today's date as YYYY-MM-DD in local time, for date inputs. */
export const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
