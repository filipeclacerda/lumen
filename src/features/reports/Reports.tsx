import { PageHeader } from "../../shared/ui/PageHeader";
import { Modal } from "../../shared/ui/Modal";
import { Tabs } from "../../shared/ui/Tabs";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  CreditCard,
  Download,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import { currentMonth as curMonth, monthLabel, shiftMonth } from "../../shared/period";
import { MonthPicker } from "../../shared/ui/CalendarPicker";
import type {
  CategoryReport,
  FinancialReport,
  FinancialTarget,
  KindBreakdown,
  ReportFilter,
  ReportSource,
} from "../../shared/types";
import { CategoryDonut, UNCATEGORIZED_CATEGORY_KEY } from "./CategoryDonut";
import { CategoryTrendChart } from "./CategoryTrendChart";
import { CategorySelect } from "../../shared/ui/CategorySelect";
import {
  CumulativeExpensesChart,
  CategoryBarsChart,
  SourceComparisonChart,
  SpendingBarsChart,
} from "../../shared/ui/Charts";
import { useToast } from "../../shared/ui/toast";
import { MoneyInput } from "../../shared/ui/MoneyInput";
import { Select } from "../../shared/ui/Select";

const currentMonth = curMonth();
type ReportTab = "overview" | "categories" | "goals" | "credit";
type CategoryKindTab = "expense" | "income" | "investment";
const categoryKindLabels: Record<CategoryKindTab, string> = {
  expense: "Gastos",
  income: "Receitas",
  investment: "Investimentos",
};
const categoryValueLabels: Record<CategoryKindTab, string> = {
  expense: "Gasto",
  income: "Receita",
  investment: "Investimento",
};
function changeLabel(value?: number | null, inverse = false) {
  if (value === undefined || value === null) return "Sem base anterior";
  const improved = inverse ? value <= 0 : value >= 0;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% vs. mês anterior|${improved ? "good" : "bad"}`;
}
function categoryKey(category: Pick<CategoryReport, "categoryId">) {
  return category.categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
}
function categoryIdFromKey(key?: string) {
  return key === UNCATEGORIZED_CATEGORY_KEY ? undefined : key;
}
function transactionsPath(filter: ReportFilter, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  params.set("startMonth", filter.startMonth);
  params.set("endMonth", filter.endMonth);
  if (filter.source !== "all") params.set("source", filter.source);
  if (filter.accountId) params.set("accountId", filter.accountId);
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/transactions?${params.toString()}`;
}

