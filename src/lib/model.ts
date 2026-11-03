import { parseMoney, parseTarget, round2 } from './money';
import { isoDate, parsePaydayHeader } from './dates';
import { guessCategory, typeFromNote } from './categories';

/** Raw tab contents as returned by the Sheets API (formatted strings, 0-based rows/cols). */
export interface RawTab {
  title: string;
  gid: number;
  rows: string[][];
  /** Cell notes, same shape as rows where present. */
  notes: (string | undefined)[][];
}

export interface RawWorkbook {
  rolling: RawTab;
  goals?: RawTab;
  withdrawals?: RawTab;
}

export const ROLLING_TAB = 'Rolling Execution Plan';
export const GOALS_TAB = 'Sheet2';
/** Created by the app the first time money is taken out of a sinking fund: Date | Fund | Amount | Note | By. */
export const WITHDRAWALS_TAB = 'Fund Withdrawals';

export interface Withdrawal {
  /** 0-based row in the Fund Withdrawals tab. */
  row: number;
  iso: string;
  fund: string;
  amount: number;
  note: string;
  by: string;
}

export interface Payday {
  index: number;
  iso: string;
  date: Date;
  /** 15 for the mid-month payday, 30 for end-of-month (incl. Feb 28). */
  half: 15 | 30;
  /** 0-based column in the Rolling Execution Plan tab. */
  col: number;
}

export type ItemKind = 'bill' | 'fund' | 'goal';
export type Schedule = '15th' | '30th' | 'split' | 'fund';

export interface LineItem {
  id: string;
  kind: ItemKind;
  name: string;
  category: string;
  schedule: Schedule;
  notes: string;
  card: string;
  monthly: number;
  /** Spending category for reports: set by hand (a "Type:" note on the name cell) or guessed from the name. */
  type: string;
  typeSet: boolean;
  /** A single payment on one payday (Notes start with "One-time"). */
  oneTime: boolean;
  template15: number;
  template30: number;
  /** 0-based row in the Rolling Execution Plan tab. */
  row: number;
}

export type CellStatus = 'paid' | 'due' | 'upcoming' | 'not-due';

export interface CellState {
  item: LineItem;
  payday: Payday;
  /** Amount currently in the sheet cell. */
  amount: number;
  /** Amount the plan expects for this payday. */
  planned: number;
  note?: string;
  status: CellStatus;
  /** True when the app (or a person) left a "Paid" note on the cell. */
  marked: boolean;
}

export interface Goal {
  id: string;
  name: string;
  target: number | null;
  targetLabel: string;
  /** Contributions recorded in the Rolling Execution Plan "Goals" row (0-based). */
  row: number | null;
  /** Row in Sheet2 holding the plan, and its name there (e.g. "Emergency Fund Allocation"). */
  planRow: number | null;
  planName: string;
  /** Planned allocation per payday (aligned to Model.paydays) from Sheet2. */
  planned: number[];
  /** Actual contribution per payday from the Rolling Execution Plan. */
  actual: number[];
}

export interface CardInfo {
  /** 0-based row in the card table. */
  row: number;
  name: string;
  limit: number | null;
  charged: number;
  dueNote: string;
  utilization: number | null;
  /** Day of the month the statement closes / payment is due (1–31), from the Statement Day / Due Day columns. */
  statementDay: number | null;
  dueDay: number | null;
  /** Free notes, kept as a cell note on the card's name. */
  notes: string;
}

/** 0-based columns of the Rolling Execution Plan header. */
export interface Columns {
  category: number;
  description: number;
  notes: number;
  card: number;
  monthly: number;
  t15: number;
  t30: number;
}

export interface Layout {
  cols: Columns;
  /** Last row of each bill section, where new rows are inserted after. */
  sectionLast: Partial<Record<Schedule, number>>;
  /** Category label used by each section, as written in the sheet. */
  sectionLabel: Partial<Record<Schedule, string>>;
  /** Rows that repeat the Category / Description / dates header. */
  headerRows: number[];
  /** Row of the "Card Name" table header (-1 when absent); the ledger ends above it. */
  cardHeaderRow: number;
  /** Card table columns for the statement and due days, and whether their headers exist yet. */
  cardCols: { statement: number; due: number; present: boolean };
  /** Rows in the Rolling Execution Plan tab. */
  rowCount: number;
  /** Sheet2: column of the first payday, and how many rows it has. */
  goalsOffset: number;
  goalsRowCount: number;
  /** Row of the Income line (-1 when absent). */
  incomeRow: number;
  /** Sheet2's TOTAL EXPENSES and AVAILABLE SURPLUS rows, when found. */
  goalsSummary: { expenses: number; surplus: number } | null;
  /** Rows used in the Fund Withdrawals tab (header included), or null when the tab doesn't exist yet. */
  withdrawalsRows: number | null;
}

