import { describe, expect, it } from "vitest";
import type { NetWorthPoint } from "../../shared/types";
import { summarizeNetWorth } from "./netWorth";

function point(
  month: string,
  totalInCents: number,
  assetsInCents = totalInCents,
  liabilitiesInCents = 0,
): NetWorthPoint {
  return { month, totalInCents, assetsInCents, liabilitiesInCents, perKind: [] };
}

describe("summarizeNetWorth", () => {
  it("compara o mês atual com o mesmo mês do ano anterior", () => {
    const points = Array.from({ length: 13 }, (_, index) =>
      point(`2025-${String(index + 1).padStart(2, "0")}`, 100_000 + index * 10_000),
    );

    expect(summarizeNetWorth(points)).toMatchObject({
      currentInCents: 220_000,
      changeInCents: 120_000,
      changePercent: 120,
    });
  });

  it("preserva passivos negativos e evita percentual sem base", () => {
    const points = [
      point("2025-01", 0),
      ...Array.from({ length: 11 }, (_, index) => point(`2025-${index + 2}`, 50_000)),
      point("2026-01", 70_000, 120_000, -50_000),
    ];

    expect(summarizeNetWorth(points)).toEqual({
      currentInCents: 70_000,
      assetsInCents: 120_000,
      liabilitiesInCents: -50_000,
      changeInCents: 70_000,
      changePercent: undefined,
    });
  });
});
