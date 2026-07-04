import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonth, shiftMonth } from "../period";

type Props = { month: string; onChange: (month: string) => void };

/** Standard month selector: ‹ › arrows, native month input and a "hoje" shortcut. */
export function MonthNavigator({ month, onChange }: Props) {
  const today = currentMonth();
  return (
    <div className="month-nav" role="group" aria-label="Selecionar mês">
      <button type="button" className="icon-button" aria-label="Mês anterior" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft size={16} />
      </button>
      <input type="month" className="month-picker" value={month} onChange={e => e.target.value && onChange(e.target.value)} />
      <button type="button" className="icon-button" aria-label="Próximo mês" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight size={16} />
      </button>
      {month !== today && (
        <button type="button" className="text-button" onClick={() => onChange(today)}>hoje</button>
      )}
    </div>
  );
}
