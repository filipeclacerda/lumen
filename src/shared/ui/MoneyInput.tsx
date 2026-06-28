import { useState } from "react";
import { centsToInput, parseMoneyToCents } from "../format";

type MoneyInputProps = {
  defaultCents?: number;
  onChange: (cents: number | null) => void;
  autoFocus?: boolean;
  id?: string;
};

/** Brazilian currency field. Uncontrolled text, reports parsed integer cents
 *  (null while the input is blank/invalid). */
export function MoneyInput({ defaultCents = 0, onChange, autoFocus, id }: MoneyInputProps) {
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
        onChange={e => {
          setText(e.target.value);
          onChange(e.target.value.trim() === "" ? null : parseMoneyToCents(e.target.value));
        }}
      />
    </div>
  );
}
