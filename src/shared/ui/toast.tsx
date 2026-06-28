import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Variant = "success" | "error";
type Toast = { id: number; message: string; variant: Variant };

const ToastContext = createContext<(message: string, variant?: Variant) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, variant: Variant = "success") => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, message, variant }]);
    setTimeout(() => setToasts(current => current.filter(t => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.variant}`} role="status">
            {t.variant === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
