import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Check, Pencil, Plus, Save, Sparkles, TestTube2, X } from "lucide-react";
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
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: rules = [] } = useQuery({ queryKey: ["rules"], queryFn: api.rules });
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const [tab, setTab] = useState<"rules" | "categories" | "merchants">("rules");
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
    <section>
      <header>
        <div>
          <p className="eyebrow">ORGANIZAÇÃO AUTOMÁTICA</p>
          <h1>Categorias e regras</h1>
          <p className="muted">Regras locais, previsíveis e sempre revisáveis.</p>
        </div>
        <button onClick={applyAll}>
          <Sparkles size={17} /> Aplicar ao histórico
        </button>
      </header>
      <div className="tabs">
        <button className={tab === "rules" ? "selected" : ""} onClick={() => setTab("rules")}>
          Regras ({rules.length})
        </button>
        <button className={tab === "categories" ? "selected" : ""} onClick={() => setTab("categories")}>
          Categorias ({categories.length})
        </button>
        <button className={tab === "merchants" ? "selected" : ""} onClick={() => setTab("merchants")}>
          Estabelecimentos
        </button>
      </div>
      {message && <p className="notice">{message}</p>}

      {tab === "rules" && (
        <div className="rules-layout">
          <article className="panel rule-editor">
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
                <select
                  value={rule.operator}
                  onChange={(e) => setRule({ ...rule, operator: e.target.value as RuleOperator })}
                >
                  <option value="contains">Descrição contém</option>
                  <option value="starts_with">Descrição começa com</option>
                  <option value="regex">Expressão regular</option>
                </select>
              </label>
              <label>
                Movimento
                <select
                  value={rule.movementType}
                  onChange={(e) => setRule({ ...rule, movementType: e.target.value as MovementType })}
                >
                  <option value="any">Qualquer</option>
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                  <option value="transfer">Transferência</option>
                </select>
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
              <select
                value={rule.accountId ?? ""}
                onChange={(e) => setRule({ ...rule, accountId: e.target.value || undefined })}
              >
                <option value="">Todas as contas</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
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
            <div className="editor-actions">
              <button className="secondary" onClick={testRule}>
                <TestTube2 size={16} /> Testar impacto
              </button>
              <button onClick={saveRule}>
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
          <article className="panel">
            <div className="panel-title">
              <h2>Prioridade das regras</h2>
              <span>A primeira correspondência vence</span>
            </div>
            <div className="rule-list">
              {rules.map((r, index) => (
                <div className={`rule-item ${!r.enabled ? "disabled" : ""}`} key={r.id}>
                  <span
                    className="category-swatch"
                    style={{ background: categoryMap.get(r.categoryId)?.color ?? "#789" }}
                  />
                  <div onClick={() => editRule(r)} role="button" tabIndex={0}>
                    <b>{r.name}</b>
                    <small>
                      {operatorLabel(r.operator)} “{r.pattern}” · {r.categoryName}
                    </small>
                  </div>
                  <span className="uses">{r.useCount} usos</span>
                  <button className="icon-button" title="Subir" onClick={() => moveRule(index, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="icon-button" title="Descer" onClick={() => moveRule(index, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button className="icon-button" title="Arquivar" onClick={() => archiveRule(r.id)}>
                    <Archive size={14} />
                  </button>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}

      {tab === "categories" && (
        <div className="rules-layout">
          <article className="panel rule-editor">
            <div className="panel-title">
              <h2>{categoryDraft.id ? "Editar categoria" : "Nova categoria"}</h2>
              {categoryDraft.id && (
                <button
                  className="text-button"
                  onClick={() => setCategoryDraft({ name: "", kind: "expense", color: "#497ca5", sortOrder: 0 })}
                >
                  Cancelar
                </button>
              )}
            </div>
            <label>
              Nome
              <input
                value={categoryDraft.name}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
              />
            </label>
            <label>
              Tipo
              <select
                value={categoryDraft.kind}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, kind: e.target.value as CategoryKind })}
              >
                <option value="expense">Despesa</option>
                <option value="income">Receita</option>
                <option value="transfer">Transferência</option>
                <option value="investment">Investimento</option>
              </select>
            </label>
            <label>
              Categoria superior
              <select
                value={categoryDraft.parentId ?? ""}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, parentId: e.target.value || undefined })}
              >
                <option value="">Nenhuma</option>
                {categories
                  .filter((c) => c.id !== categoryDraft.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Ordem
              <input
                type="number"
                value={categoryDraft.sortOrder}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, sortOrder: Number(e.target.value) })}
              />
            </label>
            <label>
              Cor
              <input
                type="color"
                value={categoryDraft.color}
                onChange={(e) => setCategoryDraft({ ...categoryDraft, color: e.target.value })}
              />
            </label>
            <button onClick={saveCategory}>
              <Plus size={16} /> {categoryDraft.id ? "Salvar categoria" : "Criar categoria"}
            </button>
          </article>
          <article className="panel">
            <div className="panel-title">
              <h2>Estrutura atual</h2>
              <span>Transferências não contam como despesa</span>
            </div>
            {(() => {
              const kinds: CategoryKind[] = ["income", "expense", "investment", "transfer"];
              const kindLabels: Record<CategoryKind, string> = {
                income: "Receitas",
                expense: "Despesas",
                investment: "Investimentos",
                transfer: "Transferências",
              };
              return kinds.map((kind) => {
                const items = categories
                  .filter((c) => c.kind === kind)
                  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
                if (items.length === 0) return null;
                const roots = items.filter((c) => !c.parentId);
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
                  <div key={kind} className="category-group">
                    <h3 className="category-group-title">
                      {kindLabels[kind]} ({items.length})
                    </h3>
                    <div className="category-tree">{roots.map((root) => renderNode(root, 0))}</div>
                  </div>
                );
              });
            })()}
          </article>
        </div>
      )}
      {tab === "merchants" && <MerchantsTab />}
      {historyImpact && (
        <div className="modal-backdrop">
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
        </div>
      )}
    </section>
  );
}

