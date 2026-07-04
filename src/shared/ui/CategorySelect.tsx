import { useMemo } from "react";
import type { Category, CategoryKind, MovementType } from "../types";

type Props = {
  value?: string;
  onChange: (id?: string) => void;
  categories: Category[];
  /**
   * Quando informado, lista apenas categorias desse(s) tipo(s). Caso contrário,
   * agrupa por kind em <optgroup>. Para o editor de regras, use `movementType`
   * — ele traduza income/expense/transfer/any para os kinds correspondentes.
   */
  kind?: CategoryKind | CategoryKind[];
  movementType?: MovementType;
  allowEmpty?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
};

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Receitas",
  expense: "Despesas",
  investment: "Investimentos",
  transfer: "Transferências",
};

const ORDER: CategoryKind[] = ["income", "expense", "investment", "transfer"];

function kindForMovement(movementType: MovementType): CategoryKind[] | undefined {
  if (movementType === "income") return ["income"];
  if (movementType === "expense") return ["expense"];
  if (movementType === "transfer") return ["transfer"];
  return undefined;
}

export function CategorySelect({
  value, onChange, categories, kind, movementType, allowEmpty = true,
  emptyLabel = "Sem categoria", disabled, id, ...rest
}: Props) {
  const filtered = useMemo(() => {
    const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : (movementType ? kindForMovement(movementType) : undefined);
    const list = kinds
      ? categories.filter(c => kinds.includes(c.kind))
      : categories.slice();
    return list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [categories, kind, movementType]);

  const groups = useMemo(() => {
    const map = new Map<CategoryKind, Category[]>();
    for (const c of filtered) {
      const key = c.kind;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return ORDER.filter(k => map.has(k)).map(k => ({ kind: k, items: map.get(k)! }));
  }, [filtered]);

  return (
    <select
      className="category-select"
      value={value ?? ""}
      onChange={e => onChange(e.target.value || undefined)}
      disabled={disabled}
      id={id}
      aria-label={rest["aria-label"]}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {groups.length === 1
        ? groups[0].items.map(c => (
            <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>
          ))
        : groups.map(g => (
            <optgroup key={g.kind} label={KIND_LABEL[g.kind]}>
              {g.items.map(c => (
                <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>
              ))}
            </optgroup>
          ))}
    </select>
  );
}
