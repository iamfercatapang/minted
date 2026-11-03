import { formatShort } from './dates';
import type { EditPlan, Guard, SheetOp } from './edits';
import { planWithdraw } from './funds';
import { formatPHP, round2 } from './money';
import type { LineItem, Model, Payday, Spend } from './model';

export const SPEND_CATEGORIES = ['Eating out', 'Groceries', 'Transport', 'Leisure & trips', 'Shopping', 'Health', 'Gifts', 'Other'] as const;

const ROW_NAME = 'Unplanned spending';
const HEADERS = ['Date', 'Amount', 'Category', 'What', 'Paid with', 'From fund', 'By'];
const rowNotes = (limit: number | null) =>
  ['Quick spends logged in Minted', limit ? `Limit ${formatPHP(limit)}` : ''].filter(Boolean).join(' · ');

/** The payday whose money a date's spending comes out of: the latest payday on or before it. */
export function paydayFor(model: Model, iso: string): Payday {
  let found = model.paydays[0];
  for (const p of model.paydays) if (p.iso <= iso) found = p;
  return found;
}

/** Quick spends counted against a payday (those taken from a sinking fund are covered by the fund). */
export const spendsFor = (model: Model, payday: Payday, list: Spend[] = model.spends) =>
  list.filter((s) => !s.fund && paydayFor(model, s.iso).index === payday.index);

export interface SpendInput {
  iso: string;
  amount: number;
  category: string;
  what: string;
  card: string;
  /** A sinking fund's name to take it from, or '' to take it from the payday. */
  fund: string;
  by: string;
}

export interface SpendSummary {
  payday: Payday;
  spends: Spend[];
  /** Everything logged in this payday's span, including fund-covered entries. */
  all: Spend[];
  total: number;
  limit: number | null;
  left: number | null;
}

export function spendSummary(model: Model, payday: Payday): SpendSummary {
  const all = model.spends.filter((s) => paydayFor(model, s.iso).index === payday.index);
  const spends = all.filter((s) => !s.fund);
  const total = round2(spends.reduce((t, s) => t + s.amount, 0));
  return { payday, spends, all, total, limit: model.spendLimit, left: model.spendLimit === null ? null : round2(model.spendLimit - total) };
}

/**
 * Ops that make sure the Unplanned spending row exists, returning its row. It's created at the end of the
 * Equal Split section with every payday at ₱0, outside the card totals ("Various").
 */
function ensureRow(model: Model, ops: SheetOp[], guards: Guard[], limit = model.spendLimit): number {
  const { cols, sectionLast, sectionLabel } = model.layout;
  if (model.spendItem) {
    guards.push({ row: model.spendItem.row, col: cols.description, expect: model.spendItem.name });
    return model.spendItem.row;
  }
  const last = sectionLast.split ?? sectionLast['30th'] ?? sectionLast['15th'];
  if (last === undefined) throw new Error("Couldn't find where to add unplanned spending in your plan.");
  const label = sectionLabel.split ?? sectionLabel['30th'] ?? sectionLabel['15th']!;
  const row = last + 1;
  const text = (value: string) => ({ kind: 'text' as const, value });
  const zero = { kind: 'number' as const, value: 0 };
  ops.push(
    { op: 'insertRow', at: row },
    { op: 'set', row, col: cols.category, input: text(label) },
    { op: 'set', row, col: cols.description, input: text(ROW_NAME) },
    { op: 'set', row, col: cols.notes, input: text(rowNotes(limit)) },
    { op: 'set', row, col: cols.card, input: text('Various') },
    { op: 'set', row, col: cols.monthly, input: { kind: 'blank' } },
    { op: 'set', row, col: cols.t15, input: zero },
    { op: 'set', row, col: cols.t30, input: zero },
    ...model.paydays.map((p): SheetOp => ({ op: 'set', row, col: p.col, input: zero })),
  );
  guards.push({ row: last, col: cols.description, expect: model.items.find((i) => i.row === last)?.name ?? '' });
  return row;
}

/**
 * Sets the row's cells for the paydays whose totals change between `before` and `after`. A row created in the same
 * plan already starts at ₱0 everywhere, so only non-zero totals are written to it.
 */
function totalsOps(model: Model, row: number, before: Spend[], after: Spend[]): SheetOp[] {
  const sum = (list: Spend[], p: Payday) => round2(spendsFor(model, p, list).reduce((t, s) => t + s.amount, 0));
  return model.paydays.flatMap((p): SheetOp[] => {
    const b = sum(after, p);
    const changed = model.spendItem ? sum(before, p) !== b : b !== 0;
    return changed ? [{ op: 'set', row, col: p.col, input: { kind: 'number', value: b } }] : [];
  });
}

