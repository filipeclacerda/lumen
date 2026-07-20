import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CornerDownLeft, CreditCard, Search, Tags } from "lucide-react";
import { api } from "../api";
import { money, normalizeText, shortDate } from "../format";
import { navigation } from "../navigation";
import { OverlayDialog } from "./OverlayDialog";
import type { CategorizationRule, Category, Transaction } from "../types";

const emptyTransactions: Transaction[] = [];
const emptyCategories: Category[] = [];
const emptyRules: CategorizationRule[] = [];

export const OPEN_COMMAND_PALETTE_EVENT = "lumen:open-command-palette";

type Entry =
  | { kind: "route"; to: string; label: string; icon: ComponentType<{ size?: number }> }
  | { kind: "transaction"; transaction: Transaction }
  | { kind: "category"; category: Category }
  | { kind: "rule"; rule: CategorizationRule };
export function CommandPalette() {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const openPalette = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openPalette);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQuery("");
      setDebounced("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const searchActive = debounced.trim().length >= 3;
  const { data: transactions = emptyTransactions } = useQuery({
    queryKey: ["command-palette-transactions", debounced],
    queryFn: () => api.listTransactions({ search: debounced.trim(), limit: 8 }).then((p) => p.items),
    enabled: open && searchActive,
  });
  const { data: categories = emptyCategories } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
    enabled: open,
  });
  const { data: rules = emptyRules } = useQuery({
    queryKey: ["rules"],
    queryFn: api.rules,
    enabled: open && searchActive,
  });
  const entries = useMemo<Entry[]>(() => {
    const n = normalizeText(query.trim());
    const routes = navigation
      .filter((r) => !n || normalizeText(r.label).includes(n))
      .map((r) => ({ kind: "route" as const, to: r.to, label: r.label, icon: r.icon }));
    const cats = n
      ? categories
          .filter((c) => normalizeText(c.name).includes(n))
          .slice(0, 8)
          .map((category) => ({ kind: "category" as const, category }))
      : [];
    if (!searchActive) return [...routes, ...cats];
    return [
      ...routes,
      ...cats,
      ...rules
        .filter((r) => normalizeText(`${r.name} ${r.pattern}`).includes(n))
        .slice(0, 5)
        .map((rule) => ({ kind: "rule" as const, rule })),
      ...transactions.map((transaction) => ({ kind: "transaction" as const, transaction })),
    ];
  }, [categories, query, rules, searchActive, transactions]);
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(entries.length - 1, 0)));
  }, [entries.length]);
  useEffect(() => {
    const option = document.getElementById(`palette-option-${active}`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const select = (e: Entry) => {
    if (e.kind === "route") navigate(e.to);
    else if (e.kind === "category") navigate(`/categories?q=${encodeURIComponent(e.category.name)}`);
    else if (e.kind === "rule") navigate(`/categories?q=${encodeURIComponent(e.rule.name)}`);
    else navigate(`/transactions?q=${encodeURIComponent(e.transaction.description)}`);
    setOpen(false);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setActive((i) =>
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? Math.max(entries.length - 1, 0)
            : e.key === "ArrowDown"
              ? Math.min(i + 1, Math.max(entries.length - 1, 0))
              : Math.max(i - 1, 0),
      );
    } else if (e.key === "Enter" && entries[active]) {
      e.preventDefault();
      select(entries[active]);
    }
  };
  if (!open) return null;
  const activeId = entries[active] ? `palette-option-${active}` : undefined;
  return (
    <OverlayDialog
      title="Busca rápida"
      className="command-palette"
      onClose={() => setOpen(false)}
      initialFocus={inputRef}
    >
      <div className="command-palette-input">
        <Search size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Buscar ou navegar…"
          aria-label="Buscar ou navegar"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="command-palette-options"
          aria-activedescendant={activeId}
        />
        <kbd>Ctrl K</kbd>
      </div>
      <div id="command-palette-options" className="command-palette-list" role="listbox" aria-label="Resultados">
        {!entries.length && (
          <div className="command-palette-empty">
            <Search size={20} aria-hidden="true" />
            <b>Nenhum resultado encontrado</b>
            <span>Tente buscar por outra palavra.</span>
          </div>
        )}
        {entries.map((entry, i) => {
          const label =
            entry.kind === "route"
              ? entry.label
              : entry.kind === "category"
                ? entry.category.name
                : entry.kind === "rule"
                  ? entry.rule.name
                  : entry.transaction.description;
          const Icon = entry.kind === "route" ? entry.icon : entry.kind === "transaction" ? CreditCard : Tags;
          const detail =
            entry.kind === "transaction"
              ? shortDate(entry.transaction.date)
              : entry.kind === "category"
                ? "Categoria"
                : entry.kind === "rule"
                  ? "Regra de categorização"
                  : null;
          return (
            <div
              id={`palette-option-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              key={`${entry.kind}-${label}-${i}`}
              className={`command-palette-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => select(entry)}
            >
              <Icon size={16} />
              <span className="command-palette-tx">
                <b>{label}</b>
                {detail && <small>{detail}</small>}
              </span>
              {entry.kind === "transaction" && (
                <span className={entry.transaction.amountInCents > 0 ? "positive" : ""}>
                  {money(entry.transaction.amountInCents)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="command-palette-footer" aria-hidden="true">
        <span>
          <kbd>
            <ArrowUp size={12} />
          </kbd>
          <kbd>
            <ArrowDown size={12} />
          </kbd>
          navegar
        </span>
        <span>
          <kbd>
            <CornerDownLeft size={12} />
          </kbd>
          abrir
        </span>
        <span>
          <kbd>Esc</kbd> fechar
        </span>
      </div>
    </OverlayDialog>
  );
}
