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
import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  CreditCard,
  FileUp,
  Landmark,
  LoaderCircle,
  Plus,
  Repeat2,
  Search,
  Tags,
  WalletCards,
} from "lucide-react";
import { api } from "../api";
import { commandScore, readRecentCommandIds, rememberCommandId, type CommandTarget } from "../commandPalette";
import { money, normalizeText, shortDate } from "../format";
import { navigation } from "../navigation";
import { OverlayDialog } from "./OverlayDialog";
import { CategoryIcon } from "./CategorySelect";
import type { Account, CategorizationRule, Category, Transaction } from "../types";

const emptyTransactions: Transaction[] = [];
const emptyAccounts: Account[] = [];
const emptyCategories: Category[] = [];
const emptyRules: CategorizationRule[] = [];

export const OPEN_COMMAND_PALETTE_EVENT = "lumen:open-command-palette";

type StaticCommand = CommandTarget & {
  group: "action" | "route";
  icon: ComponentType<{ size?: number }>;
};

type Entry =
  | { kind: "command"; command: StaticCommand }
  | { kind: "transaction"; transaction: Transaction }
  | { kind: "account"; account: Account }
  | { kind: "category"; category: Category }
  | { kind: "rule"; rule: CategorizationRule };

type EntryGroup = { id: string; label: string; entries: Entry[] };

const actionCommands: StaticCommand[] = [
  {
    id: "action:new-expense",
    group: "action",
    label: "Nova despesa",
    description: "Registrar uma saída manual",
    keywords: ["gasto", "saída", "lançamento", "transação"],
    to: "/transactions?action=new&type=expense",
    icon: Plus,
  },
  {
    id: "action:new-income",
    group: "action",
    label: "Nova receita",
    description: "Registrar uma entrada manual",
    keywords: ["ganho", "entrada", "lançamento", "transação"],
    to: "/transactions?action=new&type=income",
    icon: Plus,
  },
  {
    id: "action:new-transfer",
    group: "action",
    label: "Nova transferência",
    description: "Mover dinheiro entre contas",
    keywords: ["transferir", "movimentação"],
    to: "/transactions?action=new&type=transfer",
    icon: Repeat2,
  },
  {
    id: "action:import",
    group: "action",
    label: "Importar arquivo",
    description: "Selecionar um extrato ou uma fatura",
    keywords: ["csv", "ofx", "pdf", "extrato", "fatura"],
    to: "/import?action=choose",
    icon: FileUp,
  },
  {
    id: "action:new-account",
    group: "action",
    label: "Nova conta",
    description: "Adicionar conta, carteira ou cartão",
    keywords: ["banco", "cartão", "carteira"],
    to: "/accounts?action=new",
    icon: Landmark,
  },
  {
    id: "action:add-budget",
    group: "action",
    label: "Adicionar ao orçamento",
    description: "Definir um limite mensal por categoria",
    keywords: ["planejamento", "limite", "meta"],
    to: "/budget?action=add",
    icon: WalletCards,
  },
];

const routeCommands: StaticCommand[] = navigation.map((route) => ({
  id: `route:${route.to}`,
  group: "route",
  label: route.label,
  description: route.to === "/" ? "Abrir seu resumo financeiro" : `Ir para ${route.label.toLocaleLowerCase("pt-BR")}`,
  keywords: route.label.split(/\s+/),
  to: route.to,
  icon: route.icon,
}));

const staticCommands = [...actionCommands, ...routeCommands];
const commandById = new Map(staticCommands.map((command) => [command.id, command]));
const allowedRecentIds = new Set(commandById.keys());

const accountKindLabel: Record<Account["kind"], string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
};

function entryLabel(entry: Entry) {
  if (entry.kind === "command") return entry.command.label;
  if (entry.kind === "transaction") return entry.transaction.description;
  if (entry.kind === "account") return entry.account.name;
  if (entry.kind === "category") return entry.category.name;
  return entry.rule.name;
}

