import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { money } from "../../shared/format";
import type { CategoryReport } from "../../shared/types";

const palette = ["#247258", "#e5a142", "#728bba", "#a778ba", "#d66d68", "#4c94a8", "#9c7661", "#568a91"];
export const UNCATEGORIZED_CATEGORY_KEY = "__uncategorized";

type Props = {
  categories: CategoryReport[];
  selectedCategoryKey?: string;
  onSelect: (categoryKey: string | undefined) => void;
};

/** Interactive donut of spending by category — click a slice to drill into its trend and transactions. */
export function CategoryDonut({ categories, selectedCategoryKey, onSelect }: Props) {
  const data = categories.filter(c => c.amountInCents > 0).slice(0, 8);
  if (!data.length) return null;
  const total = data.reduce((sum, c) => sum + c.amountInCents, 0);

  return (
    <div className="donut-chart-wrap">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amountInCents"
            nameKey="category"
            innerRadius={62}
            outerRadius={92}
            paddingAngle={2}
            cursor="pointer"
            onClick={data => {
              const category = data.payload as CategoryReport | undefined;
              const categoryKey = category?.categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
              onSelect(categoryKey === selectedCategoryKey ? undefined : categoryKey);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.categoryId ?? entry.category}
                fill={entry.color ?? palette[index % palette.length]}
                opacity={!selectedCategoryKey || selectedCategoryKey === (entry.categoryId ?? UNCATEGORIZED_CATEGORY_KEY) ? 1 : 0.35}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [money(Number(value)), item?.payload?.category]}
            contentStyle={{
              background: "var(--surface)", border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)", color: "var(--text)", fontSize: 13,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <p className="muted donut-hint">{money(total)} no total · clique numa fatia para ver a tendência</p>
    </div>
  );
}
