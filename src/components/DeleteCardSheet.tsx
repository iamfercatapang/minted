import { useMemo, useState } from 'react';
import { ArrowRight, Warning } from '@phosphor-icons/react';
import { billsOnCard, planDeleteCard, type BillMove } from '../lib/edits';
import { formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';
import { currentPayday, type CardInfo, type Model } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { cardOptions, PaydaySelect } from './AddItemSheet';
import { Field, Sheet, SheetActions, fieldClass } from './Sheet';

const OTHER = '__other__';
type Step = 1 | 2 | 3;
interface Choice {
  to: string;
  end: boolean;
  endIso: string;
}

/** Picks a destination from the existing cards or a typed-in method. */
function Destination({ id, label, value, options, onChange }: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const isOther = !options.includes(value);
  return (
    <div className="space-y-2">
      <Field id={id} label={label}>
        <select id={id} value={isOther ? OTHER : value} onChange={(e) => onChange(e.target.value === OTHER ? '' : e.target.value)} className={fieldClass}>
          {options.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={OTHER}>Other…</option>
        </select>
      </Field>
      {isOther && (
        <Field id={`${id}-other`} label="Card or payment method">
          <input id={`${id}-other`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" className={fieldClass} />
        </Field>
      )}
    </div>
  );
}

/**
 * Three steps: one destination for all of the card's bills, per-bill changes (another destination, or end it),
 * then a review that moves the bills and deletes the card in one change.
 */
export function DeleteCardSheet({ model, card, today, onBack, onClose }: {
  model: Model;
  card: CardInfo;
  today: Date;
  onBack: () => void;
  onClose: () => void;
}) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const bills = useMemo(() => billsOnCard(model, card), [model, card]);
  const options = useMemo(() => cardOptions(model).filter((c) => c !== card.name), [model, card]);
  const lastIso = currentPayday(model, today)?.iso ?? model.paydays[0].iso;

  const [step, setStep] = useState<Step>(1);
  const [all, setAll] = useState(options[0] ?? '');
  const [overrides, setOverrides] = useState<Record<number, Partial<Choice>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = (row: number): Choice => ({ to: all, end: false, endIso: lastIso, ...overrides[row] });
  const setChoice = (row: number, c: Partial<Choice>) => setOverrides((o) => ({ ...o, [row]: { ...o[row], ...c } }));
  const moves: BillMove[] = bills.map((item) => {
    const c = choice(item.row);
    return { item, to: c.to, endIso: c.end ? c.endIso : null };
  });

  const plan = useMemo(() => {
    try {
      return { plan: planDeleteCard(model, card, moves) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [model, card, JSON.stringify(moves.map((m) => [m.item.row, m.to, m.endIso]))]);

  function next() {
    setError(null);
    if (step === 1 && !all.trim()) return setError('Choose where the bills go.');
    if (step === 2 && plan.error) return setError(plan.error);
    setStep((s) => (s + 1) as Step);
  }

  async function confirm() {
    if (!plan.plan) return setError(plan.error ?? 'Check the choices.');
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

  const titles = { 1: 'Where should the bills go?', 2: 'Adjust any bill', 3: 'Review and delete' } as const;

  return (
    <Sheet title={`Delete ${card.name}`} subtitle={`Step ${step} of 3 · ${titles[step]}`} onClose={onClose} busy={busy}>
      <div className="mb-4 flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((s) => <span key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-primary' : 'bg-line'}`} />)}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 3) confirm();
          else next();
        }}
      >
        {step === 1 && (
          <>
            <p className="text-sm text-muted">
              {card.name} has {bills.length} bill{bills.length === 1 ? '' : 's'} ({formatPHP(bills.reduce((s, b) => s + b.monthly, 0))} a month). Pick where they go; you can change single bills next.
            </p>
            <Destination id="del-all" label="Move all bills to" value={all} options={options} onChange={setAll} />
          </>
        )}

        {step === 2 && (
          <ul className="space-y-3">
            {bills.map((b) => {
              const c = choice(b.row);
              return (
                <li key={b.row} className="rounded-2xl bg-elev/60 p-3">
                  <div className="mb-2 flex justify-between gap-3">
                    <span className="truncate font-medium">{b.name}</span>
                    <span className="num text-sm text-muted">{formatPHP(b.monthly)}/mo</span>
                  </div>
                  <Destination id={`del-${b.row}`} label="Move to" value={c.to} options={options} onChange={(to) => setChoice(b.row, { to })} />
                  {!b.oneTime && (
                    <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <input type="checkbox" checked={c.end} onChange={(e) => setChoice(b.row, { end: e.target.checked })} className="h-5 w-5 accent-[rgb(var(--primary))]" />
                      Also end this bill
                    </label>
                  )}
                  {c.end && (
                    <Field id={`del-end-${b.row}`} label="Last payday to pay">
                      <PaydaySelect id={`del-end-${b.row}`} model={model} value={c.endIso} onChange={(endIso) => setChoice(b.row, { endIso })} />
                    </Field>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {step === 3 && (
          <>
            <ul className="divide-y divide-line/60 rounded-2xl bg-elev/60 text-sm">
              {moves.map((m) => (
                <li key={m.item.row} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{m.item.name}</span>
                  <ArrowRight size={14} className="shrink-0 text-muted" aria-label="moves to" />
                  <span className="min-w-0 flex-1 truncate text-right font-medium">
                    {m.to}
                    {m.endIso && (
                      <span className="block text-xs font-normal text-muted">
                        ends after {formatShort(model.paydays.find((p) => p.iso === m.endIso)!.date)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex gap-2 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm">
              <Warning size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
              <span>Then removes {card.name}'s row from the card table. Bills keep their amounts and payment history.</span>
            </p>
          </>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions>
          {step === 3 ? (
            <Button type="submit" busy={busy} className="!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]">
              Move {bills.length} bill{bills.length === 1 ? '' : 's'} and delete
            </Button>
          ) : (
            <Button type="submit">Next</Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => (step === 1 ? onBack() : setStep((s) => (s - 1) as Step))}>
            Back
          </Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
