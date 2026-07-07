import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Bus,
  Car,
  CirclePlus,
  CreditCard,
  Fuel,
  GraduationCap,
  House,
  Landmark,
  Lightbulb,
  Play,
  Receipt,
  Shield,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Tag,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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
  /** Renderiza o select nativo (sem ícone/tooltip/busca). Útil em tabelas densas. */
  native?: boolean;
  "aria-label"?: string;
  className?: string;
};

const KIND_LABEL: Record<CategoryKind, string> = {
  income: "Receitas",
  expense: "Despesas",
  investment: "Investimentos",
  transfer: "Transferências",
};

const ORDER: CategoryKind[] = ["income", "expense", "investment", "transfer"];
const ICONS: Record<string, LucideIcon> = {
  "arrow-left-right": ArrowLeftRight,
  "arrow-up-right": ArrowUpRight,
  bus: Bus,
  car: Car,
  "circle-plus": CirclePlus,
  "credit-card": CreditCard,
  fuel: Fuel,
  "graduation-cap": GraduationCap,
  house: House,
  landmark: Landmark,
  lightbulb: Lightbulb,
  play: Play,
  receipt: Receipt,
  shield: Shield,
  "shopping-bag": ShoppingBag,
  "shopping-basket": ShoppingBasket,
  smartphone: Smartphone,
  sparkles: Sparkles,
  utensils: Utensils,
  wallet: Wallet,
};

function kindForMovement(movementType: MovementType): CategoryKind[] | undefined {
  if (movementType === "income") return ["income"];
  if (movementType === "expense") return ["expense"];
  if (movementType === "transfer") return ["transfer"];
  return undefined;
}

function depth(categories: Category[], id?: string): number {
  let d = 0;
  let current = id ? categories.find(c => c.id === id) : undefined;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    d += 1;
    current = categories.find(c => c.id === current!.parentId);
    if (d > 16) break;
  }
  return d;
}

export function CategoryIcon({ name, size = 14 }: { name?: string; size?: number }) {
  if (!name) return null;
  const Icon = ICONS[name] ?? Tag;
  return <Icon size={size} strokeWidth={2} aria-hidden />;
}

export function CategorySelect({
  value, onChange, categories, kind, movementType, allowEmpty = true,
  emptyLabel = "Sem categoria", disabled, id, native, className, ...rest
}: Props) {
  const ariaLabel = rest["aria-label"] ?? "Categoria";

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

  const selected = useMemo(() => categories.find(c => c.id === value), [categories, value]);

  if (native) {
    return (
      <select
        className={"category-select" + (className ? " " + className : "")}
        value={value ?? ""}
        onChange={e => onChange(e.target.value || undefined)}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
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

  return (
    <CategoryDropdown
      value={value}
      onChange={onChange}
      groups={groups}
      selected={selected}
      categories={categories}
      allowEmpty={allowEmpty}
      emptyLabel={emptyLabel}
      disabled={disabled}
      id={id}
      ariaLabel={ariaLabel}
      className={className}
    />
  );
}

type DropdownProps = {
  value?: string;
  onChange: (id?: string) => void;
  groups: { kind: CategoryKind; items: Category[] }[];
  selected?: Category;
  categories: Category[];
  allowEmpty: boolean;
  emptyLabel: string;
  disabled?: boolean;
  id?: string;
  ariaLabel: string;
  className?: string;
};

function CategoryDropdown({
  value, onChange, groups, selected, categories, allowEmpty, emptyLabel,
  disabled, id, ariaLabel, className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (c: Category) => !normalizedQuery || c.name.toLowerCase().includes(normalizedQuery);
  const totalItems = groups.reduce((n, g) => n + g.items.filter(matches).length, 0);

  function select(id?: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div
      className={"category-dropdown" + (open ? " open" : "") + (className ? " " + className : "")}
      ref={rootRef}
    >
      <button
        type="button"
        className="category-dropdown-trigger"
        disabled={disabled}
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(o => !o)}
        title={selected ? `${selected.name}${selected.icon ? " · " + selected.icon : ""}` : emptyLabel}
      >
        {selected ? (
          <span className="category-dropdown-value">
            {selected.color && <span className="category-dropdown-swatch" style={{ background: selected.color }} />}
            {selected.icon && <span className="category-dropdown-icon"><CategoryIcon name={selected.icon} /></span>}
            <span className="category-dropdown-name">{selected.name}</span>
          </span>
        ) : (
          <span className="category-dropdown-placeholder">{emptyLabel}</span>
        )}
        <span className="category-dropdown-caret" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="category-dropdown-panel" role="listbox">
          <div className="category-dropdown-search">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar categoria…"
              aria-label="Buscar categoria"
            />
          </div>
          <div className="category-dropdown-list">
            {allowEmpty && totalItems >= 0 && (
              <button
                type="button"
                className={"category-dropdown-option" + (!value ? " selected" : "")}
                onClick={() => select(undefined)}
              >
                <span className="category-dropdown-placeholder">{emptyLabel}</span>
              </button>
            )}
            {totalItems === 0 && allowEmpty === false && (
              <p className="category-dropdown-empty">Nenhuma categoria encontrada.</p>
            )}
            {groups.map(g => {
              const visible = g.items.filter(matches);
              if (visible.length === 0) return null;
              return (
                <div key={g.kind} className="category-dropdown-group">
                  <div className="category-dropdown-group-label">{KIND_LABEL[g.kind]}</div>
                  {visible.map(c => {
                    const d = depth(categories, c.parentId);
                    const isSelected = c.id === value;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={"category-dropdown-option" + (isSelected ? " selected" : "")}
                        style={{ paddingLeft: 8 + d * 14 }}
                        onClick={() => select(c.id)}
                        title={c.name}
                        role="option"
                        aria-selected={isSelected}
                      >
                        {c.color && <span className="category-dropdown-swatch" style={{ background: c.color }} />}
                        {c.icon && <span className="category-dropdown-icon"><CategoryIcon name={c.icon} /></span>}
                        <span className="category-dropdown-name">{c.name}</span>
                        {c.kind && <small className="category-dropdown-kind">{KIND_LABEL[c.kind]}</small>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
