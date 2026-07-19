import type { ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";
type Variant = "page" | "panel" | "table-row";
export function LoadingState({ label = "Carregando…", variant = "panel" }: { label?: string; variant?: Variant }) {
  return (
    <div className={`async-state async-state--${variant}`} role="status" aria-live="polite">
      {variant === "page" ? (
        <div className="async-state__brand">
          <BrandLogo size={64} decorative />
          <span>{label}</span>
        </div>
      ) : (
        <>
          <span aria-hidden="true">◌</span> {label}
        </>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
  variant = "panel",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: Variant;
}) {
  return (
    <div className={`async-state async-state--${variant}`}>
      <div>
        <strong>{title}</strong>
        {description && <p className="muted">{description}</p>}
        {action}
      </div>
    </div>
  );
}
export function ErrorState({
  message = "Não foi possível carregar este conteúdo.",
  onRetry,
  variant = "panel",
}: {
  message?: string;
  onRetry?: () => void;
  variant?: Variant;
}) {
  return (
    <div className={`async-state async-state--${variant}`} role="alert">
      <div>
        <strong>Algo deu errado</strong>
        <p className="muted">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