export interface Model {
  rollingGid: number;
  layout: Layout;
  paydays: Payday[];
  items: LineItem[];
  income: number[];
  totalExpenses: number[];
  surplus: number[];
  goals: Goal[];
  cards: CardInfo[];
  withdrawals: Withdrawal[];
  /** Notes on the Income row, e.g. "Ana ₱42,800 + Ben ₱59,864.40". */
  incomeNote: string;
  /** Sheet2's total expenses per payday (aligned to paydays). */
  goalsExpenses: number[];
  amount(itemRow: number, payday: Payday): number;
  note(itemRow: number, payday: Payday): string | undefined;
}

const BILL_CATEGORIES: Record<string, Schedule> = {
  '15th payday': '15th',
  '30th payday': '30th',
  'equal split': 'split',
  'new goal': 'fund',
};

/** "25th", "Day 25", "25" or a currency-formatted "₱25.00" → 25. */
export function parseDay(s: string): number | null {
  const m = /(\d{1,2})(?:\.0+)?(?!\d)/.exec(s.replace(/,/g, ''));
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 31 ? n : null;
}

export const isPaidNote = (note: string | undefined) => !!note && /^\s*paid\b/i.test(note);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function findHeader(rows: string[][]): { row: number; cols: Record<string, number>; paydayCols: number[] } {
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map((c) => c.trim().toLowerCase());
    const desc = cells.indexOf('description');
    if (desc < 0 || cells.indexOf('category') < 0) continue;
    const cols: Record<string, number> = {};
    cells.forEach((c, i) => {
      if (c === 'category') cols.category ??= i;
      else if (c === 'description') cols.description = i;
      else if (c === 'notes') cols.notes = i;
      else if (c.startsWith('payment method')) cols.card = i;
      else if (c === 'monthly budget') cols.monthly = i;
      else if (c === '15th payday') cols.t15 = i;
      else if (c === '30th payday') cols.t30 = i;
    });
    const paydayCols = rows[r].map((c, i) => (parsePaydayHeader(c) ? i : -1)).filter((i) => i >= 0);
    if (paydayCols.length) return { row: r, cols, paydayCols };
  }
  throw new Error(`Couldn't find the header row (Category / Description / payday dates) in "${ROLLING_TAB}".`);
}

function requireCols(c: Record<string, number>): Columns {
  for (const k of ['category', 'description', 'notes', 'card', 'monthly', 't15', 't30'])
    if (c[k] === undefined) throw new Error(`Header column "${k}" not found in "${ROLLING_TAB}".`);
  return c as unknown as Columns;
}

const GOAL_KEYS: [string, RegExp][] = [
  ['debt', /debt/i],
  ['emergency', /emergency/i],
  ['house', /house|renov/i],
  ['wealth', /wealth|invest/i],
];
const goalKey = (name: string) => GOAL_KEYS.find(([, re]) => re.test(name))?.[0] ?? slug(name);

