import { nextStatement, type CardPayment } from './cards';
import { formatShort, fromIso, isoDate } from './dates';
import type { EditPlan, Guard, SheetOp } from './edits';
import { formatPHP, round2 } from './money';
import type { CardInfo, CardPay, CardPaySource, Model, Payday } from './model';
import { ensureSummaryRow, paydayFor } from './spending';

const HEADERS = ['Date', 'Card', 'Amount', 'Source', 'Statement due', 'Goal', 'By'];
const ROW_NAME = 'Extra card payments';
const ROW_NOTES = 'Extra card payments logged in Minted';

export const SOURCE_LABEL: Record<CardPaySource, string> = {
  statement: 'Statement payment',
  budgeted: 'Paid early',
  extra: 'Extra funds',
  goal: 'Goal contribution',
};

export interface CardPayInput {
  card: CardInfo;
  iso: string;
  amount: number;
  source: CardPaySource;
  /** Goal id, for source 'goal'. */
  goalId?: string;
  by: string;
  /** The statement it pays toward; defaults to the next one due on or after the date. */
  statement?: CardPayment;
}

const cardGuard = (card: CardInfo): Guard => ({ row: card.row, col: 0, expect: card.name });
const extraFor = (model: Model, p: Payday, list: CardPay[]) =>
  round2(list.filter((x) => x.source === 'extra' && paydayFor(model, x.iso).index === p.index).reduce((t, x) => t + x.amount, 0));

/** Sets the Extra card payments cell for a payday to the total of `after`. */
function extraOps(model: Model, ops: SheetOp[], guards: Guard[], p: Payday, after: CardPay[]) {
  const row = ensureSummaryRow(model, ops, guards, model.extraItem, ROW_NAME, ROW_NOTES);
  ops.push({ op: 'set', row, col: p.col, input: { kind: 'number', value: extraFor(model, p, after) } });
}

/** Adds `delta` to a goal's recorded contribution for a payday. */
function goalOps(model: Model, ops: SheetOp[], goalId: string, p: Payday, delta: number, note?: string) {
  const goal = model.goals.find((g) => g.id === goalId);
  if (!goal || goal.row === null) throw new Error('Pick a goal that has a row in your plan.');
  const current = goal.actual[p.index] ?? 0;
  ops.push({ op: 'set', row: goal.row, col: p.col, input: { kind: 'number', value: round2(Math.max(0, current + delta)) } });
  if (note && !model.note(goal.row, p)) ops.push({ op: 'note', row: goal.row, col: p.col, note });
  return goal;
}

/**
 * Records a card payment toward a statement. 'statement' also marks the reminder paid; 'extra' takes it from the
 * payday's remaining funds (the Extra card payments row); 'goal' records it as that goal's contribution.
 */
