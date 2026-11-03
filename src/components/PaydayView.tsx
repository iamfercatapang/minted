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
import { Amount, Button, Card, Collapse, ProgressBar, SectionTitle, StatTile } from './ui';
import { withLayoutTransition } from '../lib/motion';

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
    const undo = await withLayoutTransition(() => markPaid(cell, amount));
    toast({
      message: `${cell.item.name} ${cell.item.kind === 'goal' ? 'saved' : 'paid'} · ${formatPHP(amount)}`,
      tone: 'info',
      action: {
        label: 'Undo',
        run: () => withLayoutTransition(undo).catch((e) => toast({ message: (e as Error).message, tone: 'error' })),
      },
    });
  }

  async function payAll() {
    setBulkBusy(true);
    let count = 0;
    try {
      for (const c of open_) {
        await withLayoutTransition(() => markPaid(c, c.amount));
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
      <div style={{ viewTransitionName: 'pv-stats' }}>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Payday income" value={s.income} hint={extra ? `incl. ${formatPHP(extra.amount)} extra` : undefined} onClick={() => setEditingIncome(true)} action="Change income" />
        <StatTile label="Left after bills" value={s.surplus} tone={s.surplus >= 0 ? 'good' : 'warn'} />
        <StatTile label="Paid" value={s.paidTotal} hint={`${s.paidCount} of ${s.cells.length} items`} />
        <StatTile
          label={reached ? 'Still to pay' : 'Planned'}
          value={s.remaining}
          hint={`${s.dueCount} item${s.dueCount === 1 ? '' : 's'}`}
        />
      </div>

      <Card className="mt-3">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium">Bills paid</span>
          <span className="num text-muted">
            <Amount value={s.paidTotal} format={formatCompact} className="text-fg" /> / {formatCompact(s.plannedTotal)} · {Math.round(progress * 100)}%
          </span>
        </div>
        <ProgressBar value={progress} label="Share of this payday's bills paid" tone="accent" />
      </Card>
      </div>

      <Button variant="secondary" className="mt-3 w-full" onClick={() => setAdding(true)}>
        <Plus size={18} weight="bold" aria-hidden /> Add bill or payment
      </Button>

      <div style={{ viewTransitionName: 'pv-topay' }}>
      <SectionTitle
        count={open_.length}
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
        {reached ? 'To pay' : 'Planned'}
      </SectionTitle>

      <Collapse open={confirmAll}>
        <Card className="mb-2 bg-primary/10">
          <p className="text-sm">
            Mark all {open_.length} remaining items as paid at their planned amounts ({formatPHP(s.remaining)})?
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={payAll} busy={bulkBusy} className="flex-1">Mark {open_.length} paid</Button>
            <Button variant="secondary" onClick={() => setConfirmAll(false)} disabled={bulkBusy}>Cancel</Button>
          </div>
        </Card>
      </Collapse>

      {open_.length ? (
        <ul className="rounded-2xl bg-card p-1">
          {open_.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
        </ul>
      ) : (
        <Card><p className="text-sm text-muted">Everything for this payday is paid.</p></Card>
      )}
      </div>

      <div style={{ viewTransitionName: 'pv-unplanned' }}>
        <UnplannedSpending model={model} payday={payday} today={today} />
      </div>

      {payments.length > 0 && (
        <div style={{ viewTransitionName: 'pv-cardpay' }}>
          <SectionTitle count={payments.length}>Card payments</SectionTitle>
          <CardPayments model={model} payments={payments} today={today} />
        </div>
      )}

      {goals.length > 0 && (
        <div style={{ viewTransitionName: 'pv-goals' }}>
          <SectionTitle count={goals.length}>Goal contributions</SectionTitle>
          <ul className="rounded-2xl bg-card p-1">
            {goals.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
          </ul>
        </div>
      )}

      {done.length > 0 && (
        <div style={{ viewTransitionName: 'pv-paid' }}>
          <SectionTitle count={done.length}>Paid</SectionTitle>
          <ul className="rounded-2xl bg-card p-1">
            {done.map((c) => <BillRow key={c.item.id} cell={c} onOpen={setOpen} />)}
          </ul>
        </div>
      )}

      {open && (
        <MarkPaidSheet
          cell={open}
          onClose={() => setOpen(null)}
          onPaid={(amount) => pay(open, amount)}
          onUnpaid={() => withLayoutTransition(() => markUnpaid(open))}
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
