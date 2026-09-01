import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DUR_FAST_MS, exitDuration } from '../lib/motion';
import { createPortal } from 'react-dom';
import { CheckIcon, CloseIcon, InfoIcon, WarnIcon } from './ui';

type ToastTone = 'ok' | 'danger' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

interface ToastContextValue {
  success: (title: string, text?: string) => void;
  error: (title: string, text?: string) => void;
  info: (title: string, text?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  /**
   * A toast is marked as leaving first and removed once it has animated out,
   * so it sinks back towards the corner it rose from instead of blinking out
   * of existence.
   */
  const [leaving, setLeaving] = useState<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setLeaving((current) => (current.includes(id) ? current : [...current, id]));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      setLeaving((current) => current.filter((leavingId) => leavingId !== id));
    }, exitDuration(DUR_FAST_MS));
  }, []);

  const push = useCallback(
    (tone: ToastTone, title: string, text?: string) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, tone, title, text }]);
      // Errors stay longer — the user usually needs to read and act on them.
      window.setTimeout(() => dismiss(id), tone === 'danger' ? 8000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (title, text) => push('ok', title, text),
      error: (title, text) => push('danger', title, text),
      info: (title, text) => push('info', title, text),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.tone}${leaving.includes(toast.id) ? ' is-leaving' : ''}`}
            >
              <span style={{ flex: 'none', marginTop: 1 }}>
                {toast.tone === 'ok' ? <CheckIcon /> : toast.tone === 'danger' ? <WarnIcon /> : <InfoIcon />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="toast__title">{toast.title}</div>
                {toast.text && <div className="toast__text">{toast.text}</div>}
              </div>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
              >
                <CloseIcon size={15} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider.');
  return context;
}
