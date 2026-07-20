import { beforeEach, describe, expect, it } from "vitest";
import { resetDataOperationLockForTests, runExclusiveDataOperation } from "./dataOperationLock";

describe("data operation lock", () => {
  beforeEach(resetDataOperationLockForTests);

  it("rejects concurrent data operations and releases the lock after completion", async () => {
    let finish!: () => void;
    const first = runExclusiveDataOperation("backup", () => new Promise<void>((resolve) => (finish = resolve)));

    await expect(runExclusiveDataOperation("export", async () => undefined)).rejects.toThrow(
      "Outra operação de dados já está em andamento.",
    );

    finish();
    await first;
    await expect(runExclusiveDataOperation("reset", async () => "ok")).resolves.toBe("ok");
  });
});
