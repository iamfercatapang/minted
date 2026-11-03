import { useMemo, useState } from 'react';
import { planAdd, templates, type NewItem, type RecurringSchedule } from '../lib/edits';
import { formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';
import type { Model, Payday } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { Field, Segmented, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';
import { CardPicker } from './CardPicker';
import { chargeDates } from '../lib/cards';

export function cardOptions(model: Model): string[] {
  const names = [...model.cards.map((c) => c.name), ...model.items.map((i) => i.card)];
  return [...new Set(names.filter((n) => n && n !== 'Unassigned'))];
}

export function PaydaySelect({ id, model, value, onChange, filter, allowNone, describedBy }: {
  id: string;
  model: Model;
  value: string;
  onChange: (iso: string) => void;
  filter?: (p: Payday) => boolean;
  allowNone?: string;
  describedBy?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} className={fieldClass}>
      {allowNone && <option value="">{allowNone}</option>}
      {model.paydays.filter(filter ?? (() => true)).map((p) => (
        <option key={p.iso} value={p.iso}>{formatShort(p.date)}, {p.date.getFullYear()}</option>
      ))}
    </select>
  );
}

export function AddItemSheet({ model, payday, onClose }: { model: Model; payday: Payday; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const cards = useMemo(() => cardOptions(model), [model]);

  const [type, setType] = useState<NewItem['type']>('recurring');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [schedule, setSchedule] = useState<RecurringSchedule>(payday.half === 15 ? '15th' : '30th');
  const [start, setStart] = useState(payday.iso);
  const [end, setEnd] = useState('');
  const [when, setWhen] = useState(payday.iso);
  const [card, setCard] = useState(cards[0] ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = parseAmount(amount);
  const fits = (p: Payday) => schedule === 'split' || (schedule === '15th' ? p.half === 15 : p.half === 30);
  // Keep start/end on paydays the schedule actually uses.
  const startIso = model.paydays.find((p) => p.iso >= start && fits(p))?.iso ?? start;
  const endIso = end ? (model.paydays.filter((p) => p.iso <= end && fits(p)).at(-1)?.iso ?? end) : null;

  const item: NewItem =
    type === 'recurring'
      ? { type, name, card, notes, schedule, monthly: value, startIso, endIso }
      : { type, name, card, notes, paydayIso: when, amount: value };
  const charges = useMemo(() => {
    const at = (iso: string) => model.paydays.find((p) => p.iso === iso)?.date;
    if (type === 'oneTime') return [at(when)].filter((d): d is Date => !!d);
    const start = at(startIso);
    return start ? chargeDates(model, schedule, start) : [];
  }, [model, type, when, startIso, schedule]);

  const preview = useMemo(() => {
    try {
      return { text: planAdd(model, item).summary, ok: true };
    } catch (e) {
      return { text: (e as Error).message, ok: false };
    }
  }, [model, item]);


  async function submit() {
    setError(null);
    let plan;
    try {
      plan = planAdd(model, item);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      await applyPlan(plan);
      toast({ message: `Added ${item.name.trim()}`, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Add bill or payment" subtitle="Adds it to your plan" onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          name="type"
          legend="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'recurring', label: 'Recurring bill' },
            { value: 'oneTime', label: 'One-time payment' },
          ]}
        />

        <Field id="add-name" label="Name">
          <input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={type === 'recurring' ? 'e.g. Disney+' : 'e.g. Aircon repair'} autoComplete="off" className={fieldClass} />
        </Field>

        <Field id="add-amount" label={type === 'recurring' ? 'Monthly amount' : 'Amount'}>
          <div className={amountWrapClass}>
            <span className="text-muted" aria-hidden>₱</span>
            <input id="add-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
          </div>
        </Field>

        {type === 'recurring' ? (
          <>
            <Segmented
              name="schedule"
              legend="Paid from"
              value={schedule}
              onChange={setSchedule}
              options={[
                { value: '15th', label: '15th', hint: value ? formatPHP(value) : undefined },
                { value: '30th', label: '30th', hint: value ? formatPHP(value) : undefined },
                { value: 'split', label: 'Split', hint: value ? `${formatPHP(templates('split', value).t15)} each` : 'half each' },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field id="add-start" label="Starts">
                <PaydaySelect id="add-start" model={model} value={startIso} onChange={setStart} filter={fits} />
              </Field>
              <Field id="add-end" label="Ends">
                <PaydaySelect id="add-end" model={model} value={endIso ?? ''} onChange={setEnd} filter={(p) => fits(p) && p.iso >= startIso} allowNone="No end date" />
              </Field>
            </div>
          </>
        ) : (
          <Field id="add-when" label="Payday">
            <PaydaySelect id="add-when" model={model} value={when} onChange={setWhen} />
          </Field>
        )}

        <CardPicker id="add-card" model={model} value={card} onChange={setCard} charges={charges} amount={value || 0} />

        <Field id="add-notes" label="Notes (optional)">
          <input id="add-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" className={fieldClass} />
        </Field>

        <p className={`rounded-xl bg-elev px-3 py-2 text-sm ${preview.ok ? '' : 'text-muted'}`} aria-live="polite">
          {preview.ok ? preview.text : 'Fill in the name and amount to see what gets added.'}
        </p>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions>
          <Button type="submit" busy={busy}>Add to plan</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
