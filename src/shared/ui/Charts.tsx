import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Cell,
  BarChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, shortDate } from "../format";
import { monthLabel } from "../period";
import type { CategoryReport, DailyReportPoint, FinancialReport, MonthlyReportPoint } from "../types";

export const compactMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);

export const moneyAxisFormatter = (value: number | string) => compactMoney(Number(value ?? 0));

export const chartTooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  fontSize: 13,
};
export const chartTooltipItemStyle = {
  color: "var(--text)",
};
export const chartTooltipLabelStyle = {
  color: "var(--text)",
};

export const chartMoneyFormatter = (value: unknown) => money(Number(value ?? 0));

export const chartPalette = [
  "var(--data-1)",
  "var(--data-2)",
  "var(--data-3)",
  "var(--data-4)",
  "var(--data-5)",
  "var(--data-6)",
  "var(--data-7)",
  "var(--data-8)",
];

const sourceKindToLabel: Record<"bank" | "credit_card", string> = {
  bank: "Conta bancária",
  credit_card: "Cartão de crédito",
};

const sourceKindToColor: Record<"bank" | "credit_card", string> = {
  bank: "var(--brand)",
  credit_card: "var(--data-5)",
};

function sourceBarColor(source: "bank" | "credit_card") {
  if (source === "bank") return sourceKindToColor.bank;
  return sourceKindToColor.credit_card;
}

function defaultCategoryKey(category: CategoryReport) {
  return category.categoryId ?? category.category;
}

type EmptyChartProps = { message?: string };

export function EmptyChart({ message = "Sem dados suficientes para este gráfico." }: EmptyChartProps) {
  return (
    <div className="chart-empty">
      <span>{message}</span>
    </div>
  );
}

export function SpendingBarsChart({ data }: { data: MonthlyReportPoint[] }) {
  const chartData = useMemo(
    () =>
      data.map((point) => ({
        month: monthLabel(point.month),
        Receita: point.incomeInCents,
        Gasto: point.expensesInCents,
        Saldo: point.incomeInCents - point.expensesInCents,
      })),
    [data],
  );

  if (!chartData.length) return <EmptyChart />;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={230}>
        <ComposedChart accessibilityLayer={false} data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border-strong)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={moneyAxisFormatter}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            formatter={(value) => chartMoneyFormatter(value)}
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
            cursor={{ fill: "var(--surface-3)", fillOpacity: 0.72 }}
          />
          <Line type="monotone" dataKey="Saldo" stroke="var(--brand)" strokeWidth={2} dot={false} />
          <Bar dataKey="Gasto" fill="var(--danger)" radius={[4, 4, 0, 0]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type CategoryBarsChartProps = {
  categories: CategoryReport[];
  selectedCategoryKey?: string;
  onSelect: (categoryKey: string | undefined) => void;
  getCategoryKey?: (category: CategoryReport) => string;
  limit?: number;
  valueLabel?: string;
  hoverFill?: string;
};

export function CategoryBarsChart({
  categories,
  selectedCategoryKey,
  onSelect,
  getCategoryKey = defaultCategoryKey,
  limit = 8,
  valueLabel = "Gasto",
  hoverFill = "var(--brand-soft)",
}: CategoryBarsChartProps) {
  const rows = useMemo(
    () =>
      categories
        .filter((category) => category.amountInCents > 0)
        .slice(0, limit)
        .map((category, index) => {
          const categoryKey = getCategoryKey(category);
          return {
            category: category.category,
            categoryKey,
            amount: category.amountInCents,
            sharePercent: category.sharePercent,
            color: category.color ?? chartPalette[index % chartPalette.length],
          };
        }),
    [categories, getCategoryKey, limit],
  );

  if (!rows.length) return <EmptyChart />;

  const toggleCategory = (categoryKey?: string) => {
    if (!categoryKey) return;
    onSelect(categoryKey === selectedCategoryKey ? undefined : categoryKey);
  };

  return (
    <div className="chart-wrap category-bars-chart">
      <ResponsiveContainer width="100%" height={Math.max(rows.length * 38, 220)}>
        <BarChart
          accessibilityLayer={false}
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 16, bottom: 6, left: 12 }}
        >
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={moneyAxisFormatter}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            dataKey="category"
            type="category"
            width={145}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => chartMoneyFormatter(value)}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
            contentStyle={chartTooltipStyle}
            cursor={{ fill: hoverFill }}
          />
          <Bar dataKey="amount" name={valueLabel} radius={[0, 8, 8, 0]} cursor="pointer">
            {rows.map((row) => (
              <Cell
                key={row.categoryKey}
                fill={row.color}
                fillOpacity={selectedCategoryKey && selectedCategoryKey !== row.categoryKey ? 0.4 : 1}
                role="button"
                tabIndex={0}
                aria-label={`${row.category}: ${valueLabel.toLowerCase()} de ${money(row.amount)}. ${
                  row.categoryKey === selectedCategoryKey
                    ? "Selecionada. Pressione Enter ou Espaço para limpar o filtro."
                    : "Pressione Enter ou Espaço para filtrar por esta categoria."
                }`}
                aria-pressed={row.categoryKey === selectedCategoryKey}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => toggleCategory(row.categoryKey)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  toggleCategory(row.categoryKey);
                }}
              />
            ))}
            <LabelList
              dataKey="amount"
              position="right"
              formatter={(value) => moneyAxisFormatter(value as number)}
              fill="var(--text-muted)"
              fontSize={10}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SourceComparisonChart({ sources }: { sources: FinancialReport["sources"] }) {
  const chartData = useMemo(
    () =>
      [...sources]
        .sort((a, b) => b.amountInCents - a.amountInCents)
        .map((source) => ({
          kind: source.source,
          label: sourceKindToLabel[source.source],
          amount: source.amountInCents,
          share: `${source.sharePercent.toFixed(1)}%`,
          color: sourceBarColor(source.source),
        })),
    [sources],
  );

  if (!chartData.length) return <EmptyChart />;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={190}>
        <BarChart
          accessibilityLayer={false}
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 18, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={moneyAxisFormatter}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border-strong)" }}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value) => chartMoneyFormatter(value)}
            labelFormatter={(label) => String(label)}
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
            cursor={{ fill: "var(--surface-3)", fillOpacity: 0.72 }}
          />
          <Bar dataKey="amount" fill="var(--brand)" radius={[0, 8, 8, 0]}>
            {chartData.map((item) => (
              <Cell key={item.kind} fill={item.color} />
            ))}
            <LabelList dataKey="share" position="right" fill="var(--text-muted)" fontSize={11} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type CumulativeExpensesChartPoint = DailyReportPoint & {
  monthDay: string;
};

