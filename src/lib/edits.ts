import {
  cellState,
  currentPayday,
  isPaidNote,
  type CardInfo,
  type Goal,
  type LineItem,
  type Model,
  type Payday,
  type Schedule,
  toA1,
} from './model';
import { formatMonthYear, formatShort } from './dates';
import { ordinal, payPayday } from './cards';
import { guessCategory, typeNote } from './categories';
import { formatCompact, formatPHP, round2 } from './money';

export type Tab = 'rolling' | 'goals' | 'withdrawals' | 'spending' | 'cardPayments';

/**
 * What to put in a cell. `ref` becomes a formula pointing at another column of the same row (e.g. =$F21);
 * `formula` is written as-is, with `preview` standing in for its result in sample mode.
 */
export type CellInput =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'ref'; col: number }
  | { kind: 'formula'; value: string; preview: string }
  | { kind: 'blank' };

/** `tab` defaults to the Rolling Execution Plan. Ranges are [start, end). */
export type SheetOp =
  | { op: 'insertRow'; tab?: Tab; at: number }
  | { op: 'deleteRow'; tab?: Tab; row: number }
  /** Moves a row with its values, formulas and notes. `to` is counted before the row is removed (Sheets API style). */
  | { op: 'moveRow'; tab?: Tab; from: number; to: number }
  | { op: 'set'; tab?: Tab; row: number; col: number; input: CellInput }
  /** Replaces a cell's note ('' removes it); the value is left alone. */
  | { op: 'note'; tab?: Tab; row: number; col: number; note: string }
  | { op: 'appendCols'; tab?: Tab; count: number }
  /** Creates the tab (used for Fund Withdrawals the first time). */
  | { op: 'addTab'; tab: Tab }
  /** Tiles the source columns across the destination (formulas shift like copy-paste). */
  | { op: 'copyCols'; tab?: Tab; rows: [number, number]; src: [number, number]; dst: [number, number] };

/** A cell that must still hold `expect` before the plan runs (guards against rows having moved). */
export interface Guard {
  tab?: Tab;
  row: number;
  col: number;
  expect: string;
}

export interface EditPlan {
  ops: SheetOp[];
  guards: Guard[];
  summary: string;
}

export type RecurringSchedule = Exclude<Schedule, 'fund'>;

export type NewItem = { name: string; card: string; notes: string } & (
  | { type: 'recurring'; schedule: RecurringSchedule | 'fund'; monthly: number; startIso: string; endIso: string | null }
  | { type: 'oneTime'; paydayIso: string; amount: number }
);

const num = (value: number): CellInput => ({ kind: 'number', value: round2(value) });
const text = (value: string): CellInput => (value ? { kind: 'text', value } : { kind: 'blank' });
/** 1-based A1 row for a 0-based index. */
const a1 = (row: number) => row + 1;

/** Per-payday template amounts for a monthly amount on a schedule. */
export function templates(schedule: Schedule, monthly: number): { t15: number; t30: number } {
  if (schedule === 'split' || schedule === 'fund') return { t15: round2(monthly / 2), t30: round2(monthly / 2) };
  return schedule === '15th' ? { t15: monthly, t30: 0 } : { t15: 0, t30: monthly };
}

const UNTIL = /\s*·?\s*until [A-Za-z]{3,9}\.? \d{4}/i;
const ONE_TIME = /^\s*One-time [A-Za-z]{3,9}\.? \d{1,2}\s*·?\s*/i;
const untilLabel = (p: Payday) => `until ${formatMonthYear(p.date)}`;
const withUntil = (notes: string, last: Payday | null) => {
  const base = notes.replace(UNTIL, '').trim();
  return [base, last ? untilLabel(last) : ''].filter(Boolean).join(' · ');
};

