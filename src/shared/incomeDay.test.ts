import { describe, expect, it } from "vitest";
import { FIFTH_BUSINESS_DAY, incomeDayOptions, incomeDaySelection, parseIncomeDaySelection } from "./incomeDay";

describe("income day selection", () => {
  it("keeps a fixed day distinct from the fifth business day", () => {
    expect(parseIncomeDaySelection("5")).toEqual({ incomeDay: 5 });
    expect(parseIncomeDaySelection(FIFTH_BUSINESS_DAY)).toEqual({ incomeDayRule: FIFTH_BUSINESS_DAY });
  });

  it("restores the persisted fifth-business-day rule in the select", () => {
    expect(incomeDaySelection(undefined, FIFTH_BUSINESS_DAY)).toBe(FIFTH_BUSINESS_DAY);
  });

  it("offers optional, fixed, last-day and business-day choices", () => {
    expect(incomeDayOptions).toEqual(
      expect.arrayContaining([
        { value: "", label: "Não definido" },
        { value: "1", label: "1" },
        { value: "31", label: "Último dia do mês" },
        { value: FIFTH_BUSINESS_DAY, label: "5º dia útil do mês" },
      ]),
    );
  });
});
