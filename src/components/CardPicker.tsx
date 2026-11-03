import { useMemo } from 'react';
import { Lightning, Warning } from '@phosphor-icons/react';
import { POOR_DAYS, cycleFor, rankCards } from '../lib/cards';
import { formatShort } from '../lib/dates';
import type { Model } from '../lib/model';
import { cardOptions } from './AddItemSheet';
import { Field, fieldClass } from './Sheet';

const OTHER = '__other__';

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * Card / payment method select with "Other…", plus a suggestion based on statement and due days: the card that gives
 * the longest interest-free period for a charge on `charges`, and a warning when the chosen one closes right after.
 */
export function CardPicker({ id, model, value, onChange, charges, amount, currentCard, exclude }: {
  id: string;
  model: Model;
  value: string;
  onChange: (card: string) => void;
  /** When the bill gets charged (its next paydays). */
  charges: Date[];
  amount: number;
  /** The card the bill is on now, so its amount isn't counted twice in utilization. */
  currentCard?: string;
  /** Names that can't be picked (e.g. the card being deleted). */
  exclude?: string[];
}) {
  const options = useMemo(() => cardOptions(model).filter((c) => !exclude?.includes(c)), [model, exclude]);
  const isOther = !options.includes(value);
  const ranked = useMemo(() => rankCards(model, charges, amount, currentCard).filter((o) => !exclude?.includes(o.card.name)), [model, charges, amount, currentCard, exclude]);
  const best = ranked.find((o) => !o.nearLimit);
  const chosen = ranked.find((o) => o.card.name === value);
  const chosenCycle = chosen ? cycleFor(chosen.card, charges[0]) : null;

  let hint: React.ReactNode = null;
  if (best && best.card.name !== value) {
    hint = (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <Lightning size={14} weight="fill" className="text-accent" aria-hidden />
          Best: {best.card.name}, {days(best.float)} to pay
          {chosen ? ` (vs ${chosen.float})` : ''}
        </span>
        <button type="button" onClick={() => onChange(best.card.name)} className="min-h-10 cursor-pointer rounded-full border border-line px-3 text-xs font-semibold text-fg hover:bg-elev">
          Use it
        </button>
      </span>
    );
  } else if (chosen && best === chosen) {
    hint = (
      <span className="inline-flex items-center gap-1">
        <Lightning size={14} weight="fill" className="text-accent" aria-hidden />
        Best choice: {days(chosen.float)} to pay
      </span>
    );
  }

  return (
    <div className="space-y-3">
      <Field id={id} label="Paid with" hint={hint ?? undefined}>
        <select
          id={id}
          value={isOther ? OTHER : value}
          onChange={(e) => onChange(e.target.value === OTHER ? '' : e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={fieldClass}
        >
          {options.map((c) => <option key={c} value={c}>{c}</option>)}
          <option value={OTHER}>Other…</option>
        </select>
      </Field>
      {chosen && chosen.daysToStatement <= POOR_DAYS && chosenCycle && (
        <p className="flex gap-2 rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
          <Warning size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>
            {value} closes its statement {chosen.daysToStatement === 0 ? 'the same day' : `${days(chosen.daysToStatement)} after`} the charge
            ({formatShort(chosenCycle.statement)}), so it's due by {formatShort(chosenCycle.due)}.
          </span>
        </p>
      )}
      {chosen?.nearLimit && (
        <p className="flex gap-2 rounded-xl border border-warn/50 bg-warn/10 px-3 py-2 text-sm">
          <Warning size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>{value} would be at {Math.round((chosen.util ?? 0) * 100)}% of its limit.</span>
        </p>
      )}
      {isOther && (
        <Field id={`${id}-other`} label="Card or payment method">
          <input id={`${id}-other`} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" className={fieldClass} />
        </Field>
      )}
    </div>
  );
}
