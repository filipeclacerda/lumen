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
  totalInCents: number;
  kindLabel: string;
  selectedCategoryKey?: string;
  onSelect: (categoryKey: string | undefined) => void;
};

/** Interactive donut of spending by category — click a slice to drill into its trend and transactions. */
export function CategoryDonut({ categories, totalInCents, kindLabel, selectedCategoryKey, onSelect }: Props) {
  const data = categories.filter((c) => c.amountInCents > 0).slice(0, 8);
  if (!data.length) return <EmptyChart message="Sem categorias para montar o donut." />;

  return (
    <div className="donut-chart-wrap">
      <div className="donut-chart-visual">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart accessibilityLayer={false}>
            <Pie
              data={data}
              dataKey="amountInCents"
              nameKey="category"
              innerRadius={58}
              outerRadius={84}
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
                  stroke="var(--surface-2)"
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
        <div className="donut-chart-center" aria-hidden="true">
          <small>Total</small>
          <strong>{chartMoneyFormatter(totalInCents)}</strong>
          <span>{kindLabel.toLowerCase()}</span>
        </div>
      </div>
      <div className="chart-data-list" aria-label={`${kindLabel} por categoria`}>
        {data.map((entry, index) => {
          const key = entry.categoryId ?? UNCATEGORIZED_CATEGORY_KEY;
          const color = entry.color ?? chartPalette[index % chartPalette.length];
          return (
            <button
              key={key}
              type="button"
              className="chart-data-list__item"
              aria-pressed={selectedCategoryKey === key}
              onClick={() => onSelect(key === selectedCategoryKey ? undefined : key)}
            >
              <i className="chart-data-list__swatch" style={{ backgroundColor: color }} />
              <span className="chart-data-list__copy">
                <b>{entry.category}</b>
                <small>{entry.sharePercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total</small>
              </span>
              <strong>{chartMoneyFormatter(entry.amountInCents)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
