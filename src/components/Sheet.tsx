import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { reducedMotion } from '../lib/motion';

/**
 * Plays the sheet's exit on a copy of its panel, for when the parent unmounts it (e.g. after a save).
 * The dialog itself is gone by the time the animation would run, so the copy stands in for it.
 */
function playExit(panel: HTMLElement) {
  const r = panel.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.className = 'backdrop-leave fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm';
  const copy = panel.cloneNode(true) as HTMLElement;
  copy.classList.remove('sheet-enter');
  copy.classList.add('sheet-leave');
  Object.assign(copy.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '61', overflow: 'hidden' });
  const scrollTop = panel.scrollTop;
  queueMicrotask(() => {
    // Still in the page: a StrictMode re-mount in development, not a real close.
    if (panel.isConnected) return;
    document.body.append(layer, copy);
    copy.scrollTop = scrollTop;
  });
  window.setTimeout(() => {
    layer.remove();
    copy.remove();
  }, 260);
}

/** Modal bottom sheet (centered dialog on wider screens) with Escape/backdrop dismiss. */
export function Sheet({ title, subtitle, onClose, busy, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [leaving, setLeaving] = useState(false);
  const exited = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Runs before React removes the dialog, while the panel can still be measured and copied.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => {
      if (panel && !exited.current && !reducedMotion()) playExit(panel);
    };
  }, []);

  /** Closes from inside the sheet (X, Escape, backdrop): slide out first, then let the parent unmount it. */
  function close() {
    if (busy || leaving) return;
    if (reducedMotion()) return onClose();
    setLeaving(true);
    window.setTimeout(() => {
      exited.current = true;
      onClose();
    }, 220);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      className={`m-0 mt-auto max-h-none w-full max-w-none overflow-visible bg-transparent p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-md ${leaving ? 'leaving' : ''}`}
    >
      <div
        ref={panelRef}
        className={`pb-sheet max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-card px-5 pt-3 text-fg sm:rounded-3xl sm:pt-5 ${leaving ? 'sheet-leave' : 'sheet-enter'}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0 pt-1">
            <h2 id={titleId} className="truncate text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-sm leading-snug text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={close}
            disabled={busy}
            aria-label="Close"
            className="-mr-2 -mt-1 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev"
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export const fieldClass =
  'min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-fg outline-none transition-shadow duration-150 focus:border-primary focus:ring-2 focus:ring-primary/30';

/** Wrapper for a ₱-prefixed amount input; the ring follows focus inside it. */
export const amountWrapClass =
  'flex items-center rounded-xl border border-line bg-bg px-3 transition-shadow duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30';

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Segmented control built from radio inputs, so it stays keyboard and screen-reader friendly. */
export function Segmented<T extends string>({ name, legend, value, options, onChange }: {
  name: string;
  legend: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className={`grid gap-2 ${options.length === 4 ? 'grid-cols-4' : options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-center text-sm font-medium transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-primary ${
              value === o.value ? 'border-primary bg-primary/10' : 'border-line hover:bg-elev'
            }`}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
            {o.hint && <span className="num text-[11px] font-normal text-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Action area: primary first, secondary actions below it, destructive ones separated by a divider. */
export function SheetActions({ children, destructive }: { children: ReactNode; destructive?: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      {children}
      {destructive && <div className="mt-1 border-t border-line/70 pt-4">{destructive}</div>}
    </div>
  );
}

export const parseAmount = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