export function buildModel(raw: RawWorkbook): Model {
  const rows = raw.rolling.rows;
  const notes = raw.rolling.notes;
  const header = findHeader(rows);
  const cell = (r: number, c: number | undefined) => (c === undefined ? '' : (rows[r]?.[c] ?? '').trim());
  const num = (r: number, c: number | undefined) => parseMoney(cell(r, c)) ?? 0;

  const paydays: Payday[] = header.paydayCols.map((col, index) => {
    const date = parsePaydayHeader(rows[header.row][col])!;
    return { index, iso: isoDate(date), date, half: date.getDate() <= 15 ? 15 : 30, col };
  });
  const series = (r: number) => paydays.map((p) => num(r, p.col));

  const items: LineItem[] = [];
  const goalRows = new Map<string, { row: number; name: string; note: string }>();
  let income: number[] = paydays.map(() => 0);
  let totalExpenses: number[] = paydays.map(() => 0);
  let surplus: number[] = paydays.map(() => 0);
  let cardHeaderRow = -1;
  let incomeRow = -1;
  let incomeNote = '';
  const sectionLast: Layout['sectionLast'] = {};
  const sectionLabel: Layout['sectionLabel'] = {};

  for (let r = 0; r < rows.length; r++) {
    if (r === header.row) continue;
    const category = cell(r, header.cols.category);
    const name = cell(r, header.cols.description);
    const catKey = category.toLowerCase();
    if (catKey === 'card name') {
      cardHeaderRow = r;
      break;
    }
    if (!name || catKey === 'category') continue;

    if (catKey === 'income') {
      income = series(r);
      incomeRow = r;
      incomeNote = cell(r, header.cols.notes);
    }
    else if (catKey === 'summary' && /expense/i.test(name)) totalExpenses = series(r);
    else if (catKey === 'summary' && /surplus/i.test(name)) surplus = series(r);
    else if (catKey === 'goals') goalRows.set(goalKey(name), { row: r, name, note: cell(r, header.cols.notes) });
    else if (BILL_CATEGORIES[catKey]) {
      const schedule = BILL_CATEGORIES[catKey];
      sectionLast[schedule] = r;
      sectionLabel[schedule] ??= category;
      let id = slug(name);
      while (items.some((i) => i.id === id)) id += '-x';
      const kind: ItemKind = schedule === 'fund' ? 'fund' : 'bill';
      const typeSet = typeFromNote(notes[r]?.[header.cols.description]);
      items.push({
        id,
        kind,
        name,
        type: typeSet ?? guessCategory(name, kind),
        typeSet: !!typeSet,
        category,
        schedule,
        notes: cell(r, header.cols.notes),
        oneTime: /^one-time/i.test(cell(r, header.cols.notes)),
        card: cell(r, header.cols.card) || 'Unassigned',
        monthly: num(r, header.cols.monthly),
        template15: num(r, header.cols.t15),
        template30: num(r, header.cols.t30),
        row: r,
      });
    }
  }

  // Card utilization table sits below the ledger: Card Name | Credit Limit | Total Monthly Charged | Expected Payment Date | Utilization %
  const cards: CardInfo[] = [];
  const cardCols = { statement: 5, due: 6, present: false };
  if (cardHeaderRow >= 0) {
    const head = (rows[cardHeaderRow] ?? []).map((c) => c.trim().toLowerCase());
    const sc = head.findIndex((c) => c.startsWith('statement'));
    const dc = head.findIndex((c) => c.startsWith('due'));
    if (sc >= 0 && dc >= 0) Object.assign(cardCols, { statement: sc, due: dc, present: true });
    for (let r = cardHeaderRow + 1; r < rows.length; r++) {
      const [name, limit, charged, dueNote, util] = rows[r] ?? [];
      if (!name?.trim()) break;
      const limitN = parseMoney(limit);
      const utilN = parseMoney(util);
      cards.push({
        row: r,
        name: name.trim(),
        limit: limitN,
        charged: parseMoney(charged) ?? 0,
        dueNote: (dueNote ?? '').trim(),
        utilization: utilN === null ? null : utilN / 100,
        statementDay: cardCols.present ? parseDay(cell(r, cardCols.statement)) : null,
        dueDay: cardCols.present ? parseDay(cell(r, cardCols.due)) : null,
        notes: (notes[r]?.[0] ?? '').trim(),
      });
    }
  }

  const { goals, offset: goalsOffset } = buildGoals(raw.goals, paydays, goalRows, series, surplus);
  const g2 = raw.goals?.rows ?? [];
  const g2Expenses = g2.findIndex((r) => /summary/i.test(r[0] ?? '') && /expense/i.test(r[1] ?? ''));
  const g2Surplus = g2.findIndex((r) => /summary/i.test(r[0] ?? '') && /surplus/i.test(r[1] ?? ''));
  const goalsSummary = g2Expenses >= 0 && g2Surplus >= 0 ? { expenses: g2Expenses, surplus: g2Surplus } : null;
  const headerRows = rows.flatMap((r, i) => ((r[header.cols.description] ?? '').trim().toLowerCase() === 'description' ? [i] : []));

  const model: Model = {
    rollingGid: raw.rolling.gid,
    layout: {
      cols: requireCols(header.cols),
      sectionLast,
      sectionLabel,
      headerRows,
      cardHeaderRow,
      cardCols,
      incomeRow,
      goalsSummary,
      rowCount: rows.length,
      goalsOffset,
      goalsRowCount: raw.goals?.rows.length ?? 0,
      withdrawalsRows: raw.withdrawals ? Math.max(1, raw.withdrawals.rows.length) : null,
    },
    paydays,
    items,
    income,
    totalExpenses,
    surplus,
    goals,
    cards,
    incomeNote,
    goalsExpenses: paydays.map((_, i) => (goalsSummary ? parseMoney(g2[goalsSummary.expenses]?.[goalsOffset + i]) ?? 0 : 0)),
    withdrawals: (raw.withdrawals?.rows ?? []).flatMap((r, row): Withdrawal[] => {
      const [iso = '', fund = '', amount = '', note = '', by = ''] = r ?? [];
      const value = parseMoney(amount);
      return row === 0 || !fund.trim() || value === null ? [] : [{ row, iso: iso.trim(), fund: fund.trim(), amount: value, note: note.trim(), by: by.trim() }];
    }),
    amount: (row, p) => num(row, p.col),
    note: (row, p) => notes[row]?.[p.col],
  };
  return model;
}

