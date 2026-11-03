import { useMemo, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import {
  editableNotes, lastActive, paidHistory, planDelete, planEditDetails, planEnd, templates, type EditPlan, type RecurringSchedule,
} from '../lib/edits';
import { chargeDates } from '../lib/cards';
import { CATEGORIES } from '../lib/categories';
import { formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';
import { currentPayday, nextPayday, type LineItem, type Model } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { PaydaySelect } from './AddItemSheet';
import { CardPicker } from './CardPicker';
import { Field, Segmented, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

type Mode = 'details' | 'end' | 'delete';

export function ManageItemSheet({ model, item, today, onClose }: { model: Model; item: LineItem; today: Date; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const current = currentPayday(model, today);
  const next = nextPayday(model, today) ?? current;
  const recurringBill = item.kind === 'bill' && !item.oneTime;

  const [mode, setMode] = useState<Mode>('details');
  const [name, setName] = useState(item.name);
  const [notes, setNotes] = useState(editableNotes(item));
  const [card, setCard] = useState(item.card === 'Unassigned' ? '' : item.card);
  const [schedule, setSchedule] = useState(item.schedule);
  const [type, setType] = useState(item.type);
  const oneTimeAmount = item.oneTime ? (model.paydays.map((p) => model.amount(item.row, p)).find((v) => v > 0) ?? 0) : 0;
  const currentAmount = item.oneTime ? oneTimeAmount : item.monthly;
  const [amount, setAmount] = useState(String(currentAmount || ''));
  const [from, setFrom] = useState(next?.iso ?? model.paydays[0].iso);
  // The bill's current end: its last charged payday, or none when it runs to the end of the plan.
  const endsOn = lastActive(model, item);
  const openEnded = !endsOn || endsOn.index >= model.paydays.length - 2;
  const [last, setLast] = useState(openEnded ? '' : endsOn.iso);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const history = useMemo(() => paidHistory(model, item, today), [model, item, today]);
  const value = parseAmount(amount);
  const { t15, t30 } = templates(schedule, value || 0);
  const amountChanged = !!value && value !== currentAmount;
  const needsFrom = !item.oneTime && (amountChanged || schedule !== item.schedule);
  const kept = item.notes !== editableNotes(item) ? item.notes.replace(editableNotes(item), '').replace(/^[\s·]+|[\s·]+$/g, '').replace(/\s*·\s*·\s*/, ' · ') : '';

  // When the bill gets charged: its next paydays on the (new) schedule, or the one payday of a one-time payment.
  const charges = useMemo(() => {
    if (item.oneTime) {
      const p = model.paydays.find((x) => model.amount(item.row, x) > 0);
      return p ? [p.date] : [];
    }
    return chargeDates(model, schedule, today);
  }, [model, item, schedule, today]);

  const plan = useMemo((): { plan?: EditPlan; error?: string } => {
    try {
      if (mode === 'details')
        return { plan: planEditDetails(model, item, { name, notes, card, schedule, monthly: value || currentAmount, fromIso: from, type }) };
      if (mode === 'end') return { plan: planEnd(model, item, last || null) };
      return { plan: planDelete(model, item) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [mode, model, item, name, notes, card, schedule, value, currentAmount, from, last, type]);

  async function run() {
    if (!plan.plan) return setError(plan.error ?? 'Check the details.');
    if (mode === 'delete' && !confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    setError(null);
    try {
      await applyPlan(plan.plan);
      toast({ message: plan.plan.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const perPayday =
    schedule === 'split' || schedule === 'fund' ? `${formatPHP(t15)} each payday` : `${formatPHP(schedule === '15th' ? t15 : t30)} on the ${schedule}`;
  const modes: { value: Mode; label: string }[] = item.oneTime
    ? [{ value: 'details', label: 'Edit' }, { value: 'delete', label: 'Delete' }]
    : [
        { value: 'details', label: 'Edit' },
        { value: 'end', label: 'End date' },
        { value: 'delete', label: 'Delete' },
      ];
  const monthlyNow = value || item.monthly;
  const half = (s: RecurringSchedule) => (s === 'split' ? formatPHP(templates('split', monthlyNow).t15) + ' each' : formatPHP(monthlyNow));

  return (
    <Sheet title={item.name} subtitle={`${item.category} · ${item.card}`} onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Segmented
          name="manage"
          legend="What do you want to do?"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setConfirmDelete(false);
            setError(null);
          }}
          options={modes}
        />

        {mode === 'details' && (
          <>
            <Field id="m-name" label="Name">
              <input id="m-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={fieldClass} />
            </Field>

            <Field
              id="m-amount"
              label={item.oneTime ? 'Amount' : 'Monthly amount'}
              hint={item.oneTime ? undefined : amountChanged ? perPayday : `Currently ${formatPHP(item.monthly)} a month`}
            >
              <div className={amountWrapClass}>
                <span className="text-muted" aria-hidden>₱</span>
                <input id="m-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="m-amount-hint" autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
              </div>
            </Field>

            {recurringBill && (
              <>
                <Segmented
                  name="m-schedule"
                  legend="Paid from"
                  value={schedule as RecurringSchedule}
                  onChange={setSchedule}
                  options={[
                    { value: '15th', label: '15th', hint: half('15th') },
                    { value: '30th', label: '30th', hint: half('30th') },
                    { value: 'split', label: 'Split', hint: half('split') },
                  ]}
                />
              </>
            )}
            {needsFrom && (
              <Field
                id="m-from"
                label="Changes start from"
                hint={`Earlier paydays and paid ones keep their amounts.${schedule !== item.schedule ? " Months already paid aren't charged again." : ''}`}
              >
                <PaydaySelect id="m-from" model={model} value={from} onChange={setFrom} describedBy="m-from-hint" />
              </Field>
            )}

            <CardPicker id="m-card" model={model} value={card} onChange={setCard} charges={charges} amount={item.monthly} currentCard={item.card} />

            <Field id="m-type" label="Category" hint={item.typeSet ? undefined : 'Guessed from the name. Pick another to keep it.'}>
              <select id="m-type" value={type} onChange={(e) => setType(e.target.value)} aria-describedby={item.typeSet ? undefined : 'm-type-hint'} className={fieldClass}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>

            <Field id="m-notes" label="Notes" hint={kept ? `"${kept}" is kept automatically.` : undefined}>
              <input id="m-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" aria-describedby={kept ? 'm-notes-hint' : undefined} className={fieldClass} />
            </Field>

            {plan.plan && (
              <p className="rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">{plan.plan.summary}</p>
            )}
          </>
        )}

        {mode === 'end' && (
          <>
            <Field
              id="m-last"
              label="Last payment"
              hint={
                openEnded
                  ? `Currently no end date: it runs to the end of your plan (${formatShort(model.paydays.at(-1)!.date)}, ${model.paydays.at(-1)!.date.getFullYear()}).`
                  : `Currently ends ${formatShort(endsOn!.date)}, ${endsOn!.date.getFullYear()}. Pick a later payday to extend it, or an earlier one to end it sooner.`
              }
            >
              <PaydaySelect
                id="m-last"
                model={model}
                value={last}
                onChange={setLast}
                filter={(p) => (p.half === 15 ? item.template15 : item.template30) > 0}
                allowNone="No end date"
                describedBy="m-last-hint"
              />
            </Field>
            {plan.plan && <p className="rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">{plan.plan.summary}</p>}
          </>
        )}

        {mode === 'delete' && (
          <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-danger">
              <Warning size={18} aria-hidden /> Removes the bill from your plan
            </p>
            <p className="mt-1 text-muted">
              {history.length
                ? `Its payment history is lost too: paid on ${history.map((p) => formatShort(p.date)).join(', ')}.${item.oneTime ? '' : ' To keep history, use End instead.'}`
                : 'No payments are recorded for it yet.'}
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions>
          {mode === 'delete' ? (
            <Button type="submit" variant={confirmDelete ? 'primary' : 'danger'} busy={busy} className={confirmDelete ? '!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]' : 'border border-danger/50'}>
              {confirmDelete ? `Yes, delete ${item.name}` : 'Delete row'}
            </Button>
          ) : (
            <Button type="submit" busy={busy} disabled={mode === 'details' && !plan.plan}>
              {mode === 'details' ? 'Save changes' : 'Save end date'}
            </Button>
          )}
        </SheetActions>
      </form>
    </Sheet>
  );
}