function MerchantsTab() {
  const client = useQueryClient();
  const startMonth = shiftMonth(curMonth(), -11);
  const filter = { startMonth, endMonth: curMonth(), source: "all" as const, accountId: undefined };
  const { data: report } = useQuery({
    queryKey: ["financial-report", filter],
    queryFn: () => api.financialReport(filter),
  });
  const [editingKey, setEditingKey] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const merchants = report?.merchants ?? [];

  async function save(key: string) {
    if (!draftName.trim()) return;
    await api.saveMerchantAlias(key, draftName.trim());
    setEditingKey(undefined);
    await client.invalidateQueries({ queryKey: ["financial-report"] });
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
  const kindLabels: Record<CategoryKind, string> = {
    income: "Receita",
    expense: "Despesa",
    investment: "Investimento",
    transfer: "Transferência",
  };
  const parent = category.parentId ? categories.find((c) => c.id === category.parentId) : undefined;
  const barColor = depth > 0 ? (parent?.color ?? category.color ?? "#789") : (category.color ?? "#789");
  return (
    <div
      className="category-tree-node"
      style={{ marginLeft: depth > 0 ? depth * 16 : 0 }}
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
      {depth > 0 && (
        <span className="tree-bar" style={{ background: barColor, left: -10 - (depth - 1) * 16 }} aria-hidden />
      )}
      <div className="category-row tree-row">
        <span className="category-drag-handle" aria-label="Arraste para reordenar" title="Arraste para reordenar">
          ⋮⋮
        </span>
        <span className="category-swatch" style={{ background: category.color ?? "#789" }} />
        {category.icon && (
          <span className="category-icon" style={{ color: category.color ?? "#789" }}>
            <CategoryIcon name={category.icon} />
          </span>
        )}
        <div className="tree-content">
          <b>{category.name}</b>
          <small>{parent ? `${parent.name}` : "Raiz"}</small>
          <span className={`kind-badge ${category.kind}`}>{kindLabels[category.kind]}</span>
          {hasChildren && (
            <span className="tree-children-count" title="Sub-categorias">
              ▾
            </span>
          )}
        </div>
        {category.isSystem && <span className="system-label">padrão</span>}
        <div className="tree-row-actions">
          <button className="icon-button" title="Subir" onClick={onMoveUp} aria-label={`Subir ${category.name}`}>
            <ArrowUp size={14} />
          </button>
          <button className="icon-button" title="Descer" onClick={onMoveDown} aria-label={`Descer ${category.name}`}>
            <ArrowDown size={14} />
          </button>
          <button className="icon-button" onClick={onEdit} aria-label={`Editar ${category.name}`}>
            Editar
          </button>
          <button className="icon-button" onClick={onArchive} aria-label={`Arquivar ${category.name}`}>
            <Archive size={14} />
          </button>
        </div>
      </div>
      {hasChildren && <div className="category-tree-children">{children}</div>}
    </div>
  );
}