function buildGoals(
  tab: RawTab | undefined,
  paydays: Payday[],
  goalRows: Map<string, { row: number; name: string; note: string }>,
  series: (r: number) => number[],
  rollingSurplus: number[],
): { goals: Goal[]; offset: number } {
  const goals = new Map<string, Goal>();
  for (const [key, g] of goalRows) {
    goals.set(key, {
      id: key,
      name: g.name,
      target: parseTarget(g.note),
      targetLabel: g.note,
      row: g.row,
      planRow: null,
      planName: '',
      planned: paydays.map(() => 0),
      actual: series(g.row),
    });
  }

  if (tab) {
    // Sheet2 has no header row. Its payday columns are the last N columns of the fully populated
    // "Summary" rows; confirm the offset by matching the surplus series against the ledger's.
    // The series repeats every two paydays, so pick the best-matching offset, preferring the right-aligned one.
    const rows = tab.rows;
    const summary = rows.find((r) => /surplus/i.test(r[1] ?? '')) ?? rows.find((r) => r.length > paydays.length);
    let offset = summary ? Math.max(0, summary.length - paydays.length) : 6;
    if (summary) {
      const score = (o: number) =>
        paydays.filter((p, i) => round2(parseMoney(summary[o + i]) ?? NaN) === round2(rollingSurplus[p.index])).length;
      let best = score(offset);
      for (let o = 0; o + paydays.length <= summary.length; o++) {
        const s = score(o);
        if (s > best) [best, offset] = [s, o];
      }
    }
    rows.forEach((r, ri) => {
      if (!/goal/i.test(r[0] ?? '')) return;
      const name = (r[1] ?? '').trim();
      if (!name) return;
      const key = goalKey(name);
      const goal: Goal =
        goals.get(key) ??
        { id: key, name, target: null, targetLabel: '', row: null, planRow: null, planName: '', planned: [], actual: paydays.map(() => 0) };
      const label = (r[2] ?? '').trim();
      const target = parseTarget(label);
      if (target !== null) {
        goal.target = target;
        goal.targetLabel = label;
      } else if (!goal.targetLabel) goal.targetLabel = label;
      goal.planned = paydays.map((_, i) => parseMoney(r[offset + i]) ?? 0);
      goal.planRow = ri;
      goal.planName = name;
      goals.set(key, goal);
    });
    return { goals: [...goals.values()], offset };
  }
  return { goals: [...goals.values()], offset: 6 };
}

export function plannedFor(item: LineItem, payday: Payday): number {
  return payday.half === 15 ? item.template15 : item.template30;
}

/**
 * How the household reads a cell: the user overwrites the planned amount with the actual amount once paid.
 * A "Paid" note is the explicit marker (needed when actual == planned). A past/current cell whose value differs
 * from the plan is treated as paid too, since that only happens when someone typed the actual amount in.
 */
export function cellState(model: Model, item: LineItem, payday: Payday, current: Payday | undefined): CellState {
  const amount = model.amount(item.row, payday);
  const note = model.note(item.row, payday);
  // Rows with no template for this half (one-time items) plan whatever the cell holds.
  const template = plannedFor(item, payday);
  const planned = template > 0 ? template : amount;
  const marked = isPaidNote(note);
  const reached = !!current && payday.index <= current.index;
  let status: CellStatus;
  if (marked) status = 'paid';
  else if (amount === 0) status = 'not-due';
  else if (reached && round2(amount) !== round2(planned)) status = 'paid';
  else status = reached ? 'due' : 'upcoming';
  return { item, payday, amount, planned, note, status, marked };
}

/** The payday whose money is "in hand": the latest payday on or before today. */
export function currentPayday(model: Model, today: Date = new Date()): Payday | undefined {
  const t = isoDate(today);
  let found: Payday | undefined;
  for (const p of model.paydays) if (p.iso <= t) found = p;
  return found ?? model.paydays[0];
}

