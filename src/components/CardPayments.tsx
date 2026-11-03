import { useState } from 'react';
import { CheckCircle, Circle, CircleHalf, Receipt, Trash } from '@phosphor-icons/react';
import type { CardPayment } from '../lib/cards';
import { SOURCE_LABEL, planCardPay, planDeleteCardPay, planUnmarkStatement } from '../lib/cardpay';
import { formatShort, fromIso, isoDate } from '../lib/dates';
import { formatPHP, round2 } from '../lib/money';
import type { CardPay, Model } from '../lib/model';
import type { EditPlan } from '../lib/edits';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { Field, Sheet, SheetActions, parseAmount, amountWrapClass } from './Sheet';

/** Card payments due from a payday. They're reminders: the bills on each card already count in the totals. */
export function CardPayments({ model, payments, today }: { model: Model; payments: CardPayment[]; today: Date }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!payments.length) return null;
  // Look the payment up by card each render so the sheet shows fresh numbers after a save.
  const current = payments.find((p) => p.card.name === open);
  return (
    <>
      <ul className="rounded-2xl border border-line/70 bg-card p-1">
        {payments.map((p) => {
          const partial = !p.paid && p.paidTotal > 0;
          return (
            <li key={p.card.name}>
              <button
                onClick={() => setOpen(p.card.name)}
                aria-label={`${p.card.name} payment, ${formatPHP(p.amount)}, ${p.paid ? 'paid' : partial ? `${formatPHP(p.left)} left` : `due ${formatShort(p.due)}`}. Tap for details.`}
                className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-elev"
              >
                <span className={p.paid ? 'text-accent' : partial ? 'text-primary' : 'text-muted'} aria-hidden>
                  {p.paid ? <CheckCircle size={28} weight="fill" /> : partial ? <CircleHalf size={28} weight="fill" /> : <Circle size={28} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-medium ${p.paid ? 'text-muted' : ''}`}>Pay {p.card.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                    <Receipt size={14} aria-hidden />
                    {formatShort(p.statement)} statement · due {formatShort(p.due)}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`num block font-semibold ${p.paid ? 'text-accent' : ''}`}>{formatPHP(p.paid || !partial ? p.amount : p.left)}</span>
                  <span className="block text-xs text-muted">
                    {p.paid ? 'Paid' : partial ? `left of ${formatPHP(p.amount)}` : `${p.bills.length + p.spends.length} charge${p.bills.length + p.spends.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 px-1 text-xs text-muted">Not added to the totals above, since the bills on each card are already counted.</p>
      {current && <CardPaymentSheet model={model} payment={current} today={today} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Payments recorded toward a statement, each removable. */
export function PaymentList({ model, payments, busy, onRun }: { model: Model; payments: CardPay[]; busy: boolean; onRun: (p: EditPlan) => void }) {
  if (!payments.length) return null;
  return (
    <ul className="divide-y divide-line/60 rounded-2xl border border-line/70 text-sm">
      {payments.map((x) => (
        <li key={x.row} className="flex items-center gap-2 py-1 pl-3 pr-1">
          <span className="min-w-0 flex-1">
            <span className="num block">{formatPHP(x.amount)}</span>
            <span className="block truncate text-xs text-muted">
              {formatShort(fromIso(x.iso))} · {SOURCE_LABEL[x.source]}{x.goal ? ` (${x.goal})` : ''}{x.by ? ` · ${x.by}` : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRun(planDeleteCardPay(model, x))}
            disabled={busy}
            aria-label={`Remove the ${formatPHP(x.amount)} payment`}
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev hover:text-danger"
          >
            <Trash size={18} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardPaymentSheet({ model, payment: p, today, onClose }: { model: Model; payment: CardPayment; today: Date; onClose: () => void }) {
  const { applyPlan, settings, auth, backend } = useLedger();
  const toast = useToast();
  const [amount, setAmount] = useState(String(p.left || p.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');
  const value = parseAmount(amount);
  const diff = round2(value - p.left);

  async function run(plan: () => EditPlan, close = true) {
    setError(null);
    let pl: EditPlan;
    try {
      pl = plan();
    } catch (e) {
      return setError((e as Error).message);
    }
    setBusy(true);
    try {
      await applyPlan(pl);
      toast({ message: pl.summary, tone: 'info' });
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const iso = isoDate(today) < model.paydays[0].iso ? p.payday.iso : isoDate(today);

  return (
    <Sheet title={`Pay ${p.card.name}`} subtitle={`${formatShort(p.statement)} statement · due ${formatShort(p.due)}`} onClose={onClose} busy={busy}>
      <dl className="num grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-muted">Statement</dt>
        <dd className="text-right font-semibold">{formatPHP(p.amount)}</dd>
        {p.paidTotal > 0 && (
          <>
            <dt className="text-muted">Paid so far</dt>
            <dd className="text-right">−{formatPHP(p.paidTotal)}</dd>
            <dt className="font-medium">Left to pay</dt>
            <dd className="text-right text-lg font-bold">{formatPHP(p.left)}</dd>
          </>
        )}
      </dl>
      {p.paid && p.note && <p className="mt-1 text-sm text-accent">{p.note}</p>}

      {p.payments.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-sm font-medium">Payments</h3>
          <PaymentList model={model} payments={p.payments} busy={busy} onRun={(pl) => run(() => pl, false)} />
        </div>
      )}

      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Charges on this statement ({p.bills.length + p.spends.length})</summary>
        <ul className="divide-y divide-line/60 rounded-2xl border border-line/70 text-sm">
          {p.bills.map((b) => (
            <li key={`${b.item.row}-${b.payday.iso}`} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{b.item.name} <span className="text-muted">· {formatShort(b.payday.date)}</span></span>
              <span className="num">{formatPHP(b.amount)}</span>
            </li>
          ))}
          {p.spends.map((s) => (
            <li key={`spend-${s.row}`} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{s.what || s.category} <span className="text-muted">· {formatShort(fromIso(s.iso))} · unplanned</span></span>
              <span className="num">{formatPHP(s.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted">Worked out from what's charged to this card. Check it against the actual statement.</p>
      </details>

      {!p.paid && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => planCardPay(model, { card: p.card, iso, amount: value, source: 'statement', by: who, statement: p }));
          }}
        >
          <Field
            id="cp-amount"
            label="Amount paid"
            hint={!value ? undefined : diff < 0 ? `${formatPHP(-diff)} will still be left to pay.` : diff > 0 ? `${formatPHP(diff)} more than what's left.` : 'Pays the statement in full.'}
          >
            <div className={amountWrapClass}>
              <span className="text-muted" aria-hidden>₱</span>
              <input id="cp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="cp-amount-hint" autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
            </div>
          </Field>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <SheetActions>
            <Button type="submit" busy={busy}>{diff < 0 ? 'Record partial payment' : 'Mark as paid'}</Button>
          </SheetActions>
        </form>
      )}
      {p.paid && (
        <>
          {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
          <SheetActions>
            <Button variant="secondary" busy={busy} onClick={() => run(() => planUnmarkStatement(p))}>Mark as not paid</Button>
          </SheetActions>
        </>
      )}
    </Sheet>
  );
}
