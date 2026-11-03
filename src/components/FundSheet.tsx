import { useMemo, useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { planDelete, planEnd, type EditPlan } from '../lib/edits';
import {
  fundNotes, fundStatus, fundTarget, fundWithdrawals, planAddFund, planDeleteWithdrawal, planEditFund, planWithdraw,
} from '../lib/funds';
import { formatShort, fromIso, isoDate } from '../lib/dates';
import { formatPHP } from '../lib/money';
import { currentPayday, nextPayday, type LineItem, type Model } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { PaydaySelect, cardOptions } from './AddItemSheet';
import { Field, Segmented, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

type Mode = 'edit' | 'withdraw' | 'end' | 'delete';
const OTHER = '__other__';

function Amount({ id, value, onChange, placeholder, describedBy }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; describedBy?: string }) {
  return (
    <div className={amountWrapClass}>
      <span className="text-muted" aria-hidden>₱</span>
      <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? '0.00'} aria-describedby={describedBy} autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
    </div>
  );
}

/** Add a sinking fund (fund = undefined), or edit / withdraw from / end / delete one. */
export function FundSheet({ model, fund, today, onClose }: { model: Model; fund?: LineItem; today: Date; onClose: () => void }) {
  const { applyPlan, settings, auth, backend } = useLedger();
  const toast = useToast();
  const current = currentPayday(model, today);
  const next = nextPayday(model, today) ?? current ?? model.paydays[0];
  const accounts = useMemo(() => cardOptions(model), [model]);
  const status = fund ? fundStatus(model, fund, current) : null;
  const history = fund ? fundWithdrawals(model, fund) : [];
  const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');

  const [mode, setMode] = useState<Mode>('edit');
  const [name, setName] = useState(fund?.name ?? '');
  const [monthly, setMonthly] = useState(fund ? String(fund.monthly) : '');
  const [target, setTarget] = useState(fund && fundTarget(fund) ? String(fundTarget(fund)) : '');
  const [card, setCard] = useState(fund?.card ?? accounts.find((a) => /bank|cash/i.test(a)) ?? accounts[0] ?? '');
  const [notes, setNotes] = useState(fund ? fundNotes(fund) : '');
  const [from, setFrom] = useState(next.iso);
  const [end, setEnd] = useState('');
  const [last, setLast] = useState(current?.iso ?? next.iso);
  const [wAmount, setWAmount] = useState('');
  const [wDate, setWDate] = useState(isoDate(today));
  const [wNote, setWNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOther = !accounts.includes(card);
  const value = parseAmount(monthly);
  const targetValue = target.trim() ? parseAmount(target) : null;
  const input = { name, monthly: value, card, notes, target: targetValue };
  const amountChanged = !!fund && value !== fund.monthly;

  const plan = useMemo((): { plan?: EditPlan; error?: string } => {
    try {
      if (!fund) return { plan: planAddFund(model, { ...input, startIso: from, endIso: end || null }) };
      if (mode === 'edit') return { plan: planEditFund(model, fund, { ...input, fromIso: from }) };
      if (mode === 'withdraw') return { plan: planWithdraw(model, fund, { amount: parseAmount(wAmount), iso: wDate, note: wNote, by: who }) };
      if (mode === 'end') return { plan: planEnd(model, fund, last) };
      return { plan: planDelete(model, fund) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [model, fund, mode, name, value, card, notes, targetValue, from, end, last, wAmount, wDate, wNote, who]);

  async function run(p: EditPlan | undefined = plan.plan) {
    if (!p) return setError(plan.error ?? 'Check the details.');
    if (mode === 'delete' && !confirmDelete && p === plan.plan) return setConfirmDelete(true);
    setBusy(true);
    setError(null);
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

  const half = value ? formatPHP(Math.round((value / 2) * 100) / 100) : null;

  return (
    <Sheet
      title={fund ? fund.name : 'Add sinking fund'}
      subtitle={status ? `Balance ${formatPHP(status.balance)}${status.withdrawn ? ` · ${formatPHP(status.withdrawn)} taken out` : ''}` : 'Money set aside every payday'}
      onClose={onClose}
      busy={busy}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {fund && (
          <Segmented
            name="fund-mode"
            legend="What do you want to do?"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setConfirmDelete(false);
              setError(null);
            }}
            options={[
              { value: 'edit', label: 'Edit' },
              { value: 'withdraw', label: 'Withdraw' },
              { value: 'end', label: 'End' },
              { value: 'delete', label: 'Delete' },
            ]}
          />
        )}

        {mode === 'edit' && (
          <>
            <Field id="f-name" label="Fund name">
              <input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car Maintenance" autoComplete="off" className={fieldClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="f-monthly" label="Monthly" hint={half ? `${half} each payday` : undefined}>
                <Amount id="f-monthly" value={monthly} onChange={setMonthly} describedBy="f-monthly-hint" />
              </Field>
              <Field id="f-target" label="Target (optional)">
                <Amount id="f-target" value={target} onChange={setTarget} placeholder="None" />
              </Field>
            </div>
            {!fund ? (
              <div className="grid grid-cols-2 gap-3">
                <Field id="f-start" label="Starts">
                  <PaydaySelect id="f-start" model={model} value={from} onChange={setFrom} />
                </Field>
                <Field id="f-end" label="Ends">
                  <PaydaySelect id="f-end" model={model} value={end} onChange={setEnd} filter={(p) => p.iso >= from} allowNone="No end date" />
                </Field>
              </div>
            ) : (
              amountChanged && (
                <Field id="f-from" label="New amount starts from" hint="Earlier paydays keep their amounts.">
                  <PaydaySelect id="f-from" model={model} value={from} onChange={setFrom} describedBy="f-from-hint" />
                </Field>
              )
            )}
            <Field id="f-card" label="Goes to">
              <select id="f-card" value={isOther ? OTHER : card} onChange={(e) => setCard(e.target.value === OTHER ? '' : e.target.value)} className={fieldClass}>
                {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                <option value={OTHER}>Other…</option>
              </select>
            </Field>
            {isOther && (
              <Field id="f-card-other" label="Account">
                <input id="f-card-other" value={card} onChange={(e) => setCard(e.target.value)} autoComplete="off" className={fieldClass} />
              </Field>
            )}
            <Field id="f-notes" label="Notes (optional)">
              <input id="f-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" className={fieldClass} />
            </Field>
          </>
        )}

        {mode === 'withdraw' && status && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="w-amount"
                label="Amount taken out"
                hint={parseAmount(wAmount) > status.balance ? `More than the ${formatPHP(status.balance)} balance` : `Balance ${formatPHP(status.balance)}`}
              >
                <Amount id="w-amount" value={wAmount} onChange={setWAmount} describedBy="w-amount-hint" />
              </Field>
              <Field id="w-date" label="Date">
                <input id="w-date" type="date" value={wDate} onChange={(e) => setWDate(e.target.value)} className={fieldClass} />
              </Field>
            </div>
            <Field id="w-note" label="What for (optional)">
              <input id="w-note" value={wNote} onChange={(e) => setWNote(e.target.value)} placeholder="e.g. Aircon repair" autoComplete="off" className={fieldClass} />
            </Field>
            {model.layout.withdrawalsRows === null && (
              <p className="text-xs text-muted">Withdrawals are kept in a "Fund Withdrawals" list, shared with everyone using Minted.</p>
            )}
            {history.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-medium">Past withdrawals</h3>
                <ul className="divide-y divide-line/60 rounded-2xl border border-line/70 text-sm">
                  {[...history].reverse().map((w) => (
                    <li key={w.row} className="flex items-center gap-2 py-1 pl-3 pr-1">
                      <span className="min-w-0 flex-1">
                        <span className="num block">{formatPHP(w.amount)}</span>
                        <span className="block truncate text-xs text-muted">
                          {/^\d{4}-\d{2}-\d{2}$/.test(w.iso) ? formatShort(fromIso(w.iso)) : w.iso}
                          {w.note ? ` · ${w.note}` : ''}
                          {w.by ? ` · ${w.by}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => run(planDeleteWithdrawal(w))}
                        disabled={busy}
                        aria-label={`Remove the ${formatPHP(w.amount)} withdrawal`}
                        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev hover:text-danger"
                      >
                        <Trash size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {mode === 'end' && (
          <Field id="f-last" label="Last payday to set aside" hint={plan.plan?.summary}>
            <PaydaySelect id="f-last" model={model} value={last} onChange={setLast} describedBy="f-last-hint" />
          </Field>
        )}

        {mode === 'delete' && status && (
          <p className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
            Removes the fund from your plan{status.contributed ? `, including ${formatPHP(status.contributed)} of recorded contributions` : ''}. To keep its history, use End instead.
          </p>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions>
          {mode === 'delete' ? (
            <Button type="submit" variant={confirmDelete ? 'primary' : 'danger'} busy={busy} className={confirmDelete ? '!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]' : 'border border-danger/50'}>
              {confirmDelete ? `Yes, delete ${fund!.name}` : 'Delete fund'}
            </Button>
          ) : (
            <Button type="submit" busy={busy}>
              {!fund ? 'Add fund' : mode === 'edit' ? 'Save changes' : mode === 'withdraw' ? 'Record withdrawal' : 'End fund'}
            </Button>
          )}
        </SheetActions>
      </form>
    </Sheet>
  );
}
