import { PageHeader } from "../../shared/ui/PageHeader";
import { Modal } from "../../shared/ui/Modal";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  CreditCard,
  Download,
  Filter,
  Landmark,
  Pencil,
  Plus,
  Repeat,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  Unlink,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../../shared/api";
import { money, shortDate, suggestRulePattern } from "../../shared/format";
import { currentMonth } from "../../shared/period";
import { useQuickStartGuide } from "../../shared/quickStartGuide";
import { invalidateTransactionDerivedQueries } from "../../shared/queryInvalidation";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import { DatePicker, MonthPicker } from "../../shared/ui/CalendarPicker";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { Pagination, type PaginationSize } from "../../shared/ui/Pagination";
import { Select } from "../../shared/ui/Select";
import { useToast } from "../../shared/ui/toast";
import type { Account, ReportSource, Transaction, TransactionFilter } from "../../shared/types";
import { TransactionForm, type TransactionEntryType } from "./TransactionForm";

const FILTER_KEYS = [
  "category",
  "uncategorized",
  "startMonth",
  "endMonth",
  "source",
  "accountId",
  "startDate",
  "endDate",
  "status",
  "movementType",
  "minAmount",
  "maxAmount",
  "merchantKey",
] as const;

type QuickFilter = "all" | "month" | "uncategorized" | "expense" | "income" | "pending";
type MovementFilter = NonNullable<TransactionFilter["movementType"]>;

const movementLabels: Record<MovementFilter, string> = {
  income: "Receitas",
  expense: "Despesas",
  transfer: "Transferências",
  investment: "Investimentos",
};

function centsParam(value: string | null) {
  if (!value) return undefined;
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? cents : undefined;
}

function monthFilterLabel(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(" de ", " ");
}

function setOrDelete(params: URLSearchParams, key: string, value?: string) {
  if (value) params.set(key, value);
  else params.delete(key);
}

function filteredAccounts(accounts: Account[], source: ReportSource | "") {
  return accounts.filter(
    (account) =>
      !source ||
      source === "all" ||
      (source === "credit_card" ? account.kind === "credit_card" : account.kind !== "credit_card"),
  );
}

