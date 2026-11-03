import { useEffect, useId, useRef, useState } from 'react';
import type { CellState } from '../lib/model';
import { formatPHP } from '../lib/money';
import { formatLong } from '../lib/dates';
import { Button } from './ui';
import { Sheet, SheetActions, parseAmount, amountWrapClass } from './Sheet';

interface Props {
  cell: CellState;
  onClose: () => void;
  onPaid: (amount: number) => Promise<void>;
  onUnpaid: () => Promise<void>;
  /** Opens the change / end / delete sheet for this bill. */
  onManage?: () => void;
}

export function MarkPaidSheet({ cell, onClose, onPaid, onUnpaid, onManage }: Props) {
  const isGoal = cell.item.kind === 'goal';
  const paid = cell.status === 'paid';
  const [value, setValue] = useState(String(paid ? cell.amount : cell.planned));
  const [busy, setBusy] = useState<'paid' | 'unpaid' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const amount = parseAmount(value);
  const valid = value.trim() !== '' && Number.isFinite(amount) && amount >= 0;

  async function run(kind: 'paid' | 'unpaid') {
    if (kind === 'paid' && !valid) {
      setError('Enter the amount you actually paid, e.g. 1500 or 394.58.');
      inputRef.current?.focus();
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await (kind === 'paid' ? onPaid(Math.round(amount * 100) / 100) : onUnpaid());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={cell.item.name}
      subtitle={`${formatLong(cell.payday.date)} payday · ${isGoal ? 'Savings' : cell.item.card}`}
      onClose={onClose}
      busy={!!busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run('paid');
        }}
      >
        <label htmlFor="amount" className="mb-1 block text-sm font-medium">
          {isGoal ? 'Amount saved' : 'Amount paid'}
        </label>
        <div className={amountWrapClass}>
          <span className="text-muted" aria-hidden>₱</span>
          <input
            ref={inputRef}
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={`${errorId} amount-help`}
            className="num min-h-12 w-full bg-transparent px-2 text-lg font-semibold outline-none"
          />
        </div>
        <p id="amount-help" className="mt-1 text-xs text-muted">
          Planned {formatPHP(cell.planned)}. {isGoal ? 'Saves the amount to this goal.' : 'Records the amount and marks it paid.'}
        </p>
        {error && (
          <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>
        )}

        <SheetActions
          destructive={
            paid ? (
              <Button variant="danger" busy={busy === 'unpaid'} disabled={!!busy} className="w-full" onClick={() => run('unpaid')}>
                {isGoal ? 'Remove contribution' : 'Mark as not paid'}
              </Button>
            ) : undefined
          }
        >
          <Button type="submit" busy={busy === 'paid'} disabled={!!busy}>
            {paid ? 'Update amount' : isGoal ? 'Record contribution' : 'Mark as paid'}
          </Button>
          {onManage && (
            <Button variant="secondary" disabled={!!busy} onClick={onManage}>
              {cell.item.oneTime ? 'Edit or delete this payment' : 'Edit bill'}
            </Button>
          )}
        </SheetActions>
      </form>
    </Sheet>
  );
}
