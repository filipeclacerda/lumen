import { describe, expect, it } from "vitest";
import { centsToInput, money, parseMoneyToCents, shortDate } from "./format";
describe("formatação brasileira", () => {
  it("formata centavos em BRL", () => expect(money(123456)).toContain("1.234,56"));
  it("não desloca datas pelo fuso", () => expect(shortDate("2026-06-27")).toBe("27/06/2026"));
  it("interpreta valores no formato brasileiro", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("R$ 42,10")).toBe(4210);
    expect(parseMoneyToCents("99")).toBe(9900);
  });
  it("retorna null para entradas vazias ou inválidas", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
  });
  it("converte centavos para texto editável", () => expect(centsToInput(123456)).toBe("1.234,56"));
});
