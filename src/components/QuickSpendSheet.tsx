import { useMemo, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { SPEND_CATEGORIES, paydayFor, planDeleteSpend, planEditSpend, planLogSpend, planSpendLimit, spendSummary, type SpendInput } from '../lib/spending';
import { fundStatus } from '../lib/funds';
import { formatShort, isoDate } from '../lib/dates';
import { formatPHP, round2 } from '../lib/money';
import { currentPayday, type Model, type Spend } from '../lib/model';
import type { EditPlan } from '../lib/edits';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { cardOptions } from './AddItemSheet';
import { Field, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

const OTHER = '__other__';

/** Log an unplanned spend (spend = undefined) or edit / delete one. */
export function QuickSpendSheet({ model, today, spend, onClose }: { model: Model; today: Date; spend?: Spend; onClose: () => void }) {
  const { applyPlan, settings, auth, backend } = useLedger();
  const toast = useToast();
  const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');
  const cards = useMemo(() => ['Cash', ...cardOptions(model).filter((c) => c !== 'Cash')], [model]);
  const funds = model.items.filter((i) => i.kind === 'fund');
  const current = currentPayday(model, today);

  const [amount, setAmount] = useState(spend ? String(spend.amount) : '');
  const [category, setCategory] = useState(spend?.category || SPEND_CATEGORIES[0]);
  const [what, setWhat] = useState(spend?.what ?? '');
  const [iso, setIso] = useState(spend?.iso ?? isoDate(today));
  const [card, setCard] = useState(spend?.card ?? 'Cash');
  const [fromFund, setFromFund] = useState(!!spend?.fund);
  const [fund, setFund] = useState(spend?.fund || funds[0]?.name || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = parseAmount(amount);
  const input: SpendInput = { iso, amount: value, category, what, card, fund: fromFund ? fund : '', by: spend?.by || who };
  const payday = iso >= model.paydays[0].iso ? paydayFor(model, iso) : null;
  const summary = payday ? spendSummary(model, payday) : null;
  // What this payday's unplanned total would be after saving.
  const after = summary ? round2(summary.total - (spend && !spend.fund && paydayFor(model, spend.iso) === payday ? spend.amount : 0) + (fromFund ? 0 : value || 0)) : 0;
  const isOther = !cards.includes(card);
  const fundInfo = fromFund ? funds.find((f) => f.name === fund) : undefined;
  const fundBalance = fundInfo ? fundStatus(model, fundInfo, current).balance : null;

  async function run(plan: () => EditPlan) {
    setError(null);
    let p: EditPlan;
    try {
      p = plan();
    } catch (e) {
      return setError((e as Error).message);
    }
    setBusy(true);
    try {
      await applyPlan(p);
      toast({ message: p.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={spend ? 'Edit spending' : 'Log spending'} subtitle="Unplanned, one-off spending like eating out or a quick trip" onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => (spend ? planEditSpend(model, spend, input) : planLogSpend(model, input)));
        }}
      >
        <Field id="qs-amount" label="Amount">
          <div className={amountWrapClass}>
            <span className="text-lg text-muted" aria-hidden>₱</span>
            <input
              id="qs-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              autoComplete="off"
              autoFocus={!spend}
              className="num min-h-14 w-full bg-transparent px-2 text-2xl font-bold outline-none"
            />
          </div>
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Category</legend>
          <div className="flex flex-wrap gap-2">
            {SPEND_CATEGORIES.map((c) => (
              <label
                key={c}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-primary ${
                  category === c ? 'border-primary bg-primary/15 text-fg' : 'border-line text-muted hover:bg-elev'
                }`}
              >
                <input type="radio" name="qs-category" value={c} checked={category === c} onChange={() => setCategory(c)} className="sr-only" />
                {c}
              </label>
            ))}
          </div>
        </fieldset>

        <Field id="qs-what" label="What for (optional)">
          <input id="qs-what" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Lunch at Mesa" autoComplete="off" className={fieldClass} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="qs-date" label="Date">
            <input id="qs-date" type="date" value={iso} onChange={(e) => setIso(e.target.value)} className={fieldClass} />
          </Field>
          <Field id="qs-card" label="Paid with">
            <select id="qs-card" value={isOther ? OTHER : card} onChange={(e) => setCard(e.target.value === OTHER ? '' : e.target.value)} className={fieldClass}>
              {cards.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={OTHER}>Other…</option>
            </select>
          </Field>
        </div>
        {isOther && (
          <Field id="qs-card-other" label="Card or payment method">
            <input id="qs-card-other" value={card} onChange={(e) => setCard(e.target.value)} autoComplete="off" className={fieldClass} />
          </Field>
        )}

        {funds.length > 0 && (
          <div className="rounded-2xl bg-elev/60 p-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={fromFund} disabled={!!spend} onChange={(e) => setFromFund(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--primary))]" />
              Take it from a sinking fund
            </label>
            {fromFund && (
              <Field id="qs-fund" label="Fund" hint={fundBalance !== null ? `Balance ${formatPHP(fundBalance)}${value > fundBalance ? ' — this takes it below zero' : ''}` : undefined}>
                <select id="qs-fund" value={fund} disabled={!!spend} onChange={(e) => setFund(e.target.value)} aria-describedby="qs-fund-hint" className={fieldClass}>
                  {funds.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                </select>
              </Field>
            )}
          </div>
        )}

        {payday && (
          <p className="rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">
            {fromFund
              ? `Comes out of ${fund}, not the ${formatShort(payday.date)} payday.`
              : summary?.limit
                ? `${formatShort(payday.date)} payday: ${formatPHP(after)} of ${formatPHP(summary.limit)} unplanned limit used.`
                : `Comes out of the ${formatShort(payday.date)} payday's remaining funds (${formatPHP(after)} unplanned so far).`}
          </p>
        )}
        {!fromFund && summary?.limit && after > summary.limit && (
          <p className="flex gap-2 rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
            <Warning size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <span>Over this payday's limit by {formatPHP(after - summary.limit)}. You can still save it.</span>
          </p>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions
          destructive={
            spend ? (
              <Button
                variant={confirmDelete ? 'primary' : 'danger'}
                disabled={busy}
                onClick={() => (confirmDelete ? run(() => planDeleteSpend(model, spend)) : setConfirmDelete(true))}
                className={`w-full ${confirmDelete ? '!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]' : 'border border-danger/50'}`}
              >
                {confirmDelete ? `Yes, delete ${formatPHP(spend.amount)}` : 'Delete'}
              </Button>
            ) : undefined
          }
        >
          <Button type="submit" busy={busy}>{spend ? 'Save changes' : 'Log spending'}</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}

/** Sets or clears the per-payday limit for unplanned spending. */
export function SpendLimitSheet({ model, onClose }: { model: Model; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const [limit, setLimit] = useState(model.spendLimit ? String(model.spendLimit) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: number | null) {
    setBusy(true);
    setError(null);
    try {
      const p = planSpendLimit(model, value);
      await applyPlan(p);
      toast({ message: p.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Unplanned spending limit" subtitle="How much you allow for unplanned spending each payday" onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save(limit.trim() ? parseAmount(limit) : null);
        }}
      >
        <Field id="qs-limit" label="Limit per payday" hint="Leave empty for no limit.">
          <div className={amountWrapClass}>
            <span className="text-muted" aria-hidden>₱</span>
            <input id="qs-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 3,000" aria-describedby="qs-limit-hint" autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
          </div>
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <SheetActions
          destructive={model.spendLimit ? <Button variant="ghost" disabled={busy} onClick={() => save(null)} className="w-full">Remove limit</Button> : undefined}
        >
          <Button type="submit" busy={busy}>Save limit</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
