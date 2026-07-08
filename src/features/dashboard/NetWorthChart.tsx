import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../../shared/format";
import { monthLabel } from "../../shared/period";
import type { NetWorthPoint } from "../../shared/types";

type Props = { points: NetWorthPoint[] };

const compact = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

/** Patrimônio total (soma de todas as contas) ao final de cada um dos últimos meses. */
export function NetWorthChart({ points }: Props) {
  const data = points.map(p => ({
    label: monthLabel(p.month),
    Patrimônio: p.totalInCents,
  }));
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} />
          <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={52} />
          <Tooltip
            formatter={value => money(Number(value ?? 0))}
            contentStyle={{
              background: "var(--surface)", border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 13,
            }}
            cursor={{ stroke: "var(--border-strong)" }}
          />
          <Area dataKey="Patrimônio" type="monotone" stroke="var(--brand)" strokeWidth={2} fill="url(#netWorthFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
