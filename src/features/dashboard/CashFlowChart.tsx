import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../../shared/format";
import { monthLabel } from "../../shared/period";
import type { MonthlyReportPoint } from "../../shared/types";

type Props = { monthly: MonthlyReportPoint[] };

const compact = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

/** Receita × despesa por mês com linha de saldo, alimentado pelo relatório financeiro. */
export function CashFlowChart({ monthly }: Props) {
  const data = monthly.map(p => ({
    label: monthLabel(p.month),
    Receitas: p.incomeInCents,
    Despesas: p.expensesInCents,
    Saldo: p.incomeInCents - p.expensesInCents,
  }));
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={4}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            formatter={value => money(Number(value ?? 0))}
            contentStyle={{
              background: "var(--surface)", border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 13,
            }}
            cursor={{ fill: "var(--surface-2)" }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="Receitas" fill="var(--accent-green)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Bar dataKey="Despesas" fill="var(--danger)" radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Line dataKey="Saldo" stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
