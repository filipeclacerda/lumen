import { describe, expect, it } from "vitest";
import { centsToInput, money, normalizeText, parseMoneyToCents, shortDate, suggestRulePattern } from "./format";
describe("formatação brasileira", () => {
  it("formata centavos em BRL", () => expect(money(123456)).toContain("1.234,56"));
  it("não desloca datas pelo fuso", () => expect(shortDate("2026-06-27")).toBe("27/06/2026"));
  it("interpreta valores no formato brasileiro", () => {
    expect(parseMoneyToCents("1.234,56")).toBe(123456);
    expect(parseMoneyToCents("R$ 42,10")).toBe(4210);
    expect(parseMoneyToCents("99")).toBe(9900);
  });
  it("interpreta ponto como separador de milhar quando não há vírgula", () => {
    expect(parseMoneyToCents("1.234")).toBe(123400);
    expect(parseMoneyToCents("1.234.567")).toBe(123456700);
  });
  it("retorna null para entradas vazias ou inválidas", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
  });
  it("converte centavos para texto editável", () => expect(centsToInput(123456)).toBe("1.234,56"));
  it("normaliza texto removendo acentos e caixa", () => {
    expect(normalizeText("Cartão")).toBe("cartao");
    expect(normalizeText("SUPERMERCADO")).toBe("supermercado");
  });
  it("sugere um padrão de regra sem datas, parcelas e números longos", () => {
    expect(suggestRulePattern("COMPRA CARTAO SUPERMERCADO BH 02/06")).toBe("COMPRA CARTAO SUPERMERCADO BH");
    expect(suggestRulePattern("PARC 02/06 COMPRA LOJA XYZ")).toBe("COMPRA LOJA XYZ");
    expect(suggestRulePattern("PIX RECEBIDO 123456789012")).toBe("PIX RECEBIDO");
  });
});
