import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonth, shiftMonth } from "../period";
import { MonthPicker } from "./CalendarPicker";

type Props = { month: string; onChange: (month: string) => void };

/** Standard month selector: ‹ › arrows, a compatible month picker and a "hoje" shortcut. */
export function MonthNavigator({ month, onChange }: Props) {
  const today = currentMonth();
  const [year, value] = month.split("-").map(Number);
  const monthName = new Date(year, value - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);

  return (
    <div className="month-nav" role="group" aria-label="Selecionar mês">
      <div className="month-nav__stepper">
        <button
          type="button"
          className="month-nav__step"
          aria-label="Mês anterior"
          onClick={() => onChange(shiftMonth(month, -1))}
        >
          <ChevronLeft size={17} />
        </button>
        <MonthPicker
          className="month-nav__picker"
          ariaLabel="Escolher mês"
          value={month}
          onChange={onChange}
          allowClear={false}
          placeholder={monthLabel}
        />
        <button
          type="button"
          className="month-nav__step"
          aria-label="Próximo mês"
          onClick={() => onChange(shiftMonth(month, 1))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <button type="button" className="month-nav__today" disabled={month === today} onClick={() => onChange(today)}>
        Hoje
      </button>
    </div>
  );
}