function payday(model: Model, iso: string): Payday {
  const p = model.paydays.find((x) => x.iso === iso);
  if (!p) throw new Error(`Payday ${iso} is not in your plan.`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Bills

export function planAdd(model: Model, item: NewItem): EditPlan {
  const { cols, sectionLast, sectionLabel } = model.layout;
  const name = item.name.trim();
  if (!name) throw new Error('Give the item a name.');
  const amount = item.type === 'recurring' ? item.monthly : item.amount;
  if (!(amount > 0)) throw new Error('Enter an amount above ₱0.');

  const section: RecurringSchedule | 'fund' =
    item.type === 'recurring' ? item.schedule : payday(model, item.paydayIso).half === 15 ? '15th' : '30th';
  const last = sectionLast[section];
  if (last === undefined) throw new Error(`Couldn't find the "${section}" section in your plan.`);
  const row = last + 1;
  const ops: SheetOp[] = [{ op: 'insertRow', at: row }];
  const set = (col: number, input: CellInput) => ops.push({ op: 'set', row, col, input });

  set(cols.category, text(sectionLabel[section]!));
  set(cols.description, text(name));
  set(cols.card, text(item.card.trim()));

  let summary: string;
  if (item.type === 'recurring') {
    const start = payday(model, item.startIso);
    const end = item.endIso ? payday(model, item.endIso) : null;
    if (end && end.index < start.index) throw new Error('The end payday is before the start.');
    const { t15, t30 } = templates(item.schedule, item.monthly);
    set(cols.notes, text(withUntil(item.notes.trim(), end)));
    set(cols.monthly, num(item.monthly));
    set(cols.t15, num(t15));
    set(cols.t30, num(t30));
    let count = 0;
    for (const p of model.paydays) {
      const template = p.half === 15 ? t15 : t30;
      const active = p.index >= start.index && (!end || p.index <= end.index) && template > 0;
      if (active) count++;
      set(p.col, active ? { kind: 'ref', col: p.half === 15 ? cols.t15 : cols.t30 } : num(0));
    }
    summary = `${name}: ${count} paydays from ${formatShort(start.date)}${end ? ` to ${formatShort(end.date)}` : ''}`;
  } else {
    const target = payday(model, item.paydayIso);
    const label = `One-time ${formatShort(target.date)}`;
    set(cols.notes, text([label, item.notes.trim()].filter(Boolean).join(' · ')));
    set(cols.monthly, { kind: 'blank' });
    set(cols.t15, num(0));
    set(cols.t30, num(0));
    for (const p of model.paydays) set(p.col, num(p.index === target.index ? item.amount : 0));
    summary = `${name}: one payment on ${formatShort(target.date)}`;
  }
  return {
    ops,
    guards: [{ row: last, col: cols.description, expect: model.items.find((i) => i.row === last)?.name ?? '' }],
    summary,
  };
}

const guardFor = (model: Model, item: LineItem): Guard => ({ row: item.row, col: model.layout.cols.description, expect: item.name });

/**
 * New monthly amount from `fromIso` on. Earlier paydays are frozen at what they show now, so history doesn't move;
 * later active paydays point at the updated 15th/30th template cells.
 */
export function planChangeAmount(model: Model, item: LineItem, monthly: number, fromIso: string): EditPlan {
  if (!(monthly > 0)) throw new Error('Enter an amount above ₱0.');
  const { cols } = model.layout;
  const from = payday(model, fromIso);
  const { t15, t30 } = templates(item.schedule, monthly);
  const ops: SheetOp[] = [];
  const set = (col: number, input: CellInput) => ops.push({ op: 'set', row: item.row, col, input });
  set(cols.monthly, num(monthly));
  set(cols.t15, num(t15));
  set(cols.t30, num(t30));
  for (const p of model.paydays) {
    const amount = model.amount(item.row, p);
    if (isPaidNote(model.note(item.row, p)) || amount === 0) continue;
    if (p.index < from.index) set(p.col, num(amount));
    else {
      const template = p.half === 15 ? t15 : t30;
      set(p.col, template > 0 ? { kind: 'ref', col: p.half === 15 ? cols.t15 : cols.t30 } : num(0));
    }
  }
  return { ops, guards: [guardFor(model, item)], summary: `${item.name} is now ${formatPHP(monthly)} a month from ${formatShort(from.date)}` };
}

/** The last payday a bill is still charged (or marked paid), or null when it has none. */
export function lastActive(model: Model, item: LineItem): Payday | null {
  let found: Payday | null = null;
  for (const p of model.paydays) if (model.amount(item.row, p) !== 0 || isPaidNote(model.note(item.row, p))) found = p;
  return found;
}

/**
 * Sets when a bill ends: its last payday, or null for no end date. Unpaid paydays after the new end become ₱0;
 * moving the end later brings back the paydays between the old and new end (pointing at the 15th / 30th amounts),
 * and Notes get or lose "until Mon YYYY".
 */
export function planEnd(model: Model, item: LineItem, lastIso: string | null): EditPlan {
  const { cols } = model.layout;
  const last = lastIso ? payday(model, lastIso) : null;
  const was = lastActive(model, item);
  const ops: SheetOp[] = [{ op: 'set', row: item.row, col: cols.notes, input: text(withUntil(item.notes, last)) }];
  let cleared = 0;
  let restored = 0;
  for (const p of model.paydays) {
    if (isPaidNote(model.note(item.row, p))) continue;
    const amount = model.amount(item.row, p);
    if (last && p.index > last.index) {
      if (amount === 0) continue;
      ops.push({ op: 'set', row: item.row, col: p.col, input: num(0) });
      cleared++;
    } else if (amount === 0 && (!was || p.index > was.index)) {
      const template = p.half === 15 ? item.template15 : item.template30;
      if (template <= 0) continue;
      ops.push({ op: 'set', row: item.row, col: p.col, input: { kind: 'ref', col: p.half === 15 ? cols.t15 : cols.t30 } });
      restored++;
    }
  }
  const counts = [restored ? `${restored} payday${restored === 1 ? '' : 's'} added` : '', cleared ? `${cleared} cleared` : '']
    .filter(Boolean)
    .join(', ');
  return {
    ops,
    guards: [guardFor(model, item)],
    summary: `${item.name} ${last ? `ends after ${formatShort(last.date)}, ${last.date.getFullYear()}` : 'has no end date'}${counts ? ` (${counts})` : ''}`,
  };
}

/** The part of Notes a person edits; the "One-time Nov 15" prefix and "until Mar 2027" suffix are kept by the app. */
export const editableNotes = (item: LineItem) => item.notes.replace(ONE_TIME, '').replace(UNTIL, '').trim();

function rebuildNotes(item: LineItem, notes: string) {
  const prefix = ONE_TIME.exec(item.notes)?.[0].replace(/[\s·]+$/, '').trim();
  const until = UNTIL.exec(item.notes)?.[0].replace(/^[\s·]+/, '');
  return [prefix, notes.trim(), until].filter(Boolean).join(' · ');
}

export interface ItemDetails {
  name: string;
  notes: string;
  card: string;
  schedule: Schedule;
  /** Monthly amount; for a one-time payment, the payment amount. */
  monthly: number;
  /** First payday a new schedule or amount applies to. */
  fromIso: string;
  /** Spending category; omitted = unchanged. */
  type?: string;
}

const monthKey = (p: Payday) => p.date.getFullYear() * 12 + p.date.getMonth();
const SCHEDULE_LABEL: Record<RecurringSchedule, string> = { '15th': '15th payday', '30th': '30th payday', split: 'Equal Split' };

/**
 * Updates a bill's name, notes and card. A schedule change moves the row (with its paid notes) to the other section;
 * paydays before `fromIso` keep the amounts they show now, and from then on the bill is due on the new schedule's
 * paydays in the months it was active, skipping months it has already been paid in.
 */
export function planEditDetails(model: Model, item: LineItem, input: ItemDetails): EditPlan {
  const { cols, sectionLast, sectionLabel } = model.layout;
  const name = input.name.trim();
  const card = input.card.trim();
  if (!name) throw new Error('Give the bill a name.');
  if (!card) throw new Error('Pick a card or payment method.');
  if (model.items.some((i) => i !== item && i.name.toLowerCase() === name.toLowerCase()))
    throw new Error(`There's already a bill called "${name}".`);

  const ops: SheetOp[] = [];
  const guards: Guard[] = [guardFor(model, item)];
  const changes: string[] = [];
  let row = item.row;
  const monthly = round2(input.monthly);
  const oneTimePayday = item.oneTime ? model.paydays.find((p) => model.amount(item.row, p) > 0) : undefined;
  const currentAmount = oneTimePayday ? model.amount(item.row, oneTimePayday) : item.monthly;
  const amountChanged = monthly !== round2(currentAmount);
  if (amountChanged && !(monthly > 0)) throw new Error('Enter an amount above ₱0.');

  const moving = input.schedule !== item.schedule;
  if (moving) {
    if (item.oneTime || item.kind !== 'bill' || input.schedule === 'fund')
      throw new Error('Only recurring bills can change schedule.');
    const schedule = input.schedule as RecurringSchedule;
    const last = sectionLast[schedule];
    if (last === undefined) throw new Error(`Couldn't find the "${SCHEDULE_LABEL[schedule]}" section in your plan.`);
    const from = payday(model, input.fromIso);
    guards.push({ row: last, col: cols.description, expect: model.items.find((i) => i.row === last)?.name ?? '' });

    // Work out the cells from the current row before it moves.
    const active = model.paydays.filter((p) => model.amount(item.row, p) !== 0 || isPaidNote(model.note(item.row, p)));
    const [firstMonth, lastMonth] = active.length ? [monthKey(active[0]), monthKey(active.at(-1)!)] : [Infinity, -Infinity];
    const paidMonths = new Set(
      model.paydays.filter((p) => p.index >= from.index && isPaidNote(model.note(item.row, p))).map(monthKey),
    );
    const { t15, t30 } = templates(schedule, monthly);
    const cells: [number, CellInput][] = [];
    for (const p of model.paydays) {
      const amount = model.amount(item.row, p);
      if (isPaidNote(model.note(item.row, p))) continue;
      if (p.index < from.index) {
        if (amount !== 0) cells.push([p.col, num(amount)]);
        continue;
      }
      const template = p.half === 15 ? t15 : t30;
      const key = monthKey(p);
      const due = template > 0 && key >= firstMonth && key <= lastMonth && !paidMonths.has(key);
      cells.push([p.col, due ? { kind: 'ref', col: p.half === 15 ? cols.t15 : cols.t30 } : num(0)]);
    }

    const to = last + 1;
    ops.push({ op: 'moveRow', from: item.row, to });
    row = to > item.row ? to - 1 : to;
    const set = (col: number, input: CellInput) => ops.push({ op: 'set', row, col, input });
    set(cols.category, text(sectionLabel[schedule]!));
    if (amountChanged) set(cols.monthly, num(monthly));
    set(cols.t15, num(t15));
    set(cols.t30, num(t30));
    for (const [col, v] of cells) set(col, v);
    changes.push(`moved to ${SCHEDULE_LABEL[schedule]} from ${formatShort(from.date)}`);
    if (amountChanged) changes.push(`${formatPHP(monthly)} a month`);
  } else if (amountChanged && oneTimePayday) {
    ops.push({ op: 'set', row, col: oneTimePayday.col, input: num(monthly) });
    changes.push(`now ${formatPHP(monthly)}`);
  } else if (amountChanged) {
    ops.push(...planChangeAmount(model, item, monthly, input.fromIso).ops);
    changes.push(`${formatPHP(monthly)} a month from ${formatShort(payday(model, input.fromIso).date)}`);
  }

  const set = (col: number, input: CellInput) => ops.push({ op: 'set', row, col, input });
  if (name !== item.name) {
    set(cols.description, text(name));
    changes.push(`renamed from ${item.name}`);
  }
  const notes = rebuildNotes(item, input.notes);
  if (notes !== item.notes) {
    set(cols.notes, text(notes));
    changes.push('notes updated');
  }
  if (card !== item.card) {
    set(cols.card, text(card));
    changes.push(`now on ${card}`);
  }
  if (input.type && input.type !== item.type) {
    // A category that matches the guess needs no note; the note lives on the name cell and moves with the row.
    const auto = guessCategory(name, item.kind) === input.type;
    ops.push({ op: 'note', row, col: cols.description, note: auto ? '' : typeNote(input.type) });
    changes.push(`category ${input.type}`);
  }
  if (!ops.length) throw new Error('Nothing to change.');
  return { ops, guards, summary: `${name}: ${changes.join(', ')}` };
}

export function planDelete(model: Model, item: LineItem): EditPlan {
  return { ops: [{ op: 'deleteRow', row: item.row }], guards: [guardFor(model, item)], summary: `${item.name} deleted` };
}

/** Paydays on which this item counts as paid, so the delete confirmation can warn about lost history. */
export function paidHistory(model: Model, item: LineItem, today: Date = new Date()): Payday[] {
  const current = currentPayday(model, today);
  return model.paydays.filter((p) => cellState(model, item, p, current).status === 'paid');
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The sheet's header style: "Oct 15-2026", with the end-of-month payday on the 30th (28th in February). */
const headerLabel = (d: Date) => `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;

/** The `count` paydays after `last`, alternating 15th and 30th. */
export function nextPaydayDates(last: Date, count: number): Date[] {
  const out: Date[] = [];
  let y = last.getFullYear();
  let m = last.getMonth();
  let half: 15 | 30 = last.getDate() <= 15 ? 15 : 30;
  for (let i = 0; i < count; i++) {
    if (half === 15) half = 30;
    else {
      half = 15;
      m++;
      if (m > 11) [m, y] = [0, y + 1];
    }
    out.push(new Date(y, m, half === 15 ? 15 : m === 1 ? 28 : 30));
  }
  return out;
}

/**
 * Adds `months` of payday columns to both tabs. Ledger rows copy the last 15th/30th pair, so every row keeps its
 * own formula (including loan end dates). Finite goals in Sheet2 keep their last allocation until the target is met;
 * open-ended goals (Wealth) just continue.
 */
export function planExtend(model: Model, months = 6): EditPlan {
  const { paydays, layout } = model;
  const last = paydays.at(-1);
  if (!last || paydays.length < 2) throw new Error('The plan needs at least two paydays to extend.');
  const count = months * 2;
  const dates = nextPaydayDates(last.date, count);
  const lastCol = last.col;
  const ledgerEnd = layout.cardHeaderRow >= 0 ? layout.cardHeaderRow : layout.rowCount;

  const ops: SheetOp[] = [
    { op: 'appendCols', count },
    { op: 'copyCols', rows: [0, ledgerEnd], src: [lastCol - 1, lastCol + 1], dst: [lastCol + 1, lastCol + 1 + count] },
  ];
  for (const r of layout.headerRows)
    dates.forEach((d, i) => ops.push({ op: 'set', row: r, col: lastCol + 1 + i, input: text(headerLabel(d)) }));
  for (const summaryRow of [model.spendItem, model.extraItem])
    if (summaryRow) dates.forEach((_, i) => ops.push({ op: 'set', row: summaryRow.row, col: lastCol + 1 + i, input: num(0) }));

  if (layout.goalsRowCount) {
    const gLast = layout.goalsOffset + paydays.length - 1;
    const goalRows = new Set(model.goals.flatMap((g) => (g.planRow === null ? [] : [g.planRow])));
    ops.push({ op: 'appendCols', tab: 'goals', count });
    for (let r = 0; r < layout.goalsRowCount; r++) {
      if (goalRows.has(r)) continue;
      ops.push({ op: 'copyCols', tab: 'goals', rows: [r, r + 1], src: [gLast - 1, gLast + 1], dst: [gLast + 1, gLast + 1 + count] });
    }
    for (const g of model.goals) {
      if (g.planRow === null) continue;
      const lastAmounts = [g.planned.at(-2) ?? 0, g.planned.at(-1) ?? 0];
      let cum = g.planned.reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) {
        let amt = lastAmounts[i % 2];
        if (g.target !== null) amt = Math.max(0, Math.min(amt, g.target - cum));
        cum += amt;
        ops.push({ op: 'set', tab: 'goals', row: g.planRow, col: gLast + 1 + i, input: num(amt) });
      }
    }
  }

  const lastHeader = layout.headerRows[0] ?? 0;
  return {
    ops,
    guards: [{ row: lastHeader, col: lastCol, expect: headerLabel(last.date) }],
    summary: `Added ${formatShort(dates[0])}, ${dates[0].getFullYear()} to ${formatShort(dates.at(-1)!)}, ${dates.at(-1)!.getFullYear()}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cards

export interface CardInput {
  name: string;
  /** null = no credit limit (e.g. bank / cash), shown as N/A. */
  limit: number | null;
  /** Statement closing day and payment due day (1–31). */
  statementDay: number | null;
  dueDay: number | null;
  /** Kept as the Expected Payment Date when there's no due day; otherwise it's worked out from the due day. */
  dueNote: string;
  /** Optional; saved as a note on the card's name cell. */
  notes?: string;
}

/** Expected Payment Date text for a card: the payday before its due day, or what the sheet already says. */
export const expectedPayment = (input: Pick<CardInput, 'dueDay' | 'dueNote'>) =>
  input.dueDay ? payPayday(input.dueDay) : input.dueNote.trim();

/** Writes the Statement Day / Due Day cells, adding their headers to the card table the first time. */
function cardDayOps(model: Model, row: number, input: CardInput): SheetOp[] {
  const { cardCols, cardHeaderRow } = model.layout;
  const day = (d: number | null) => text(d ? ordinal(d) : '');
  const ops: SheetOp[] = [];
  if (!cardCols.present && (input.statementDay || input.dueDay))
    ops.push(
      { op: 'set', row: cardHeaderRow, col: cardCols.statement, input: text('Statement Day') },
      { op: 'set', row: cardHeaderRow, col: cardCols.due, input: text('Due Day') },
    );
  if (cardCols.present || input.statementDay || input.dueDay)
    ops.push(
      { op: 'set', row, col: cardCols.statement, input: day(input.statementDay) },
      { op: 'set', row, col: cardCols.due, input: day(input.dueDay) },
    );
  return ops;
}

function billRange(model: Model): [number, number] {
  const rows = model.items.map((i) => i.row);
  if (!rows.length) throw new Error('No bills found to total cards against.');
  return [Math.min(...rows), Math.max(...rows)];
}

function chargedFormula(model: Model, row: number): string {
  const [first, last] = billRange(model);
  const letter = (col: number) => toA1(0, col).replace(/\d+$/, '');
  const [card, monthly] = [letter(model.layout.cols.card), letter(model.layout.cols.monthly)];
  const d = `$${card}$${a1(first)}:$${card}$${a1(last)}`;
  const e = `$${monthly}$${a1(first)}:$${monthly}$${a1(last)}`;
  return `=SUMIF(${d}, A${a1(row)}, ${e})`;
}

const cardGuard = (card: CardInfo): Guard => ({ row: card.row, col: 0, expect: card.name });

function validateCard(model: Model, input: CardInput, except?: CardInfo) {
  const name = input.name.trim();
  if (!name) throw new Error('Give the card a name.');
  if (model.cards.some((c) => c !== except && c.name.toLowerCase() === name.toLowerCase()))
    throw new Error(`There's already a card called "${name}".`);
  if (input.limit !== null && !(input.limit > 0)) throw new Error('Enter a credit limit above ₱0, or mark it as no limit.');
  for (const d of [input.statementDay, input.dueDay])
    if (d !== null && !(Number.isInteger(d) && d >= 1 && d <= 31)) throw new Error('Days must be between 1 and 31.');
  if ((input.statementDay === null) !== (input.dueDay === null)) throw new Error('Set both the statement day and the due day, or neither.');
  return name;
}

export function planAddCard(model: Model, input: CardInput): EditPlan {
  const name = validateCard(model, input);
  const lastCard = model.cards.at(-1);
  const at = lastCard ? lastCard.row + 1 : model.layout.cardHeaderRow + 1;
  if (at <= 0) throw new Error('Couldn\'t find the "Card Name" table in your plan.');
  const ops: SheetOp[] = [
    { op: 'insertRow', at },
    { op: 'set', row: at, col: 0, input: text(name) },
    { op: 'set', row: at, col: 1, input: input.limit === null ? text('N/A') : num(input.limit) },
    { op: 'set', row: at, col: 2, input: { kind: 'formula', value: chargedFormula(model, at), preview: formatPHP(0) } },
    { op: 'set', row: at, col: 3, input: text(expectedPayment(input)) },
    {
      op: 'set',
      row: at,
      col: 4,
      input: input.limit === null ? text('N/A') : { kind: 'formula', value: `=C${a1(at)}/B${a1(at)}`, preview: '0.00%' },
    },
    ...cardDayOps(model, at, input),
    ...(input.notes?.trim() ? [{ op: 'note', row: at, col: 0, note: input.notes.trim() } as SheetOp] : []),
  ];
  return {
    ops,
    guards: [lastCard ? cardGuard(lastCard) : { row: model.layout.cardHeaderRow, col: 0, expect: 'Card Name' }],
    summary: `Added card ${name}`,
  };
}

/** Updates a card; renaming also moves every bill assigned to it, so the sheet's SUMIF keeps matching. */
export function planEditCard(model: Model, card: CardInfo, input: CardInput): EditPlan {
  const name = validateCard(model, input, card);
  const r = card.row;
  const ops: SheetOp[] = [
    { op: 'set', row: r, col: 1, input: input.limit === null ? text('N/A') : num(input.limit) },
    { op: 'set', row: r, col: 3, input: text(expectedPayment(input)) },
    ...cardDayOps(model, r, input),
  ];
  if (input.notes !== undefined && input.notes.trim() !== card.notes) ops.push({ op: 'note', row: r, col: 0, note: input.notes.trim() });
  if ((input.limit === null) !== (card.limit === null)) {
    const pct = input.limit ? `${((card.charged / input.limit) * 100).toFixed(2)}%` : 'N/A';
    ops.push({
      op: 'set',
      row: r,
      col: 4,
      input: input.limit === null ? text('N/A') : { kind: 'formula', value: `=C${a1(r)}/B${a1(r)}`, preview: pct },
    });
  }
  let moved = 0;
  if (name !== card.name) {
    ops.push({ op: 'set', row: r, col: 0, input: text(name) });
    for (const i of model.items.filter((x) => x.card === card.name)) {
      ops.push({ op: 'set', row: i.row, col: model.layout.cols.card, input: text(name) });
      moved++;
    }
  }
  const renamed = name !== card.name ? ` (renamed from ${card.name}${moved ? `, ${moved} bill${moved === 1 ? '' : 's'} moved` : ''})` : '';
  return { ops, guards: [cardGuard(card)], summary: `Updated ${name}${renamed}` };
}

export const billsOnCard = (model: Model, card: CardInfo) => model.items.filter((i) => i.card === card.name);

/** Where a bill goes when its card is deleted; `endIso` also stops it after that payday. */
export interface BillMove {
  item: LineItem;
  to: string;
  endIso?: string | null;
}

/** Deletes a card, first moving each of its bills to another card or payment method (and ending any marked to end). */
export function planDeleteCard(model: Model, card: CardInfo, moves: BillMove[] = []): EditPlan {
  const bills = billsOnCard(model, card);
  const missing = bills.filter((b) => !moves.some((m) => m.item.row === b.row));
  if (missing.length) throw new Error(`Choose where these bills go first: ${missing.map((b) => b.name).join(', ')}.`);
  const ops: SheetOp[] = [];
  const guards: Guard[] = [cardGuard(card)];
  let ended = 0;
  for (const m of moves) {
    const to = m.to.trim();
    if (!to) throw new Error(`Choose where ${m.item.name} goes.`);
    if (to.toLowerCase() === card.name.toLowerCase()) throw new Error(`${m.item.name} can't stay on the card being deleted.`);
    ops.push({ op: 'set', row: m.item.row, col: model.layout.cols.card, input: text(to) });
    guards.push(guardFor(model, m.item));
    if (m.endIso) {
      ops.push(...planEnd(model, m.item, m.endIso).ops);
      ended++;
    }
  }
  ops.push({ op: 'deleteRow', row: card.row });
  const parts = [
    moves.length ? `${moves.length} bill${moves.length === 1 ? '' : 's'} moved` : '',
    ended ? `${ended} ended` : '',
  ].filter(Boolean);
  return { ops, guards, summary: `Deleted card ${card.name}${parts.length ? ` (${parts.join(', ')})` : ''}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Goals

export interface GoalInput {
  name: string;
  /** null = open-ended (like Wealth). */
  target: number | null;
}

export interface GoalPlanInput {
  perPayday: number;
  fromIso: string;
}

export const targetLabel = (target: number | null) => (target === null ? '' : `Target ${formatCompact(target).replace('₱', '')}`);

/**
 * Planned allocation per payday: earlier paydays keep `existing`, then `perPayday` from `from` on until the target
 * is reached (the last one partial), then ₱0.
 */
export function schedulePlan(existing: number[], target: number | null, perPayday: number, fromIndex: number): number[] {
  let cum = existing.slice(0, fromIndex).reduce((a, b) => a + b, 0);
  return existing.map((v, i) => {
    if (i < fromIndex) return v;
    const amt = target === null ? perPayday : Math.max(0, Math.min(perPayday, target - cum));
    cum += amt;
    return round2(amt);
  });
}

/** Paydays (today onward) where the goals' plans add up to more than the surplus. */
export function surplusShortfalls(model: Model, today: Date, override?: { goalId: string | null; planned: number[] }) {
  const current = currentPayday(model, today);
  const from = current?.index ?? 0;
  const plans = model.goals.filter((g) => g.id !== override?.goalId).map((g) => g.planned);
  if (override) plans.push(override.planned);
  return model.paydays
    .filter((p) => p.index >= from)
    .map((p) => ({ payday: p, over: round2(plans.reduce((s, pl) => s + (pl[p.index] ?? 0), 0) - (model.surplus[p.index] ?? 0)) }))
    .filter((x) => x.over > 1);
}

function validateGoal(model: Model, input: GoalInput, except?: Goal) {
  const name = input.name.trim();
  if (!name) throw new Error('Give the goal a name.');
  if (model.goals.some((g) => g !== except && g.name.toLowerCase() === name.toLowerCase()))
    throw new Error(`There's already a goal called "${name}".`);
  if (input.target !== null && !(input.target > 0)) throw new Error('Enter a target above ₱0, or make it open-ended.');
  return name;
}

/** Where new goal rows go: just above Wealth (the catch-all) if it exists, else after the last goal. */
function goalInsertRows(model: Model) {
  const wealth = model.goals.find((g) => g.id === 'wealth');
  const lastRow = Math.max(...model.goals.map((g) => g.row ?? -1));
  const lastPlan = Math.max(...model.goals.map((g) => g.planRow ?? -1));
  return { rolling: wealth?.row ?? lastRow + 1, goals: wealth?.planRow ?? lastPlan + 1, anchor: wealth ?? model.goals.find((g) => g.row === lastRow) };
}

function goalGuards(goal: Goal): Guard[] {
  const g: Guard[] = [];
  if (goal.row !== null) g.push({ row: goal.row, col: 1, expect: goal.name });
  if (goal.planRow !== null) g.push({ tab: 'goals', row: goal.planRow, col: 1, expect: goal.planName });
  return g;
}

export function planAddGoal(model: Model, input: GoalInput, plan: GoalPlanInput): EditPlan {
  const name = validateGoal(model, input);
  if (!(plan.perPayday >= 0)) throw new Error('Enter how much to set aside each payday.');
  if (!model.goals.length || model.layout.goalsRowCount === 0) throw new Error('Couldn\'t find the goals in your plan.');
  const { cols, goalsOffset } = model.layout;
  const at = goalInsertRows(model);
  const from = payday(model, plan.fromIso);
  const planned = schedulePlan(model.paydays.map(() => 0), input.target, plan.perPayday, from.index);
  const label = targetLabel(input.target);

  const ops: SheetOp[] = [
    { op: 'insertRow', at: at.rolling },
    { op: 'set', row: at.rolling, col: cols.category, input: text('Goals') },
    { op: 'set', row: at.rolling, col: cols.description, input: text(name) },
    { op: 'set', row: at.rolling, col: cols.notes, input: text(label) },
    { op: 'set', row: at.rolling, col: cols.t15, input: num(0) },
    { op: 'set', row: at.rolling, col: cols.t30, input: num(0) },
    ...model.paydays.map((p): SheetOp => ({ op: 'set', row: at.rolling, col: p.col, input: num(0) })),
    { op: 'insertRow', tab: 'goals', at: at.goals },
    { op: 'set', tab: 'goals', row: at.goals, col: 0, input: text('Financial Goal') },
    { op: 'set', tab: 'goals', row: at.goals, col: 1, input: text(name) },
    { op: 'set', tab: 'goals', row: at.goals, col: 2, input: text(label) },
    ...planned.map((v, i): SheetOp => ({ op: 'set', tab: 'goals', row: at.goals, col: goalsOffset + i, input: num(v) })),
  ];
  let done = -1;
  planned.forEach((v, i) => v > 0 && (done = i));
  return {
    ops,
    guards: at.anchor ? goalGuards(at.anchor) : [],
    summary: `Added goal ${name}${done >= 0 ? `, planned through ${formatShort(model.paydays[done].date)} ${model.paydays[done].date.getFullYear()}` : ''}`,
  };
}

/** Renames / retargets a goal, and optionally replaces its plan from a payday on. */
export function planEditGoal(model: Model, goal: Goal, input: GoalInput, plan?: GoalPlanInput): EditPlan {
  const name = validateGoal(model, input, goal);
  const { cols, goalsOffset } = model.layout;
  const label = targetLabel(input.target);
  // Only touch what changed, so e.g. Sheet2's "Emergency Fund Allocation" keeps its name on a target-only edit.
  const renamed = name !== goal.name;
  const retargeted = input.target !== goal.target;
  const ops: SheetOp[] = [];
  if (goal.row !== null) {
    if (renamed) ops.push({ op: 'set', row: goal.row, col: cols.description, input: text(name) });
    if (retargeted) ops.push({ op: 'set', row: goal.row, col: cols.notes, input: text(label) });
  }
  if (goal.planRow !== null) {
    if (renamed) ops.push({ op: 'set', tab: 'goals', row: goal.planRow, col: 1, input: text(name) });
    if (retargeted) ops.push({ op: 'set', tab: 'goals', row: goal.planRow, col: 2, input: text(label) });
  }
  if (plan) {
    if (goal.planRow === null) throw new Error(`"${goal.name}" has no savings schedule yet.`);
    const from = payday(model, plan.fromIso);
    const next = schedulePlan(goal.planned, input.target, plan.perPayday, from.index);
    next.forEach((v, i) => {
      if (i >= from.index && v !== goal.planned[i])
        ops.push({ op: 'set', tab: 'goals', row: goal.planRow!, col: goalsOffset + i, input: num(v) });
    });
  }
  return { ops, guards: goalGuards(goal), summary: `Updated goal ${name}` };
}

/** The plan a goal would have after an edit, for previews and the surplus check. */
export function previewGoalPlan(model: Model, existing: number[] | null, target: number | null, plan: GoalPlanInput): number[] {
  const from = payday(model, plan.fromIso);
  return schedulePlan(existing ?? model.paydays.map(() => 0), target, plan.perPayday, from.index);
}

export function planDeleteGoal(goal: Goal): EditPlan {
  const ops: SheetOp[] = [];
  if (goal.row !== null) ops.push({ op: 'deleteRow', row: goal.row });
  if (goal.planRow !== null) ops.push({ op: 'deleteRow', tab: 'goals', row: goal.planRow });
  return { ops, guards: goalGuards(goal), summary: `Deleted goal ${goal.name}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Sample mode / tests

export interface Grid {
  rows: string[][];
  notes: (string | undefined)[][];
}

/**
 * Applies ops to plain grids of formatted strings (sample mode and tests). `ref` formulas copy the referenced cell;
 * other formulas use their preview; copied columns copy displayed values.
 */
/** Tabs missing from `grids` are created empty when an op touches them (e.g. Fund Withdrawals). */
export function applyToGrid(grids: Partial<Record<Tab, Grid>>, ops: SheetOp[]): Record<Tab, Grid> {
  const out = {} as Record<Tab, Grid>;
  for (const [t, g] of Object.entries(grids) as [Tab, Grid][])
    out[t] = { rows: g.rows.map((x) => [...(x ?? [])]), notes: g.notes.map((x) => [...(x ?? [])]) };
  const refs: { tab: Tab; row: number; col: number; src: number }[] = [];
  for (const o of ops) {
    const tab = o.tab ?? 'rolling';
    const g = (out[tab] ??= { rows: [], notes: [] });
    if (o.op === 'addTab') {
      /* the grid above is the new tab */
    } else if (o.op === 'insertRow') {
      g.rows.splice(o.at, 0, []);
      g.notes.splice(o.at, 0, []);
    } else if (o.op === 'deleteRow') {
      g.rows.splice(o.row, 1);
      g.notes.splice(o.row, 1);
    } else if (o.op === 'note') {
      (g.notes[o.row] ??= [])[o.col] = o.note || undefined;
    } else if (o.op === 'moveRow') {
      const [row] = g.rows.splice(o.from, 1);
      const [note] = g.notes.splice(o.from, 1);
      const at = o.to > o.from ? o.to - 1 : o.to;
      g.rows.splice(at, 0, row ?? []);
      g.notes.splice(at, 0, note ?? []);
    } else if (o.op === 'appendCols') {
      /* grids grow as cells are written */
    } else if (o.op === 'copyCols') {
      const width = o.src[1] - o.src[0];
      for (let r = o.rows[0]; r < o.rows[1]; r++) {
        const row = (g.rows[r] ??= []);
        if (!row.length) continue;
        for (let c = o.dst[0]; c < o.dst[1]; c++) row[c] = row[o.src[0] + ((c - o.dst[0]) % width)] ?? '';
      }
    } else {
      const row = (g.rows[o.row] ??= []);
      const { input } = o;
      if (input.kind === 'ref') refs.push({ tab, row: o.row, col: o.col, src: input.col });
      else
        row[o.col] =
          input.kind === 'number' ? formatPHP(input.value)
          : input.kind === 'text' ? input.value
          : input.kind === 'formula' ? input.preview
          : '';
    }
  }
  for (const x of refs) out[x.tab].rows[x.row][x.col] = out[x.tab].rows[x.row][x.src] ?? '';
  for (const t of Object.keys(out) as Tab[])
    for (const row of out[t].rows) for (let i = 0; i < row.length; i++) row[i] ??= '';
  return out;
}

