import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../shared/api";
import { createVerifiedBackup } from "../../shared/backupReminder";
import {
  chooseBackupToRestore,
  createDatabaseBackup,
  exportTransactions,
  prepareDatabaseReset,
  prepareDatabaseRestore,
  type ExportFormat,
} from "./desktopDataOperations";

const dialogMocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);
vi.mock("../../shared/api", () => ({
  api: {
    exportTransactionsCsv: vi.fn(),
    exportTransactionsOfx: vi.fn(),
    exportTransactionsPdf: vi.fn(),
    restoreDatabase: vi.fn(),
    resetDatabase: vi.fn(),
  },
}));
vi.mock("../../shared/backupReminder", () => ({ createVerifiedBackup: vi.fn() }));

const exportCases: Array<{
  format: ExportFormat;
  defaultPath: string;
  filterName: string;
  extension: string;
  apiMethod: "exportTransactionsCsv" | "exportTransactionsOfx" | "exportTransactionsPdf";
}> = [
  {
    format: "csv",
    defaultPath: "transacoes.csv",
    filterName: "Planilha CSV",
    extension: "csv",
    apiMethod: "exportTransactionsCsv",
  },
  {
    format: "ofx",
    defaultPath: "transacoes.ofx",
    filterName: "Arquivo OFX",
    extension: "ofx",
    apiMethod: "exportTransactionsOfx",
  },
  {
    format: "pdf",
    defaultPath: "transacoes.pdf",
    filterName: "Relatório PDF",
    extension: "pdf",
    apiMethod: "exportTransactionsPdf",
  },
];

describe("desktopDataOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each(exportCases)("exportTransactions($format)", (testCase) => {
    it("uses the matching dialog format and exports with an empty filter", async () => {
      dialogMocks.save.mockResolvedValue(`C:\\exports\\${testCase.defaultPath}`);
      vi.mocked(api[testCase.apiMethod]).mockResolvedValue(17);

      await expect(exportTransactions(testCase.format)).resolves.toEqual({ status: "success", value: 17 });
      expect(dialogMocks.save).toHaveBeenCalledWith({
        defaultPath: testCase.defaultPath,
        filters: [{ name: testCase.filterName, extensions: [testCase.extension] }],
      });
      expect(api[testCase.apiMethod]).toHaveBeenCalledWith(`C:\\exports\\${testCase.defaultPath}`, {});
    });
  });

  it("returns cancellation without calling an export API", async () => {
    dialogMocks.save.mockResolvedValue(null);

    await expect(exportTransactions("csv")).resolves.toEqual({ status: "cancelled" });
    expect(api.exportTransactionsCsv).not.toHaveBeenCalled();
    expect(api.exportTransactionsOfx).not.toHaveBeenCalled();
    expect(api.exportTransactionsPdf).not.toHaveBeenCalled();
  });

  it("propagates export errors unchanged", async () => {
    const error = new Error("falha ao escrever");
    dialogMocks.save.mockResolvedValue("transacoes.ofx");
    vi.mocked(api.exportTransactionsOfx).mockRejectedValue(error);

    await expect(exportTransactions("ofx")).rejects.toBe(error);
  });

  it("creates and returns a verified database backup", async () => {
    const verified = { reminderRecorded: true };
    dialogMocks.save.mockResolvedValue("C:\\backups\\lumen.db");
    vi.mocked(createVerifiedBackup).mockResolvedValue(verified);

    await expect(createDatabaseBackup()).resolves.toEqual({ status: "success", value: verified });
    expect(dialogMocks.save).toHaveBeenCalledWith({
      defaultPath: "lumen-backup.db",
      filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
    });
    expect(createVerifiedBackup).toHaveBeenCalledWith("C:\\backups\\lumen.db");
  });

  it("does not start a backup when the save dialog is cancelled", async () => {
    dialogMocks.save.mockResolvedValue(null);

    await expect(createDatabaseBackup()).resolves.toEqual({ status: "cancelled" });
    expect(createVerifiedBackup).not.toHaveBeenCalled();
  });

  it("propagates verified backup errors unchanged", async () => {
    const error = new Error("backup inválido");
    dialogMocks.save.mockResolvedValue("lumen.db");
    vi.mocked(createVerifiedBackup).mockRejectedValue(error);

    await expect(createDatabaseBackup()).rejects.toBe(error);
  });

  it("chooses a restore file and exposes only its basename separately", async () => {
    dialogMocks.open.mockResolvedValue("C:\\private\\copies\\lumen-backup.db");

    await expect(chooseBackupToRestore()).resolves.toEqual({
      status: "success",
      value: {
        path: "C:\\private\\copies\\lumen-backup.db",
        fileName: "lumen-backup.db",
      },
    });
    expect(dialogMocks.open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
    });
  });

  it("returns cancellation when no restore file is selected", async () => {
    dialogMocks.open.mockResolvedValue(null);

    await expect(chooseBackupToRestore()).resolves.toEqual({ status: "cancelled" });
  });

  it("propagates restore dialog errors unchanged", async () => {
    const error = new Error("seletor indisponível");
    dialogMocks.open.mockRejectedValue(error);

    await expect(chooseBackupToRestore()).rejects.toBe(error);
  });

  it("prepares restore and reset through their backend commands", async () => {
    vi.mocked(api.restoreDatabase).mockResolvedValue(undefined);
    vi.mocked(api.resetDatabase).mockResolvedValue(undefined);

    await expect(prepareDatabaseRestore("C:\\private\\backup.db")).resolves.toBeUndefined();
    await expect(prepareDatabaseReset()).resolves.toBeUndefined();

    expect(api.restoreDatabase).toHaveBeenCalledWith("C:\\private\\backup.db");
    expect(api.resetDatabase).toHaveBeenCalledOnce();
  });
});
