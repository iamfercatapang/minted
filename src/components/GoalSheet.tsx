import { useMemo, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { planAddGoal, planDeleteGoal, planEditGoal, previewGoalPlan, surplusShortfalls, type GoalPlanInput } from '../lib/edits';
import { formatMonthYear, formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';
import { currentPayday, nextPayday, type Goal, type Model } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { PaydaySelect } from './AddItemSheet';
import { Field, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

function AmountInput({ id, value, onChange, disabled, placeholder, describedBy }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  describedBy?: string;
}) {
  return (
    <div className={`${amountWrapClass} ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-muted" aria-hidden>₱</span>
      <input
        id={id}
        inputMode="decimal"
        value={disabled ? '' : value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'}
        aria-describedby={describedBy}
        autoComplete="off"
        className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Add a goal (goal = undefined) or edit / re-plan / delete one. */
export function GoalSheet({ model, goal, today, onClose }: { model: Model; goal?: Goal; today: Date; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const start = nextPayday(model, today) ?? currentPayday(model, today) ?? model.paydays[0];
  const lastPlanned = goal ? [...goal.planned].reverse().find((v) => v > 0) : undefined;

  const [name, setName] = useState(goal?.name ?? '');
  const [openEnded, setOpenEnded] = useState(goal ? goal.target === null : false);
  const [target, setTarget] = useState(goal?.target ? String(goal.target) : '');
  const [changePlan, setChangePlan] = useState(!goal);
  const [perPayday, setPerPayday] = useState(lastPlanned ? String(lastPlanned) : '');
  const [from, setFrom] = useState(start.iso);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetValue = openEnded ? null : parseAmount(target);
  const plan: GoalPlanInput = { perPayday: parseAmount(perPayday) || 0, fromIso: from };
  const saved = goal ? goal.actual.reduce((a, b) => a + b, 0) : 0;

  const preview = useMemo(() => {
    if (!changePlan) return null;
    try {
      const planned = previewGoalPlan(model, goal?.planned ?? null, targetValue, plan);
      let lastIdx = -1;
      planned.forEach((v, i) => v > 0 && (lastIdx = i));
      const total = planned.reduce((a, b) => a + b, 0);
      const reaches = targetValue !== null && total >= targetValue - 1;
      const short = surplusShortfalls(model, today, { goalId: goal?.id ?? null, planned });
      return { lastIdx, reaches, total, short };
    } catch {
      return null;
    }
  }, [changePlan, model, goal, targetValue, plan.perPayday, plan.fromIso, today]);

  async function run(kind: 'save' | 'delete') {
    setError(null);
    if (kind === 'delete' && !confirmDelete) return setConfirmDelete(true);
    try {
      const input = { name, target: targetValue };
      const p =
        kind === 'delete' ? planDeleteGoal(goal!)
        : goal ? planEditGoal(model, goal, input, changePlan ? plan : undefined)
        : planAddGoal(model, input, plan);
      setBusy(kind);
      await applyPlan(p);
      toast({ message: p.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const endOfTimeline = model.paydays.at(-1)!;

  return (
    <Sheet
      title={goal ? goal.name : 'Add goal'}
      subtitle={goal ? `${formatPHP(saved)} saved so far` : 'Adds this goal to your plan and savings schedule'}
      onClose={onClose}
      busy={!!busy}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run('save');
        }}
      >
        <Field id="goal-name" label="Goal name">
          <input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car Fund" autoComplete="off" className={fieldClass} />
        </Field>

        <div>
          <Field id="goal-target" label="Target">
            <AmountInput id="goal-target" value={target} onChange={setTarget} disabled={openEnded} placeholder={openEnded ? 'Open-ended' : undefined} />
          </Field>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--primary))]" />
            Open-ended (no target, like Wealth)
          </label>
        </div>

        <fieldset className="rounded-2xl border border-line/70 p-3">
          <legend className="px-1 text-sm font-medium">Savings plan</legend>
          <p className="mb-3 px-1 text-xs text-muted">How much to set aside each payday.</p>
          {goal && (
            <label className="mb-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={changePlan} onChange={(e) => setChangePlan(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--primary))]" />
              Change the plan from a payday on
            </label>
          )}
          {changePlan ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field id="goal-per" label="Per payday">
                  <AmountInput id="goal-per" value={perPayday} onChange={setPerPayday} />
                </Field>
                <Field id="goal-from" label="Starting">
                  <PaydaySelect id="goal-from" model={model} value={from} onChange={setFrom} />
                </Field>
              </div>
              {preview && (
                <div aria-live="polite" className="space-y-2 text-sm">
                  <p className="rounded-xl bg-elev px-3 py-2">
                    {plan.perPayday === 0
                      ? 'No allocations from this payday on.'
                      : preview.reaches
                        ? `Reaches ${formatPHP(targetValue!)} on ${formatShort(model.paydays[preview.lastIdx].date)}, ${model.paydays[preview.lastIdx].date.getFullYear()}.`
                        : targetValue === null
                          ? `${formatPHP(plan.perPayday)} every payday through ${formatMonthYear(endOfTimeline.date)}.`
                          : `Plans ${formatPHP(preview.total)} by ${formatMonthYear(endOfTimeline.date)}, short of the target. Extend the timeline or raise the amount.`}
                  </p>
                  {preview.short.length > 0 && (
                    <p className="flex gap-2 rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-fg">
                      <Warning size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                      <span>
                        Goal plans exceed the surplus on {preview.short.length} payday{preview.short.length === 1 ? '' : 's'}, starting{' '}
                        {formatShort(preview.short[0].payday.date)} (over by {formatPHP(preview.short[0].over)}). You can still save.
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Planned allocations stay as they are.</p>
          )}
        </fieldset>

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions
          destructive={
            goal ? (
              <div className="space-y-2">
                {confirmDelete && (
                  <p className="text-sm text-muted">
                    Removes the goal from your plan and savings schedule{saved > 0 ? `, including ${formatPHP(saved)} of recorded contributions` : ''}.
                  </p>
                )}
                <Button
                  variant={confirmDelete ? 'primary' : 'danger'}
                  busy={busy === 'delete'}
                  disabled={!!busy}
                  onClick={() => run('delete')}
                  className={`w-full ${confirmDelete ? '!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]' : 'border border-danger/50'}`}
                >
                  {confirmDelete ? `Yes, delete ${goal.name}` : 'Delete goal'}
                </Button>
              </div>
            ) : undefined
          }
        >
          <Button type="submit" busy={busy === 'save'} disabled={!!busy}>{goal ? 'Save changes' : 'Add goal'}</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
