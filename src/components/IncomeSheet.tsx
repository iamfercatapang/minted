import { useMemo, useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import { incomeExtra, parseEarners, planChangeIncome, planIncomeExtra, type Earner } from '../lib/income';
import { formatShort } from '../lib/dates';
import { formatPHP, round2 } from '../lib/money';
import type { EditPlan } from '../lib/edits';
import type { Model, Payday } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { PaydaySelect } from './AddItemSheet';
import { Field, Segmented, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

type Mode = 'regular' | 'extra';
type Row = { name: string; amount: string };

/** Edit each earner's regular pay from a payday on, or add a one-time extra (bonus, 13th month) to this payday. */
export function IncomeSheet({ model, payday, onClose }: { model: Model; payday: Payday; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const extra = incomeExtra(model, payday);
  const initial = parseEarners(model.incomeNote);

  const [mode, setMode] = useState<Mode>('regular');
  const [rows, setRows] = useState<Row[]>(
    initial.length ? initial.map((e) => ({ name: e.name, amount: String(e.amount) })) : [{ name: '', amount: String(model.income[payday.index] || '') }],
  );
  const [from, setFrom] = useState(payday.iso);
  const [extraAmount, setExtraAmount] = useState(extra ? String(extra.amount) : '');
  const [extraLabel, setExtraLabel] = useState(extra?.label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const earners: Earner[] = rows.map((r) => ({ name: r.name, amount: parseAmount(r.amount) }));
  const total = round2(earners.reduce((s, e) => s + (e.amount || 0), 0));
  const update = (i: number, r: Partial<Row>) => setRows((all) => all.map((x, j) => (j === i ? { ...x, ...r } : x)));

  const plan = useMemo((): { plan?: EditPlan; error?: string } => {
    try {
      return mode === 'regular'
        ? { plan: planChangeIncome(model, earners, from) }
        : { plan: planIncomeExtra(model, payday, parseAmount(extraAmount) || 0, extraLabel) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [model, payday, mode, JSON.stringify(rows), from, extraAmount, extraLabel]);

  async function run(p = plan.plan) {
    if (!p) return setError(plan.error ?? 'Check the amounts.');
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

  return (
    <Sheet title="Payday income" subtitle={`${formatShort(payday.date)}, ${payday.date.getFullYear()} · ${formatPHP(model.income[payday.index] ?? 0)}`} onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <Segmented
          name="income-mode"
          legend="What changed?"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: 'regular', label: 'Regular pay' },
            { value: 'extra', label: 'One-time extra' },
          ]}
        />

        {mode === 'regular' ? (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Pay per payday</legend>
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Earner ${i + 1} name`}
                    value={r.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    placeholder="Name"
                    autoComplete="off"
                    className={`${fieldClass} !w-28 shrink-0`}
                  />
                  <div className={`${amountWrapClass} min-w-0 flex-1`}>
                    <span className="text-muted" aria-hidden>₱</span>
                    <input
                      aria-label={`${r.name || `Earner ${i + 1}`} pay per payday`}
                      inputMode="decimal"
                      value={r.amount}
                      onChange={(e) => update(i, { amount: e.target.value })}
                      placeholder="0.00"
                      autoComplete="off"
                      className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none"
                    />
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
                      aria-label={`Remove ${r.name || 'earner'}`}
                      className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev hover:text-danger"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              <Button variant="ghost" onClick={() => setRows((all) => [...all, { name: '', amount: '' }])} className="-ml-2">
                <Plus size={18} weight="bold" aria-hidden /> Add earner
              </Button>
            </fieldset>
            <p className="num rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">
              {formatPHP(total)} each payday · {formatPHP(total * 2)} a month
            </p>
            <Field id="inc-from" label="Starting from" hint="Earlier paydays keep their income. Goal plans stay as they are, so any difference shows in Remaining funds.">
              <PaydaySelect id="inc-from" model={model} value={from} onChange={setFrom} describedBy="inc-from-hint" />
            </Field>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field id="inc-extra" label="Extra amount">
                <div className={amountWrapClass}>
                  <span className="text-muted" aria-hidden>₱</span>
                  <input id="inc-extra" inputMode="decimal" value={extraAmount} onChange={(e) => setExtraAmount(e.target.value)} placeholder="0.00" autoComplete="off" className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
                </div>
              </Field>
              <Field id="inc-extra-label" label="What is it?">
                <input id="inc-extra-label" value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)} placeholder="e.g. 13th month" autoComplete="off" className={fieldClass} />
              </Field>
            </div>
            <p className="text-xs text-muted">Only for {formatShort(payday.date)}. It shows as extra in Remaining funds that payday.</p>
          </>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions
          destructive={
            mode === 'extra' && extra ? (
              <Button variant="danger" busy={busy} onClick={() => run(planIncomeExtra(model, payday, 0, ''))} className="w-full border border-danger/50">
                Remove the {formatPHP(extra.amount)} extra
              </Button>
            ) : undefined
          }
        >
          <Button type="submit" busy={busy}>{mode === 'regular' ? 'Save income' : extra ? 'Update extra' : 'Add extra'}</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