export function Reports() {
  const [preset, setPreset] = useState("1");
  const [startMonth, setStartMonth] = useState(currentMonth);
  const [endMonth, setEndMonth] = useState(currentMonth);
  const [source, setSource] = useState<ReportSource>("all");
  const [accountId, setAccountId] = useState("");
  const [editing, setEditing] = useState<FinancialTarget>();
  const [exporting, setExporting] = useState(false);
  const client = useQueryClient();
  const toast = useToast();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const { data: categories = [] } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: api.profile });
  const filter: ReportFilter = { startMonth, endMonth, source, accountId: accountId || undefined };
  const invalidPeriod = startMonth > endMonth;
  const {
    data: report,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["financial-report", filter],
    queryFn: () => api.financialReport(filter),
    enabled: !invalidPeriod,
  });
  const { data: targets = [] } = useQuery({ queryKey: ["financial-targets"], queryFn: api.financialTargets });
  const filteredAccounts = accounts.filter(
    (a) => source === "all" || (source === "credit_card" ? a.kind === "credit_card" : a.kind !== "credit_card"),
  );
  useEffect(() => {
    if (accountId && !filteredAccounts.some((a) => a.id === accountId)) setAccountId("");
  }, [source, accountId, filteredAccounts]);
  function selectPreset(value: string) {
    setPreset(value);
    if (value !== "custom") {
      const count = Number(value);
      setEndMonth(currentMonth);
      setStartMonth(shiftMonth(currentMonth, -count + 1));
    }
  }
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["financial-report"] }),
      client.invalidateQueries({ queryKey: ["financial-targets"] }),
    ]);
  }
  async function removeTarget(id: string) {
    await api.deleteFinancialTarget(id);
    await refresh();
  }
  async function exportPdf() {
    if (!("__TAURI_INTERNALS__" in window)) {
      toast("Abra o aplicativo desktop para exportar o PDF.", "error");
      return;
    }
    const path = await save({
      defaultPath: `relatorio-${startMonth}-${endMonth}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    setExporting(true);
    try {
      const count = await api.exportFinancialReportPdf(path, filter);
      toast(`Relatório PDF exportado com ${count} lançamentos.`);
    } catch (error: any) {
      toast(`Não foi possível exportar o PDF: ${error?.message || error}`, "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="reports-page" data-tutorial="reports">
      <div>
        <PageHeader>
          <div>
            <p className="eyebrow">ANÁLISE FINANCEIRA</p>
            <h1>Relatórios</h1>
            <p className="muted">Entenda seus hábitos, compare períodos e acompanhe suas metas.</p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button className="secondary" disabled={exporting || invalidPeriod || !report} onClick={exportPdf}>
              <Download size={16} /> {exporting ? "Exportando..." : "PDF"}
            </button>
            <button
              onClick={() => setEditing({ id: "", kind: "category", amountInCents: 0, enabled: true, overrides: [] })}
            >
              <Plus size={16} /> Nova meta
            </button>
          </div>
        </PageHeader>
      </div>
      <article className="report-filters" data-quick-guide="reports-filters">
        <div className="filter-presets">
          {[
            ["1", "Mês"],
            ["3", "3 meses"],
            ["6", "6 meses"],
            ["12", "12 meses"],
            ["custom", "Personalizado"],
          ].map(([value, label]) => (
            <button key={value} className={preset === value ? "active" : ""} onClick={() => selectPreset(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="report-filter-fields">
          <label>
            <CalendarRange size={15} /> De
            <MonthPicker
              ariaLabel="Mês inicial do relatório"
              value={startMonth}
              onChange={(value) => {
                setPreset("custom");
                setStartMonth(value);
              }}
            />
          </label>
          <label>
            Até
            <MonthPicker
              ariaLabel="Mês final do relatório"
              value={endMonth}
              onChange={(value) => {
                setPreset("custom");
                setEndMonth(value);
              }}
            />
          </label>
          <label>
            Origem
            <Select
              value={source}
              onChange={(value) => setSource(value as ReportSource)}
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
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: "", label: "Todas as contas" },
                ...filteredAccounts.map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </label>
        </div>
      </article>
      {invalidPeriod && <p className="form-error">O mês inicial não pode ser posterior ao mês final.</p>}
      {!invalidPeriod && isLoading && <LoadingState variant="panel" label="Calculando seus relatórios…" />}
      {!invalidPeriod && error && (
        <ErrorState message="Não foi possível gerar o relatório." onRetry={() => void refetch()} />
      )}
      {!invalidPeriod && report && (
        <ReportContent
          report={report}
          filter={filter}
          profileIncome={profile?.monthlyIncomeInCents}
          targets={targets}
          compareWithPreviousMonth={preset === "1"}
          onEdit={setEditing}
          onDelete={removeTarget}
          onMerchantRenamed={refresh}
        />
      )}
      {editing && (
        <TargetEditor
          target={editing}
          month={endMonth}
          categories={categories.filter((c) => c.kind === "expense")}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function ReportContent({
  report,
  filter,
  profileIncome,
  targets,
  onEdit,
  onDelete,
  onMerchantRenamed,
  compareWithPreviousMonth,
}: {
  report: FinancialReport;
  filter: ReportFilter;
  profileIncome?: number;
  targets: FinancialTarget[];
  onEdit: (target: FinancialTarget) => void;
  onDelete: (id: string) => void;
  onMerchantRenamed: () => void;
  compareWithPreviousMonth: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ReportTab>("overview");
  const [renamingMerchant, setRenamingMerchant] = useState<{ key: string; name: string }>();
  const summary = report.summary;
  const topCategory = report.categories[0];
  const tabs: { id: ReportTab; label: string }[] = [
    { id: "overview", label: "Visão geral" },
    { id: "categories", label: "Categorias" },
    { id: "goals", label: "Metas" },
    ...(filter.source === "bank" ? [] : [{ id: "credit" as const, label: "Crédito" }]),
  ];
  useEffect(() => {
    if (activeTab === "credit" && filter.source === "bank") setActiveTab("overview");
  }, [activeTab, filter.source]);
  const cards = [
    {
      label: "Ganhos no período",
      value: summary.incomeInCents,
      detail: `Entradas em ${report.monthly.length} ${report.monthly.length === 1 ? "mês" : "meses"}`,
      icon: <ArrowUpRight />,
      tone: "emerald",
    },
    {
      label: "Gastos no período",
      value: summary.expensesInCents,
      detail: `Total em ${report.monthly.length} ${report.monthly.length === 1 ? "mês" : "meses"}`,
      icon: <ArrowDownRight />,
      tone: "red",
    },
    {
      label: "Maior categoria",
      value: topCategory?.amountInCents ?? 0,
      detail: topCategory
        ? `${topCategory.category} · ${topCategory.sharePercent.toFixed(1)}% dos gastos`
        : "Sem gastos no período",
      icon: <Target />,
      tone: "blue",
    },
    {
      label: "Média mensal",
      value: report.monthlyAverageInCents,
      detail: "Média do período filtrado",
      icon: <CalendarRange />,
      tone: "green",
    },
    {
      label: "Total investido atual",
      value: report.currentInvestedInCents,
      detail: "Patrimônio investido acumulado",
      icon: <TrendingUp />,
      tone: "blue",
    },
  ];
  return (
    <>
      <div className="report-kpis" data-quick-guide="reports-kpis">
        {cards.map((card) => (
          <article key={card.label}>
            <div className={`report-kpi-icon ${card.tone}`}>{card.icon}</div>
            <span>{card.label}</span>
            <strong>{money(card.value)}</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </div>
      <div data-quick-guide="reports-categories">
        <Tabs
          value={activeTab}
          onChange={(value) => setActiveTab(value as typeof activeTab)}
          hidePanel
          tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label }))}
        />
      </div>
      {activeTab === "overview" && (
        <OverviewTab
          report={report}
          filter={filter}
          compareWithPreviousMonth={compareWithPreviousMonth}
          onRenameMerchant={setRenamingMerchant}
        />
      )}
      {activeTab === "categories" && <CategoriesTab report={report} filter={filter} />}
      {activeTab === "goals" && (
        <GoalsTab report={report} profileIncome={profileIncome} targets={targets} onEdit={onEdit} onDelete={onDelete} />
      )}
      {activeTab === "credit" && <CreditTab report={report} />}
      {renamingMerchant && (
        <RenameMerchantModal
          merchant={renamingMerchant}
          onClose={() => setRenamingMerchant(undefined)}
          onSaved={() => {
            setRenamingMerchant(undefined);
            onMerchantRenamed();
          }}
        />
      )}
      <ReportAlerts report={report} filter={filter} />
    </>
  );
}

function OverviewTab({
  report,
  filter,
  onRenameMerchant,
  compareWithPreviousMonth,
}: {
  report: FinancialReport;
  filter: ReportFilter;
  onRenameMerchant: (merchant: { key: string; name: string }) => void;
  compareWithPreviousMonth: boolean;
}) {
  const summary = report.summary;
  const latest = report.latestMonthSummary;
  const spendingData =
    compareWithPreviousMonth && report.monthly.length === 1
      ? [
          {
            month: shiftMonth(filter.endMonth, -1),
            incomeInCents: report.previousSummary.incomeInCents,
            expensesInCents: report.previousSummary.expensesInCents,
            investmentsInCents: report.previousSummary.investmentsInCents,
            savingsInCents: report.previousSummary.savingsInCents,
            savingsRatePercent: report.previousSummary.savingsRatePercent,
          },
          ...report.monthly,
        ]
      : report.monthly;
  return (
    <>
      <div className="report-grid main-charts">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Resumo do período</h2>
              <small>Entradas, saídas e economia no filtro atual</small>
            </div>
          </div>
          <div className="period-summary">
            <div>
              <span>Receitas</span>
              <b>{money(summary.incomeInCents)}</b>
            </div>
            <div>
              <span>Despesas</span>
              <b>{money(summary.expensesInCents)}</b>
            </div>
            <div>
              <span>Economizado</span>
              <b className={summary.savingsInCents >= 0 ? "positive" : ""}>{money(summary.savingsInCents)}</b>
            </div>
            <div>
              <span>Aportes no período</span>
              <b>{money(summary.investmentsInCents)}</b>
            </div>
            <div>
              <span>Taxa de economia</span>
              <b>{summary.savingsRatePercent?.toFixed(1) ?? "—"}%</b>
            </div>
          </div>
          <div className="month-comparison">
            <b>{monthLabel(filter.endMonth)} x mês anterior</b>
            <ComparisonLine label="Despesas" value={latest.expenseChangePercent} inverse />
            <ComparisonLine label="Receitas" value={latest.incomeChangePercent} />
            <ComparisonLine label="Economia" value={latest.savingsChangePercent} />
          </div>
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Evolução dos gastos</h2>
              <small>Total gasto em cada mês filtrado</small>
            </div>
          </div>
          <SpendingBarsChart data={spendingData} />
        </article>
      </div>
      <div className="report-grid">
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Gasto acumulado</h2>
              <small>Evolução dentro de {monthLabel(filter.endMonth)}</small>
            </div>
          </div>
          <CumulativeExpensesChart data={report.daily} />
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Principais estabelecimentos</h2>
              <small>Somados no período selecionado</small>
            </div>
          </div>
          <MerchantRanking report={report} onRenameMerchant={onRenameMerchant} />
        </article>
      </div>
      <div className="report-grid insights-grid">
        <article className="panel">
          <div className="panel-title">
            <h2>Concentração dos gastos</h2>
          </div>
          <div className="insight-list">
            {report.categories.slice(0, 3).map((category) => (
              <div key={categoryKey(category)}>
                <span>{category.category}</span>
                <b>{category.sharePercent.toFixed(1)}%</b>
              </div>
            ))}
            {filter.source !== "bank" && (
              <div>
                <span>Compras no cartão</span>
                <b>{report.cardSharePercent.toFixed(1)}%</b>
              </div>
            )}
            <div>
              <span>Total sem categoria</span>
              <b>
                <Link to={transactionsPath(filter, { uncategorized: "1" })}>{money(report.uncategorizedInCents)}</Link>
              </b>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-title">
            <h2>Indicadores úteis</h2>
          </div>
          <div className="insight-list">
            <div>
              <span>Média mensal</span>
              <b>{money(report.monthlyAverageInCents)}</b>
            </div>
            <div>
              <span>Média diária de {monthLabel(filter.endMonth)}</span>
              <b>{money(latest.dailyAverageInCents)}</b>
            </div>
            <div>
              <span>Projeção de {monthLabel(filter.endMonth)}</span>
              <b>{money(latest.projectedExpensesInCents)}</b>
            </div>
            <div>
              <span>Maior dia do período</span>
              <b>
                {report.highestSpendingDay
                  ? `${shortDate(report.highestSpendingDay.date)} · ${money(report.highestSpendingDay.amountInCents)}`
                  : "—"}
              </b>
            </div>
            <div>
              <span>Sem categoria</span>
              <b>
                {report.uncategorizedCount} · {money(report.uncategorizedInCents)}
              </b>
            </div>
          </div>
        </article>
        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>Cartão x conta bancária</h2>
              <small>Participação nas despesas</small>
            </div>
          </div>
          <SourceComparisonChart sources={report.sources} />
        </article>
      </div>
    </>
  );
}

function CategoriesTab({ report, filter }: { report: FinancialReport; filter: ReportFilter }) {
  const [kind, setKind] = useState<CategoryKindTab>("expense");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>();
  const breakdown = report.kindBreakdown.find((item) => item.kind === kind) as KindBreakdown | undefined;
  const categories = useMemo(
    () => (kind === "expense" && report.categories.length ? report.categories : (breakdown?.categories ?? [])),
    [breakdown?.categories, kind, report.categories],
  );
  const total = kind === "expense" ? report.summary.expensesInCents : (breakdown?.totalInCents ?? 0);
  useEffect(() => {
    if (selectedCategoryKey && !categories.some((item) => categoryKey(item) === selectedCategoryKey))
      setSelectedCategoryKey(undefined);
  }, [categories, selectedCategoryKey]);
  const selectedCategory = categories.find((item) => categoryKey(item) === selectedCategoryKey);
  return (
    <article className="panel wide-panel">
      <div className="panel-title">
        <div>
          <h2>Categorias</h2>
          <small>Alterne entre gastos, receitas e investimentos no período selecionado</small>
        </div>
      </div>
      <div className="category-kind-tabs">
        {(["expense", "income", "investment"] as CategoryKindTab[]).map((item) => (
          <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>
            {categoryKindLabels[item]}
          </button>
        ))}
      </div>
      <div className="category-breakdown">
        <section className="category-breakdown-card category-distribution-card">
          <div className="category-breakdown-heading">
            <div>
              <h3>Distribuição</h3>
              <small>Selecione uma categoria para ver sua tendência</small>
            </div>
          </div>
          <CategoryDonut
            categories={categories}
            totalInCents={total}
            kindLabel={categoryKindLabels[kind]}
            selectedCategoryKey={selectedCategoryKey}
            onSelect={setSelectedCategoryKey}
          />
        </section>
        <section className="category-breakdown-card category-comparison-card">
          <div className="category-breakdown-heading">
            <div>
              <h3>Comparação por categoria</h3>
              <small>Valores ordenados do maior para o menor</small>
            </div>
            <strong>{money(total)}</strong>
          </div>
          <CategoryBarsChart
            categories={categories}
            selectedCategoryKey={selectedCategoryKey}
            onSelect={setSelectedCategoryKey}
            getCategoryKey={categoryKey}
            valueLabel={categoryValueLabels[kind]}
          />
        </section>
      </div>
      {selectedCategoryKey && (
        <CategoryTrendPanel
          categoryKey={selectedCategoryKey}
          categoryName={selectedCategory?.category ?? "Sem categoria"}
          filter={filter}
          onClose={() => setSelectedCategoryKey(undefined)}
        />
      )}
    </article>
  );
}

function GoalsTab({
  report,
  profileIncome,
  targets,
  onEdit,
  onDelete,
}: {
  report: FinancialReport;
  profileIncome?: number;
  targets: FinancialTarget[];
  onEdit: (target: FinancialTarget) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <article className="panel goals-panel">
      <div className="panel-title">
        <div>
          <h2>
            <Target size={17} /> Metas do mês
          </h2>
          <small>Metas recorrentes com ajustes mensais</small>
        </div>
      </div>
      {report.goals.length === 0 ? (
        <div className="report-empty">
          <Target />
          <div>
            <b>Nenhuma meta configurada</b>
            <p>
              {profileIncome
                ? `Sua renda de referência é ${money(profileIncome)}. Crie limites para transformar isso em um plano.`
                : "Cadastre sua renda e crie uma meta de economia ou gasto por categoria."}
            </p>
          </div>
        </div>
      ) : (
        <div className="goal-grid">
          {report.goals.map((goal) => (
            <div className={`goal-card ${goal.projectedToExceed ? "goal-warning" : ""}`} key={goal.targetId}>
              <div>
                <b>{goal.label}</b>
                <small>{goal.kind === "savings" ? "Objetivo de economia" : "Limite de gastos"}</small>
              </div>
              <strong>
                {money(goal.actualInCents)} <small>de {money(goal.targetInCents)}</small>
              </strong>
              <div className="goal-progress">
                <i style={{ width: `${Math.min(Math.max(goal.progressPercent, 0), 100)}%` }} />
              </div>
              <p>
                {goal.remainingInCents >= 0
                  ? `${money(goal.remainingInCents)} restantes`
                  : `Meta excedida em ${money(-goal.remainingInCents)}`}
                <span>Projeção: {money(goal.projectedInCents)}</span>
              </p>
              <div className="goal-actions">
                {targets.find((t) => t.id === goal.targetId) && (
                  <button className="secondary" onClick={() => onEdit(targets.find((t) => t.id === goal.targetId)!)}>
                    Editar
                  </button>
                )}
                <button className="icon-button danger" onClick={() => onDelete(goal.targetId)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function CreditTab({ report }: { report: FinancialReport }) {
  return (
    <div className="report-grid">
      <article className="panel">
        <div className="panel-title">
          <h2>Faturas e crédito</h2>
        </div>
        <div className="invoice-report">
          <CreditCard />
          <strong>{money(report.invoices.openTotalInCents)}</strong>
          <span>em faturas abertas</span>
          <div>
            <b>{report.invoices.openCount}</b> abertas <b>{report.invoices.paidCount}</b> pagas
          </div>
          <p>{report.cardSharePercent.toFixed(1)}% das despesas foram feitas no cartão.</p>
        </div>
      </article>
      <article className="panel">
        <div className="panel-title">
          <div>
            <h2>Origem dos gastos</h2>
            <small>Cartão comparado às contas bancárias</small>
          </div>
        </div>
        <SourceComparisonChart sources={report.sources} />
      </article>
    </div>
  );
}

function MerchantRanking({
  report,
  onRenameMerchant,
}: {
  report: FinancialReport;
  onRenameMerchant: (merchant: { key: string; name: string }) => void;
}) {
  return (
    <div className="ranking-list">
      {report.merchants.length ? (
        report.merchants.slice(0, 5).map((m, i) => (
          <div key={m.merchant}>
            <span className="rank">{i + 1}</span>
            <span>
              <b>{m.merchant}</b>
              <small>
                {m.transactionCount} lançamento{m.transactionCount === 1 ? "" : "s"}
              </small>
            </span>
            <strong>{money(m.amountInCents)}</strong>
            {m.merchantKey && (
              <button
                className="icon-button"
                aria-label={`Renomear ${m.merchant}`}
                onClick={() => onRenameMerchant({ key: m.merchantKey!, name: m.merchant })}
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="muted">Nenhum gasto no período.</p>
      )}
    </div>
  );
}

function ReportAlerts({ report, filter }: { report: FinancialReport; filter: ReportFilter }) {
  if (!report.alerts.length) return null;
  return (
    <article className="panel alerts-panel">
      <div className="panel-title">
        <h2>
          <AlertTriangle size={17} /> Pontos de atenção
        </h2>
      </div>
      <div>
        {report.alerts.map((alert) => (
          <p key={alert}>
            <AlertTriangle size={15} />
            <span>{alert}</span>
            {alert.includes("sem categoria") && (
              <Link className="text-button" to={transactionsPath(filter, { uncategorized: "1" })}>
                Resolver
              </Link>
            )}
          </p>
        ))}
      </div>
    </article>
  );
}

function ComparisonLine({
  label,
  value,
  inverse = false,
}: {
  label: string;
  value?: number | null;
  inverse?: boolean;
}) {
  const [text, status] = changeLabel(value ?? undefined, inverse).split("|");
  return (
    <div>
      <span>{label}</span>
      <b className={status}>{text}</b>
    </div>
  );
}

function CategoryTrendPanel({
  categoryKey: selectionKey,
  categoryName,
  filter,
  onClose,
}: {
  categoryKey: string;
  categoryName: string;
  filter: ReportFilter;
  onClose: () => void;
}) {
  const categoryId = categoryIdFromKey(selectionKey);
  const { data = [], isLoading } = useQuery({
    queryKey: ["category-trend", selectionKey, filter],
    queryFn: () =>
      api.categoryTrend({
        categoryId,
        endMonth: filter.endMonth,
        source: filter.source,
        accountId: filter.accountId,
        months: 12,
      }),
  });
  const total = data.reduce((sum, p) => sum + p.amountInCents, 0);
  const average = data.length ? Math.round(total / data.length) : 0;
  const link = categoryId
    ? transactionsPath(filter, { category: categoryId })
    : transactionsPath(filter, { uncategorized: "1" });
  return (
    <div className="category-trend-panel">
      <div className="panel-title">
        <div>
          <h2>Tendência · {categoryName}</h2>
          <small>Últimos 12 meses · média de {money(average)}/mês</small>
        </div>
        <div className="category-trend-actions">
          <Link to={link}>Ver transações →</Link>
          <button className="icon-button" aria-label="Fechar tendência" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      {isLoading ? <p className="muted">Carregando tendência…</p> : <CategoryTrendChart data={data} />}
    </div>
  );
}

function RenameMerchantModal({
  merchant,
  onClose,
  onSaved,
}: {
  merchant: { key: string; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(merchant.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!name.trim()) {
      setError("Informe um nome.");
      return;
    }
    setSaving(true);
    try {
      await api.saveMerchantAlias(merchant.key, name.trim());
      onSaved();
    } catch (e: any) {
      setError(e?.message || String(e));
      setSaving(false);
    }
  }
  return (
    <Modal title="Renomear estabelecimento" onClose={onClose}>
      <article className="modal">
        <h2>Renomear estabelecimento</h2>
        <p className="muted">Esse apelido será usado sempre que este estabelecimento aparecer nos relatórios.</p>
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={saving} onClick={save}>
            Salvar
          </button>
        </div>
      </article>
    </Modal>
  );
}

function TargetEditor({
  target,
  month,
  categories,
  onClose,
  onSaved,
}: {
  target: FinancialTarget;
  month: string;
  categories: Awaited<ReturnType<typeof api.categories>>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<"savings" | "category">(target.kind);
  const [categoryId, setCategoryId] = useState(target.categoryId ?? "");
  const [amountInCents, setAmountInCents] = useState<number | null>(target.amountInCents || null);
  const [monthlyOnly, setMonthlyOnly] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    try {
      if (!amountInCents || amountInCents <= 0) {
        setError("Informe um valor positivo.");
        return;
      }
      if (target.id && monthlyOnly) {
        await api.saveFinancialTargetOverride(target.id, month, amountInCents);
      } else
        await api.saveFinancialTarget({
          id: target.id || undefined,
          kind,
          categoryId: kind === "category" ? categoryId : undefined,
          amountInCents,
          enabled: true,
        });
      onSaved();
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  }
  return (
    <Modal title={target.id ? "Editar meta" : "Nova meta financeira"} onClose={onClose}>
      <article className="modal target-modal">
        <h2>{target.id ? "Editar meta" : "Nova meta financeira"}</h2>
        <p className="muted">Defina um objetivo recorrente e acompanhe a projeção ao longo do mês.</p>
        <label>
          Tipo
          <Select
            value={kind}
            onChange={(value) => setKind(value as typeof kind)}
            options={[
              { value: "category", label: "Limite por categoria" },
              { value: "savings", label: "Economia mensal" },
            ]}
          />
        </label>
        {kind === "category" && (
          <CategorySelect
            value={categoryId}
            onChange={(id) => setCategoryId(id ?? "")}
            categories={categories}
            kind="expense"
            allowEmpty
            emptyLabel="Selecione"
          />
        )}
        <label>
          Valor mensal
          <MoneyInput defaultCents={target.amountInCents} onChange={setAmountInCents} />
        </label>
        {target.id && (
          <label className="check-label">
            <input type="checkbox" checked={monthlyOnly} onChange={(e) => setMonthlyOnly(e.target.checked)} />
            Alterar somente para {monthLabel(month)}
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="editor-actions">
          <button className="secondary" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={kind === "category" && !categoryId} onClick={save}>
            Salvar meta
          </button>
        </div>
      </article>
    </Modal>
  );
}