function validate(model: Model, s: SpendInput) {
  if (!(s.amount > 0)) throw new Error('Enter an amount above ₱0.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.iso)) throw new Error('Pick a date.');
  if (s.iso < model.paydays[0].iso) throw new Error(`Your plan starts ${formatShort(model.paydays[0].date)}; pick a later date.`);
}

const cells = (s: SpendInput) => [s.iso, null, s.category, s.what.trim(), s.card.trim(), s.fund, s.by];

function rowOps(row: number, s: SpendInput): SheetOp[] {
  return cells(s).map((v, col): SheetOp =>
    v === null
      ? { op: 'set', tab: 'spending', row, col, input: { kind: 'number', value: round2(s.amount) } }
      : { op: 'set', tab: 'spending', row, col, input: v ? { kind: 'text', value: v } : { kind: 'blank' } },
  );
}

const fundItem = (model: Model, name: string): LineItem => {
  const f = model.items.find((i) => i.kind === 'fund' && i.name === name);
  if (!f) throw new Error(`Couldn't find the fund "${name}".`);
  return f;
};

/** Logs a quick spend: a Spending Log row, plus the payday's total (or a withdrawal when it comes from a fund). */
export function planLogSpend(model: Model, s: SpendInput): EditPlan {
  validate(model, s);
  const ops: SheetOp[] = [];
  const guards: Guard[] = [];
  let at = model.layout.spendingRows;
  if (at === null) {
    ops.push({ op: 'addTab', tab: 'spending' });
    HEADERS.forEach((h, col) => ops.push({ op: 'set', tab: 'spending', row: 0, col, input: { kind: 'text', value: h } }));
    at = 1;
  } else guards.push({ tab: 'spending', row: at, col: 0, expect: '' });
  ops.push(...rowOps(at, s));

  const payday = paydayFor(model, s.iso);
  const label = s.what.trim() || s.category;
  if (s.fund) {
    const w = planWithdraw(model, fundItem(model, s.fund), { amount: s.amount, iso: s.iso, note: label, by: s.by });
    ops.push(...w.ops);
    guards.push(...w.guards);
    return { ops, guards, summary: `${label} · ${formatPHP(s.amount)} from ${s.fund}` };
  }
  const row = ensureRow(model, ops, guards);
  const entry: Spend = { row: at, ...s, what: s.what.trim(), card: s.card.trim() };
  ops.push(...totalsOps(model, row, model.spends, [...model.spends, entry]));
  return { ops, guards, summary: `${label} · ${formatPHP(s.amount)} on the ${formatShort(payday.date)} payday` };
}

/** Changes a logged spend. Moving it between paydays, or to / from a fund, updates both totals. */
export function planEditSpend(model: Model, old: Spend, s: SpendInput): EditPlan {
  validate(model, s);
  if (old.fund || s.fund) {
    if (old.fund !== s.fund || old.amount !== s.amount)
      throw new Error('To change the amount or fund of a fund-covered spend, delete it and log it again.');
  }
  const ops: SheetOp[] = rowOps(old.row, s);
  const guards: Guard[] = [{ tab: 'spending', row: old.row, col: 0, expect: old.iso }];
  if (!s.fund) {
    const row = ensureRow(model, ops, guards);
    const after = model.spends.map((x) => (x.row === old.row ? { ...x, ...s } : x));
    ops.push(...totalsOps(model, row, model.spends, after));
  }
  return { ops, guards, summary: `Updated ${s.what.trim() || s.category}` };
}

/** Removes a logged spend and takes it off its payday's total. A fund-covered one leaves its withdrawal in place. */
export function planDeleteSpend(model: Model, old: Spend): EditPlan {
  const ops: SheetOp[] = [];
  const guards: Guard[] = [{ tab: 'spending', row: old.row, col: 0, expect: old.iso }];
  if (!old.fund && model.spendItem) {
    guards.push({ row: model.spendItem.row, col: model.layout.cols.description, expect: model.spendItem.name });
    ops.push(...totalsOps(model, model.spendItem.row, model.spends, model.spends.filter((x) => x.row !== old.row)));
  }
  ops.push({ op: 'deleteRow', tab: 'spending', row: old.row });
  return {
    ops,
    guards,
    summary: `Removed ${old.what || old.category} (${formatPHP(old.amount)})${old.fund ? `. Its withdrawal from ${old.fund} stays; remove it there if needed.` : ''}`,
  };
}

/** Sets (or with null, clears) the per-payday limit for unplanned spending. */
export function planSpendLimit(model: Model, limit: number | null): EditPlan {
  if (limit !== null && !(limit > 0)) throw new Error('Enter a limit above ₱0, or clear it.');
  const ops: SheetOp[] = [];
  const guards: Guard[] = [];
  const row = ensureRow(model, ops, guards, limit);
  if (model.spendItem) ops.push({ op: 'set', row, col: model.layout.cols.notes, input: { kind: 'text', value: rowNotes(limit) } });
  return { ops, guards, summary: limit ? `Unplanned spending limit: ${formatPHP(limit)} per payday` : 'Unplanned spending limit removed' };
}
