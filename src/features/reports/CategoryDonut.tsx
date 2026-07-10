import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  chartMoneyFormatter,
  chartPalette,
  chartTooltipLabelStyle,
  chartTooltipStyle,
  chartTooltipItemStyle,
  EmptyChart,
} from "../../shared/ui/Charts";
import type { CategoryReport } from "../../shared/types";

export const UNCATEGORIZED_CATEGORY_KEY = "__uncategorized";

type Props = {
  categories: CategoryReport[];
  selectedCategoryKey?: string;
  onSelect: (categoryKey: string | undefined) => void;
};

/** Interactive donut of spending by category — click a slice to drill into its trend and transactions. */
export function CategoryDonut({ categories, selectedCategoryKey, onSelect }: Props) {
  const data = categories.filter((c) => c.amountInCents > 0).slice(0, 8);
  if (!data.length) return <EmptyChart message="Sem categorias para montar o donut." />;
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
            onClick={(data) => {
              const category = data.payload as CategoryReport | undefined;
              const categoryKey = category?.categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
              onSelect(categoryKey === selectedCategoryKey ? undefined : categoryKey);
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.categoryId ?? entry.category}
                fill={entry.color ?? chartPalette[index % chartPalette.length]}
                opacity={
                  !selectedCategoryKey || selectedCategoryKey === (entry.categoryId ?? UNCATEGORIZED_CATEGORY_KEY)
                    ? 1
                    : 0.35
                }
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => [chartMoneyFormatter(value), item?.payload?.category]}
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
          />
        </PieChart>
      </ResponsiveContainer>
      <p className="muted donut-hint">{chartMoneyFormatter(total)} no total · clique numa fatia para ver a tendência</p>
    </div>
  );
}
