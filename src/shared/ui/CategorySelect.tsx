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

const ORDER: CategoryKind[] = ["income", "expense", "investment", "transfer"];
const PAGE_SIZE = 3;
const FAMILY_CHILDREN_PAGE_SIZE = 2;
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

function normalizeCategorySearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function categoryPath(categories: Category[], category: Category): string {
  const path = [category.name];
  const visited = new Set([category.id]);
  let parentId = category.parentId;

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = categories.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    path.unshift(parent.name);
    parentId = parent.parentId;
  }

  return path.join(" › ");
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
  const [browseMode, setBrowseMode] = useState<"roots" | "family">("roots");
  const [familyId, setFamilyId] = useState<string>();
  const [rootPage, setRootPage] = useState(0);
  const [familyPage, setFamilyPage] = useState(0);
  const [searchPage, setSearchPage] = useState(0);
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
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
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
    if (!open) return;

    setQuery("");
    setBrowseMode("roots");
    setFamilyId(undefined);
    setRootPage(0);
    setFamilyPage(0);
    setSearchPage(0);

    const focusFrame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(focusFrame);
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

  const allItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const filteredIds = useMemo(() => new Set(allItems.map((category) => category.id)), [allItems]);
  const roots = useMemo(
    () => allItems.filter((category) => !category.parentId || !filteredIds.has(category.parentId)),
    [allItems, filteredIds],
  );
  const selectedRootId = useMemo(() => {
    let current = selected;
    const visited = new Set<string>();
    while (current?.parentId && filteredIds.has(current.parentId) && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      current = allItems.find((category) => category.id === current!.parentId);
    }
    return current?.id;
  }, [allItems, filteredIds, selected]);
  const orderedRoots = useMemo(
    () =>
      selectedRootId
        ? [...roots].sort((a, b) => Number(b.id === selectedRootId) - Number(a.id === selectedRootId))
        : roots,
    [roots, selectedRootId],
  );
  const family = familyId ? allItems.find((category) => category.id === familyId) : undefined;
  const familyChildren = useMemo(
    () => (family ? allItems.filter((category) => category.parentId === family.id) : []),
    [allItems, family],
  );
  const normalizedQuery = normalizeCategorySearch(query);
  const searchResults = useMemo(
    () =>
      normalizedQuery
        ? allItems.filter((category) =>
            normalizeCategorySearch(categoryPath(categories, category)).includes(normalizedQuery),
          )
        : [],
    [allItems, categories, normalizedQuery],
  );
  const showClearOption = allowEmpty && Boolean(value);
  const rootOptionsPerPage = showClearOption ? PAGE_SIZE - 1 : PAGE_SIZE;
  const rootPageCount = Math.max(1, Math.ceil(orderedRoots.length / rootOptionsPerPage));
  const familyPageCount = Math.max(1, Math.ceil(familyChildren.length / FAMILY_CHILDREN_PAGE_SIZE));
  const searchPageCount = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
  const safeRootPage = Math.min(rootPage, rootPageCount - 1);
  const safeFamilyPage = Math.min(familyPage, familyPageCount - 1);
  const safeSearchPage = Math.min(searchPage, searchPageCount - 1);
  const visibleRoots = orderedRoots.slice(safeRootPage * rootOptionsPerPage, (safeRootPage + 1) * rootOptionsPerPage);
  const visibleFamilyChildren = familyChildren.slice(
    safeFamilyPage * FAMILY_CHILDREN_PAGE_SIZE,
    (safeFamilyPage + 1) * FAMILY_CHILDREN_PAGE_SIZE,
  );
  const visibleSearchResults = searchResults.slice(safeSearchPage * PAGE_SIZE, (safeSearchPage + 1) * PAGE_SIZE);

  function select(id?: string) {
    setOpen(false);
    onChange(id);
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }

  function openFamily(id: string) {
    setFamilyId(id);
    setFamilyPage(0);
    setBrowseMode("family");
  }

  function focusListOption(position: "first" | "last" | "next" | "previous", current?: HTMLElement) {
    const options = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>(".category-dropdown-list button:not(:disabled)") ?? []),
    ];
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

  function renderCategoryOption(category: Category, displayPath = false) {
    const d = depth(categories, category.id);
    const parent = category.parentId ? categories.find((candidate) => candidate.id === category.parentId) : undefined;
    const path = categoryPath(categories, category);
    const isSelected = category.id === value;

    return (
      <button
        key={category.id}
        type="button"
        className={`category-dropdown-option category-dropdown-option--${category.kind}${
          category.parentId ? " category-dropdown-option--child" : ""
        }${isSelected ? " selected" : ""}`}
        data-kind={category.kind}
        data-depth={d}
        style={{ "--category-depth": d } as CSSProperties}
        onClick={() => select(category.id)}
        onKeyDown={handleOptionKeyDown}
        title={path}
        role="option"
        aria-label={displayPath ? path : category.name}
        aria-selected={isSelected}
      >
        <span
          className="category-dropdown-swatch"
          data-kind={category.kind}
          style={category.color ? { background: category.color } : undefined}
          aria-hidden
        />
        {category.parentId && (
          <span className="category-dropdown-branch" aria-hidden>
            <span className="category-dropdown-branch-line" />
            <span className="category-dropdown-branch-corner" />
          </span>
        )}
        <span className="category-dropdown-icon" data-kind={category.kind} aria-hidden>
          <CategoryIcon name={category.icon} kind={category.kind} />
        </span>
        <span className="category-dropdown-option-copy">
          <span className="category-dropdown-name">{displayPath ? path : category.name}</span>
          {!displayPath && parent && <small className="category-dropdown-parent-label">em {parent.name}</small>}
        </span>
      </button>
    );
  }

  function renderPagination(page: number, pageCount: number, setPage: (nextPage: number) => void, label: string) {
    if (pageCount <= 1) return null;
    return (
      <div className="category-dropdown-pagination" aria-label={label}>
        <button
          type="button"
          className="category-dropdown-pagination-button"
          onClick={() => setPage(Math.max(0, page - 1))}
          onKeyDown={handleOptionKeyDown}
          disabled={page === 0}
          aria-label={`${label}: página anterior`}
        >
          ‹
        </button>
        <span>
          Página {page + 1} de {pageCount}
        </span>
        <button
          type="button"
          className="category-dropdown-pagination-button"
          onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
          onKeyDown={handleOptionKeyDown}
          disabled={page === pageCount - 1}
          aria-label={`${label}: próxima página`}
        >
          ›
        </button>
      </div>
    );
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
        onMouseDown={(e) => {
          if (!open) e.preventDefault();
        }}
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
          <div
            className="category-dropdown-panel category-dropdown-panel--portal"
            ref={panelRef}
            style={panelStyle ?? { position: "fixed", top: 0, left: 0, visibility: "hidden" }}
          >
            <div className="category-dropdown-search">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchPage(0);
                }}
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
              {!normalizedQuery && browseMode === "roots" && showClearOption && (
                <button
                  type="button"
                  className="category-dropdown-option"
                  onClick={() => select(undefined)}
                  onKeyDown={handleOptionKeyDown}
                  role="option"
                  aria-selected={false}
                >
                  <span className="category-dropdown-icon category-dropdown-icon-muted">
                    <Tag size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="category-dropdown-placeholder">{emptyLabel}</span>
                </button>
              )}

              {!normalizedQuery && browseMode === "roots" && (
                <>
                  <div className="category-dropdown-group" role="group" aria-label="Famílias de categorias">
                    {visibleRoots.map((root) => {
                      const childCount = allItems.filter((category) => category.parentId === root.id).length;
                      return (
                        <button
                          key={root.id}
                          type="button"
                          className={`category-dropdown-option category-dropdown-option--${root.kind}`}
                          data-kind={root.kind}
                          onClick={() => openFamily(root.id)}
                          onKeyDown={handleOptionKeyDown}
                          title={root.name}
                          role="option"
                          aria-label={root.name}
                          aria-selected={false}
                        >
                          <span
                            className="category-dropdown-swatch"
                            data-kind={root.kind}
                            style={root.color ? { background: root.color } : undefined}
                            aria-hidden
                          />
                          <span className="category-dropdown-icon" data-kind={root.kind} aria-hidden>
                            <CategoryIcon name={root.icon} kind={root.kind} />
                          </span>
                          <span className="category-dropdown-option-copy">
                            <span className="category-dropdown-name">{root.name}</span>
                            <small className="category-dropdown-parent-label">
                              {childCount === 1 ? "1 subcategoria" : `${childCount} subcategorias`}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {orderedRoots.length === 0 && (
                    <p className="category-dropdown-empty">Nenhuma categoria encontrada.</p>
                  )}
                  {renderPagination(safeRootPage, rootPageCount, setRootPage, "Famílias")}
                </>
              )}

              {!normalizedQuery && browseMode === "family" && (
                <>
                  <button
                    type="button"
                    className="category-dropdown-option category-dropdown-option--back"
                    onKeyDown={handleOptionKeyDown}
                    onClick={() => setBrowseMode("roots")}
                  >
                    <span aria-hidden>‹</span>
                    <span className="category-dropdown-name">Todas as famílias</span>
                  </button>
                  {family && (
                    <div
                      className={`category-dropdown-group category-dropdown-group--${family.kind}`}
                      data-kind={family.kind}
                      role="group"
                      aria-label={`Família ${family.name}`}
                    >
                      <div className="category-dropdown-group-label">{family.name}</div>
                      {renderCategoryOption(family)}
                      {visibleFamilyChildren.map((category) => renderCategoryOption(category))}
                    </div>
                  )}
                  {renderPagination(safeFamilyPage, familyPageCount, setFamilyPage, "Subcategorias")}
                </>
              )}

              {normalizedQuery && (
                <>
                  {visibleSearchResults.map((category) => renderCategoryOption(category, true))}
                  {searchResults.length === 0 && (
                    <p className="category-dropdown-empty">Nenhuma categoria encontrada.</p>
                  )}
                  {renderPagination(safeSearchPage, searchPageCount, setSearchPage, "Resultados")}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
