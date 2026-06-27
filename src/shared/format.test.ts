import { describe, expect, it } from "vitest";
import { money, shortDate } from "./format";
describe("formatação brasileira", () => {
  it("formata centavos em BRL", () => expect(money(123456)).toContain("1.234,56"));
  it("não desloca datas pelo fuso", () => expect(shortDate("2026-06-27")).toBe("27/06/2026"));
});
