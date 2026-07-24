import { PageHeader } from "../../shared/ui/PageHeader";
import { Modal } from "../../shared/ui/Modal";
import { Tabs } from "../../shared/ui/Tabs";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownRight,
  GitMerge,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import type {
  Category,
  CategoryMergeImpact,
  CategoryKind,
  CategorizationRule,
  MovementType,
  RuleImpact,
  RuleInput,
  RuleOperator,
} from "../../shared/types";
import { shortDate, money, normalizeText } from "../../shared/format";
import { CategoryIcon, CategorySelect } from "../../shared/ui/CategorySelect";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Pagination, type PaginationSize } from "../../shared/ui/Pagination";
import { Select } from "../../shared/ui/Select";
import { useToast } from "../../shared/ui/toast";
import { invalidateCategoryMergeQueries } from "../../shared/queryInvalidation";

const emptyRule: RuleInput = {
  name: "",
  priority: 100,
  enabled: true,
  operator: "contains",
  pattern: "",
  movementType: "any",
  categoryId: "",
  minAmountInCents: undefined,
  maxAmountInCents: undefined,
};

export function CategoriesRules() {
  const [searchParams, setSearchParams] = useSearchParams();
  const client = useQueryClient();
  const {
    data: categories = [],
    isLoading: categoriesLoading,
    isError: categoriesError,
    refetch: refetchCategories,
  } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const {
    data: rules = [],
    isLoading: rulesLoading,
    isError: rulesError,
    refetch: refetchRules,
  } = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<"rules" | "categories" | "merchants">(
    requestedTab === "categories" || requestedTab === "merchants" ? requestedTab : "rules",
  );
  const searchQuery = normalizeText(searchParams.get("q") ?? "");
  const [categoryKindFilter, setCategoryKindFilter] = useState<"all" | CategoryKind>("all");
  const [rulesPage, setRulesPage] = useState(0);
  const [rulesPageSize, setRulesPageSize] = useState<PaginationSize>(10);
  const [rule, setRule] = useState<RuleInput>(emptyRule);
  const [ruleInputVersion, setRuleInputVersion] = useState(0);
  const [impact, setImpact] = useState<RuleImpact>();
  const [historyImpact, setHistoryImpact] = useState<RuleImpact>();
  const [message, setMessage] = useState("");
  const [mergeDraft, setMergeDraft] = useState<{
    sourceId: string;
    targetId: string;
    impact?: CategoryMergeImpact;
    loading: boolean;
  }>();
  const mergePreviewToken = useRef(0);
  const mergeConfirmLock = useRef(false);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<{
    id?: string;
    parentId?: string;
    name: string;
    kind: CategoryKind;
    color: string;
    sortOrder: number;
  }>({ name: "", kind: "expense", color: "#497ca5", sortOrder: 0 });
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const matchingRules = searchQuery
    ? rules.filter((item) =>
        normalizeText(`${item.name} ${item.pattern} ${item.categoryName ?? ""}`).includes(searchQuery),
      )
    : rules;
  const matchingCategories = searchQuery
    ? categories.filter((item) => normalizeText(item.name).includes(searchQuery))
    : categories;
  const visibleRules = matchingRules.slice(rulesPage * rulesPageSize, (rulesPage + 1) * rulesPageSize);

  useEffect(() => {
    if (requestedTab === "rules" || requestedTab === "categories" || requestedTab === "merchants") setTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    setRulesPage((page) => Math.min(page, Math.max(0, Math.ceil(matchingRules.length / rulesPageSize) - 1)));
  }, [matchingRules.length, rulesPageSize]);

  // Herdar kind/color do pai quando parentId muda
  useEffect(() => {
    if (categoryDraft.parentId) {
      const parent = categoryMap.get(categoryDraft.parentId);
      if (parent) {
        setCategoryDraft((prev) => ({
          ...prev,
          kind: parent.kind,
          color: prev.color === "#497ca5" || prev.color === parent.color ? (parent.color ?? prev.color) : prev.color,
        }));
      }
    }
  }, [categoryDraft.parentId, categoryMap]);

  async function saveRule() {
    if (!rule.name || !rule.pattern || !rule.categoryId) {
      setMessage("Preencha nome, padrão e categoria.");
      return;
    }
    await api.saveRule(rule);
    setRuleInputVersion((version) => version + 1);
    setRule(emptyRule);
    setImpact(undefined);
    setMessage("Regra salva.");
    await client.invalidateQueries({ queryKey: ["rules"] });
  }
  async function testRule() {
    if (!rule.name || !rule.pattern || !rule.categoryId) {
      setMessage("Preencha a regra antes de testar.");
      return;
    }
    setImpact(await api.previewRule(rule));
  }
  async function applyAll() {
    setHistoryImpact(await api.previewAllRules(false));
  }
  async function confirmApplyAll() {
    const count = await api.applyRules(false);
    setMessage(`${count} transações categorizadas; escolhas manuais foram preservadas.`);
    setHistoryImpact(undefined);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["transactions"] }),
      client.invalidateQueries({ queryKey: ["summary"] }),
      client.invalidateQueries({ queryKey: ["rules"] }),
    ]);
  }
  async function moveRule(index: number, delta: number) {
    const next = [...rules];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await api.reorderRules(next.map((x) => x.id));
    await client.invalidateQueries({ queryKey: ["rules"] });
  }
  async function archiveRule(id: string) {
    await api.archiveRule(id);
    await client.invalidateQueries({ queryKey: ["rules"] });
  }
  async function saveCategory() {
    if (!categoryDraft.name) return;
    await api.saveCategory(categoryDraft);
    setCategoryDraft({ name: "", kind: "expense", color: "#497ca5", sortOrder: categories.length * 10 });
    await client.invalidateQueries({ queryKey: ["categories"] });
  }
  async function archiveCategory(id: string) {
    try {
      await api.archiveCategory(id);
      await client.invalidateQueries({ queryKey: ["categories"] });
    } catch {
      mergePreviewToken.current += 1;
      setMergeDraft({ sourceId: id, targetId: "", loading: false });
      setMessage("Esta categoria está em uso. Você pode uni-la a outra categoria do mesmo tipo.");
    }
  }
  function closeMergeCategory() {
    mergePreviewToken.current += 1;
    setMergeDraft(undefined);
  }
  async function previewMergeCategory(targetId: string) {
    if (!mergeDraft) return;
    const sourceId = mergeDraft.sourceId;
    const token = ++mergePreviewToken.current;
    if (!targetId) {
      setMergeDraft({ sourceId, targetId, loading: false });
      return;
    }
    setMergeDraft({ sourceId, targetId, loading: true });
    try {
      const impact = await api.previewCategoryMerge(sourceId, targetId);
      if (token !== mergePreviewToken.current) return;
      setMergeDraft((current) =>
        current?.sourceId === sourceId && current.targetId === targetId
          ? { sourceId, targetId, impact, loading: false }
          : current,
      );
    } catch (error: any) {
      if (token !== mergePreviewToken.current) return;
      setMergeDraft((current) => (current ? { ...current, loading: false } : current));
      setMessage(error?.message || String(error));
    }
  }
  async function confirmMergeCategory() {
    const snapshot = mergeDraft?.impact;
    if (!snapshot || mergeDraft.loading || mergeConfirmLock.current) return;
    mergeConfirmLock.current = true;
    setMergeSubmitting(true);
    try {
      const impact = await api.mergeCategory(snapshot.sourceCategoryId, snapshot.targetCategoryId);
      closeMergeCategory();
      setMessage(
        `${impact.sourceCategoryName} foi unida a ${impact.targetCategoryName}. ${impact.movedTransactions} lançamento(s) foram preservados.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ["categories"] }),
        client.invalidateQueries({ queryKey: ["rules"] }),
        client.invalidateQueries({ queryKey: ["transactions"] }),
        client.invalidateQueries({ queryKey: ["financial-targets"] }),
        invalidateCategoryMergeQueries(client),
      ]);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      mergeConfirmLock.current = false;
      setMergeSubmitting(false);
    }
  }
  function categoryOrderInput(category: Category, sortOrder: number): Partial<Category> {
    return {
      id: category.id,
      parentId: category.parentId,
      name: category.name,
      kind: category.kind,
      color: category.color,
      icon: category.icon,
      sortOrder,
    };
  }
  async function moveCategory(cat: Category, delta: number) {
    const siblings = categories
      .filter((c) => c.kind === cat.kind && (c.parentId ?? null) === (cat.parentId ?? null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const index = siblings.findIndex((c) => c.id === cat.id);
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    await Promise.all(reordered.map((c, i) => api.saveCategory(categoryOrderInput(c, siblings[i].sortOrder))));
    await client.invalidateQueries({ queryKey: ["categories"] });
  }
  async function dropCategory(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const dragged = categories.find((c) => c.id === draggedId);
    const target = categories.find((c) => c.id === targetId);
    if (!dragged || !target) return;
    if (dragged.kind !== target.kind || (dragged.parentId ?? null) !== (target.parentId ?? null)) return;
    const siblings = categories
      .filter((c) => c.kind === dragged.kind && (c.parentId ?? null) === (dragged.parentId ?? null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const from = siblings.findIndex((c) => c.id === draggedId);
    const to = siblings.findIndex((c) => c.id === targetId);
    if (from === -1 || to === -1) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    await Promise.all(reordered.map((c, i) => api.saveCategory(categoryOrderInput(c, siblings[i].sortOrder))));
    await client.invalidateQueries({ queryKey: ["categories"] });
  }
  function editRule(value: CategorizationRule) {
    setRule({
      id: value.id,
      name: value.name,
      priority: value.priority,
      enabled: value.enabled,
      operator: value.operator,
      pattern: value.pattern,
      accountId: value.accountId,
      movementType: value.movementType,
      minAmountInCents: value.minAmountInCents,
      maxAmountInCents: value.maxAmountInCents,
      categoryId: value.categoryId,
    });
    setImpact(undefined);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <section className="categories-rules-page" data-tutorial="categories">
      <PageHeader>
        <div>
          <p className="eyebrow">{tab === "categories" ? "PLANO DE CATEGORIAS" : "ORGANIZAÇÃO AUTOMÁTICA"}</p>
          <h1>Categorias e regras</h1>
          <p className="muted">
            {tab === "categories"
              ? "Organize receitas, despesas e investimentos em uma estrutura fácil de reconhecer."
              : "Regras locais, previsíveis e sempre revisáveis."}
          </p>
        </div>
        {tab === "rules" && (
          <button className="history-action" onClick={applyAll}>
            <Sparkles size={17} /> Aplicar ao histórico
          </button>
        )}
      </PageHeader>
      {categoriesLoading || rulesLoading ? (
        <LoadingState variant="panel" label="Carregando categorias e regras…" />
      ) : null}
      {(categoriesError || rulesError) && (
        <ErrorState
          message="Não foi possível carregar categorias e regras."
          onRetry={() => void Promise.all([refetchCategories(), refetchRules()])}
        />
      )}
      <Tabs
        value={tab}
        onChange={(value) => {
          const nextTab = value as typeof tab;
          setTab(nextTab);
          setSearchParams(
            (params) => {
              const next = new URLSearchParams(params);
              next.set("tab", nextTab);
              next.delete("q");
              return next;
            },
            { replace: true },
          );
        }}
        hidePanel
        tabs={[
          { id: "rules", label: `Regras (${rules.length})` },
          { id: "categories", label: `Categorias (${categories.length})` },
          { id: "merchants", label: "Estabelecimentos" },
        ]}
      />
      {searchQuery && (
        <div className="command-search-context">
          <Search size={15} aria-hidden="true" />
          <span>
            Exibindo {tab === "categories" ? matchingCategories.length : matchingRules.length} resultado(s) para “
            {searchParams.get("q")}”
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setSearchParams(
                (params) => {
                  const next = new URLSearchParams(params);
                  next.delete("q");
                  return next;
                },
                { replace: true },
              )
            }
          >
            Limpar
          </button>
        </div>
      )}
      {message && <p className="notice">{message}</p>}

      {tab === "rules" && (
        <div className="rules-layout rules-workspace">
          <article className="panel rule-editor rules-form-card">
            <div className="panel-title">
              <h2>{rule.id ? "Editar regra" : "Nova regra"}</h2>
              {rule.id && (
                <button
                  className="text-button"
                  onClick={() => {
                    setRuleInputVersion((version) => version + 1);
                    setRule(emptyRule);
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
            <label>
              Nome
              <input
                value={rule.name}
                onChange={(e) => setRule({ ...rule, name: e.target.value })}
                placeholder="Ex.: Mercado do bairro"
              />
            </label>
            <div className="form-row">
              <label>
                Correspondência
                <Select
                  value={rule.operator}
                  onChange={(value) => setRule({ ...rule, operator: value as RuleOperator })}
                  options={[
                    { value: "contains", label: "Descrição contém" },
                    { value: "starts_with", label: "Descrição começa com" },
                    { value: "regex", label: "Expressão regular" },
                  ]}
                />
              </label>
              <label>
                Movimento
                <Select
                  value={rule.movementType}
                  onChange={(value) => setRule({ ...rule, movementType: value as MovementType })}
                  options={[
                    { value: "any", label: "Qualquer" },
                    { value: "expense", label: "Despesa" },
                    { value: "income", label: "Receita" },
                    { value: "transfer", label: "Transferência" },
                  ]}
                />
              </label>
            </div>
            <label>
              Padrão
              <input
                value={rule.pattern}
                onChange={(e) => setRule({ ...rule, pattern: e.target.value })}
                placeholder="SUPERMERCADO"
              />
            </label>
            <CategorySelect
              value={rule.categoryId}
              onChange={(id) => setRule({ ...rule, categoryId: id ?? "" })}
              categories={categories}
              movementType={rule.movementType}
              allowEmpty
              emptyLabel="Selecione…"
              aria-label="Categoria da regra"
            />
            {rule.categoryId &&
              rule.movementType !== "any" &&
              (() => {
                const cat = categoryMap.get(rule.categoryId);
                const movementKind =
                  rule.movementType === "expense"
                    ? "expense"
                    : rule.movementType === "income"
                      ? "income"
                      : rule.movementType === "transfer"
                        ? "transfer"
                        : null;
                if (cat && movementKind && cat.kind !== movementKind) {
                  return (
                    <p className="form-error" style={{ fontSize: 12, marginTop: 4 }}>
                      ⚠️ Tipo da regra ({rule.movementType}) difere do tipo da categoria ({cat.kind}). A regra pode não
                      funcionar como esperado.
                    </p>
                  );
                }
                return null;
              })()}
            <label>
              Conta
              <Select
                value={rule.accountId ?? ""}
                onChange={(value) => setRule({ ...rule, accountId: value || undefined })}
                options={[
                  { value: "", label: "Todas as contas" },
                  ...accounts.map((account) => ({ value: account.id, label: account.name })),
                ]}
              />
            </label>
            <div className="form-row">
              <label>
                Valor mínimo
                <MoneyInput
                  key={`min-${rule.id ?? "new"}-${ruleInputVersion}`}
                  defaultCents={rule.minAmountInCents ?? 0}
                  onChange={(cents) => setRule({ ...rule, minAmountInCents: cents ?? undefined })}
                />
              </label>
              <label>
                Valor máximo
                <MoneyInput
                  key={`max-${rule.id ?? "new"}-${ruleInputVersion}`}
                  defaultCents={rule.maxAmountInCents ?? 0}
                  onChange={(cents) => setRule({ ...rule, maxAmountInCents: cents ?? undefined })}
                />
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => setRule({ ...rule, enabled: e.target.checked })}
              />{" "}
              Regra ativa
            </label>
            <div className="editor-actions rule-editor-actions">
              <button className="secondary rule-test-button" onClick={testRule}>
                <TestTube2 size={16} /> Testar impacto
              </button>
              <button className="rule-save-button" onClick={saveRule}>
                <Save size={16} /> Salvar regra
              </button>
            </div>
            {impact && (
              <div className="impact">
                <b>{impact.count} transações correspondem</b>
                {impact.sample.map((x) => (
                  <div key={x.transactionId}>
                    <span>
                      {shortDate(x.date)} · {x.description}
                    </span>
                    <small>
                      {x.currentCategory ?? "Sem categoria"} → {x.suggestedCategory}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="panel rules-priority-panel">
            <div className="panel-title">
              <h2>Prioridade das regras</h2>
              <span>A primeira correspondência vence</span>
            </div>
            <div className="rule-list">
              {visibleRules.map((r) => {
                const index = rules.findIndex((item) => item.id === r.id);
                return (
                  <div className={`rule-item rule-priority-item ${!r.enabled ? "disabled" : ""}`} key={r.id}>
                    <span
                      className="category-swatch"
                      style={{ background: categoryMap.get(r.categoryId)?.color ?? "#789" }}
                    />
                    <div
                      onClick={() => editRule(r)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          editRule(r);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <b>{r.name}</b>
                      <small>
                        {operatorLabel(r.operator)} “{r.pattern}” · {r.categoryName}
                      </small>
                    </div>
                    <span className="uses">{r.useCount} usos</span>
                    <button
                      className="icon-button rule-order-button"
                      title="Subir"
                      aria-label={`Subir ${r.name}`}
                      disabled={Boolean(searchQuery) || index === 0}
                      onClick={() => moveRule(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className="icon-button rule-order-button"
                      title="Descer"
                      aria-label={`Descer ${r.name}`}
                      disabled={Boolean(searchQuery) || index === rules.length - 1}
                      onClick={() => moveRule(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      className="icon-button rule-archive-button"
                      title="Arquivar"
                      aria-label={`Arquivar ${r.name}`}
                      onClick={() => archiveRule(r.id)}
                    >
                      <Archive size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <Pagination
              page={rulesPage}
              pageSize={rulesPageSize}
              totalCount={matchingRules.length}
              onPageChange={setRulesPage}
              onPageSizeChange={(size) => {
                setRulesPageSize(size);
                setRulesPage(0);
              }}
              itemLabel="regras"
            />
          </article>
        </div>
      )}

      {tab === "categories" && (
        <div className="rules-layout categories-layout">
          <article className="panel rule-editor category-editor-panel">
            <div className="panel-title category-editor-heading">
              <div>
                <p className="eyebrow">{categoryDraft.id ? "EDIÇÃO" : "NOVA CATEGORIA"}</p>
                <h2>{categoryDraft.id ? categoryDraft.name : "Criar categoria"}</h2>
                <span>Defina como ela aparece e onde fica na hierarquia.</span>
              </div>
              {categoryDraft.id && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setCategoryDraft({ name: "", kind: "expense", color: "#497ca5", sortOrder: 0 })}
                >
                  Cancelar
                </button>
              )}
            </div>
            <div className="category-editor-preview" aria-label="Prévia da categoria">
              <span
                className="category-editor-preview-icon"
                style={{ color: categoryDraft.color, backgroundColor: `${categoryDraft.color}1a` }}
              >
                <CategoryIcon name="tag" size={18} />
              </span>
              <div>
                <strong>{categoryDraft.name || "Nome da categoria"}</strong>
                <span>
                  {categoryDraft.parentId
                    ? `Dentro de ${categoryMap.get(categoryDraft.parentId)?.name ?? "categoria"}`
                    : "Categoria principal"}
                </span>
              </div>
            </div>
            <label className="category-field category-field--name">
              Nome
              <input
                value={categoryDraft.name}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              />
            </label>
            <label className="category-field">
              Tipo
              <Select
                value={categoryDraft.kind}
                onChange={(value) => setCategoryDraft({ ...categoryDraft, kind: value as CategoryKind })}
                options={[
                  { value: "expense", label: "Despesa" },
                  { value: "income", label: "Receita" },
                  { value: "transfer", label: "Transferência" },
                  { value: "investment", label: "Investimento" },
                ]}
              />
            </label>
            <label className="category-field category-parent-field">
              Categoria superior
              <Select
                value={categoryDraft.parentId ?? ""}
                onChange={(value) => setCategoryDraft({ ...categoryDraft, parentId: value || undefined })}
                options={[
                  { value: "", label: "Nenhuma" },
                  ...categories
                    .filter((category) => category.id !== categoryDraft.id)
                    .map((category) => ({ value: category.id, label: category.name })),
                ]}
              />
            </label>
            <label className="category-field category-order-field">
              Ordem
              <input
                type="number"
                value={categoryDraft.sortOrder}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, sortOrder: Number(e.target.value) })}
              />
            </label>
            <label className="category-field category-color-field">
              Cor
              <input
                type="color"
                value={categoryDraft.color}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, color: e.target.value })}
              />
            </label>
            <button className="category-editor-submit" onClick={saveCategory}>
              <Plus size={16} /> {categoryDraft.id ? "Salvar categoria" : "Criar categoria"}
            </button>
          </article>
          <article className="panel categories-structure-panel">
            <div className="panel-title categories-structure-heading">
              <div>
                <h2>Estrutura de categorias</h2>
                <span>As subcategorias ficam agrupadas abaixo da categoria principal.</span>
              </div>
              <span className="categories-structure-count">{categories.length} no total</span>
            </div>
            <div className="category-kind-filters" role="group" aria-label="Filtrar categorias por tipo">
              {(
                [
                  ["all", "Todas"],
                  ["income", "Receitas"],
                  ["expense", "Despesas"],
                  ["investment", "Investimentos"],
                  ["transfer", "Transferências"],
                ] as const
              ).map(([value, label]) => {
                const count =
                  value === "all"
                    ? matchingCategories.length
                    : matchingCategories.filter((c) => c.kind === value).length;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`category-kind-filter ${categoryKindFilter === value ? "active" : ""}`}
                    aria-pressed={categoryKindFilter === value}
                    onClick={() => setCategoryKindFilter(value)}
                  >
                    <span>{label}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
            {(() => {
              const kinds: CategoryKind[] = ["income", "expense", "investment", "transfer"];
              const kindLabels: Record<CategoryKind, string> = {
                income: "Receitas",
                expense: "Despesas",
                investment: "Investimentos",
                transfer: "Transferências",
              };
              const visibleKinds = categoryKindFilter === "all" ? kinds : [categoryKindFilter];
              const groups = visibleKinds.map((kind) => {
                const items = matchingCategories
                  .filter((c) => c.kind === kind)
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                if (items.length === 0) return null;
                const itemIds = new Set(items.map((item) => item.id));
                const roots = items.filter((c) => !c.parentId || !itemIds.has(c.parentId));
                const childrenOf = (parentId: string): Category[] => items.filter((c) => c.parentId === parentId);
                const renderNode = (cat: Category, depth: number): React.ReactNode => {
                  const children = childrenOf(cat.id);
                  return (
                    <CategoryTreeNode
                      key={cat.id}
                      category={cat}
                      depth={depth}
                      hasChildren={children.length > 0}
                      categories={categories}
                      onEdit={() =>
                        setCategoryDraft({
                          id: cat.id,
                          parentId: cat.parentId,
                          name: cat.name,
                          kind: cat.kind,
                          color: cat.color ?? "#497ca5",
                          sortOrder: cat.sortOrder,
                        })
                      }
                      onArchive={() => archiveCategory(cat.id)}
                      onMoveUp={() => moveCategory(cat, -1)}
                      onMoveDown={() => moveCategory(cat, 1)}
                      onDrop={(draggedId) => dropCategory(draggedId, cat.id)}
                    >
                      {children.map((child) => renderNode(child, depth + 1))}
                    </CategoryTreeNode>
                  );
                };
                return (
                  <div key={kind} className={`category-group category-group--${kind}`}>
                    <div className="category-group-heading">
                      <h3 className="category-group-title">{kindLabels[kind]}</h3>
                      <span>
                        {items.length} {items.length === 1 ? "categoria" : "categorias"}
                      </span>
                    </div>
                    <div className={`category-tree category-tree--${kind}`} role="tree">
                      {roots.map((root) => renderNode(root, 0))}
                    </div>
                  </div>
                );
              });
              return groups.some(Boolean) ? (
                groups
              ) : (
                <p className="categories-empty-state muted">Nenhuma categoria neste tipo.</p>
              );
            })()}
          </article>
        </div>
      )}
      {tab === "merchants" && <MerchantsTab />}
      {mergeDraft && (
        <Modal title="Unir categoria" onClose={closeMergeCategory}>
          <article className="modal">
            <h2>Para onde vão os lançamentos?</h2>
            <p className="muted">
              Escolha uma categoria parecida. O Lumen preserva lançamentos, regras, recorrências e subcategorias.
            </p>
            <label>
              Categoria de destino
              <CategorySelect
                value={mergeDraft.targetId || undefined}
                onChange={(id) => void previewMergeCategory(id ?? "")}
                categories={categories.filter((category) => {
                  const source = categoryMap.get(mergeDraft.sourceId);
                  return category.id !== mergeDraft.sourceId && category.kind === source?.kind;
                })}
                emptyLabel="Escolher categoria"
                aria-label="Categoria de destino"
              />
            </label>
            {mergeDraft.loading && <LoadingState variant="panel" label="Calculando impacto da união…" />}
            {mergeDraft.impact && !mergeDraft.loading && (
              <div className="notice" role="status">
                <strong>{mergeDraft.impact.movedTransactions} lançamento(s)</strong>, {mergeDraft.impact.movedRules}{" "}
                regra(s), {mergeDraft.impact.movedRecurring} recorrência(s), {mergeDraft.impact.movedChildren}{" "}
                subcategoria(s) e {mergeDraft.impact.movedTargets} meta(s) serão movidos para{" "}
                {mergeDraft.impact.targetCategoryName}.
                {mergeDraft.impact.archivedTargets > 0 && (
                  <p className="form-error" role="alert">
                    Atenção: {mergeDraft.impact.archivedTargets} meta(s) conflitante(s) serão arquivadas para evitar
                    limites duplicados.
                  </p>
                )}
              </div>
            )}
            <div className="editor-actions">
              <button className="secondary" onClick={closeMergeCategory} disabled={mergeSubmitting}>
                Cancelar
              </button>
              <button
                disabled={!mergeDraft.impact || mergeDraft.loading || mergeSubmitting}
                onClick={confirmMergeCategory}
              >
                <GitMerge size={16} /> {mergeSubmitting ? "Unindo…" : "Unir categorias"}
              </button>
            </div>
          </article>
        </Modal>
      )}
      {historyImpact && (
        <Modal title="Aplicar regras ao histórico?" onClose={() => setHistoryImpact(undefined)}>
          <article className="modal">
            <h2>Aplicar regras ao histórico?</h2>
            <p className="muted">
              {historyImpact.count} transações serão categorizadas. Categorias definidas manualmente serão preservadas.
            </p>
            <div className="impact">
              {historyImpact.sample.map((x) => (
                <div key={x.transactionId}>
                  <span>
                    {shortDate(x.date)} · {x.description}
                  </span>
                  <small>
                    {x.currentCategory ?? "Sem categoria"} → {x.suggestedCategory}
                  </small>
                </div>
              ))}
            </div>
            <div className="editor-actions">
              <button className="secondary" onClick={() => setHistoryImpact(undefined)}>
                Cancelar
              </button>
              <button onClick={confirmApplyAll}>Confirmar aplicação</button>
            </div>
          </article>
        </Modal>
      )}
    </section>
  );
}

function MerchantsTab() {
  const client = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PaginationSize>(10);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const filter = { search: debouncedSearch || undefined, sort: "transaction_count" as const };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["merchants", filter, page, pageSize],
    queryFn: () => api.listMerchantsPage({ ...filter, limit: pageSize, offset: page * pageSize }),
    placeholderData: keepPreviousData,
  });
  const { data: aliases = [] } = useQuery({ queryKey: ["merchant-aliases"], queryFn: api.merchantAliases });
  const [editingKey, setEditingKey] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const [savingKey, setSavingKey] = useState<string>();
  const merchants = data?.items ?? [];
  const totalCount = data?.totalCount;

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => setPage(0), [debouncedSearch, pageSize]);

  useEffect(() => {
    if (totalCount === undefined) return;
    const lastPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [totalCount, page, pageSize]);

  async function save(key: string) {
    if (!draftName.trim()) return;
    setSavingKey(key);
    try {
      await api.saveMerchantAlias(key, draftName.trim());
      setEditingKey(undefined);
      toast("Nome do estabelecimento atualizado.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["merchants"] }),
        client.invalidateQueries({ queryKey: ["merchant-aliases"] }),
      ]);
    } catch (error: any) {
      toast(`Não foi possível atualizar o nome: ${error?.message || error}`, "error");
    } finally {
      setSavingKey(undefined);
    }
  }

  async function restore(key: string) {
    const alias = aliases.find((item) => item.merchantKey === key);
    if (!alias) return;
    setSavingKey(key);
    try {
      await api.deleteMerchantAlias(alias.id);
      setEditingKey(undefined);
      toast("Nome original restaurado.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["merchants"] }),
        client.invalidateQueries({ queryKey: ["merchant-aliases"] }),
      ]);
    } catch (error: any) {
      toast(`Não foi possível restaurar o nome: ${error?.message || error}`, "error");
    } finally {
      setSavingKey(undefined);
    }
  }

  return (
    <section className="merchants-workspace">
      <PendingPixPanel />
      <article className="panel merchants-panel">
        <div className="panel-title merchants-heading">
          <div>
            <h2>Gerenciar estabelecimentos</h2>
            <span>Use nomes mais claros sem alterar nem combinar os lançamentos originais.</span>
          </div>
          <span className="merchants-total">{data?.totalCount ?? 0} no histórico</span>
        </div>
        <label className="merchants-search">
          <span>Buscar por nome original ou personalizado</span>
          <span className="merchants-search-control">
            <Search size={17} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Ex.: supermercado"
            />
          </span>
        </label>
        {isLoading && <LoadingState label="Carregando estabelecimentos…" />}
        {isError && (
          <ErrorState message="Não foi possível carregar os estabelecimentos." onRetry={() => void refetch()} />
        )}
        {!isLoading && !isError && merchants.length === 0 && (
          <EmptyState
            title={debouncedSearch ? "Nenhum estabelecimento encontrado" : "Nenhum estabelecimento disponível"}
            description={
              debouncedSearch
                ? "Tente buscar por outro nome original ou personalizado."
                : "Os estabelecimentos aparecerão após a importação de despesas."
            }
          />
        )}
        {!isLoading && !isError && merchants.length > 0 && (
          <div className="merchants-list" role="list">
            {merchants.map((merchant) => {
              const displayName = merchant.alias ?? merchant.originalName;
              const editing = editingKey === merchant.merchantKey;
              const saving = savingKey === merchant.merchantKey;
              return (
                <div className="merchant-row" role="listitem" key={merchant.merchantKey}>
                  <div className="merchant-identity">
                    {editing ? (
                      <label>
                        <span>Nome personalizado</span>
                        <input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void save(merchant.merchantKey);
                            if (event.key === "Escape") setEditingKey(undefined);
                          }}
                          disabled={saving}
                          autoFocus
                        />
                      </label>
                    ) : (
                      <>
                        <strong>{displayName}</strong>
                        {merchant.alias && <small>Original: {merchant.originalName}</small>}
                      </>
                    )}
                  </div>
                  <div className="merchant-metric">
                    <span>Lançamentos</span>
                    <strong>{merchant.transactionCount}</strong>
                  </div>
                  <div className="merchant-metric merchant-amount">
                    <span>Total de despesas</span>
                    <strong>{money(merchant.amountInCents)}</strong>
                  </div>
                  <div className="merchant-actions">
                    {editing ? (
                      <>
                        <button
                          className="secondary compact merchant-action-cancel"
                          aria-label={`Cancelar edição de ${displayName}`}
                          onClick={() => setEditingKey(undefined)}
                          disabled={saving}
                        >
                          <X size={15} /> Cancelar
                        </button>
                        <button
                          className="compact merchant-action-save"
                          aria-label={`Salvar nome de ${merchant.originalName}`}
                          onClick={() => void save(merchant.merchantKey)}
                          disabled={saving || !draftName.trim()}
                        >
                          <Check size={15} /> {saving ? "Salvando…" : "Salvar"}
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          className="merchant-action-link merchant-action-view"
                          to={`/transactions?merchantKey=${encodeURIComponent(merchant.merchantKey)}`}
                        >
                          Ver lançamentos
                        </Link>
                        <button
                          className="secondary compact merchant-action-rename"
                          onClick={() => {
                            setEditingKey(merchant.merchantKey);
                            setDraftName(displayName);
                          }}
                        >
                          <Pencil size={15} /> Renomear
                        </button>
                        {merchant.alias && (
                          <button
                            className="secondary compact merchant-action-restore"
                            onClick={() => void restore(merchant.merchantKey)}
                            disabled={saving}
                          >
                            <RotateCcw size={15} /> Restaurar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="merchants-pagination">
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={data?.totalCount ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            itemLabel="estabelecimentos"
          />
        </div>
      </article>
    </section>
  );
}

function PendingPixPanel() {
  const client = useQueryClient();
  const toast = useToast();
  const {
    data: pending = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["pending-pix"],
    queryFn: api.pendingPixTransactions || (() => Promise.resolve([])),
  });
  const { data: merchantOptions = [] } = useQuery({
    queryKey: ["merchant-options"],
    queryFn: api.merchantOptions || (() => Promise.resolve([])),
    enabled: pending.length > 0,
  });
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [newNames, setNewNames] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string>();

  async function confirm(transactionId: string) {
    const merchantKey = selected[transactionId];
    const newDisplayName = newNames[transactionId]?.trim();
    if (!merchantKey && !newDisplayName) return;
    setSavingId(transactionId);
    try {
      await api.identifyTransactionMerchant(transactionId, merchantKey ? { merchantKey } : { newDisplayName });
      toast("Pix identificado. Ele agora aparece no estabelecimento escolhido.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["pending-pix"] }),
        client.invalidateQueries({ queryKey: ["merchants"] }),
        client.invalidateQueries({ queryKey: ["merchant-options"] }),
        client.invalidateQueries({ queryKey: ["merchant-aliases"] }),
        client.invalidateQueries({ queryKey: ["financial-report"] }),
        client.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
    } catch (error: any) {
      toast(`Não foi possível identificar o Pix: ${error?.message || error}`, "error");
    } finally {
      setSavingId(undefined);
    }
  }

  const options = merchantOptions.map((merchant) => ({
    value: merchant.merchantKey,
    label: merchant.displayName,
  }));

  return (
    <article className="panel pending-pix-panel" aria-labelledby="pending-pix-title">
      <div className="panel-title merchants-heading">
        <div>
          <h2 id="pending-pix-title">Pix pendentes de identificação</h2>
          <span>Eles continuam nos totais. Só entram em Estabelecimentos depois da sua confirmação.</span>
        </div>
        <span className="merchants-total">{pending.length} pendentes</span>
      </div>
      {isLoading && <LoadingState label="Carregando Pix pendentes…" />}
      {isError && <ErrorState message="Não foi possível carregar os Pix pendentes." onRetry={() => void refetch()} />}
      {!isLoading && !isError && pending.length === 0 && (
        <EmptyState
          title="Nenhum Pix pendente"
          description="Pix com identificação confiável e lançamentos já confirmados ficam na lista de estabelecimentos."
        />
      )}
      {!isLoading && !isError && pending.length > 0 && (
        <div className="pending-pix-list" role="list" aria-live="polite">
          {pending.map((item) => {
            const selectedKey = selected[item.id] ?? "";
            const newName = newNames[item.id] ?? "";
            const saving = savingId === item.id;
            return (
              <div className="pending-pix-row" role="listitem" key={item.id}>
                <div className="pending-pix-summary">
                  <strong>Pix sem identificação</strong>
                  <span>
                    {shortDate(item.date)} · {money(item.amountInCents)}
                    {item.category ? ` · ${item.category}` : ""}
                  </span>
                  <details>
                    <summary>Ver texto original do banco</summary>
                    <small>{item.originalDescription}</small>
                  </details>
                </div>
                {item.suggestedMerchantKey && (
                  <div className="pending-pix-suggestion">
                    <span>
                      Sugestão: <strong>{item.suggestedMerchantName}</strong>
                    </span>
                    <small>{item.suggestionReason}</small>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={() => {
                        setSelected((current) => ({
                          ...current,
                          [item.id]: item.suggestedMerchantKey!,
                        }));
                        setNewNames((current) => ({ ...current, [item.id]: "" }));
                      }}
                    >
                      Usar sugestão
                    </button>
                  </div>
                )}
                <div className="pending-pix-identification">
                  <Select
                    ariaLabel={`Estabelecimento para o Pix de ${shortDate(item.date)} no valor de ${money(item.amountInCents)}`}
                    value={selectedKey}
                    onChange={(value) => {
                      setSelected((current) => ({ ...current, [item.id]: value }));
                      if (value) setNewNames((current) => ({ ...current, [item.id]: "" }));
                    }}
                    options={[{ value: "", label: "Escolher estabelecimento existente" }, ...options]}
                  />
                  <span className="muted">ou</span>
                  <label>
                    <span>Novo nome</span>
                    <input
                      aria-label={`Novo nome para o Pix de ${shortDate(item.date)} no valor de ${money(item.amountInCents)}`}
                      value={newName}
                      onChange={(event) => {
                        setNewNames((current) => ({ ...current, [item.id]: event.target.value }));
                        if (event.target.value) {
                          setSelected((current) => ({ ...current, [item.id]: "" }));
                        }
                      }}
                      placeholder="Ex.: Feira do bairro"
                      maxLength={120}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Confirmar identificação do Pix de ${shortDate(item.date)} no valor de ${money(item.amountInCents)}`}
                    onClick={() => void confirm(item.id)}
                    disabled={saving || (!selectedKey && !newName.trim())}
                  >
                    {saving ? "Confirmando…" : "Confirmar identificação"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function operatorLabel(value: RuleOperator) {
  return value === "contains" ? "contém" : value === "starts_with" ? "começa com" : "regex";
}

function CategoryTreeNode({
  category,
  depth,
  hasChildren,
  categories,
  onEdit,
  onArchive,
  onMoveUp,
  onMoveDown,
  onDrop,
  children,
}: {
  category: Category;
  depth: number;
  hasChildren: boolean;
  categories: Category[];
  onEdit: () => void;
  onArchive: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDrop: (draggedId: string) => void;
  children?: ReactNode;
}) {
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined;
  return (
    <div
      className={`category-tree-node ${depth > 0 ? "category-tree-node--child" : "category-tree-node--root"}`}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={hasChildren ? true : undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/category-id", category.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/category-id")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/category-id");
        if (draggedId) onDrop(draggedId);
      }}
    >
      <div className="category-row tree-row">
        <span className="category-drag-handle" aria-hidden title="Arraste para reordenar">
          ⋮⋮
        </span>
        <span
          className="category-icon category-icon-tile"
          style={{ color: category.color ?? "#789", backgroundColor: `${category.color ?? "#789"}1a` }}
        >
          <CategoryIcon name={category.icon ?? "tag"} size={18} />
        </span>
        <div className="tree-content">
          <div className="category-title-row">
            <b>{category.name}</b>
            {category.isSystem && <span className="system-label">padrão</span>}
          </div>
          <small className={`category-hierarchy-label ${parent ? "is-child" : "is-root"}`}>
            {parent ? (
              <>
                <CornerDownRight size={12} aria-hidden /> Subcategoria de {parent.name}
              </>
            ) : (
              "Categoria principal"
            )}
          </small>
          {hasChildren && (
            <span className="tree-children-count" title="Possui subcategorias">
              Possui subcategorias
            </span>
          )}
        </div>
        <div className="tree-row-actions">
          <button
            className="icon-button category-action-button category-action-button--square"
            title="Subir"
            onClick={onMoveUp}
            aria-label={`Subir ${category.name}`}
          >
            <ArrowUp size={14} />
          </button>
          <button
            className="icon-button category-action-button category-action-button--square"
            title="Descer"
            onClick={onMoveDown}
            aria-label={`Descer ${category.name}`}
          >
            <ArrowDown size={14} />
          </button>
          <button
            className="icon-button category-action-button"
            title="Editar"
            onClick={onEdit}
            aria-label={`Editar ${category.name}`}
          >
            <Pencil size={14} /> <span>Editar</span>
          </button>
          <button
            className="icon-button category-action-button category-action-button--square"
            title={category.isSystem ? "Categoria essencial do Lumen" : "Arquivar"}
            onClick={onArchive}
            aria-label={`Arquivar ${category.name}`}
            disabled={category.isSystem}
          >
            <Archive size={14} />
          </button>
        </div>
      </div>
      {hasChildren && (
        <div className="category-tree-children" role="group">
          {children}
        </div>
      )}
    </div>
  );
}
