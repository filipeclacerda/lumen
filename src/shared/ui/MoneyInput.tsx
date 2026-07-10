import { useState } from "react";
import { centsToInput, parseMoneyToCents, maskCurrency } from "../format";

type MoneyInputProps = {
  defaultCents?: number;
  onChange: (cents: number | null) => void;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  hint?: string;
  error?: string;
  "aria-label"?: string;
};

/** Brazilian currency field. Uncontrolled text, reports parsed integer cents
 *  (null while the input is blank/invalid). */
export function MoneyInput({
  defaultCents = 0,
  onChange,
  autoFocus,
  id,
  disabled,
  name,
  required,
  onBlur,
  hint,
  error,
  "aria-label": ariaLabel,
}: MoneyInputProps) {
  const [text, setText] = useState(defaultCents ? centsToInput(defaultCents) : "");
  return (
    <div className="money-input">
      <span aria-hidden="true">R$</span>
      <input
        id={id}
        name={name}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id ?? "money"}-hint` : undefined}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder="0,00"
        disabled={disabled}
        onBlur={onBlur}
        onChange={(e) => {
          const masked = maskCurrency(e.target.value);
          setText(masked);
          onChange(masked === "" ? null : parseMoneyToCents(masked));
        }}
      />
      {(hint || error) && (
        <small id={`${id ?? "money"}-hint`} className={error ? "form-error" : "muted"}>
          {error ?? hint}
        </small>
      )}
    </div>
  );
}
