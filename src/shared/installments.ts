export function splitInstallmentCents(totalInCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalInCents) || totalInCents <= 0) return [];
  if (!Number.isInteger(count) || count < 2 || count > 48) return [];
  if (totalInCents < count) return [];
  const base = Math.floor(totalInCents / count);
  const remainder = totalInCents % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function addMonthsClamped(isoDate: string, offset: number): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !Number.isInteger(offset) || offset < 0) return undefined;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const source = new Date(Date.UTC(year, monthIndex, day));
  if (source.getUTCFullYear() !== year || source.getUTCMonth() !== monthIndex || source.getUTCDate() !== day) {
    return undefined;
  }
  const absoluteMonth = year * 12 + monthIndex + offset;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonthIndex = absoluteMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}
