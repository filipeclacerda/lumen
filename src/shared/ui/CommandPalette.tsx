import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CreditCard,
  FileUp,
  LayoutDashboard,
  Repeat,
  Search,
  Settings,
  Tags,
  Wallet,
  WalletCards,
} from "lucide-react";
import { api } from "../api";
import { money, normalizeText, shortDate } from "../format";
import type { CategorizationRule, Category, Transaction } from "../types";

/// Kept in sync with the sidebar `nav` list in App.tsx — every route the app exposes.
const routes = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard },
  { to: "/transactions", label: "Transações", icon: CreditCard },
  { to: "/recurring", label: "Recorrências", icon: Repeat },
  { to: "/budget", label: "Orçamento", icon: Wallet },
  { to: "/import", label: "Importar", icon: FileUp },
  { to: "/accounts", label: "Contas e cartões", icon: WalletCards },
  { to: "/categories", label: "Categorias e regras", icon: Tags },
  { to: "/reports", label: "Relatórios", icon: BarChart3 },
  { to: "/settings", label: "Configurações", icon: Settings },
] as const;

type PaletteEntry =
  | { kind: "route"; to: string; label: string; icon: typeof LayoutDashboard }
  | { kind: "transaction"; transaction: Transaction }
  | { kind: "category"; category: Category }
  | { kind: "rule"; rule: CategorizationRule };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setActiveIndex(0);
      // Focus after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounce the transaction search so typing doesn't spam the backend with a query per keystroke.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const searchActive = debouncedQuery.trim().length >= 3;
  const { data: transactionResults = [] } = useQuery({
    queryKey: ["command-palette-transactions", debouncedQuery],
    queryFn: () => api.listTransactions({ search: debouncedQuery.trim(), limit: 8 }).then((page) => page.items),
    enabled: open && searchActive,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
    enabled: open,
  });
  const { data: rules = [] } = useQuery({
    queryKey: ["rules"],
    queryFn: api.rules,
    enabled: open && searchActive,
  });

  const filteredRoutes = useMemo(() => {
    const normalized = normalizeText(query.trim());
    if (!normalized) return routes;
    return routes.filter((route) => normalizeText(route.label).includes(normalized));
  }, [query]);

  const entries: PaletteEntry[] = useMemo(() => {
    const normalized = normalizeText(query.trim());
    const routeEntries: PaletteEntry[] = filteredRoutes.map((route) => ({
      kind: "route",
      to: route.to,
      label: route.label,
      icon: route.icon,
    }));
    const categoryEntries: PaletteEntry[] = normalized
      ? categories
          .filter((category) => normalizeText(category.name).includes(normalized))
          .slice(0, 8)
          .map((category) => ({ kind: "category", category }))
      : [];
    if (!searchActive) return [...routeEntries, ...categoryEntries];
    const transactionEntries: PaletteEntry[] = transactionResults.map((transaction) => ({
      kind: "transaction",
      transaction,
    }));
    const ruleEntries: PaletteEntry[] = rules
      .filter((rule) => normalizeText(`${rule.name} ${rule.pattern}`).includes(normalized))
      .slice(0, 5)
      .map((rule) => ({ kind: "rule", rule }));
    return [...routeEntries, ...categoryEntries, ...ruleEntries, ...transactionEntries];
  }, [categories, filteredRoutes, query, rules, searchActive, transactionResults]);

  useEffect(() => {
    setActiveIndex(0);
  }, [entries.length]);

  function close() {
    setOpen(false);
  }

  function select(entry: PaletteEntry) {
    if (entry.kind === "route") {
      navigate(entry.to);
    } else if (entry.kind === "category") {
      navigate(`/categories?q=${encodeURIComponent(entry.category.name)}`);
    } else if (entry.kind === "rule") {
      navigate(`/categories?q=${encodeURIComponent(entry.rule.name)}`);
    } else {
      navigate(`/transactions?q=${encodeURIComponent(entry.transaction.description)}`);
    }
    close();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, entries.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[activeIndex];
      if (entry) select(entry);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={close}>
      <article className="modal command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar ou navegar…"
            aria-label="Buscar ou navegar"
          />
        </div>
        <div className="command-palette-list">
          {entries.length === 0 && <p className="muted command-palette-empty">Nenhum resultado encontrado.</p>}
          {entries.map((entry, index) => {
            const active = index === activeIndex;
            if (entry.kind === "route") {
              const Icon = entry.icon;
              return (
                <button
                  key={`route-${entry.to}`}
                  className={`command-palette-item${active ? " active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(entry)}
                >
                  <Icon size={16} />
                  <span>{entry.label}</span>
                </button>
              );
            }
            if (entry.kind === "category") {
              return (
                <button
                  key={`category-${entry.category.id}`}
                  className={`command-palette-item${active ? " active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(entry)}
                >
                  <Tags size={16} />
                  <span className="command-palette-tx">
                    <b>{entry.category.name}</b>
                    <small>Categoria</small>
                  </span>
                </button>
              );
            }
            if (entry.kind === "rule") {
              return (
                <button
                  key={`rule-${entry.rule.id}`}
                  className={`command-palette-item${active ? " active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(entry)}
                >
                  <Tags size={16} />
                  <span className="command-palette-tx">
                    <b>{entry.rule.name}</b>
                    <small>Regra: {entry.rule.pattern}</small>
                  </span>
                </button>
              );
            }
            const t = entry.transaction;
            return (
              <button
                key={`tx-${t.id}`}
                className={`command-palette-item${active ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(entry)}
              >
                <CreditCard size={16} />
                <span className="command-palette-tx">
                  <b>{t.description}</b>
                  <small>{shortDate(t.date)}</small>
                </span>
                <span className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</span>
              </button>
            );
          })}
        </div>
      </article>
    </div>
  );
}
