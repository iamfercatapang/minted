import { CheckCircle, Circle, CreditCard, PiggyBank } from '@phosphor-icons/react';
import type { CellState } from '../lib/model';
import { formatPHP } from '../lib/money';

const scheduleLabel = { '15th': '15th', '30th': '30th', split: 'Split', fund: 'Fund' } as const;

export function BillRow({ cell, onOpen }: { cell: CellState; onOpen: (c: CellState) => void }) {
  const paid = cell.status === 'paid';
  const differs = paid && Math.abs(cell.amount - cell.planned) > 0.004;
  const isGoal = cell.item.kind === 'goal';
  const verb = isGoal ? 'Saved' : 'Paid';
  return (
    <li>
      <button
        onClick={() => onOpen(cell)}
        className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-elev active:bg-elev"
        aria-label={`${cell.item.name}, ${paid ? `${verb.toLowerCase()} ${formatPHP(cell.amount)}` : `${formatPHP(cell.amount)} ${cell.status === 'due' ? 'due' : 'upcoming'}`}. Tap to ${paid ? 'edit' : isGoal ? 'record contribution' : 'mark paid'}.`}
      >
        <span className={paid ? 'text-accent' : 'text-muted'} aria-hidden>
          {paid ? <CheckCircle size={28} weight="fill" /> : <Circle size={28} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${paid ? 'text-muted' : ''}`}>{cell.item.name}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-muted">
            {isGoal ? <PiggyBank size={14} aria-hidden /> : <CreditCard size={14} aria-hidden />}
            <span className="truncate">{isGoal ? cell.item.notes || 'Goal contribution' : cell.item.card}</span>
            {!isGoal && <span className="rounded bg-elev px-1.5 py-px text-[11px] font-medium">{scheduleLabel[cell.item.schedule]}</span>}
          </span>
        </span>
        <span className="text-right">
          <span className={`num block font-semibold ${paid ? 'text-accent' : ''}`}>{formatPHP(cell.amount)}</span>
          {paid ? (
            <span className="block text-xs text-muted">{differs ? `${verb} · plan ${formatPHP(cell.planned)}` : verb}</span>
          ) : (
            <span className={`block text-xs ${cell.status === 'due' ? 'text-warn' : 'text-muted'}`}>
              {cell.status === 'due' ? 'Due' : 'Upcoming'}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
