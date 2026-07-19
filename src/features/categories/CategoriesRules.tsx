import { PageHeader } from "../../shared/ui/PageHeader";
import { Modal } from "../../shared/ui/Modal";
import { Tabs } from "../../shared/ui/Tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CornerDownRight,
  FolderTree,
  Layers3,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  TestTube2,
  X,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { api } from "../../shared/api";
import type {
  Category,
  CategoryKind,
  CategorizationRule,
  MovementType,
  RuleImpact,
  RuleInput,
  RuleOperator,
} from "../../shared/types";
import { shortDate, money } from "../../shared/format";
import { currentMonth as curMonth, shiftMonth } from "../../shared/period";
import { CategoryIcon, CategorySelect } from "../../shared/ui/CategorySelect";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { Pagination, type PaginationSize } from "../../shared/ui/Pagination";
import { Select } from "../../shared/ui/Select";

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
  const [tab, setTab] = useState<"rules" | "categories" | "merchants">("rules");
  const [categoryKindFilter, setCategoryKindFilter] = useState<"all" | CategoryKind>("all");
  const [rulesPage, setRulesPage] = useState(0);
  const [rulesPageSize, setRulesPageSize] = useState<PaginationSize>(10);
  const [rule, setRule] = useState<RuleInput>(emptyRule);
  const [ruleInputVersion, setRuleInputVersion] = useState(0);
  const [impact, setImpact] = useState<RuleImpact>();
  const [historyImpact, setHistoryImpact] = useState<RuleImpact>();
  const [message, setMessage] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<{
    id?: string;
    parentId?: string;
    name: string;
    kind: CategoryKind;
    color: string;
    sortOrder: number;
  }>({ name: "", kind: "expense", color: "#497ca5", sortOrder: 0 });
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const categorySummary = useMemo(
    () => ({
      roots: categories.filter((category) => !category.parentId).length,
      children: categories.filter((category) => category.parentId).length,
      system: categories.filter((category) => category.isSystem).length,
    }),
    [categories],
  );
  const visibleRules = rules.slice(rulesPage * rulesPageSize, (rulesPage + 1) * rulesPageSize);

  useEffect(() => {
    setRulesPage((page) => Math.min(page, Math.max(0, Math.ceil(rules.length / rulesPageSize) - 1)));
  }, [rules.length, rulesPageSize]);

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
      setMessage("Esta categoria está em uso e não pode ser arquivada ainda.");
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
    <section className="categories-rules-page">
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
        onChange={(value) => setTab(value as typeof tab)}
        hidePanel
        tabs={[
          { id: "rules", label: `Regras (${rules.length})` },
          { id: "categories", label: `Categorias (${categories.length})` },
          { id: "merchants", label: "Estabelecimentos" },
        ]}
      />
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
              {visibleRules.map((r, pageIndex) => {
                const index = rulesPage * rulesPageSize + pageIndex;
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
                      disabled={index === 0}
                      onClick={() => moveRule(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className="icon-button rule-order-button"
                      title="Descer"
                      aria-label={`Descer ${r.name}`}
                      disabled={index === rules.length - 1}
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
              totalCount={rules.length}
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
        <>
          <section className="categories-summary" aria-label="Resumo das categorias">
            <article className="categories-summary-card">
              <span className="categories-summary-icon" aria-hidden>
                <Layers3 size={18} />
              </span>
              <div>
                <strong>{categories.length}</strong>
                <span>Categorias ativas</span>
              </div>
            </article>
            <article className="categories-summary-card">
              <span className="categories-summary-icon" aria-hidden>
                <FolderTree size={18} />
              </span>
              <div>
                <strong>{categorySummary.roots}</strong>
                <span>Principais</span>
              </div>
            </article>
            <article className="categories-summary-card">
              <span className="categories-summary-icon" aria-hidden>
                <CornerDownRight size={18} />
              </span>
              <div>
                <strong>{categorySummary.children}</strong>
                <span>Subcategorias</span>
              </div>
            </article>
            <article className="categories-summary-card">
              <span className="categories-summary-icon" aria-hidden>
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>{categorySummary.system}</strong>
                <span>Categorias padrão</span>
              </div>
            </article>
          </section>
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
                  const count = value === "all" ? categories.length : categories.filter((c) => c.kind === value).length;
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
                  const items = categories
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
        </>
      )}
      {tab === "merchants" && <MerchantsTab />}
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
  const startMonth = shiftMonth(curMonth(), -11);
  const filter = { startMonth, endMonth: curMonth(), source: "all" as const, accountId: undefined };
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PaginationSize>(10);
  const { data } = useQuery({
    queryKey: ["merchants", filter, page, pageSize],
    queryFn: () => api.listMerchantsPage({ ...filter, limit: pageSize, offset: page * pageSize }),
  });
  const [editingKey, setEditingKey] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const merchants = data?.items ?? [];

  async function save(key: string) {
    if (!draftName.trim()) return;
    await api.saveMerchantAlias(key, draftName.trim());
    setEditingKey(undefined);
    await client.invalidateQueries({ queryKey: ["merchants"] });
  }

  return (
    <div className="rules-layout">
      <article className="panel">
        <div className="panel-title">
          <h2>Principais estabelecimentos</h2>
          <span>Últimos 12 meses · renomeie para agrupar apelidos</span>
        </div>
        {merchants.length === 0 && <p className="muted">Nenhum gasto encontrado nos últimos 12 meses.</p>}
        <div className="rule-list">
          {merchants.map((m) => (
            <div className="rule-item" key={m.merchant}>
              <span className="category-swatch" style={{ background: "transparent" }} />
              {editingKey === m.merchantKey ? (
                <>
                  <input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus />
                  <span />
                  <button className="icon-button" title="Salvar" onClick={() => save(m.merchantKey!)}>
                    <Check size={14} />
                  </button>
                  <button className="icon-button" title="Cancelar" onClick={() => setEditingKey(undefined)}>
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <b>{m.merchant}</b>
                    <small>
                      {m.transactionCount} lançamento{m.transactionCount === 1 ? "" : "s"}
                    </small>
                  </div>
                  <span className="uses">{money(m.amountInCents)}</span>
                  {m.merchantKey && (
                    <button
                      className="icon-button"
                      title="Renomear"
                      onClick={() => {
                        setEditingKey(m.merchantKey);
                        setDraftName(m.merchant);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
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
      </article>
    </div>
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
        <span className="category-swatch" style={{ background: category.color ?? "#789" }} />
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
            title="Arquivar"
            onClick={onArchive}
            aria-label={`Arquivar ${category.name}`}
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
