import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../../shared/api";
import { createVerifiedBackup } from "../../shared/backupReminder";
import { runExclusiveDataOperation } from "../../shared/dataOperationLock";

export type ExportFormat = "csv" | "ofx" | "pdf";

export type FileOperationResult<T> = { status: "cancelled" } | { status: "success"; value: T };

type ExportOption = {
  defaultPath: string;
  filterName: string;
  extension: ExportFormat;
  run: (path: string) => Promise<number>;
};

const exportOptions: Record<ExportFormat, ExportOption> = {
  csv: {
    defaultPath: "transacoes.csv",
    filterName: "Planilha CSV",
    extension: "csv",
    run: (path) => api.exportTransactionsCsv(path, {}),
  },
  ofx: {
    defaultPath: "transacoes.ofx",
    filterName: "Arquivo OFX",
    extension: "ofx",
    run: (path) => api.exportTransactionsOfx(path, {}),
  },
  pdf: {
    defaultPath: "transacoes.pdf",
    filterName: "Relatório PDF",
    extension: "pdf",
    run: (path) => api.exportTransactionsPdf(path, {}),
  },
};

export async function exportTransactions(format: ExportFormat): Promise<FileOperationResult<number>> {
  const option = exportOptions[format];
  const path = await save({
    defaultPath: option.defaultPath,
    filters: [{ name: option.filterName, extensions: [option.extension] }],
  });
  if (!path) return { status: "cancelled" };

  const count = await runExclusiveDataOperation("export", () => option.run(path));
  return { status: "success", value: count };
}

export async function createDatabaseBackup(): Promise<
  FileOperationResult<Awaited<ReturnType<typeof createVerifiedBackup>>>
> {
  const path = await save({
    defaultPath: "lumen-backup.db",
    filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
  });
  if (!path) return { status: "cancelled" };

  const result = await createVerifiedBackup(path);
  return { status: "success", value: result };
}

export type BackupRestoreSelection = {
  path: string;
  fileName: string;
};

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "backup.db";
}

export async function chooseBackupToRestore(): Promise<FileOperationResult<BackupRestoreSelection>> {
  const path = await open({
    multiple: false,
    filters: [{ name: "Backup do Lumen", extensions: ["db"] }],
  });
  if (!path) return { status: "cancelled" };

  return {
    status: "success",
    value: { path, fileName: fileNameFromPath(path) },
  };
}

export function prepareDatabaseRestore(path: string) {
  return runExclusiveDataOperation("restore", () => api.restoreDatabase(path));
}

export function prepareDatabaseReset() {
  return runExclusiveDataOperation("reset", () => api.resetDatabase());
}