export function CumulativeExpensesChart({ data }: { data: DailyReportPoint[] }) {
  const rows = useMemo<CumulativeExpensesChartPoint[]>(
    () =>
      data.map((point) => ({
        ...point,
        monthDay: shortDate(point.date),
      })),
    [data],
  );

  const [focused, setFocused] = useState<CumulativeExpensesChartPoint | undefined>();
  if (!rows.length) return <EmptyChart />;

  const latest = rows[rows.length - 1];
  const max = Math.max(...rows.map((item) => item.cumulativeInCents), 1);
  const total = latest?.cumulativeInCents ?? 0;
  const average = rows.length ? Math.round(total / rows.length) : 0;
  const highest = rows.reduce((best, item) => (item.amountInCents > best.amountInCents ? item : best), rows[0]);

  const active = focused ?? latest;

  return (
    <div className="cumulative-chart-wrap">
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart
            accessibilityLayer={false}
            data={rows}
            margin={{ top: 8, right: 8, bottom: 2, left: 8 }}
            onMouseMove={(state) => {
              const payload = (state as { activePayload?: { payload?: CumulativeExpensesChartPoint }[] })
                ?.activePayload?.[0]?.payload;
              if (payload) setFocused(payload);
            }}
            onMouseLeave={() => setFocused(undefined)}
          >
            <defs>
              <linearGradient id="cumulativeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="monthDay"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border-strong)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={moneyAxisFormatter}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
              domain={[0, Math.max(max * 1.08, 1)]}
            />
            <Tooltip
              formatter={(value) => chartMoneyFormatter(value)}
              labelFormatter={(label) => String(label)}
              contentStyle={chartTooltipStyle}
              labelStyle={chartTooltipLabelStyle}
              itemStyle={chartTooltipItemStyle}
            />
            <Area
              dataKey="cumulativeInCents"
              name="Gasto acumulado"
              type="monotone"
              stroke="var(--brand)"
              strokeWidth={2}
              fill="url(#cumulativeFill)"
            />
            <Line dataKey="amountInCents" name="Gasto do dia" stroke="var(--text-soft)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {active && (
        <div className="cumulative-focus">
          <span>{shortDate(active.date)}</span>
          <b>{money(active.cumulativeInCents)}</b>
          <small>{money(active.amountInCents)} gastos no dia</small>
        </div>
      )}
      <div className="cumulative-metrics">
        <div>
          <span>Acumulado</span>
          <b>{money(total)}</b>
        </div>
        <div>
          <span>Maior dia</span>
          <b>
            {shortDate(highest.date)} · {money(highest.amountInCents)}
          </b>
        </div>
        <div>
          <span>Média por dia com gasto</span>
          <b>{money(average)}</b>
        </div>
      </div>
    </div>
  );
}

export function SourceDonutChart({ sources }: { sources: FinancialReport["sources"] }) {
  const data = useMemo(
    () =>
      sources.map((source) => ({
        label: sourceKindToLabel[source.source],
        value: source.amountInCents,
      })),
    [sources],
  );

  if (!data.length) return <EmptyChart />;

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={210}>
        <PieChart accessibilityLayer={false}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius={52}
            outerRadius={86}
            paddingAngle={2}
            fill={chartPalette[0]}
          >
            {data.map((item, index) => (
              <Cell key={item.label} fill={chartPalette[index % chartPalette.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => chartMoneyFormatter(value)}
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
