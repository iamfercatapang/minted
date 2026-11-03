import { daysBetween, isoDate } from './dates';
import { fromIso } from './dates';
import { isPaidNote, type CardInfo, type LineItem, type Model, type Payday, type Schedule, type Spend } from './model';

/** A charge this close to the statement date (or closer) gets the least float, so it is flagged. */
export const POOR_DAYS = 5;
/** Utilization at or above this counts as near the limit. */
export const NEAR_LIMIT = 0.8;

export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** Day `d` of a month, moved to the last day for short months (31st → Feb 28). */
const onDay = (y: number, m: number, d: number) => new Date(y, m, Math.min(d, daysIn(y, m)));
const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export interface Cycle {
  /** The statement a charge on `charge` lands on, and when that statement is due. */
  statement: Date;
  due: Date;
  /** Days from the charge to the due date (interest-free days). */
  float: number;
  daysToStatement: number;
}

export const hasCycle = (c: CardInfo): c is CardInfo & { statementDay: number; dueDay: number } =>
  c.statementDay !== null && c.dueDay !== null;

/** The statement a charge on `charge` lands on (charges on the closing day are included) and its due date. */
export function cycleFor(card: CardInfo, charge: Date): Cycle | null {
  if (!hasCycle(card)) return null;
  const t = dateOnly(charge);
  let statement = onDay(t.getFullYear(), t.getMonth(), card.statementDay);
  if (statement < t) statement = onDay(t.getFullYear(), t.getMonth() + 1, card.statementDay);
  // A due day after the statement day falls in the same month; otherwise in the next one.
  const dueMonth = card.dueDay > card.statementDay ? statement.getMonth() : statement.getMonth() + 1;
  const due = onDay(statement.getFullYear(), dueMonth, card.dueDay);
  return { statement, due, float: daysBetween(t, due), daysToStatement: daysBetween(t, statement) };
}

/**
 * The payday that pays a card: the last 15th / 30th on or before its due day. A due day before the 15th is paid
 * from the previous month's 30th payday.
 */
export function payPayday(dueDay: number): '15th Payday' | '30th Payday' {
  return dueDay >= 15 && dueDay < 30 ? '15th Payday' : '30th Payday';
}

/** The next paydays (on or after today) a bill on this schedule is charged on. */
export function chargeDates(model: Model, schedule: Schedule, today: Date): Date[] {
  const t = isoDate(today);
  const halves: (15 | 30)[] = schedule === '15th' ? [15] : schedule === '30th' ? [30] : [15, 30];
  return halves.flatMap((h) => {
    const p = model.paydays.find((x) => x.half === h && x.iso >= t);
    return p ? [p.date] : [];
  });
}

export interface CardOption {
  card: CardInfo;
  /** Worst-case float across the charge dates. */
  float: number;
  daysToStatement: number;
  /** Utilization if the amount were added to this card. */
  util: number | null;
  nearLimit: boolean;
}

/**
 * Credit cards with statement and due days, best first: most interest-free days, with cards that would end up near
 * their limit after the charge ranked last.
 */
export function rankCards(model: Model, charges: Date[], amount = 0, currentCard?: string): CardOption[] {
  if (!charges.length) return [];
  return model.cards
    .filter((c) => c.limit !== null && hasCycle(c))
    .map((card) => {
      const cycles = charges.map((d) => cycleFor(card, d)!);
      const extra = card.name === currentCard ? 0 : amount;
      const util = card.limit ? (card.charged + extra) / card.limit : null;
      return {
        card,
        float: Math.min(...cycles.map((c) => c.float)),
        daysToStatement: Math.min(...cycles.map((c) => c.daysToStatement)),
        util,
        nearLimit: util !== null && util >= NEAR_LIMIT,
      };
    })
    .sort((a, b) => Number(a.nearLimit) - Number(b.nearLimit) || b.float - a.float);
}

export function bestCardToday(model: Model, today: Date): CardOption | null {
  return rankCards(model, [today]).find((o) => !o.nearLimit) ?? null;
}

export interface PoorAssignment {
  item: LineItem;
  card: CardInfo;
  daysToStatement: number;
  float: number;
  /** A card that gives at least a week more float, if any. */
  better: CardOption | null;
}

/** A bill whose charge lands within POOR_DAYS of its card's statement date. */
export function poorAssignment(model: Model, item: LineItem, today: Date): PoorAssignment | null {
  if (item.kind !== 'bill' || item.oneTime) return null;
  const card = model.cards.find((c) => c.name === item.card);
  if (!card || !hasCycle(card)) return null;
  const charges = chargeDates(model, item.schedule, today);
  const cycles = charges.map((d) => cycleFor(card, d)!);
  if (!cycles.length) return null;
  const daysToStatement = Math.min(...cycles.map((c) => c.daysToStatement));
  if (daysToStatement > POOR_DAYS) return null;
  const float = Math.min(...cycles.map((c) => c.float));
  const better = rankCards(model, charges, item.monthly, item.card).find((o) => !o.nearLimit && o.card !== card && o.float >= float + 7) ?? null;
  return { item, card, daysToStatement, float, better };
}

export interface CardPayment {
  card: CardInfo;
  payday: Payday;
  /** The statement this payday pays, and its due date. */
  statement: Date;
  due: Date;
  /** Bills charged to the card in that statement's cycle. */
  bills: { item: LineItem; payday: Payday; amount: number }[];
  /** Quick spends paid with the card, dated in the same cycle. */
  spends: Spend[];
  amount: number;
  /** "Paid …" note on the card row's payday cell, if marked. */
  note?: string;
  paid: boolean;
}

/**
 * Card payments due from a payday: credit cards whose due day makes this half the pay-from payday. The amount is the
 * statement total, worked out from the bills charged to the card between the previous statement and this one. These
 * are reminders only; the bills themselves are what Total Expenses counts.
 */
export function cardPayments(model: Model, payday: Payday): CardPayment[] {
  const out: CardPayment[] = [];
  for (const card of model.cards) {
    if (card.limit === null || !hasCycle(card)) continue;
    if ((payPayday(card.dueDay) === '15th Payday') !== (payday.half === 15)) continue;
    const d = payday.date;
    let due = onDay(d.getFullYear(), d.getMonth(), card.dueDay);
    if (due < d) due = onDay(d.getFullYear(), d.getMonth() + 1, card.dueDay);
    const sMonth = card.dueDay > card.statementDay ? due.getMonth() : due.getMonth() - 1;
    const statement = onDay(due.getFullYear(), sMonth, card.statementDay);
    const prev = onDay(due.getFullYear(), sMonth - 1, card.statementDay);
    const bills = model.items
      .filter((i) => i.card === card.name)
      .flatMap((item) =>
        model.paydays
          .filter((p) => p.date > prev && p.date <= statement)
          .map((p) => ({ item, payday: p, amount: model.amount(item.row, p) }))
          .filter((b) => b.amount > 0),
      );
    const spends = model.spends.filter((s) => !s.fund && s.card === card.name && fromIso(s.iso) > prev && fromIso(s.iso) <= statement);
    const total = bills.reduce((s, b) => s + b.amount, 0) + spends.reduce((s, x) => s + x.amount, 0);
    const amount = Math.round(total * 100) / 100;
    if (!amount) continue;
    const note = model.note(card.row, payday);
    out.push({ card, payday, statement, due, bills, spends, amount, note, paid: isPaidNote(note) });
  }
  return out;
}
