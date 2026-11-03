import { useState } from 'react';
import { billsOnCard, expectedPayment, planAddCard, planDeleteCard, planEditCard, type CardInput } from '../lib/edits';
import { cycleFor, ordinal } from '../lib/cards';
import { formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';
import type { CardInfo, Model } from '../lib/model';
import { DeleteCardSheet } from './DeleteCardSheet';
import { PayCardSheet } from './PayCardSheet';
import { CreditCard } from '@phosphor-icons/react';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { Field, Sheet, SheetActions, fieldClass, parseAmount, amountWrapClass } from './Sheet';

/** Add a card (card = undefined) or edit / rename / delete one. */
export function CardSheet({ model, card, today, onClose }: { model: Model; card?: CardInfo; today: Date; onClose: () => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const [name, setName] = useState(card?.name ?? '');
  const [noLimit, setNoLimit] = useState(card ? card.limit === null : false);
  const [limit, setLimit] = useState(card?.limit ? String(card.limit) : '');
  const dueNote = card?.dueNote ?? '';
  const [statementDay, setStatementDay] = useState<number | null>(card?.statementDay ?? null);
  const [dueDay, setDueDay] = useState<number | null>(card?.dueDay ?? null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bills = card ? billsOnCard(model, card) : [];
  const [notes, setNotes] = useState(card?.notes ?? '');
  const input: CardInput = { name, limit: noLimit ? null : parseAmount(limit), statementDay, dueDay, dueNote, notes };
  const daySelect = (id: string, v: number | null, set: (d: number | null) => void) => (
    <select id={id} value={v ?? ''} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)} className={fieldClass}>
      <option value="">Not set</option>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
    </select>
  );
  const renaming = !!card && name.trim() !== card.name && name.trim() !== '';
  const cycle = statementDay && dueDay ? cycleFor({ ...(card ?? { name, limit: null, charged: 0, dueNote, utilization: null, row: -1, notes: '' }), statementDay, dueDay }, today) : null;
  const [wizard, setWizard] = useState(false);
  const [paying, setPaying] = useState(false);
  const canPay = !!card && card.limit !== null && card.statementDay !== null && card.dueDay !== null;

  if (wizard && card) return <DeleteCardSheet model={model} card={card} today={today} onBack={() => setWizard(false)} onClose={onClose} />;
  if (paying && card) return <PayCardSheet model={model} card={card} today={today} onClose={onClose} />;

  async function run(kind: 'save' | 'delete') {
    setError(null);
    if (kind === 'delete' && !confirmDelete) return setConfirmDelete(true);
    try {
      const plan = kind === 'delete' ? planDeleteCard(model, card!) : card ? planEditCard(model, card, input) : planAddCard(model, input);
      setBusy(kind);
      await applyPlan(plan);
      toast({ message: plan.summary, tone: 'info' });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={card ? card.name : 'Add card'}
      subtitle={card ? `${formatPHP(card.charged)} charged a month` : 'Adds it to your cards'}
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
        {canPay && (
          <Button variant="secondary" onClick={() => setPaying(true)} className="w-full">
            <CreditCard size={18} aria-hidden /> Pay card now
          </Button>
        )}
        <Field
          id="card-name"
          label="Card name"
          hint={renaming && bills.length ? `Also moves ${bills.length} bill${bills.length === 1 ? '' : 's'} to the new name.` : undefined}
        >
          <input id="card-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metrobank Ana" autoComplete="off" aria-describedby="card-name-hint" className={fieldClass} />
        </Field>

        <div>
          <Field id="card-limit" label="Credit limit">
            <div className={`${amountWrapClass} ${noLimit ? 'opacity-50' : ''}`}>
              <span className="text-muted" aria-hidden>₱</span>
              <input
                id="card-limit"
                inputMode="decimal"
                value={noLimit ? '' : limit}
                disabled={noLimit}
                onChange={(e) => setLimit(e.target.value)}
                placeholder={noLimit ? 'No limit' : '0.00'}
                autoComplete="off"
                className="num min-h-12 w-full bg-transparent px-2 font-semibold outline-none disabled:cursor-not-allowed"
              />
            </div>
          </Field>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--primary))]" />
            No credit limit (bank account, cash)
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field id="card-statement" label="Statement day">{daySelect('card-statement', statementDay, setStatementDay)}</Field>
          <Field id="card-dueday" label="Due day">{daySelect('card-dueday', dueDay, setDueDay)}</Field>
        </div>
        <p className="rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">
          Pay from: {expectedPayment(input) || 'set a due day to work this out'}
          {cycle && (
            <span className="mt-1 block text-muted">
              Charged today: on the {formatShort(cycle.statement)} statement, due {formatShort(cycle.due)} ({cycle.float} days to pay).
            </span>
          )}
        </p>

        <Field id="card-notes" label="Notes (optional)" hint="Shared with everyone using Minted.">
          <textarea
            id="card-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Autopay from BPI savings, annual fee waived"
            aria-describedby="card-notes-hint"
            className={`${fieldClass} py-3`}
          />
        </Field>

        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

        <SheetActions
          destructive={
            card ? (
              bills.length ? (
                <Button variant="danger" disabled={!!busy} onClick={() => setWizard(true)} className="w-full border border-danger/50">
                  Delete card… ({bills.length} bill{bills.length === 1 ? '' : 's'} to move)
                </Button>
              ) : (
                <Button
                  variant={confirmDelete ? 'primary' : 'danger'}
                  busy={busy === 'delete'}
                  disabled={!!busy}
                  onClick={() => run('delete')}
                  className={`w-full ${confirmDelete ? '!bg-[#B91C1C] !text-white hover:!bg-[#991B1B]' : 'border border-danger/50'}`}
                >
                  {confirmDelete ? `Yes, delete ${card.name}` : 'Delete card'}
                </Button>
              )
            ) : undefined
          }
        >
          <Button type="submit" busy={busy === 'save'} disabled={!!busy}>{card ? 'Save changes' : 'Add card'}</Button>
        </SheetActions>
      </form>
    </Sheet>
  );
}
