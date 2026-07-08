import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartMoneyFormatter, chartTooltipItemStyle, chartTooltipLabelStyle, chartTooltipStyle, moneyAxisFormatter } from "../../shared/ui/Charts";
import { monthLabel } from "../../shared/period";
import type { MonthlyReportPoint } from "../../shared/types";

type Props = { monthly: MonthlyReportPoint[] };

type MonthlySurplusChartPoint = {
  label: string;
  Receitas: number;
  Despesas: number;
  Investimentos: number;
  Sobra: number;
};

type SurplusTooltipProps = {
  active?: boolean;
  label?: string;
  payload?: { payload?: MonthlySurplusChartPoint }[];
};

function SurplusTooltip({ active, label, payload }: SurplusTooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div style={{ ...chartTooltipStyle, display: "grid", gap: 4, padding: "10px 12px" }}>
      <strong style={chartTooltipLabelStyle}>{label}</strong>
      <div style={chartTooltipItemStyle}>Receitas: {chartMoneyFormatter(point.Receitas)}</div>
      <div style={chartTooltipItemStyle}>Gastos: {chartMoneyFormatter(point.Despesas)}</div>
      <div style={chartTooltipItemStyle}>Investimentos: {chartMoneyFormatter(point.Investimentos)}</div>
      <div style={chartTooltipItemStyle}>Sobra: {chartMoneyFormatter(point.Sobra)}</div>
    </div>
  );
}

/** Sobra final do mês depois de gastos e investimentos, para leitura rápida no dashboard. */
export function MonthlySurplusChart({ monthly }: Props) {
  const data: MonthlySurplusChartPoint[] = monthly.map(point => ({
    label: monthLabel(point.month),
    Receitas: point.incomeInCents,
    Despesas: point.expensesInCents,
    Investimentos: point.investmentsInCents,
    Sobra: point.incomeInCents - point.expensesInCents - point.investmentsInCents,
  }));

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} />
          <YAxis tickFormatter={moneyAxisFormatter} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip
            content={<SurplusTooltip />}
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
            cursor={{ fill: "var(--surface-2)" }}
          />
          <Bar dataKey="Sobra" radius={[4, 4, 0, 0]} maxBarSize={32}>
            {data.map(point => (
              <Cell key={point.label} fill={point.Sobra >= 0 ? "var(--brand)" : "var(--danger)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
