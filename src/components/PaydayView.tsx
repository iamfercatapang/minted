import { useMemo, useState } from 'react';
import { Checks, Plus } from '@phosphor-icons/react';
import { goalCells, summarize, type CellState, type LineItem, type Model, type Payday } from '../lib/model';
import { formatPHP, formatCompact } from '../lib/money';
import { useLedger } from '../store';
import { BillRow } from './BillRow';
import { MarkPaidSheet } from './MarkPaidSheet';
import { AddItemSheet } from './AddItemSheet';
import { ManageItemSheet } from './ManageItemSheet';
import { CardPayments } from './CardPayments';
import { cardPayments } from '../lib/cards';
import { incomeExtra } from '../lib/income';
import { IncomeSheet } from './IncomeSheet';
import { UnplannedSpending } from './UnplannedSpending';
import { useToast } from './toast';
import { Button, Card, ProgressBar, SectionTitle, StatTile } from './ui';

export function PaydayView({ model, payday, current, today }: { model: Model; payday: Payday; current: Payday | undefined; today: Date }) {
  const { markPaid, markUnpaid } = useLedger();
  const toast = useToast();
  const [open, setOpen] = useState<CellState | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingIncome, setEditingIncome] = useState(false);
  const [managing, setManaging] = useState<LineItem | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const s = useMemo(() => summarize(model, payday, current), [model, payday, current]);
  const goals = useMemo(() => goalCells(model, payday, current), [model, payday, current]);
  const payments = useMemo(() => cardPayments(model, payday), [model, payday]);
  const extra = incomeExtra(model, payday);
  // summarize() leaves out the app-managed rows (Unplanned spending, Extra card payments); they have their own sections.
  const open_ = s.cells.filter((c) => c.status !== 'paid');
  const done = s.cells.filter((c) => c.status === 'paid');
  const reached = !!current && payday.index <= current.index;
  const progress = s.plannedTotal ? s.paidTotal / s.plannedTotal : 0;

  async function pay(cell: CellState, amount: number) {
    const undo = await markPaid(cell, amount);
    toast({
      message: `${cell.item.name} ${cell.item.kind === 'goal' ? 'saved' : 'paid'} · ${formatPHP(amount)}`,
      tone: 'info',
      action: {
        label: 'Undo',
        run: () => undo().catch((e) => toast({ message: (e as Error).message, tone: 'error' })),
      },
    });
  }

  async function payAll() {
    setBulkBusy(true);
    let count = 0;
    try {
      for (const c of open_) {
        await markPaid(c, c.amount);
        count++;
      }
      toast({ message: `Marked ${count} bills paid`, tone: 'info' });
    } catch (e) {
      toast({ message: `Stopped after ${count}: ${(e as Error).message}`, tone: 'error' });
    } finally {
      setBulkBusy(false);
      setConfirmAll(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Payday income" value={formatPHP(s.income)} hint={extra ? `incl. ${formatPHP(extra.amount)} extra` : undefined} onClick={() => setEditingIncome(true)} action="Change income" />
        <StatTile label="Remaining funds after bills" value={formatPHP(s.surplus)} tone={s.surplus >= 0 ? 'good' : 'warn'} />
        <StatTile label="Paid" value={formatPHP(s.paidTotal)} hint={`${s.paidCount} of ${s.cells.length} items`} tone="good" />
        <StatTile
          label={reached ? 'Still to pay' : 'Planned'}
          value={formatPHP(s.remaining)}
          hint={`${s.dueCount} item${s.dueCount === 1 ? '' : 's'}`}
          tone={reached && s.remaining > 0 ? 'warn' : 'default'}
        />
      </div>

      <Card className="mt-3">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium">Bills paid</span>
          <span className="num text-muted">
            {formatCompact(s.paidTotal)} / {formatCompact(s.plannedTotal)} · {Math.round(progress * 100)}%
          </span>
        </div>
        <ProgressBar value={progress} label="Share of this payday's bills paid" tone="accent" />
      </Card>

      <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>
        <Plus size={18} weight="bold" aria-hidden /> Add bill or payment
      </Button>

      <SectionTitle
        aside={
          reached && open_.length > 1 && !confirmAll ? (
            <button
              onClick={() => setConfirmAll(true)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/10"
            >
              <Checks size={18} aria-hidden /> Mark all paid
            </button>
          ) : undefined
        }
      >
        {reached ? 'To pay' : 'Planned'} ({open_.length})
      </SectionTitle>

      {confirmAll && (
        <Card className="mb-2 border-primary/50">
          <p className="text-sm">
            Mark all {open_.length} remaining items as paid at their planned amounts ({formatPHP(s.remaining)})?
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={payAll} busy={bulkBusy} className="flex-1">Mark {open_.length} paid</Button>
            <Button variant="secondary" onClick={() => setConfirmAll(false)} disabled={bulkBusy}>Cancel</Button>
          </div>
        </Card>
      )}

      {open_.length ? (
        <ul className="rounded-2xl border border-line/70 bg-card p-1">
          {open_.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
        </ul>
      ) : (
        <Card><p className="text-sm text-muted">Everything for this payday is paid.</p></Card>
      )}

      <UnplannedSpending model={model} payday={payday} today={today} />

      {payments.length > 0 && (
        <>
          <SectionTitle>Card payments ({payments.length})</SectionTitle>
          <CardPayments model={model} payments={payments} today={today} />
        </>
      )}

      {goals.length > 0 && (
        <>
          <SectionTitle>Goal contributions ({goals.length})</SectionTitle>
          <ul className="rounded-2xl border border-line/70 bg-card p-1">
            {goals.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
          </ul>
        </>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle>Paid ({done.length})</SectionTitle>
          <ul className="rounded-2xl border border-line/70 bg-card p-1">
            {done.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
          </ul>
        </>
      )}

      {open && (
        <MarkPaidSheet
          cell={open}
          onClose={() => setOpen(null)}
          onPaid={(amount) => pay(open, amount)}
          onUnpaid={() => markUnpaid(open)}
          onManage={open.item.kind === 'goal' ? undefined : () => {
            setManaging(model.items.find((i) => i.row === open.item.row) ?? null);
            setOpen(null);
          }}
        />
      )}
      {editingIncome && <IncomeSheet model={model} payday={payday} onClose={() => setEditingIncome(false)} />}
      {adding && <AddItemSheet model={model} payday={payday} onClose={() => setAdding(false)} />}
      {managing && <ManageItemSheet model={model} item={managing} today={today} onClose={() => setManaging(null)} />}
    </div>
  );
}
