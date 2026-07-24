import type { NetWorthPoint } from "../../shared/types";

export type NetWorthSummary = {
  currentInCents: number;
  assetsInCents: number;
  liabilitiesInCents: number;
  changeInCents?: number;
  changePercent?: number;
};

export function summarizeNetWorth(points: NetWorthPoint[]): NetWorthSummary | undefined {
  const current = points.at(-1);
  if (!current) return undefined;
  const yearAgo = points.length >= 13 ? points.at(-13) : undefined;
  const changeInCents = yearAgo ? current.totalInCents - yearAgo.totalInCents : undefined;
  const changePercent =
    yearAgo && yearAgo.totalInCents !== 0
      ? ((current.totalInCents - yearAgo.totalInCents) / Math.abs(yearAgo.totalInCents)) * 100
      : undefined;

  return {
    currentInCents: current.totalInCents,
    assetsInCents: current.assetsInCents,
    liabilitiesInCents: current.liabilitiesInCents,
    changeInCents,
    changePercent,
  };
}