function resultScore(query: string, label: string, description: string, keywords: string[] = []) {
  return commandScore(query, { label, description, keywords });
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
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
    if (!open) return;
    setQuery("");
    setDebounced("");
    setActive(0);
    setRecentIds(readRecentCommandIds(allowedRecentIds));
  }, [open]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const normalizedQuery = normalizeText(query.trim());
  const transactionSearchActive = debounced.trim().length >= 3;
  const { data: transactions = emptyTransactions, isFetching: transactionsFetching } = useQuery({
    queryKey: ["command-palette-transactions", debounced],
    queryFn: () => api.listTransactions({ search: debounced.trim(), limit: 8 }).then((page) => page.items),
    enabled: open && transactionSearchActive,
  });
  const { data: accounts = emptyAccounts } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts, enabled: open });
  const { data: categories = emptyCategories } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
    enabled: open,
  });
  const { data: rules = emptyRules } = useQuery({ queryKey: ["rules"], queryFn: api.rules, enabled: open });

  const groups = useMemo<EntryGroup[]>(() => {
    if (!normalizedQuery) {
      const recent = recentIds
        .map((id) => commandById.get(id))
        .filter((command): command is StaticCommand => Boolean(command))
        .map((command) => ({ kind: "command" as const, command }));
      return [
        {
          id: "actions",
          label: "Ações rápidas",
          entries: actionCommands.map((command) => ({ kind: "command", command })),
        },
        ...(recent.length ? [{ id: "recent", label: "Recentes", entries: recent }] : []),
        {
          id: "navigation",
          label: "Navegação",
          entries: routeCommands.map((command) => ({ kind: "command", command })),
        },
      ];
    }

    const matchingCommands = (commands: StaticCommand[]) =>
      commands
        .map((command) => ({ command, score: commandScore(query, command) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ command }) => ({ kind: "command" as const, command }));
    const accountEntries = accounts
      .map((account) => ({
        account,
        score: resultScore(query, account.name, accountKindLabel[account.kind], ["conta", "cartão", "saldo"]),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ account }) => ({ kind: "account" as const, account }));
    const categoryEntries = categories
      .map((category) => ({
        category,
        score: resultScore(query, category.name, "Categoria", [category.kind]),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ category }) => ({ kind: "category" as const, category }));
    const ruleEntries = rules
      .map((rule) => ({
        rule,
        score: resultScore(query, rule.name, rule.pattern, ["regra", rule.categoryName ?? ""]),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ rule }) => ({ kind: "rule" as const, rule }));
    const transactionEntries =
      transactionSearchActive && normalizeText(debounced.trim()) === normalizedQuery
        ? transactions
            .map((transaction) => ({
              transaction,
              score: resultScore(
                query,
                transaction.description,
                `${transaction.accountName} ${transaction.category ?? ""}`,
              ),
            }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ transaction }) => ({ kind: "transaction" as const, transaction }))
        : [];

    return [
      { id: "actions", label: "Ações", entries: matchingCommands(actionCommands) },
      { id: "navigation", label: "Páginas", entries: matchingCommands(routeCommands) },
      { id: "transactions", label: "Transações", entries: transactionEntries },
      { id: "accounts", label: "Contas e cartões", entries: accountEntries },
      { id: "categories", label: "Categorias", entries: categoryEntries },
      { id: "rules", label: "Regras", entries: ruleEntries },
    ].filter((group) => group.entries.length > 0);
  }, [
    accounts,
    categories,
    debounced,
    normalizedQuery,
    query,
    recentIds,
    rules,
    transactionSearchActive,
    transactions,
  ]);

  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(entries.length - 1, 0)));
  }, [entries.length]);

  useEffect(() => {
    document.getElementById(`palette-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const select = (entry: Entry) => {
    if (entry.kind === "command") {
      setRecentIds(rememberCommandId(entry.command.id, allowedRecentIds));
      navigate(entry.command.to);
    } else if (entry.kind === "category") {
      navigate(`/categories?tab=categories&q=${encodeURIComponent(entry.category.name)}`);
    } else if (entry.kind === "rule") {
      navigate(`/categories?tab=rules&q=${encodeURIComponent(entry.rule.name)}`);
    } else if (entry.kind === "account") {
      navigate(`/accounts?q=${encodeURIComponent(entry.account.name)}`);
    } else {
      navigate(`/transactions?q=${encodeURIComponent(entry.transaction.description)}`);
    }
    setOpen(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive((index) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? Math.max(entries.length - 1, 0)
            : event.key === "ArrowDown"
              ? Math.min(index + 1, Math.max(entries.length - 1, 0))
              : Math.max(index - 1, 0),
      );
    } else if (event.key === "Enter" && entries[active]) {
      event.preventDefault();
      select(entries[active]);
    }
  };

  if (!open) return null;
  const activeId = entries[active] ? `palette-option-${active}` : undefined;
  const waitingForTransactions = query.trim().length > 0 && query.trim().length < 3;

  return (
    <OverlayDialog
      title="Central de comandos"
      className="command-palette"
      onClose={() => setOpen(false)}
      initialFocus={inputRef}
    >
      <div className="command-palette-input">
        {transactionsFetching ? (
          <LoaderCircle className="command-palette-spinner" size={19} aria-hidden="true" />
        ) : (
          <Search size={19} aria-hidden="true" />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Busque uma ação, página ou lançamento…"
          aria-label="Buscar ações, páginas ou dados"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="command-palette-options"
          aria-activedescendant={activeId}
        />
        <kbd>Ctrl K</kbd>
      </div>
      <div className="command-palette-status" aria-live="polite">
        {transactionsFetching
          ? "Buscando transações…"
          : waitingForTransactions
            ? "Digite 3 caracteres para incluir transações"
            : normalizedQuery
              ? `${entries.length} resultado${entries.length === 1 ? "" : "s"}`
              : "Acesse qualquer parte do Lumen sem tirar as mãos do teclado"}
      </div>
      <div id="command-palette-options" className="command-palette-list" role="listbox" aria-label="Resultados">
        {!entries.length && !transactionsFetching && (
          <div className="command-palette-empty">
            <span className="command-palette-empty__icon">
              <Search size={20} aria-hidden="true" />
            </span>
            <b>Nenhum resultado encontrado</b>
            <span>Tente outro termo ou procure pelo nome de uma área.</span>
          </div>
        )}
        {groups.map((group) => (
          <section
            className="command-palette-group"
            role="group"
            aria-labelledby={`palette-group-${group.id}`}
            key={group.id}
          >
            <h3 id={`palette-group-${group.id}`}>{group.label}</h3>
            {group.entries.map((entry) => {
              const index = entries.indexOf(entry);
              const label = entryLabel(entry);
              const Icon =
                entry.kind === "command"
                  ? entry.command.icon
                  : entry.kind === "transaction"
                    ? CreditCard
                    : entry.kind === "account"
                      ? entry.account.kind === "credit_card"
                        ? CreditCard
                        : Landmark
                      : Tags;
              const detail =
                entry.kind === "command"
                  ? entry.command.description
                  : entry.kind === "transaction"
                    ? [shortDate(entry.transaction.date), entry.transaction.accountName, entry.transaction.category]
                        .filter(Boolean)
                        .join(" · ")
                    : entry.kind === "account"
                      ? accountKindLabel[entry.account.kind]
                      : entry.kind === "category"
                        ? entry.category.parentId
                          ? "Subcategoria"
                          : "Categoria"
                        : `Regra · ${entry.rule.pattern}`;
              const meta =
                entry.kind === "transaction"
                  ? money(entry.transaction.amountInCents)
                  : entry.kind === "account"
                    ? money(entry.account.balanceInCents)
                    : entry.kind === "rule"
                      ? `${entry.rule.useCount} usos`
                      : null;
              return (
                <button
                  type="button"
                  id={`palette-option-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  key={`${entry.kind}-${entry.kind === "command" ? entry.command.id : label}`}
                  className={`command-palette-item${index === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(entry)}
                >
                  <span
                    className={`command-palette-item__icon command-palette-item__icon--${entry.kind}`}
                    style={
                      entry.kind === "category"
                        ? { color: entry.category.color }
                        : entry.kind === "rule"
                          ? { color: categories.find((category) => category.id === entry.rule.categoryId)?.color }
                          : undefined
                    }
                  >
                    {entry.kind === "category" ? (
                      <CategoryIcon name={entry.category.icon} size={17} />
                    ) : (
                      <Icon size={17} />
                    )}
                  </span>
                  <span className="command-palette-copy">
                    <b>{label}</b>
                    <small>{detail}</small>
                  </span>
                  {meta && (
                    <span
                      className={`command-palette-meta${
                        entry.kind === "transaction"
                          ? entry.transaction.amountInCents > 0
                            ? " positive"
                            : " command-palette-meta--expense"
                          : ""
                      }`}
                    >
                      {meta}
                    </span>
                  )}
                  {entry.kind === "command" && index === active && <kbd className="command-palette-enter">↵</kbd>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      <div className="command-palette-footer" aria-hidden="true">
        <span>
          <kbd>
            <ArrowUp size={12} />
          </kbd>
          <kbd>
            <ArrowDown size={12} />
          </kbd>{" "}
          navegar
        </span>
        <span>
          <kbd>
            <CornerDownLeft size={12} />
          </kbd>{" "}
          abrir
        </span>
        <span>
          <kbd>Esc</kbd> fechar
        </span>
        <span className="command-palette-footer__privacy">Somente dados locais</span>
      </div>
    </OverlayDialog>
  );
}
