import type { ReactNode } from 'react';
import { PencilSimple } from '@phosphor-icons/react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line/70 bg-card p-4 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline justify-between px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {aside}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = 'default', onClick, action }: {
  label: string;
  value: string;
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
        {label}
        {onClick && <PencilSimple size={14} aria-hidden />}
      </p>
      <p className={`num mt-1 truncate text-lg font-semibold ${color}`} title={value}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      aria-label={`${label} ${value}. ${action ?? 'Edit'}`}
      className="min-w-0 cursor-pointer rounded-2xl border border-line/70 bg-card p-3 text-left transition-colors duration-150 hover:bg-elev"
    >
      {body}
    </button>
  ) : (
    <div className="min-w-0 rounded-2xl border border-line/70 bg-card p-3">{body}</div>
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
      className="h-2.5 w-full overflow-hidden rounded-full bg-elev"
    >
      <div className={`h-full rounded-full ${bg} transition-[width] duration-500 ease-out`} style={{ width: `${pct}%` }} />
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
  const styles = {
    primary: 'bg-primary text-on-primary hover:bg-primary/90',
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
      className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
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
