import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

const importPageMemory = new Map<string, unknown>();

export function clearImportPageMemory() {
  importPageMemory.clear();
}

export function useImportPageMemoryState<T>(key: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    importPageMemory.has(key) ? (importPageMemory.get(key) as T) : initialValue,
  );
  const valueRef = useRef(value);

  const setRememberedValue = useCallback<Dispatch<SetStateAction<T>>>(
    (nextValue) => {
      const resolvedValue =
        typeof nextValue === "function" ? (nextValue as (currentValue: T) => T)(valueRef.current) : nextValue;
      valueRef.current = resolvedValue;
      importPageMemory.set(key, resolvedValue);
      setValue(resolvedValue);
    },
    [key],
  );

  return [value, setRememberedValue];
}
