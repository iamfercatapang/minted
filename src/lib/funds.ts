import { editableNotes, planAdd, planEditDetails, targetLabel, type EditPlan, type Guard, type SheetOp } from './edits';
import { formatPHP, parseTarget, round2 } from './money';
import { cellState, type LineItem, type Model, type Payday, type Withdrawal } from './model';

const TARGET = /Target\s*~?\s*₱?\s*[\d.,]+\s*[kKmM]?/i;
const tidy = (s: string) => s.replace(/^[\s·]+|[\s·]+$/g, '').replace(/(\s*·\s*)+/g, ' · ');

/** A fund's target lives in its Notes as "Target 50k", like the goals do. */
export const fundTarget = (fund: LineItem) => {
  const m = TARGET.exec(fund.notes);
  return m ? parseTarget(m[0]) : null;
};
/** Notes without the target and the app-managed "until …" part. */
export const fundNotes = (fund: LineItem) => tidy(editableNotes(fund).replace(TARGET, ''));
const withTarget = (notes: string, target: number | null) => tidy([targetLabel(target), notes.trim()].filter(Boolean).join(' · '));

export const fundWithdrawals = (model: Model, fund: LineItem) =>
  model.withdrawals.filter((w) => w.fund.toLowerCase() === fund.name.toLowerCase());

export interface FundStatus {
  fund: LineItem;
  contributed: number;
  withdrawn: number;
  balance: number;
  target: number | null;
  pct: number | null;
  /** When the balance reaches the target if the remaining planned contributions are paid. */
  projectedDone: Payday | null;
  next: { payday: Payday; amount: number } | null;
}

export function fundStatus(model: Model, fund: LineItem, current: Payday | undefined): FundStatus {
  const upto = current?.index ?? -1;
  const contributed = round2(
    model.paydays.reduce((s, p) => {
      const c = cellState(model, fund, p, current);
      return c.status === 'paid' ? s + c.amount : s;
    }, 0),
  );
  const withdrawn = round2(fundWithdrawals(model, fund).reduce((s, w) => s + w.amount, 0));
  const balance = round2(contributed - withdrawn);
  const target = fundTarget(fund);
  let projectedDone: Payday | null = null;
  if (target) {
    let cum = balance;
    if (cum >= target - 1) projectedDone = current ?? null;
    for (const p of model.paydays) {
      if (projectedDone) break;
      const c = cellState(model, fund, p, current);
      if (c.status === 'paid' || c.status === 'not-due') continue;
      cum += c.amount;
      if (cum >= target - 1) projectedDone = p;
    }
  }
  const nextP = model.paydays.find((p) => p.index > upto && model.amount(fund.row, p) > 0);
  return {
    fund,
    contributed,
    withdrawn,
    balance,
    target,
    pct: target ? Math.max(0, Math.min(1, balance / target)) : null,
    projectedDone,
    next: nextP ? { payday: nextP, amount: model.amount(fund.row, nextP) } : null,
  };
}

export interface FundInput {
  name: string;
  monthly: number;
  /** Account the money goes to (the card / payment column). */
  card: string;
  notes: string;
  target: number | null;
}

export function planAddFund(model: Model, input: FundInput & { startIso: string; endIso: string | null }): EditPlan {
  if (input.target !== null && !(input.target > 0)) throw new Error('Enter a target above ₱0, or leave it empty.');
  if (model.items.some((i) => i.name.toLowerCase() === input.name.trim().toLowerCase()))
    throw new Error(`There's already a bill or fund called "${input.name.trim()}".`);
  const plan = planAdd(model, {
    type: 'recurring',
    schedule: 'fund',
    name: input.name,
    card: input.card,
    notes: withTarget(input.notes, input.target),
    monthly: input.monthly,
    startIso: input.startIso,
    endIso: input.endIso,
  });
  return { ...plan, summary: `Added fund ${plan.summary}` };
}

/** Edits a fund; a rename also renames its withdrawals so the balance keeps adding up. */
export function planEditFund(model: Model, fund: LineItem, input: FundInput & { fromIso: string }): EditPlan {
  if (input.target !== null && !(input.target > 0)) throw new Error('Enter a target above ₱0, or leave it empty.');
  const plan = planEditDetails(model, fund, {
    name: input.name,
    notes: withTarget(input.notes, input.target),
    card: input.card,
    schedule: 'fund',
    monthly: input.monthly,
    fromIso: input.fromIso,
  });
  const name = input.name.trim();
  if (name !== fund.name)
    for (const w of fundWithdrawals(model, fund)) plan.ops.push({ op: 'set', tab: 'withdrawals', row: w.row, col: 1, input: { kind: 'text', value: name } });
  return plan;
}

const HEADERS = ['Date', 'Fund', 'Amount', 'Note', 'By'];

/** Records money taken out of a fund as a new row in Fund Withdrawals, creating the tab the first time. */
export function planWithdraw(model: Model, fund: LineItem, w: { amount: number; iso: string; note: string; by: string }): EditPlan {
  if (!(w.amount > 0)) throw new Error('Enter an amount above ₱0.');
  const ops: SheetOp[] = [];
  const guards: Guard[] = [{ row: fund.row, col: model.layout.cols.description, expect: fund.name }];
  let row = model.layout.withdrawalsRows;
  if (row === null) {
    ops.push({ op: 'addTab', tab: 'withdrawals' });
    HEADERS.forEach((h, col) => ops.push({ op: 'set', tab: 'withdrawals', row: 0, col, input: { kind: 'text', value: h } }));
    row = 1;
  } else guards.push({ tab: 'withdrawals', row, col: 1, expect: '' });
  const cells = [w.iso, fund.name, null, w.note.trim(), w.by];
  cells.forEach((v, col) => {
    if (v === null) ops.push({ op: 'set', tab: 'withdrawals', row: row!, col, input: { kind: 'number', value: round2(w.amount) } });
    else if (v) ops.push({ op: 'set', tab: 'withdrawals', row: row!, col, input: { kind: 'text', value: v } });
  });
  return { ops, guards, summary: `Took ${formatPHP(w.amount)} out of ${fund.name}` };
}

export function planDeleteWithdrawal(w: Withdrawal): EditPlan {
  return {
    ops: [{ op: 'deleteRow', tab: 'withdrawals', row: w.row }],
    guards: [{ tab: 'withdrawals', row: w.row, col: 1, expect: w.fund }],
    summary: `Removed the ${formatPHP(w.amount)} withdrawal from ${w.fund}`,
  };
}

