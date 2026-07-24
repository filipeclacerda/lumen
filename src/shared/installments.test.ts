import { describe, expect, it } from "vitest";
import { addMonthsClamped, splitInstallmentCents } from "./installments";

describe("parcelamento", () => {
  it("divide R$ 100 em três parcelas sem perder centavos", () => {
    const installments = splitInstallmentCents(10_000, 3);
    expect(installments).toEqual([3_334, 3_333, 3_333]);
    expect(installments.reduce((sum, value) => sum + value, 0)).toBe(10_000);
  });

  it("limita o dia ao fim do mês e cruza o ano", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-12-31", 1)).toBe("2027-01-31");
  });
});
