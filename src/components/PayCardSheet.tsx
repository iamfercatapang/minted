import { useMemo, useState } from 'react';
import { nextStatement } from '../lib/cards';
import { planCardPay } from '../lib/cardpay';
import { paydayFor } from '../lib/spending';
import { formatShort, isoDate } from '../lib/dates';
import { formatPHP, round2 } from '../lib/money';
import type { CardInfo, CardPaySource, Model } from '../lib/model';
import type { EditPlan } from '../lib/edits';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { PaymentList } from './CardPayments';
import { Field, Segmented, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

type Source = Exclude<CardPaySource, 'statement'>;

/** Pay part (or all) of a card before its due date: from money already budgeted, extra funds, or a goal. */
export function PayCardSheet({ model, card, today, onClose }: { model: Model; card: CardInfo; today: Date; onClose: () => void }) {
  const { applyPlan, settings, auth, backend } = useLedger();
  const toast = useToast();
  const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');
  const goals = model.goals.filter((g) => g.row !== null);
  const todayIso = isoDate(today);

  const [amount, setAmount] = useState('');
  const [iso, setIso] = useState(todayIso < model.paydays[0].iso ? model.paydays[0].iso : todayIso);
  const [source, setSource] = useState<Source>('budgeted');
  const [goalId, setGoalId] = useState(goals.find((g) => g.id === 'debt')?.id ?? goals[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = parseAmount(amount);
  const statement = useMemo(() => (iso >= model.paydays[0].iso ? nextStatement(model, card, iso) : null), [model, card, iso]);
  const payday = iso >= model.paydays[0].iso ? paydayFor(model, iso) : null;
  const leftAfter = statement ? Math.max(0, round2(statement.left - (value || 0))) : 0;
  const recent = model.cardPays.filter((p) => p.card === card.name && p.source !== 'statement').slice(-5).reverse();

  async function run(plan: () => EditPlan, close = true) {
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
      if (close) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sourceHint: Record<Source, string> = {
    budgeted: "For charges already in your plan. Your budget doesn't change; it just lowers what's left on the statement.",
    extra: payday ? `Comes out of the ${formatShort(payday.date)} payday's remaining funds.` : '',
    goal: 'Counts as a contribution to the goal, like paying down debt.',
  };

  return (
    <Sheet title={`Pay ${card.name} now`} subtitle="Pay part or all of the card before it's due" onClose={onClose} busy={busy}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => planCardPay(model, { card, iso, amount: value, source, goalId: source === 'goal' ? goalId : undefined, by: who }));
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field id="pc-amount" label="Amount">
            <div className={amountWrapClass}>
              <span className="text-muted" aria-hidden>₱</span>
              <input id="pc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" autoFocus className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none" />
            </div>
          </Field>
          <Field id="pc-date" label="Date">
            <input id="pc-date" type="date" value={iso} onChange={(e) => setIso(e.target.value)} className={fieldClass} />
          </Field>
        </div>

        <div>
          <Segmented
            name="pc-source"
            legend="Where is the money from?"
            value={source}
            onChange={setSource}
            options={[
              { value: 'budgeted', label: 'Budgeted' },
              { value: 'extra', label: 'Extra funds' },
              { value: 'goal', label: 'A goal', },
            ]}
          />
          <p className="mt-1 text-xs text-muted">{sourceHint[source]}</p>
        </div>

        {source === 'goal' && (
          <Field id="pc-goal" label="Goal">
            <select id="pc-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)} className={fieldClass}>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}

        {statement ? (
          <p className="num rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">
            Goes toward the {formatShort(statement.statement)} statement (due {formatShort(statement.due)}): {formatPHP(statement.left)} left
            {value ? ` → ${formatPHP(leftAfter)} after this payment` : ''}.
            {value > statement.left && statement.left > 0 ? ` ${formatPHP(round2(value - statement.left))} more than the statement.` : ''}
          </p>
        ) : (
          <p className="rounded-xl bg-elev px-3 py-2 text-sm text-muted">Set this card's statement and due days to link payments to a statement.</p>
        )}

        {recent.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Recent early payments</h3>
            <PaymentList model={model} payments={recent} busy={busy} onRun={(p) => run(() => p, false)} />
          </div>
        )}

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions>
          <Button type="submit" busy={busy} disabled={!statement}>Record payment</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