export function nextPayday(model: Model, today: Date = new Date()): Payday | undefined {
  const t = isoDate(today);
  return model.paydays.find((p) => p.iso > t);
}

export interface PaydaySummary {
  payday: Payday;
  income: number;
  plannedTotal: number;
  paidTotal: number;
  remaining: number;
  surplus: number;
  cells: CellState[];
  paidCount: number;
  dueCount: number;
}

export function summarize(model: Model, payday: Payday, current: Payday | undefined): PaydaySummary {
  const cells = model.items.map((i) => cellState(model, i, payday, current)).filter((c) => c.status !== 'not-due');
  const paid = cells.filter((c) => c.status === 'paid');
  const open = cells.filter((c) => c.status !== 'paid');
  const paidTotal = round2(paid.reduce((s, c) => s + c.amount, 0));
  const remaining = round2(open.reduce((s, c) => s + c.amount, 0));
  return {
    payday,
    income: model.income[payday.index] ?? 0,
    plannedTotal: round2(paidTotal + remaining),
    paidTotal,
    remaining,
    surplus: model.surplus[payday.index] ?? 0,
    cells,
    paidCount: paid.length,
    dueCount: open.length,
  };
}

export interface GoalProgress {
  goal: Goal;
  saved: number;
  plannedToDate: number;
  plannedTotal: number;
  pct: number | null;
  /** Payday when the cumulative plan reaches the target. */
  projectedDone: Payday | null;
  nextPlanned: { payday: Payday; amount: number } | null;
}

export function goalProgress(model: Model, goal: Goal, current: Payday | undefined): GoalProgress {
  const upto = current?.index ?? -1;
  const saved = round2(goal.actual.reduce((s, v) => s + v, 0));
  const plannedToDate = round2(goal.planned.slice(0, upto + 1).reduce((s, v) => s + v, 0));
  const plannedTotal = round2(goal.planned.reduce((s, v) => s + v, 0));
  let projectedDone: Payday | null = null;
  if (goal.target) {
    // Payday where following the plan reaches the target: whatever is recorded so far (or the plan to date,
    // whichever is larger) plus the remaining scheduled allocations.
    let cum = Math.max(saved, plannedToDate);
    if (cum >= goal.target - 1) projectedDone = current ?? null;
    for (let i = upto + 1; i < model.paydays.length && !projectedDone; i++) {
      cum += goal.planned[i] ?? 0;
      if (cum >= goal.target - 1) projectedDone = model.paydays[i];
    }
  }
  const nextIdx = goal.planned.findIndex((v, i) => i >= Math.max(upto, 0) && v > 0 && (goal.actual[i] ?? 0) === 0);
  return {
    goal,
    saved,
    plannedToDate,
    plannedTotal,
    pct: goal.target ? Math.min(1, saved / goal.target) : null,
    projectedDone,
    nextPlanned: nextIdx >= 0 ? { payday: model.paydays[nextIdx], amount: goal.planned[nextIdx] } : null,
  };
}

/** Converts 0-based (row, col) to A1 notation, e.g. (9, 7) → "H10". */
export function toA1(row: number, col: number): string {
  let s = '';
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${row + 1}`;
}

/** Goal contributions due on a payday, shaped like bill cells so the same mark-paid flow writes them. */
export function goalCells(model: Model, payday: Payday, current: Payday | undefined): CellState[] {
  const reached = !!current && payday.index <= current.index;
  return model.goals
    .filter((g) => g.row !== null && ((g.planned[payday.index] ?? 0) > 0 || (g.actual[payday.index] ?? 0) > 0))
    .map((g) => {
      const planned = g.planned[payday.index] ?? 0;
      const amount = g.actual[payday.index] ?? 0;
      const note = model.note(g.row!, payday);
      const marked = isPaidNote(note);
      const item: LineItem = {
        id: `goal-${g.id}`,
        kind: 'goal',
        name: g.name,
        category: 'Goals',
        schedule: 'fund',
        notes: g.targetLabel,
        card: 'Savings',
        monthly: 0,
        type: 'Savings & funds',
        typeSet: false,
        oneTime: false,
        template15: planned,
        template30: planned,
        row: g.row!,
      };
      const status: CellStatus = marked || amount > 0 ? 'paid' : reached ? 'due' : 'upcoming';
      return { item, payday, amount: amount > 0 ? amount : planned, planned, note, status, marked };
    });
}
