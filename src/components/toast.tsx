import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from '../lib/motion';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

const Ctx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number>();
  const leaveTimer = useRef<number>();

  /** Drops the toast out before removing it. */
  const dismiss = useCallback((id?: number) => {
    window.clearTimeout(leaveTimer.current);
    if (reducedMotion()) return setToast((cur) => (id === undefined || cur?.id === id ? null : cur));
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      setToast((cur) => (id === undefined || cur?.id === id ? null : cur));
      setLeaving(false);
    }, 200);
  }, []);

  const show = useCallback((t: Omit<Toast, 'id'>) => {
    window.clearTimeout(timer.current);
    window.clearTimeout(leaveTimer.current);
    const next = { ...t, id: Date.now() };
    setLeaving(false);
    setToast(next);
    timer.current = window.setTimeout(() => dismiss(next.id), t.action ? 10000 : 4000);
  }, [dismiss]);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pb-safe">
        {toast && (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`${leaving ? 'toast-leave' : 'toast-enter'} pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl py-1.5 pl-4 pr-1.5 shadow-lg ${
              toast.tone === 'error' ? 'bg-danger text-white' : 'bg-fg text-bg'
            }`}
          >
            <p className="flex-1 py-1.5 text-sm font-medium leading-snug">{toast.message}</p>
            {toast.action && (
              <button
                className="min-h-11 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-bold underline-offset-2 hover:underline"
                onClick={() => {
                  window.clearTimeout(timer.current);
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
