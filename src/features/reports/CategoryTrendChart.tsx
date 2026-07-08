import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../../shared/format";
import { monthLabel } from "../../shared/period";
import type { CategoryTrendPoint } from "../../shared/types";

type Props = { data: CategoryTrendPoint[] };

const compact = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(cents / 100);

/** Last-12-months trend line for a single category, shown when the user drills into it. */
export function CategoryTrendChart({ data }: Props) {
  const points = data.map(p => ({ label: monthLabel(p.month), amount: p.amountInCents }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="categoryTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-strong)" }} tickLine={false} />
        <YAxis tickFormatter={compact} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          formatter={value => money(Number(value ?? 0))}
          contentStyle={{
            background: "var(--surface)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 13,
          }}
        />
        <Area dataKey="amount" stroke="var(--brand)" strokeWidth={2} fill="url(#categoryTrendFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
