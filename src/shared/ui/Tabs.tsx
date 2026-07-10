import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
type Tab = { id: string; label: string; content?: ReactNode };
type Props = { tabs: Tab[]; defaultTab?: string; value?: string; onChange?: (id: string) => void; hidePanel?: boolean };
export function Tabs({ tabs, defaultTab, value, onChange, hidePanel = false }: Props) {
  const base = useId();
  const [internalSelected, setSelected] = useState(defaultTab ?? tabs[0]?.id);
  const selected = value ?? internalSelected;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === selected),
  );
  const activate = (i: number) => {
    const tab = tabs[i];
    if (tab) {
      setSelected(tab.id);
      onChange?.(tab.id);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    activate(next);
  };
  return (
    <div className="tabs">
      <div role="tablist" aria-label="Seções">
        {tabs.map((tab, i) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${base}-${tab.id}`}
            aria-selected={i === index}
            {...(hidePanel ? {} : { "aria-controls": `${base}-panel-${tab.id}` })}
            tabIndex={i === index ? 0 : -1}
            onClick={() => activate(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!hidePanel &&
        tabs.map(
          (tab, i) =>
            i === index && (
              <section
                role="tabpanel"
                tabIndex={0}
                key={tab.id}
                id={`${base}-panel-${tab.id}`}
                aria-labelledby={`${base}-${tab.id}`}
              >
                {tab.content}
              </section>
            ),
        )}
    </div>
  );
}
