import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonth, shiftMonth } from "../period";

type PickerMode = "date" | "month";

type Props = {
  value: string;
  onChange: (value: string) => void;
  mode: PickerMode;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
};

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

function monthName(month: string, format: "long" | "short" = "long") {
  const [year, value] = month.split("-").map(Number);
  const label = new Date(year, value - 1, 1).toLocaleDateString("pt-BR", { month: format, year: "numeric" });
  return format === "long" ? label.charAt(0).toUpperCase() + label.slice(1) : label.replace(".", "");
}

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : undefined;
}

function dateToIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function selectedMonth(value: string, mode: PickerMode) {
  if (mode === "month" && /^\d{4}-\d{2}$/.test(value)) {
    const [, monthPart] = value.split("-");
    const month = Number(monthPart);
    if (month >= 1 && month <= 12) return value;
  }
  const date = parseDate(value);
  return date ? monthFromDate(date) : currentMonth();
}

function CalendarPicker({
  value,
  onChange,
  mode,
  ariaLabel,
  placeholder = mode === "date" ? "Selecionar data" : "Selecionar mês",
  disabled = false,
  allowClear = true,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => selectedMonth(value, mode));
  const rootRef = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const selectedDate = mode === "date" ? parseDate(value) : undefined;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openPicker = () => {
    if (disabled) return;
    setViewMonth(selectedMonth(value, mode));
    setOpen((current) => !current);
  };

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  const displayValue =
    mode === "date" ? selectedDate?.toLocaleDateString("pt-BR") : value ? monthName(value) : undefined;
  const [year, month] = viewMonth.split("-").map(Number);

  return (
    <div ref={rootRef} className={`calendar-picker${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="calendar-picker__trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={popupId}
        disabled={disabled}
        onClick={openPicker}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{displayValue ?? placeholder}</span>
      </button>

      {open && (
        <div id={popupId} className="calendar-picker__popover" role="dialog" aria-label={ariaLabel}>
          {mode === "date" ? (
            <>
              <div className="calendar-picker__header">
                <button
                  type="button"
                  className="calendar-picker__nav"
                  aria-label="Mês anterior"
                  onClick={() => setViewMonth(shiftMonth(viewMonth, -1))}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <strong>{monthName(viewMonth)}</strong>
                <button
                  type="button"
                  className="calendar-picker__nav"
                  aria-label="Próximo mês"
                  onClick={() => setViewMonth(shiftMonth(viewMonth, 1))}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="calendar-picker__weekdays" aria-hidden="true">
                {WEEKDAYS.map((weekday, index) => (
                  <span key={`${weekday}-${index}`}>{weekday}</span>
                ))}
              </div>
              <div className="calendar-picker__days">
                {Array.from(
                  { length: new Date(year, month, 0).getDate() + ((new Date(year, month - 1, 1).getDay() + 6) % 7) },
                  (_, index) => {
                    const firstDayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
                    if (index < firstDayOffset) return <span key={`empty-${index}`} aria-hidden="true" />;
                    const day = index - firstDayOffset + 1;
                    const date = new Date(year, month - 1, day);
                    const dateValue = dateToIso(date);
                    const isToday = dateValue === dateToIso(new Date());
                    const isSelected = dateValue === value;
                    return (
                      <button
                        key={dateValue}
                        type="button"
                        className={`calendar-picker__day${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                        aria-label={date.toLocaleDateString("pt-BR", { dateStyle: "full" })}
                        aria-pressed={isSelected}
                        onClick={() => selectValue(dateValue)}
                      >
                        {day}
                      </button>
                    );
                  },
                )}
              </div>
            </>
          ) : (
            <>
              <div className="calendar-picker__header">
                <button
                  type="button"
                  className="calendar-picker__nav"
                  aria-label="Ano anterior"
                  onClick={() => setViewMonth(`${year - 1}-${String(month).padStart(2, "0")}`)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <strong>{year}</strong>
                <button
                  type="button"
                  className="calendar-picker__nav"
                  aria-label="Próximo ano"
                  onClick={() => setViewMonth(`${year + 1}-${String(month).padStart(2, "0")}`)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
              <div className="calendar-picker__months">
                {Array.from({ length: 12 }, (_, index) => {
                  const monthValue = `${year}-${String(index + 1).padStart(2, "0")}`;
                  const isSelected = monthValue === value;
                  return (
                    <button
                      key={monthValue}
                      type="button"
                      className={`calendar-picker__month${isSelected ? " is-selected" : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => selectValue(monthValue)}
                    >
                      {new Date(year, index, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="calendar-picker__footer">
            <button
              type="button"
              className="calendar-picker__footer-button"
              onClick={() => selectValue(mode === "date" ? dateToIso(new Date()) : currentMonth())}
            >
              {mode === "date" ? "Hoje" : "Este mês"}
            </button>
            {allowClear && value && (
              <button type="button" className="calendar-picker__footer-button" onClick={() => selectValue("")}>
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DatePicker(props: Omit<Props, "mode">) {
  return <CalendarPicker {...props} mode="date" />;
}

export function MonthPicker(props: Omit<Props, "mode">) {
  return <CalendarPicker {...props} mode="month" />;
}
