import { useState } from "react";
import { centsToInput, parseMoneyToCents, maskCurrency } from "../format";

type MoneyInputProps = {
  defaultCents?: number;
  onChange: (cents: number | null) => void;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
};

/** Brazilian currency field. Uncontrolled text, reports parsed integer cents
 *  (null while the input is blank/invalid). */
export function MoneyInput({ defaultCents = 0, onChange, autoFocus, id, disabled }: MoneyInputProps) {
  const [text, setText] = useState(defaultCents ? centsToInput(defaultCents) : "");
  return (
    <div className="money-input">
      <span>R$</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={text}
        placeholder="0,00"
        disabled={disabled}
        onChange={(e) => {
          const masked = maskCurrency(e.target.value);
          setText(masked);
          onChange(masked === "" ? null : parseMoneyToCents(masked));
        }}
      />
    </div>
  );
}
