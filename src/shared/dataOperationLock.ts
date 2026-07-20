export type DataOperation = "export" | "backup" | "restore" | "reset";

let activeOperation: DataOperation | null = null;

export async function runExclusiveDataOperation<T>(operation: DataOperation, task: () => Promise<T>): Promise<T> {
  if (activeOperation) {
    throw new Error("Outra operação de dados já está em andamento.");
  }

  activeOperation = operation;
  try {
    return await task();
  } finally {
    activeOperation = null;
  }
}

export function resetDataOperationLockForTests() {
  activeOperation = null;
}
