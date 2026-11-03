import { useState } from 'react';
import { CheckCircle, Circle, Receipt } from '@phosphor-icons/react';
import type { CardPayment } from '../lib/cards';
import { planCardPayment } from '../lib/edits';
import { formatShort, fromIso } from '../lib/dates';
import { formatPHP } from '../lib/money';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { Sheet, SheetActions } from './Sheet';

/** Card payments due from a payday. They're reminders: the bills on each card already count in the totals. */
export function CardPayments({ payments }: { payments: CardPayment[] }) {
  const [open, setOpen] = useState<CardPayment | null>(null);
  if (!payments.length) return null;
  return (
    <>
      <ul className="rounded-2xl border border-line/70 bg-card p-1">
        {payments.map((p) => (
          <li key={p.card.name}>
            <button
              onClick={() => setOpen(p)}
              aria-label={`${p.card.name} payment, ${formatPHP(p.amount)}, ${p.paid ? 'paid' : `due ${formatShort(p.due)}`}. Tap for details.`}
              className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-elev"
            >
              <span className={p.paid ? 'text-accent' : 'text-muted'} aria-hidden>
                {p.paid ? <CheckCircle size={28} weight="fill" /> : <Circle size={28} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-medium ${p.paid ? 'text-muted' : ''}`}>Pay {p.card.name}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                  <Receipt size={14} aria-hidden />
                  {formatShort(p.statement)} statement · due {formatShort(p.due)}
                </span>
              </span>
              <span className="text-right">
                <span className={`num block font-semibold ${p.paid ? 'text-accent' : ''}`}>{formatPHP(p.amount)}</span>
                <span className="block text-xs text-muted">{p.paid ? 'Paid' : `${p.bills.length + p.spends.length} charge${p.bills.length + p.spends.length === 1 ? '' : 's'}`}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 px-1 text-xs text-muted">Not added to the totals above, since the bills on each card are already counted.</p>
      {open && <CardPaymentSheet payment={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function CardPaymentSheet({ payment: p, onClose }: { payment: CardPayment; onClose: () => void }) {
  const { applyPlan, settings, auth, backend } = useLedger();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');

  async function run(paid: boolean) {
    setBusy(true);
    setError(null);
    try {
      const plan = planCardPayment(p, paid ? who : null);
      await applyPlan(plan);
      toast({ message: plan.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Pay ${p.card.name}`} subtitle={`${formatShort(p.statement)} statement · due ${formatShort(p.due)}`} onClose={onClose} busy={busy}>
      <p className="num text-3xl font-bold">{formatPHP(p.amount)}</p>
      {p.paid && p.note && <p className="mt-1 text-sm text-accent">{p.note}</p>}
      <h3 className="mb-1 mt-4 text-sm font-medium">Charges on this statement</h3>
      <ul className="divide-y divide-line/60 rounded-2xl border border-line/70 text-sm">
        {p.bills.map((b) => (
          <li key={`${b.item.row}-${b.payday.iso}`} className="flex justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              {b.item.name} <span className="text-muted">· {formatShort(b.payday.date)}</span>
            </span>
            <span className="num">{formatPHP(b.amount)}</span>
          </li>
        ))}
        {p.spends.map((s) => (
          <li key={`spend-${s.row}`} className="flex justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              {s.what || s.category} <span className="text-muted">· {formatShort(fromIso(s.iso))} · unplanned</span>
            </span>
            <span className="num">{formatPHP(s.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Worked out from the bills charged to this card. Check it against the actual statement.</p>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
      <SheetActions>
        {p.paid ? (
          <Button variant="secondary" busy={busy} onClick={() => run(false)}>Mark as not paid</Button>
        ) : (
          <Button busy={busy} onClick={() => run(true)}>Mark as paid</Button>
        )}
      </SheetActions>
    </Sheet>
  );
}
