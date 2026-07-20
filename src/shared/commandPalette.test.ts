// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { commandScore, readRecentCommandIds, rememberCommandId } from "./commandPalette";

describe("command palette model", () => {
  beforeEach(() => localStorage.clear());

  it("ranks titles and aliases without accents", () => {
    const target = {
      label: "Nova transferência",
      description: "Mover dinheiro entre contas",
      keywords: ["transferir", "movimentação"],
    };
    expect(commandScore("nova transferencia", target)).toBe(100);
    expect(commandScore("transfer", target)).toBeGreaterThan(commandScore("dinheiro", target));
    expect(commandScore("movimentacao", target)).toBeGreaterThan(0);
  });

  it("stores only allowed command ids, without duplicates", () => {
    const allowed = new Set(["action:new-expense", "route:/"]);
    expect(rememberCommandId("private transaction description", allowed)).toEqual([]);
    rememberCommandId("route:/", allowed);
    rememberCommandId("action:new-expense", allowed);
    rememberCommandId("route:/", allowed);
    expect(readRecentCommandIds(allowed)).toEqual(["route:/", "action:new-expense"]);
    expect(localStorage.getItem("lumen-command-palette-recent")).not.toContain("private");
  });

  it("ignores malformed and unknown persisted entries", () => {
    localStorage.setItem("lumen-command-palette-recent", JSON.stringify(["unknown", 4, "route:/", "route:/"]));
    expect(readRecentCommandIds(new Set(["route:/"]))).toEqual(["route:/"]);
    localStorage.setItem("lumen-command-palette-recent", "not-json");
    expect(readRecentCommandIds(new Set(["route:/"]))).toEqual([]);
  });
});
