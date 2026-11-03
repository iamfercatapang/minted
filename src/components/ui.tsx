import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { formatPHP } from '../lib/money';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-card p-4 ${className}`}>{children}</section>;
}

/** A section's heading: sentence case, one weight step above the body, with an optional quiet count. */
export function SectionTitle({ children, count, aside }: { children: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-7 flex min-h-11 items-center justify-between gap-3 px-1">
      <h2 className="text-[15px] font-semibold">
        {children}
        {count !== undefined && <span className="num ml-1.5 font-medium text-muted">{count}</span>}
      </h2>
      {aside}
    </div>
  );
}

/**
 * A money value whose changed characters roll into place, last digit first, in the direction the value moved.
 * Unchanged characters stay still. Screen readers get the plain value.
 */
export function Amount({ value, format = formatPHP, className = '' }: { value: number; format?: (n: number) => string; className?: string }) {
  const text = format(value);
  const last = useRef({ text, value });
  const run = useRef<{ from: string; to: string; up: boolean; id: number } | null>(null);
  if (last.current.text !== text) {
    run.current = { from: last.current.text, to: text, up: value >= last.current.value, id: (run.current?.id ?? 0) + 1 };
    last.current = { text, value };
  }
  const r = run.current?.to === text ? run.current : null;

  let rank = 0;
  const chars = [...text].map((ch, i) => ({ ch, i }));
  const slots = chars.reverse().map(({ ch, i }) => {
    const old = r ? r.from[r.from.length - (text.length - i)] : ch;
    if (!r || old === ch) return <span key={i}>{ch}</span>;
    const d = Math.min(rank++ * 35, 280);
    return (
      <span key={`${r.id}-${i}`} className={`roll-slot ${r.up ? 'roll-up' : 'roll-down'}`} style={{ '--d': `${d}ms` } as CSSProperties}>
        {old !== undefined && <span className="roll-old">{old}</span>}
        <span className="roll-new">{ch}</span>
      </span>
    );
  });

  return (
    <span className={`num ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{slots.reverse()}</span>
    </span>
  );
}

export function StatTile({ label, value, format, hint, tone = 'default', onClick, action }: {
  label: string;
  value: number;
  format?: (n: number) => string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn';
  /** Makes the tile a button; `action` names what it does for screen readers and shows as a small cue. */
  onClick?: () => void;
  action?: string;
}) {
  const color = tone === 'good' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-fg';
  const body = (
    <>
      <p className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>
        {onClick && <PencilSimple size={14} weight="fill" className="shrink-0" aria-hidden />}
      </p>
      <p className={`mt-1 truncate text-lg font-semibold ${color}`}>
        <Amount value={value} format={format} />
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      aria-label={`${label} ${(format ?? formatPHP)(value)}. ${action ?? 'Edit'}`}
      className="min-w-0 cursor-pointer rounded-2xl bg-card p-3 text-left transition-colors duration-150 hover:bg-elev"
    >
      {body}
    </button>
  ) : (
    <div className="min-w-0 rounded-2xl bg-card p-3">{body}</div>
  );
}

export function ProgressBar({ value, label, tone = 'primary' }: {
  value: number;
  label: string;
  tone?: 'primary' | 'accent' | 'warn' | 'danger';
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const bg = { primary: 'bg-primary', accent: 'bg-accent', warn: 'bg-warn', danger: 'bg-danger' }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-2 w-full overflow-hidden rounded-full bg-elev"
    >
      <div className={`h-full rounded-full ${bg} transition-[width,background-color] duration-500 ease-travel`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, busy, className = '', type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  // A filled button keeps its own color under the pointer: one step brighter, never a translucent wash.
  const styles = {
    primary: 'bg-primary text-on-primary hover:brightness-110',
    secondary: 'bg-elev text-fg hover:bg-line/60',
    ghost: 'text-primary hover:bg-primary/10',
    danger: 'text-danger hover:bg-danger/10',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-grid min-h-12 cursor-pointer place-items-center rounded-xl px-4 font-semibold transition-[background-color,filter,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {/* Label and spinner share one cell, so the button keeps its size while busy. */}
      <span className={`col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition-opacity duration-150 ${busy ? 'opacity-0' : ''}`}>
        {children}
      </span>
      {busy && <span className="col-start-1 row-start-1 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
    </button>
  );
}

/** Content that opens its own height and closes it again, staying mounted (and inert) while closed. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = !open;
  }, [open]);
  return (
    <div ref={ref} className="reveal" data-open={open || undefined}>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-muted" aria-hidden>{icon}</div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} aria-hidden />;
}