export function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const monthNow = currentMonth();
  const categoryFilter = searchParams.get("category") ?? "";
  const uncategorizedFilter = searchParams.get("uncategorized") === "1";
  const startMonthFilter = searchParams.get("startMonth") ?? "";
  const endMonthFilter = searchParams.get("endMonth") ?? "";
  const startDateFilter = searchParams.get("startDate") ?? "";
  const endDateFilter = searchParams.get("endDate") ?? "";
  const focusParam = searchParams.get("focus");
  const statusParam = searchParams.get("status");
  const statusFilter = statusParam === "cleared" || statusParam === "pending" ? statusParam : "";
  const movementParam = searchParams.get("movementType");
  const movementFilter = (
    movementParam === "income" ||
    movementParam === "expense" ||
    movementParam === "transfer" ||
    movementParam === "investment"
      ? movementParam
      : ""
  ) as MovementFilter | "";
  const sourceParam = searchParams.get("source");
  const sourceFilter = (sourceParam === "bank" || sourceParam === "credit_card" ? sourceParam : "") as
    ReportSource | "";
  const accountFilter = searchParams.get("accountId") ?? "";
  const minAmountFilter = centsParam(searchParams.get("minAmount"));
  const maxAmountFilter = centsParam(searchParams.get("maxAmount"));
  const qParam = searchParams.get("q") ?? "";
  const merchantKeyFilter = searchParams.get("merchantKey") ?? "";
  const [search, setSearch] = useState(qParam);
  const [debouncedSearch, setDebouncedSearch] = useState(qParam);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const completeGuideActive = useQuickStartGuide(
    (state) => state.mode === "tour" && state.activeGuide === "complete" && state.guides.complete.stepIndex === 1,
  );
  const advancedFiltersBeforeGuide = useRef<boolean | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PaginationSize>(25);
  const [showNew, setShowNew] = useState(false);
  const [newTransactionType, setNewTransactionType] = useState<TransactionEntryType>("expense");
  const [editing, setEditing] = useState<Transaction>();
  const [unlinking, setUnlinking] = useState<Transaction>();
  const [deletingTransfer, setDeletingTransfer] = useState<Transaction>();
  const [learning, setLearning] = useState<{ transaction: Transaction; categoryId: string; pattern: string }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<
    | { kind: "delete"; ids: string[] }
    | { kind: "transfer-delete"; transactionId: string }
    | { kind: "categorize"; previous: { id: string; categoryId?: string }[] }
    | { kind: "status"; transactionId: string }
  >();
  const [statusChanging, setStatusChanging] = useState<string>();
  const [actionBusy, setActionBusy] = useState<string>();
  const actionLocks = useRef(new Set<string>());
  const [notice, setNotice] = useState("");
  const client = useQueryClient();

  useEffect(() => {
    if (searchParams.get("action") !== "new") return;
    const requestedType = searchParams.get("type");
    setNewTransactionType(
      requestedType === "income" || requestedType === "transfer" || requestedType === "expense"
        ? requestedType
        : "expense",
    );
    setShowNew(true);
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("action");
        next.delete("type");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (completeGuideActive) {
      if (advancedFiltersBeforeGuide.current === undefined) {
        advancedFiltersBeforeGuide.current = advancedOpen;
      }
      if (!advancedOpen) setAdvancedOpen(true);
      return;
    }
    if (advancedFiltersBeforeGuide.current === undefined) return;
    const previousState = advancedFiltersBeforeGuide.current;
    advancedFiltersBeforeGuide.current = undefined;
    if (advancedOpen !== previousState) setAdvancedOpen(previousState);
  }, [advancedOpen, completeGuideActive]);

  useEffect(() => {
    if (!qParam) return;
    setSearch(qParam);
    setDebouncedSearch(qParam);
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("q");
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [
    debouncedSearch,
    categoryFilter,
    uncategorizedFilter,
    startMonthFilter,
    endMonthFilter,
    startDateFilter,
    endDateFilter,
    statusFilter,
    movementFilter,
    sourceFilter,
    accountFilter,
    minAmountFilter,
    maxAmountFilter,
    merchantKeyFilter,
  ]);

  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: () => api.categories() });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const sourceAccounts = useMemo(() => filteredAccounts(accounts, sourceFilter), [accounts, sourceFilter]);

  useEffect(() => {
    if (!accountFilter || sourceAccounts.some((account) => account.id === accountFilter)) return;
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete("accountId");
        return next;
      },
      { replace: true },
    );
  }, [accountFilter, setSearchParams, sourceAccounts]);

  const filter: TransactionFilter = {
    startMonth: startMonthFilter || undefined,
    endMonth: endMonthFilter || undefined,
    startDate: startDateFilter || undefined,
    endDate: endDateFilter || undefined,
    source: sourceFilter || undefined,
    accountId: accountFilter || undefined,
    categoryId: uncategorizedFilter ? undefined : categoryFilter || undefined,
    uncategorized: uncategorizedFilter || undefined,
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    movementType: movementFilter || undefined,
    minAbsAmountInCents: minAmountFilter,
    maxAbsAmountInCents: maxAmountFilter,
    merchantKey: merchantKeyFilter || undefined,
    limit: pageSize,
    offset: page * pageSize,
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.listTransactions(filter),
    placeholderData: keepPreviousData,
  });
  const items = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const rows = items;
  const categoryFilterName = uncategorizedFilter
    ? "Sem categoria"
    : categories.find((c) => c.id === categoryFilter)?.name;
  const sourceLabel =
    sourceFilter === "bank" ? "Conta bancária" : sourceFilter === "credit_card" ? "Cartão de crédito" : "";
  const accountLabel = accounts.find((a) => a.id === accountFilter)?.name;
  const hasActiveFilters = Boolean(
    search ||
    categoryFilter ||
    uncategorizedFilter ||
    startMonthFilter ||
    endMonthFilter ||
    startDateFilter ||
    endDateFilter ||
    sourceFilter ||
    accountFilter ||
    statusFilter ||
    movementFilter ||
    minAmountFilter ||
    maxAmountFilter ||
    merchantKeyFilter,
  );
  const quickActive: QuickFilter | "" = !hasActiveFilters
    ? "all"
    : startMonthFilter === monthNow &&
        endMonthFilter === monthNow &&
        !categoryFilter &&
        !uncategorizedFilter &&
        !statusFilter &&
        !movementFilter &&
        !startDateFilter &&
        !endDateFilter &&
        !sourceFilter &&
        !accountFilter &&
        !minAmountFilter &&
        !maxAmountFilter &&
        !merchantKeyFilter &&
        !search
      ? "month"
      : uncategorizedFilter && !statusFilter && !movementFilter
        ? "uncategorized"
        : movementFilter === "expense" && !statusFilter && !uncategorizedFilter
          ? "expense"
          : movementFilter === "income" && !statusFilter && !uncategorizedFilter
            ? "income"
            : statusFilter === "pending" && !movementFilter && !uncategorizedFilter
              ? "pending"
              : "";
  const activeChips = [
    debouncedSearch && { key: "search", label: `Busca: ${debouncedSearch}` },
    categoryFilterName && {
      key: uncategorizedFilter ? "uncategorized" : "category",
      label: `Categoria: ${categoryFilterName}`,
    },
    startMonthFilter &&
      endMonthFilter && {
        key: "months",
        label:
          startMonthFilter === endMonthFilter
            ? `Período: ${monthFilterLabel(startMonthFilter)}`
            : `Período: ${monthFilterLabel(startMonthFilter)} — ${monthFilterLabel(endMonthFilter)}`,
      },
    startDateFilter && { key: "startDate", label: `Desde ${shortDate(startDateFilter)}` },
    endDateFilter && { key: "endDate", label: `Até ${shortDate(endDateFilter)}` },
    sourceLabel && { key: "source", label: `Origem: ${sourceLabel}` },
    accountLabel && { key: "accountId", label: `Conta: ${accountLabel}` },
    statusFilter && { key: "status", label: statusFilter === "pending" ? "Pendentes" : "Confirmadas" },
    movementFilter && { key: "movementType", label: movementLabels[movementFilter] },
    minAmountFilter && { key: "minAmount", label: `Mín. ${money(minAmountFilter)}` },
    maxAmountFilter && { key: "maxAmount", label: `Máx. ${money(maxAmountFilter)}` },
    merchantKeyFilter && { key: "merchantKey", label: `Estabelecimento: ${merchantKeyFilter}` },
  ].filter(Boolean) as { key: string; label: string }[];

  function updateParams(mutator: (next: URLSearchParams) => void) {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      mutator(next);
      return next;
    });
  }
  function applyQuick(value: QuickFilter) {
    setSearch("");
    setDebouncedSearch("");
    updateParams((next) => {
      FILTER_KEYS.forEach((key) => next.delete(key));
      next.delete("q");
      if (value === "month") {
        next.set("startMonth", monthNow);
        next.set("endMonth", monthNow);
      } else if (value === "uncategorized") {
        next.set("uncategorized", "1");
      } else if (value === "expense" || value === "income") {
        next.set("movementType", value);
      } else if (value === "pending") {
        next.set("status", "pending");
      }
    });
  }
  function clearAllFilters() {
    setSearch("");
    setDebouncedSearch("");
    updateParams((next) => {
      FILTER_KEYS.forEach((key) => next.delete(key));
      next.delete("q");
    });
  }
  function removeFilter(key: string) {
    if (key === "search") {
      setSearch("");
      setDebouncedSearch("");
      return;
    }
    updateParams((next) => {
      if (key === "months") {
        next.delete("startMonth");
        next.delete("endMonth");
      } else if (key === "category") {
        next.delete("category");
      } else if (key === "uncategorized") {
        next.delete("uncategorized");
      } else {
        next.delete(key);
      }
    });
  }
  const isProtectedFromGenericMutations = (transaction: Transaction) =>
    transaction.isTransferLeg || transaction.linkedKind === "credit_card_payment";
  const selectableRows = rows.filter((transaction) => !isProtectedFromGenericMutations(transaction));
  const allVisibleSelected =
    selectableRows.length > 0 && selectableRows.every((transaction) => selected.has(transaction.id));
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) selectableRows.forEach((transaction) => next.delete(transaction.id));
      else selectableRows.forEach((transaction) => next.add(transaction.id));
      return next;
    });
  }
  const exportFilter: TransactionFilter = {
    startMonth: filter.startMonth,
    endMonth: filter.endMonth,
    startDate: filter.startDate,
    endDate: filter.endDate,
    source: filter.source,
    accountId: filter.accountId,
    categoryId: filter.categoryId,
    uncategorized: filter.uncategorized,
    search: filter.search,
    status: filter.status,
    movementType: filter.movementType,
    minAbsAmountInCents: filter.minAbsAmountInCents,
    maxAbsAmountInCents: filter.maxAbsAmountInCents,
    merchantKey: filter.merchantKey,
  };
  async function exportFile(kind: "csv" | "ofx" | "pdf") {
    if (!("__TAURI_INTERNALS__" in window)) {
      toast("Abra o aplicativo desktop para exportar arquivos.", "error");
      return;
    }
    const labels = {
      csv: { name: "CSV", extension: "csv", action: api.exportTransactionsCsv },
      ofx: { name: "OFX", extension: "ofx", action: api.exportTransactionsOfx },
      pdf: { name: "PDF", extension: "pdf", action: api.exportTransactionsPdf },
    };
    const option = labels[kind];
    const path = await save({
      defaultPath: `transacoes.${option.extension}`,
      filters: [{ name: option.name, extensions: [option.extension] }],
    });
    if (!path) return;
    setExporting(true);
    try {
      const count = await option.action(path, exportFilter);
      toast(`${count} transações exportadas em ${option.name}.`);
    } catch (error: any) {
      toast(`Não foi possível exportar ${option.name}: ${error?.message || error}`, "error");
    } finally {
      setExporting(false);
    }
  }
  async function refresh() {
    await invalidateTransactionDerivedQueries(client);
  }
  async function confirmPending(transaction: Transaction) {
    const lockKey = `status:${transaction.id}`;
    if (
      actionLocks.current.has(lockKey) ||
      statusChanging ||
      transaction.status !== "pending" ||
      isProtectedFromGenericMutations(transaction)
    )
      return;
    actionLocks.current.add(lockKey);
    setStatusChanging(transaction.id);
    try {
      await api.setTransactionStatus(transaction.id, "cleared");
      setUndo({ kind: "status", transactionId: transaction.id });
      setNotice("Lançamento confirmado.");
      toast("Lançamento confirmado.");
      await refresh();
    } catch (error: any) {
      toast(`Não foi possível confirmar o lançamento: ${error?.message || error}`, "error");
    } finally {
      actionLocks.current.delete(lockKey);
      setStatusChanging(undefined);
    }
  }
  async function changeCategory(transaction: Transaction, categoryId?: string) {
    await api.updateTransactionCategory(transaction.id, categoryId || undefined);
    await refresh();
    if (categoryId) setLearning({ transaction, categoryId, pattern: suggestRulePattern(transaction.description) });
  }
  async function deleteOne(transaction: Transaction) {
    const lockKey = `delete:${transaction.id}`;
    if (actionLocks.current.has(lockKey)) return;
    actionLocks.current.add(lockKey);
    setActionBusy(lockKey);
    try {
      if (transaction.linkedKind === "transfer") {
        await api.setTransferDeleted(transaction.id, true);
        setUndo({ kind: "transfer-delete", transactionId: transaction.id });
        setNotice("Transferência movida para a lixeira com os dois lançamentos.");
        setDeletingTransfer(undefined);
      } else {
        const count = await api.deleteTransactions([transaction.id]);
        setUndo({ kind: "delete", ids: [transaction.id] });
        setNotice(`${count} transação movida para a lixeira.`);
      }
      setSelected((current) => {
        const next = new Set(current);
        next.delete(transaction.id);
        return next;
      });
      await refresh();
    } catch (error: unknown) {
      toast((error as { message?: string })?.message ?? "Não foi possível excluir o lançamento.", "error");
    } finally {
      actionLocks.current.delete(lockKey);
      setActionBusy(undefined);
    }
  }
  async function unlinkTransfer() {
    if (!unlinking) return;
    const snapshot = unlinking;
    const lockKey = `unlink:${snapshot.id}`;
    if (actionLocks.current.has(lockKey)) return;
    actionLocks.current.add(lockKey);
    setActionBusy(lockKey);
    try {
      await api.unlinkTransfer(snapshot.id);
      setUnlinking(undefined);
      setNotice("Vínculo removido. As categorias anteriores dos dois lançamentos foram restauradas.");
      await refresh();
    } catch (error: unknown) {
      toast((error as { message?: string })?.message ?? "Não foi possível desvincular a transferência.", "error");
    } finally {
      actionLocks.current.delete(lockKey);
      setActionBusy(undefined);
    }
  }
  async function createRule() {
    if (!learning) return;
    const selectedCategory = categories.find((c) => c.id === learning.categoryId);
    await api.saveRule({
      name: `Reconhecer ${learning.transaction.description}`,
      priority: 100,
      enabled: true,
      operator: "contains",
      pattern: learning.pattern,
      movementType:
        selectedCategory?.kind === "transfer"
          ? "transfer"
          : learning.transaction.amountInCents >= 0
            ? "income"
            : "expense",
      categoryId: learning.categoryId,
    });
    toast("Regra criada com sucesso.");
    setLearning(undefined);
    await api.applyRules(false);
    await client.invalidateQueries({ queryKey: ["rules"] });
    await refresh();
  }
  async function applyBulkCategory() {
    const ids = [...selected];
    if (!ids.length) return;
    const previous = ids.map((id) => ({ id, categoryId: items.find((t) => t.id === id)?.categoryId }));
    const count = await api.bulkUpdateTransactionCategory(ids, bulkCategory || undefined);
    setUndo({ kind: "categorize", previous });
    setNotice(`${count} transações atualizadas.`);
    setSelected(new Set());
    setBulkCategory("");
    await refresh();
  }
  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    const count = await api.deleteTransactions(ids);
    setUndo({ kind: "delete", ids });
    setNotice(`${count} transações movidas para a lixeira.`);
    setSelected(new Set());
    setConfirmDelete(false);
    await refresh();
  }
  async function undoLast() {
    if (!undo) return;
    const snapshot = undo;
    const lockKey = `undo:${snapshot.kind}`;
    if (actionLocks.current.has(lockKey)) return;
    actionLocks.current.add(lockKey);
    setActionBusy(lockKey);
    try {
      if (snapshot.kind === "delete") {
        const count = await api.restoreTransactions(snapshot.ids);
        setNotice(`${count} transações restauradas.`);
      } else if (snapshot.kind === "status") {
        await api.setTransactionStatus(snapshot.transactionId, "pending");
        setNotice("Lançamento voltou a ficar pendente.");
      } else if (snapshot.kind === "transfer-delete") {
        await api.setTransferDeleted(snapshot.transactionId, false);
        setNotice("Transferência restaurada com os dois lançamentos.");
      } else {
        const groups = new Map<string | undefined, string[]>();
        snapshot.previous.forEach((p) => {
          const list = groups.get(p.categoryId) ?? [];
          list.push(p.id);
          groups.set(p.categoryId, list);
        });
        for (const [categoryId, ids] of groups) await api.bulkUpdateTransactionCategory(ids, categoryId);
        setNotice(`${snapshot.previous.length} transações voltaram às categorias anteriores.`);
      }
      setUndo(undefined);
      await refresh();
    } catch (error: unknown) {
      toast((error as { message?: string })?.message ?? "Não foi possível desfazer a ação.", "error");
    } finally {
      actionLocks.current.delete(lockKey);
      setActionBusy(undefined);
    }
  }
  const rangeStart = totalCount === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(totalCount, page * pageSize + rows.length);
  useEffect(() => {
    if (!data) return;
    setPage((currentPage) => Math.min(currentPage, Math.max(0, Math.ceil(totalCount / pageSize) - 1)));
  }, [data, totalCount, pageSize]);
  useEffect(() => {
    if (!focusParam || !data?.items.some((item) => item.id === focusParam)) return;
    const row = [...document.querySelectorAll<HTMLElement>("[data-transaction-id]")].find(
      (candidate) => candidate.dataset.transactionId === focusParam,
    );
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [data, focusParam]);

  return (
    <section data-tutorial="transactions">
      <PageHeader>
        <div>
          <p className="eyebrow">MOVIMENTAÇÕES</p>
          <h1>Transações</h1>
          <p className="muted">
            {totalCount === 0 ? "0 lançamentos" : `${rangeStart}–${rangeEnd} de ${totalCount} lançamentos`}
          </p>
        </div>
        <div className="transaction-header-actions" data-quick-guide="transactions">
          <div className="export-actions" role="group" aria-label="Exportar transações">
            <button
              className="secondary"
              aria-label="Exportar CSV"
              title="Exportar CSV"
              disabled={exporting}
              onClick={() => exportFile("csv")}
            >
              <Download size={14} /> CSV
            </button>
            <button
              className="secondary"
              aria-label="Exportar OFX"
              title="Exportar OFX"
              disabled={exporting}
              onClick={() => exportFile("ofx")}
            >
              <Download size={14} /> OFX
            </button>
            <button
              className="secondary"
              aria-label="Exportar PDF"
              title="Exportar PDF"
              disabled={exporting}
              onClick={() => exportFile("pdf")}
            >
              <Download size={14} /> PDF
            </button>
          </div>
          <button
            onClick={() => {
              setNewTransactionType("expense");
              setShowNew(true);
            }}
          >
            <Plus size={17} /> Nova transação
          </button>
        </div>
      </PageHeader>
      {showNew && <TransactionForm initialType={newTransactionType} onClose={() => setShowNew(false)} />}
      {editing && <TransactionForm existing={editing} onClose={() => setEditing(undefined)} />}
      {notice && (
        <div className="notice notice-action" role="status" aria-live="polite">
          <span>{notice}</span>
          {undo && (
            <button className="text-button" onClick={undoLast} disabled={actionBusy?.startsWith("undo:")}>
              <Undo2 size={15} /> {actionBusy?.startsWith("undo:") ? "Desfazendo…" : "Desfazer"}
            </button>
          )}
        </div>
      )}
      <article className="panel transactions-panel">
        <div className="transactions-panel__heading">
          <div>
            <span className="section-kicker">EXTRATO</span>
            <h2>Seus lançamentos</h2>
          </div>
          <span className="transactions-panel__count">
            {totalCount} {totalCount === 1 ? "resultado" : "resultados"}
          </span>
        </div>
        <div className="transactions-toolbar" data-quick-guide="transactions-filters">
          <div className="toolbar">
            <Search size={18} />
            <input
              aria-label="Buscar transações"
              placeholder="Buscar por descrição…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="secondary" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
            <SlidersHorizontal size={15} /> Filtros
          </button>
          {selected.size > 0 && (
            <div className="bulk-actions">
              <b>
                {selected.size} selecionada{selected.size > 1 ? "s" : ""}
              </b>
              <CategorySelect
                value={bulkCategory}
                onChange={(id) => setBulkCategory(id ?? "")}
                categories={categories}
                allowEmpty
                emptyLabel="Sem categoria"
                aria-label="Categoria das transações selecionadas"
              />
              <button className="secondary" onClick={applyBulkCategory}>
                <Tags size={15} /> Categorizar
              </button>
              <button className="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> Excluir
              </button>
            </div>
          )}
        </div>
        <div className="quick-filters" role="group" aria-label="Filtros rápidos">
          {(
            [
              ["all", "Todos"],
              ["month", "Este mês"],
              ["uncategorized", "Sem categoria"],
              ["expense", "Despesas"],
              ["income", "Receitas"],
              ["pending", "Pendentes"],
            ] as [QuickFilter, string][]
          ).map(([value, label]) => (
            <button key={value} className={quickActive === value ? "active" : ""} onClick={() => applyQuick(value)}>
              {label}
            </button>
          ))}
        </div>
        {advancedOpen && (
          <div className="transaction-filter-panel" data-quick-guide="transactions-filter-panel">
            <label>
              <CalendarRange size={15} /> De
              <MonthPicker
                ariaLabel="Mês inicial"
                value={startMonthFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "startMonth", value))}
              />
            </label>
            <label>
              Até
              <MonthPicker
                ariaLabel="Mês final"
                value={endMonthFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "endMonth", value))}
              />
            </label>
            <label>
              Data inicial
              <DatePicker
                ariaLabel="Data inicial"
                value={startDateFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "startDate", value))}
              />
            </label>
            <label>
              Data final
              <DatePicker
                ariaLabel="Data final"
                value={endDateFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "endDate", value))}
              />
            </label>
            <label>
              Origem
              <Select
                value={sourceFilter || "all"}
                onChange={(value) =>
                  updateParams((next) => {
                    const source = value as ReportSource;
                    setOrDelete(next, "source", source === "all" ? undefined : source);
                    next.delete("accountId");
                  })
                }
                options={[
                  { value: "all", label: "Todas" },
                  { value: "bank", label: "Conta bancária" },
                  { value: "credit_card", label: "Cartão de crédito" },
                ]}
              />
            </label>
            <label>
              Conta
              <Select
                value={accountFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "accountId", value))}
                options={[
                  { value: "", label: "Todas as contas" },
                  ...sourceAccounts.map((account) => ({ value: account.id, label: account.name })),
                ]}
              />
            </label>
            <label>
              Status
              <Select
                value={statusFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "status", value))}
                options={[
                  { value: "", label: "Todos" },
                  { value: "cleared", label: "Confirmadas" },
                  { value: "pending", label: "Pendentes" },
                ]}
              />
            </label>
            <label>
              Tipo
              <Select
                value={movementFilter}
                onChange={(value) => updateParams((next) => setOrDelete(next, "movementType", value))}
                options={[
                  { value: "", label: "Todos" },
                  { value: "expense", label: "Despesas" },
                  { value: "income", label: "Receitas" },
                  { value: "transfer", label: "Transferências" },
                  { value: "investment", label: "Investimentos" },
                ]}
              />
            </label>
            <div className="filter-category-field">
              <span>Categoria</span>
              <CategorySelect
                value={categoryFilter}
                onChange={(id) =>
                  updateParams((next) => {
                    setOrDelete(next, "category", id);
                    if (id) next.delete("uncategorized");
                  })
                }
                categories={categories}
                allowEmpty
                emptyLabel="Todas as categorias"
                aria-label="Filtrar transações por categoria"
              />
            </div>
            <label className="check-label filter-check">
              <input
                type="checkbox"
                checked={uncategorizedFilter}
                onChange={(e) =>
                  updateParams((next) => {
                    if (e.target.checked) {
                      next.set("uncategorized", "1");
                      next.delete("category");
                    } else next.delete("uncategorized");
                  })
                }
              />{" "}
              Sem categoria
            </label>
            <label>
              Valor mínimo
              <MoneyInput
                key={`min-${minAmountFilter ?? 0}`}
                defaultCents={minAmountFilter ?? 0}
                onChange={(cents) =>
                  updateParams((next) => setOrDelete(next, "minAmount", cents && cents > 0 ? String(cents) : undefined))
                }
              />
            </label>
            <label>
              Valor máximo
              <MoneyInput
                key={`max-${maxAmountFilter ?? 0}`}
                defaultCents={maxAmountFilter ?? 0}
                onChange={(cents) =>
                  updateParams((next) => setOrDelete(next, "maxAmount", cents && cents > 0 ? String(cents) : undefined))
                }
              />
            </label>
          </div>
        )}
        {activeChips.length > 0 && (
          <div className="active-filter-chips">
            <span className="active-filter-chips__label">
              <Filter size={15} aria-hidden="true" /> Filtros ativos
            </span>
            <div className="active-filter-chips__items">
              {activeChips.map((chip) => (
                <button key={chip.key} className="filter-chip" onClick={() => removeFilter(chip.key)}>
                  <span>{chip.label}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
            <button className="text-button active-filter-chips__clear" onClick={clearAllFilters}>
              Limpar filtros
            </button>
          </div>
        )}
        <p className="table-hint">Em telas estreitas, deslize horizontalmente para ver todas as colunas e ações.</p>
        <div className="table-scroll">
          <table className="transactions-table">
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    aria-label="Selecionar transações visíveis"
                    checked={allVisibleSelected}
                    disabled={selectableRows.length === 0}
                    onChange={toggleAll}
                  />
                </th>
                <th>Data</th>
                <th>Descrição</th>
                <th>Origem</th>
                <th>Categoria</th>
                <th>Status</th>
                <th className="amount">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    {isLoading ? (
                      <LoadingState variant="table-row" label="Carregando transações…" />
                    ) : isError ? (
                      <ErrorState variant="table-row" onRetry={() => void refetch()} />
                    ) : (
                      <EmptyState
                        variant="table-row"
                        title="Nenhuma transação encontrada"
                        description={
                          hasActiveFilters
                            ? "Tente ajustar ou limpar os filtros."
                            : "Adicione sua primeira transação para começar."
                        }
                      />
                    )}
                  </td>
                </tr>
              )}
              {rows.map((t) => (
                <tr
                  key={t.id}
                  data-transaction-id={t.id}
                  tabIndex={focusParam === t.id ? -1 : undefined}
                  className={selected.has(t.id) ? "selected-row" : ""}
                >
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${t.description}`}
                      checked={selected.has(t.id)}
                      disabled={isProtectedFromGenericMutations(t)}
                      title={isProtectedFromGenericMutations(t) ? "Use as ações próprias deste vínculo" : undefined}
                      onChange={() => toggle(t.id)}
                    />
                  </td>
                  <td className="transaction-date">{shortDate(t.date)}</td>
                  <td>
                    <div className="transaction-description">
                      {(() => {
                        const c = categories.find((cat) => cat.id === t.categoryId);
                        const isInv = c?.kind === "investment";
                        const isInc = t.amountInCents > 0;
                        const tone = isInv ? "investment" : isInc ? "income" : "expense";
                        return (
                          <div className={`tx-icon tx-icon-${tone}`} aria-hidden="true">
                            {isInc || isInv ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                          </div>
                        );
                      })()}
                      <b className="transaction-description__text">{t.description}</b>
                      {t.isTransferLeg && (
                        <span
                          className="badge"
                          title="Parte de uma transferência vinculada"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "var(--status-info-bg)",
                            color: "var(--status-info-fg)",
                          }}
                        >
                          <Repeat size={12} /> Vinculada
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`origin-tag ${t.accountKind === "credit_card" ? "card-origin" : "bank-origin"}`}>
                      {t.accountKind === "credit_card" ? <CreditCard size={13} /> : <Landmark size={13} />}
                      <span>
                        {t.accountKind === "credit_card" ? "Cartão de crédito" : "Conta bancária"}
                        <small>{t.accountName}</small>
                      </span>
                    </span>
                  </td>
                  <td className="transaction-category-cell">
                    <CategorySelect
                      value={t.categoryId}
                      onChange={(id) => changeCategory(t, id)}
                      categories={categories}
                      allowEmpty
                      emptyLabel="Sem categoria"
                      disabled={isProtectedFromGenericMutations(t)}
                      aria-label={`Categoria de ${t.description} em ${shortDate(t.date)}`}
                    />
                    {t.categorySource && (
                      <small className="source-label" style={{ marginTop: "6px" }}>
                        {t.categorySource === "rule"
                          ? "categorizado por regra"
                          : t.categorySource === "history"
                            ? "sugerido pelo seu histórico"
                            : "selecionado manualmente"}
                      </small>
                    )}
                  </td>
                  <td>
                    <span className={t.status === "cleared" ? "badge" : "badge status-warning"}>
                      {t.status === "cleared" ? "Confirmada" : "Pendente"}
                    </span>
                    {t.status === "pending" && !t.isTransferLeg && t.linkedKind !== "credit_card_payment" && (
                      <button
                        className="text-button"
                        disabled={statusChanging === t.id}
                        onClick={() => void confirmPending(t)}
                      >
                        {statusChanging === t.id ? "Confirmando…" : "Confirmar lançamento"}
                      </button>
                    )}
                  </td>
                  <td className="amount">
                    <span className={t.amountInCents > 0 ? "positive" : ""}>{money(t.amountInCents)}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      {t.linkedKind !== "credit_card_payment" && (
                        <button
                          className="icon-button"
                          title={t.linkedKind === "transfer" ? "Editar transferência completa" : "Editar transação"}
                          aria-label={
                            t.linkedKind === "transfer"
                              ? `Editar transferência ${t.description}`
                              : `Editar ${t.description}`
                          }
                          onClick={() => setEditing(t)}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {t.linkedKind === "transfer" && (
                        <button
                          className="icon-button"
                          title="Desvincular os dois lançamentos"
                          aria-label={`Desvincular transferência ${t.description}`}
                          onClick={() => setUnlinking(t)}
                        >
                          <Unlink size={15} />
                        </button>
                      )}
                      {t.linkedKind !== "credit_card_payment" && (
                        <button
                          className="danger icon-button"
                          title={t.linkedKind === "transfer" ? "Excluir transferência completa" : "Excluir transação"}
                          aria-label={
                            t.linkedKind === "transfer"
                              ? `Excluir transferência ${t.description}`
                              : `Excluir ${t.description}`
                          }
                          onClick={() => (t.linkedKind === "transfer" ? setDeletingTransfer(t) : void deleteOne(t))}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          itemLabel="lançamentos"
        />
      </article>
      {learning && (
        <Modal title="Usar esta correção no futuro?" onClose={() => setLearning(undefined)}>
          <div className="modal-form correction-learning-modal">
            <p className="muted">Você pode criar uma regra local ou manter a alteração somente nesta transação.</p>
            <label>
              Descrição contém
              <input value={learning.pattern} onChange={(e) => setLearning({ ...learning, pattern: e.target.value })} />
            </label>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setLearning(undefined)}>
                Somente esta transação
              </button>
              <button onClick={createRule}>Criar regra</button>
            </div>
          </div>
        </Modal>
      )}
      {unlinking && (
        <Modal title="Desvincular transferência" onClose={() => setUnlinking(undefined)}>
          <article className="modal">
            <h2>Transformar em dois lançamentos separados?</h2>
            <p className="muted">
              Nenhum lançamento será apagado. O Lumen removerá apenas o vínculo e restaurará a categoria anterior de
              cada lado quando ela estiver disponível.
            </p>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setUnlinking(undefined)}>
                Cancelar
              </button>
              <button onClick={unlinkTransfer} disabled={actionBusy === `unlink:${unlinking.id}`}>
                <Unlink size={15} /> {actionBusy === `unlink:${unlinking.id}` ? "Desvinculando…" : "Desvincular"}
              </button>
            </div>
          </article>
        </Modal>
      )}
      {deletingTransfer && (
        <Modal title="Excluir transferência" onClose={() => setDeletingTransfer(undefined)}>
          <article className="modal">
            <h2>Mover a transferência inteira para a lixeira?</h2>
            <p className="muted">
              Os lançamentos de saída e entrada serão removidos juntos dos saldos e relatórios. Você poderá desfazer
              logo depois.
            </p>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setDeletingTransfer(undefined)}>
                Cancelar
              </button>
              <button
                className="danger"
                onClick={() => void deleteOne(deletingTransfer)}
                disabled={actionBusy === `delete:${deletingTransfer.id}`}
              >
                <Trash2 size={15} />{" "}
                {actionBusy === `delete:${deletingTransfer.id}` ? "Movendo…" : "Mover os dois lançamentos"}
              </button>
            </div>
          </article>
        </Modal>
      )}
      {confirmDelete && (
        <Modal title="Excluir transações" onClose={() => setConfirmDelete(false)}>
          <article className="modal">
            <h2>Excluir {selected.size} transações?</h2>
            <p className="muted">
              Elas serão removidas dos saldos e relatórios. Você poderá desfazer imediatamente após a ação.
            </p>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button className="danger" onClick={deleteSelected}>
                <Trash2 size={15} /> Mover para lixeira
              </button>
            </div>
          </article>
        </Modal>
      )}
    </section>
  );
}
