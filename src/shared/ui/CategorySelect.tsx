import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
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
import { Select } from "./Select";

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
  /** Renderiza o select compacto (sem ícone/tooltip/busca). Útil em tabelas densas. */
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
  let current = id ? categories.find((c) => c.id === id) : undefined;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    d += 1;
    current = categories.find((c) => c.id === current!.parentId);
    if (d > 16) break;
  }
  return d;
}

const KIND_FALLBACK_ICON: Record<CategoryKind, LucideIcon> = {
  income: CirclePlus,
  expense: Receipt,
  investment: Landmark,
  transfer: ArrowLeftRight,
};

export function CategoryIcon({ name, kind, size = 14 }: { name?: string; kind?: CategoryKind; size?: number }) {
  const Icon = (name ? ICONS[name] : undefined) ?? (kind ? KIND_FALLBACK_ICON[kind] : Tag);
  return <Icon size={size} strokeWidth={2} aria-hidden />;
}

export function CategorySelect({
  value,
  onChange,
  categories,
  kind,
  movementType,
  allowEmpty = true,
  emptyLabel = "Sem categoria",
  disabled,
  id,
  native,
  className,
  ...rest
}: Props) {
  const ariaLabel = rest["aria-label"] ?? "Categoria";

  const filtered = useMemo(() => {
    const kinds = kind
      ? Array.isArray(kind)
        ? kind
        : [kind]
      : movementType
        ? kindForMovement(movementType)
        : undefined;
    const list = kinds ? categories.filter((c) => kinds.includes(c.kind)) : categories.slice();
    return list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [categories, kind, movementType]);

  const groups = useMemo(() => {
    const map = new Map<CategoryKind, Category[]>();
    for (const c of filtered) {
      const key = c.kind;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return ORDER.filter((k) => map.has(k)).map((k) => ({ kind: k, items: map.get(k)! }));
  }, [filtered]);

  const selected = useMemo(() => categories.find((c) => c.id === value), [categories, value]);

  // Category selects use the rich dropdown by default so color and icon metadata
  // remain visible in import, transactions, and the other category surfaces.
  if (native) {
    return (
      <Select
        className={"category-select" + (className ? " " + className : "")}
        value={value ?? ""}
        onChange={(nextValue) => onChange(nextValue || undefined)}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel}
        options={[
          ...(allowEmpty ? [{ value: "", label: emptyLabel }] : []),
          ...groups.flatMap((group) =>
            group.items.map((category) => ({
              value: category.id,
              label: `${category.parentId ? "— " : ""}${category.name}`,
            })),
          ),
        ]}
      />
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
  value,
  onChange,
  groups,
  selected,
  categories,
  allowEmpty,
  emptyLabel,
  disabled,
  id,
  ariaLabel,
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [panelStyle, setPanelStyle] = useState<CSSProperties>();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node) &&
        !panelRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
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

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(undefined);
      return;
    }

    const updatePosition = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;

      const edge = 12;
      const gap = 6;
      const preferredHeight = 360;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Math.min(Math.max(trigger.width, 280), viewportWidth - edge * 2);
      const left = Math.max(edge, Math.min(trigger.left, viewportWidth - width - edge));
      const spaceBelow = viewportHeight - trigger.bottom - gap - edge;
      const spaceAbove = trigger.top - gap - edge;
      const placeAbove = spaceBelow < 240 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(120, Math.min(preferredHeight, placeAbove ? spaceAbove : spaceBelow));

      setPanelStyle({
        position: "fixed",
        top: placeAbove ? "auto" : trigger.bottom + gap,
        bottom: placeAbove ? viewportHeight - trigger.top + gap : "auto",
        left,
        right: "auto",
        width,
        maxHeight: availableHeight,
      });
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updatePosition);
    if (rootRef.current) resizeObserver?.observe(rootRef.current);
    document.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    updatePosition();

    return () => {
      resizeObserver?.disconnect();
      document.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (c: Category) => !normalizedQuery || c.name.toLowerCase().includes(normalizedQuery);
  const totalItems = groups.reduce((n, g) => n + g.items.filter(matches).length, 0);

  function select(id?: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function focusListOption(position: "first" | "last" | "next" | "previous", current?: HTMLElement) {
    const options = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (options.length === 0) return;
    if (!current || position === "first" || position === "last") {
      options[position === "last" ? options.length - 1 : 0]?.focus();
      return;
    }
    const currentIndex = options.indexOf(current);
    const nextIndex =
      position === "next" ? Math.min(currentIndex + 1, options.length - 1) : Math.max(currentIndex - 1, 0);
    options[nextIndex]?.focus();
  }

  function handleOptionKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusListOption(
        e.key === "ArrowDown" ? "next" : e.key === "ArrowUp" ? "previous" : e.key === "Home" ? "first" : "last",
        e.currentTarget,
      );
    }
  }

  return (
    <div
      className={"category-dropdown" + (open ? " open" : "") + (className ? " " + className : "")}
      data-kind={selected?.kind}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="category-dropdown-trigger"
        disabled={disabled}
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={selected ? `${selected.name}${selected.icon ? " · " + selected.icon : ""}` : emptyLabel}
      >
        {selected ? (
          <span className="category-dropdown-value" data-kind={selected.kind}>
            <span
              className="category-dropdown-swatch"
              data-kind={selected.kind}
              style={selected.color ? { background: selected.color } : undefined}
              aria-hidden
            />
            <span className="category-dropdown-icon" data-kind={selected.kind} aria-hidden>
              <CategoryIcon name={selected.icon} kind={selected.kind} />
            </span>
            <span className="category-dropdown-name">{selected.name}</span>
          </span>
        ) : (
          <span className="category-dropdown-placeholder">{emptyLabel}</span>
        )}
        <span className="category-dropdown-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <div className="category-dropdown-panel category-dropdown-panel--portal" ref={panelRef} style={panelStyle}>
            <div className="category-dropdown-search">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    focusListOption(e.key === "ArrowDown" ? "first" : "last");
                  }
                }}
                placeholder="Buscar categoria…"
                aria-label="Buscar categoria"
              />
            </div>
            <div className="category-dropdown-list" id={listboxId} role="listbox" aria-label={ariaLabel}>
              {allowEmpty && totalItems >= 0 && (
                <button
                  type="button"
                  className={"category-dropdown-option" + (!value ? " selected" : "")}
                  onClick={() => select(undefined)}
                  onKeyDown={handleOptionKeyDown}
                  role="option"
                  aria-selected={!value}
                >
                  <span className="category-dropdown-icon category-dropdown-icon-muted">
                    <Tag size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="category-dropdown-placeholder">{emptyLabel}</span>
                </button>
              )}
              {totalItems === 0 && allowEmpty === false && (
                <p className="category-dropdown-empty">Nenhuma categoria encontrada.</p>
              )}
              {groups.map((g) => {
                const visible = g.items.filter(matches);
                if (visible.length === 0) return null;
                const groupLabelId = `${listboxId}-${g.kind}`;
                return (
                  <div
                    key={g.kind}
                    className={`category-dropdown-group category-dropdown-group--${g.kind}`}
                    data-kind={g.kind}
                    role="group"
                    aria-labelledby={groupLabelId}
                  >
                    <div id={groupLabelId} className="category-dropdown-group-label">
                      {KIND_LABEL[g.kind]}
                    </div>
                    {visible.map((c) => {
                      const d = depth(categories, c.id);
                      const parent = c.parentId ? categories.find((category) => category.id === c.parentId) : undefined;
                      const isSelected = c.id === value;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={`category-dropdown-option category-dropdown-option--${c.kind}${
                            c.parentId ? " category-dropdown-option--child" : ""
                          }${isSelected ? " selected" : ""}`}
                          data-kind={c.kind}
                          data-depth={d}
                          style={{ "--category-depth": d } as CSSProperties}
                          onClick={() => select(c.id)}
                          onKeyDown={handleOptionKeyDown}
                          title={parent ? `${c.name} · Subcategoria de ${parent.name}` : c.name}
                          role="option"
                          aria-selected={isSelected}
                        >
                          <span
                            className="category-dropdown-swatch"
                            data-kind={c.kind}
                            style={c.color ? { background: c.color } : undefined}
                            aria-hidden
                          />
                          {c.parentId && (
                            <span className="category-dropdown-branch" aria-hidden>
                              <span className="category-dropdown-branch-line" />
                              <span className="category-dropdown-branch-corner" />
                            </span>
                          )}
                          <span className="category-dropdown-icon" data-kind={c.kind} aria-hidden>
                            <CategoryIcon name={c.icon} kind={c.kind} />
                          </span>
                          <span className="category-dropdown-option-copy">
                            <span className="category-dropdown-name">{c.name}</span>
                            {parent && <small className="category-dropdown-parent-label">em {parent.name}</small>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
