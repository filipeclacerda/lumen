import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type SelectOption = {
  value: string | number;
  label: ReactNode;
  disabled?: boolean;
};

type SelectProps = {
  value: string | number;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
};

export function Select({
  value,
  options,
  onChange,
  disabled = false,
  id,
  ariaLabel,
  placeholder = "Selecione…",
  className = "",
}: SelectProps) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-options`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedValue = String(value ?? "");
  const selectedIndex = options.findIndex((option) => String(option.value) === selectedValue);
  const selected = options[selectedIndex];
  const availableIndexes = useMemo(
    () => options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0),
    [options],
  );

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, [open]);

  function openMenu() {
    if (disabled) return;
    setActiveIndex(
      selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : (availableIndexes[0] ?? -1),
    );
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(String(option.value));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(direction: 1 | -1) {
    if (!availableIndexes.length) return;
    const currentPosition = Math.max(0, availableIndexes.indexOf(activeIndex));
    const nextPosition = (currentPosition + direction + availableIndexes.length) % availableIndexes.length;
    setActiveIndex(availableIndexes[nextPosition]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(availableIndexes[0] ?? -1);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(availableIndexes.at(-1) ?? -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div
      className={`custom-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""} ${className}`.trim()}
      ref={rootRef}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="custom-select__trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`custom-select__value${selected ? "" : " is-placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <span className="custom-select__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="custom-select__menu" id={listboxId} role="listbox" aria-label={ariaLabel}>
          {options.length === 0 ? (
            <span className="custom-select__empty">Nenhuma opção disponível</span>
          ) : (
            options.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listboxId}-${index}`}
                className={`custom-select__option${index === activeIndex ? " is-active" : ""}${String(option.value) === selectedValue ? " is-selected" : ""}`}
                aria-selected={String(option.value) === selectedValue}
                disabled={option.disabled}
                key={`${option.value}-${index}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