export function planCardPay(model: Model, input: CardPayInput): EditPlan {
  const { card, iso, amount, source } = input;
  if (!(amount > 0)) throw new Error('Enter an amount above ₱0.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < model.paydays[0].iso) throw new Error('Pick a date inside your plan.');
  const statement = input.statement ?? nextStatement(model, card, iso);
  if (!statement) throw new Error(`Set ${card.name}'s statement and due days first.`);

  const ops: SheetOp[] = [];
  const guards: Guard[] = [cardGuard(card)];
  let at = model.layout.cardPaymentRows;
  if (at === null) {
    ops.push({ op: 'addTab', tab: 'cardPayments' });
    HEADERS.forEach((h, col) => ops.push({ op: 'set', tab: 'cardPayments', row: 0, col, input: { kind: 'text', value: h } }));
    at = 1;
  } else guards.push({ tab: 'cardPayments', row: at, col: 0, expect: '' });

  const payday = paydayFor(model, iso);
  const goal = source === 'goal' ? model.goals.find((g) => g.id === input.goalId) : undefined;
  if (source === 'goal' && !goal) throw new Error('Pick the goal this payment counts toward.');
  const dueIso = isoDate(statement.due);
  const values: (string | number)[] = [iso, card.name, round2(amount), source, dueIso, goal?.name ?? '', input.by];
  values.forEach((v, col) =>
    ops.push({
      op: 'set',
      tab: 'cardPayments',
      row: at!,
      col,
      input: typeof v === 'number' ? { kind: 'number', value: v } : v ? { kind: 'text', value: v } : { kind: 'blank' },
    }),
  );

  const entry: CardPay = { row: at, iso, card: card.name, amount: round2(amount), source, dueIso, goal: goal?.name ?? '', by: input.by };
  const left = Math.max(0, round2(statement.amount - statement.paidTotal - amount));
  if (source === 'statement') {
    // Only a payment that clears the statement writes a "Paid" note, which on its own marks it paid.
    const paidSoFar = formatPHP(round2(statement.paidTotal + amount));
    const note = left < 0.5 ? `Paid ${iso} by ${input.by} · ${paidSoFar}` : `Partly paid ${iso} by ${input.by} · ${paidSoFar} of ${formatPHP(statement.amount)}`;
    ops.push({ op: 'note', row: card.row, col: statement.payday.col, note });
  } else if (source === 'extra') extraOps(model, ops, guards, payday, [...model.cardPays, entry]);
  else if (source === 'goal') goalOps(model, ops, goal!.id, payday, amount, `Paid ${iso} by ${input.by} · ${card.name} payment`);

  return {
    ops,
    guards,
    summary: `${card.name}: ${formatPHP(amount)} paid toward the ${formatShort(statement.statement)} statement${left ? `, ${formatPHP(left)} left` : ', fully paid'}`,
  };
}

/** Removes a recorded payment, undoing its effect on the reminder, the payday or the goal. */
export function planDeleteCardPay(model: Model, pay: CardPay): EditPlan {
  const card = model.cards.find((c) => c.name === pay.card);
  const ops: SheetOp[] = [];
  const guards: Guard[] = [{ tab: 'cardPayments', row: pay.row, col: 1, expect: pay.card }];
  const payday = paydayFor(model, pay.iso);
  if (pay.source === 'extra') extraOps(model, ops, guards, payday, model.cardPays.filter((x) => x.row !== pay.row));
  else if (pay.source === 'goal') {
    const goal = model.goals.find((g) => g.name === pay.goal);
    if (goal) goalOps(model, ops, goal.id, payday, -pay.amount);
  } else if (pay.source === 'statement' && card) {
    const s = nextStatement(model, card, pay.dueIso);
    const others = model.cardPays.filter((x) => x.row !== pay.row && x.source === 'statement' && x.card === pay.card && x.dueIso === pay.dueIso);
    if (s && !others.length) ops.push({ op: 'note', row: card.row, col: s.payday.col, note: '' });
  }
  ops.push({ op: 'deleteRow', tab: 'cardPayments', row: pay.row });
  return { ops, guards, summary: `Removed the ${formatPHP(pay.amount)} ${pay.card} payment from ${formatShort(fromIso(pay.iso))}` };
}

/** "Mark as not paid": removes the statement payments recorded from the reminder (early payments stay). */
export function planUnmarkStatement(s: CardPayment): EditPlan {
  const mine = s.payments.filter((p) => p.source === 'statement').sort((a, b) => b.row - a.row);
  const ops: SheetOp[] = [{ op: 'note', row: s.card.row, col: s.payday.col, note: '' }];
  const guards: Guard[] = [cardGuard(s.card), ...mine.map((p): Guard => ({ tab: 'cardPayments', row: p.row, col: 1, expect: p.card }))];
  // Bottom-up so earlier row numbers stay valid.
  for (const p of mine) ops.push({ op: 'deleteRow', tab: 'cardPayments', row: p.row });
  return { ops, guards, summary: `${s.card.name} payment marked not paid` };
}
