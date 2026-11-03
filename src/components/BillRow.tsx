import { CheckCircle, Circle, CreditCard, PiggyBank } from '@phosphor-icons/react';
import type { CellState } from '../lib/model';
import { formatPHP } from '../lib/money';
import { vtName } from '../lib/motion';

const scheduleLabel = { '15th': '15th', '30th': '30th', split: 'Split', fund: 'Fund' } as const;

export function BillRow({ cell, onOpen }: { cell: CellState; onOpen: (c: CellState) => void }) {
  const paid = cell.status === 'paid';
  const differs = paid && Math.abs(cell.amount - cell.planned) > 0.004;
  const isGoal = cell.item.kind === 'goal';
  const verb = isGoal ? 'Saved' : 'Paid';
  return (
    // Named so the row travels between the To pay and Paid lists when its state changes.
    <li style={{ viewTransitionName: vtName('row', cell.item.id) }}>
      <button
        onClick={() => onOpen(cell)}
        className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-elev active:bg-elev"
        aria-label={`${cell.item.name}, ${paid ? `${verb.toLowerCase()} ${formatPHP(cell.amount)}` : `${formatPHP(cell.amount)} ${cell.status === 'due' ? 'due' : 'upcoming'}`}. Tap to ${paid ? 'edit' : isGoal ? 'record contribution' : 'mark paid'}.`}
      >
        <span className={`shrink-0 ${paid ? 'text-accent' : 'text-muted/70'}`} aria-hidden>
          {paid ? <CheckCircle size={28} weight="fill" /> : <Circle size={28} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium leading-snug ${paid ? 'text-muted' : ''}`}>{cell.item.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-snug text-muted">
            {isGoal ? <PiggyBank size={14} weight="fill" className="shrink-0" aria-hidden /> : <CreditCard size={14} weight="fill" className="shrink-0" aria-hidden />}
            <span className="truncate">{isGoal ? cell.item.notes || 'Goal contribution' : cell.item.card}</span>
            {!isGoal && <span className="shrink-0 rounded bg-elev px-1.5 py-px text-[11px] font-medium">{scheduleLabel[cell.item.schedule]}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`num block font-semibold leading-snug ${paid ? 'text-muted' : ''}`}>{formatPHP(cell.amount)}</span>
          {/* The section already says what's due; only a paid amount that differs from the plan needs a word here. */}
          <span className="mt-0.5 block text-xs leading-snug text-muted">
            {paid ? (differs ? `plan ${formatPHP(cell.planned)}` : verb) : cell.status === 'due' ? 'Due' : 'Upcoming'}
          </span>
        </span>
      </button>
    </li>
  );
}
