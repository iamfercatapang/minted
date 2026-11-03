import { CATEGORIES } from './categories';
import { SPEND_CATEGORIES, paydayFor } from './spending';
import { cellState, currentPayday, plannedFor, type LineItem, type Model, type Payday } from './model';
import { round2 } from './money';

export type Period = 'month' | '6m' | 'all';

export interface MonthTotals {
  key: string;
  date: Date;
  income: number;
  bills: number;
  /** Sinking funds and goal contributions. */
  saved: number;
  left: number;
}

export interface Slice {
  name: string;
  amount: number;
  share: number;
}

export interface LoanPayoff {
  item: LineItem;
  monthly: number;
  last: Payday;
  remaining: number;
}

export interface Variance {
  item: LineItem;
  planned: number;
  actual: number;
  diff: number;
  count: number;
}

export interface Report {
  paydays: Payday[];
  income: number;
  bills: number;
  saved: number;
  left: number;
  savingsRate: number | null;
  categories: Slice[];
  cards: Slice[];
  /** Quick spends in the period by their own categories (fund-covered ones excluded). */
  unplanned: Slice[];
  unplannedTotal: number;
  top: { item: LineItem; amount: number }[];
  months: MonthTotals[];
  loans: LoanPayoff[];
  variances: Variance[];
  /** Paid bill cells the variance was measured over. */
  paidCount: number;
  biggestMonths: MonthTotals[];
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Paydays in the period, starting from today's month. */
export function periodPaydays(model: Model, period: Period, today: Date): Payday[] {
  if (period === 'all') return model.paydays;
  const start = today.getFullYear() * 12 + today.getMonth();
  const months = period === 'month' ? 1 : 6;
  return model.paydays.filter((p) => {
    const m = p.date.getFullYear() * 12 + p.date.getMonth();
    return m >= start && m < start + months;
  });
}

const slices = (totals: Map<string, number>): Slice[] => {
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .filter(([, v]) => v > 0)
    .map(([name, amount]) => ({ name, amount: round2(amount), share: sum ? amount / sum : 0 }))
    .sort((a, b) => b.amount - a.amount);
};

export function buildReport(model: Model, period: Period, today: Date): Report {
  const paydays = periodPaydays(model, period, today);
  const current = currentPayday(model, today);
  const byCategory = new Map<string, number>(CATEGORIES.map((c) => [c, 0]));
  const byCard = new Map<string, number>();
  const byItem = new Map<LineItem, number>();
  const months = new Map<string, MonthTotals>();

  for (const p of paydays) {
    const key = monthKey(p.date);
    const m = months.get(key) ?? { key, date: new Date(p.date.getFullYear(), p.date.getMonth(), 1), income: 0, bills: 0, saved: 0, left: 0 };
    m.income += model.income[p.index] ?? 0;
    for (const item of model.items) {
      const amount = model.amount(item.row, p);
      if (amount <= 0) continue;
      byCategory.set(item.type, (byCategory.get(item.type) ?? 0) + amount);
      byItem.set(item, (byItem.get(item) ?? 0) + amount);
      if (item.kind === 'fund') m.saved += amount;
      else if (item.kind === 'spend') m.bills += amount;
      else {
        m.bills += amount;
        byCard.set(item.card, (byCard.get(item.card) ?? 0) + amount);
      }
    }
    // Goal contributions: what was recorded, or the plan where nothing is recorded yet.
    for (const g of model.goals) {
      const v = (g.actual[p.index] ?? 0) || (g.planned[p.index] ?? 0);
      if (v > 0) {
        m.saved += v;
        byCategory.set('Savings & funds', (byCategory.get('Savings & funds') ?? 0) + v);
      }
    }
    months.set(key, m);
  }
  // Quick spends: by their card (the summary row itself is on "Various") and by spending category.
  const inPeriod = new Set(paydays.map((p) => p.index));
  const spends = model.spends.filter((s) => !s.fund && s.iso >= model.paydays[0].iso && inPeriod.has(paydayFor(model, s.iso).index));
  const byUnplanned = new Map<string, number>(SPEND_CATEGORIES.map((c) => [c, 0]));
  for (const s of spends) {
    byUnplanned.set(s.category || 'Other', (byUnplanned.get(s.category || 'Other') ?? 0) + s.amount);
    const card = s.card || 'Cash';
    byCard.set(card, (byCard.get(card) ?? 0) + s.amount);
  }

  const monthList = [...months.values()].map((m) => ({
    ...m,
    income: round2(m.income),
    bills: round2(m.bills),
    saved: round2(m.saved),
    left: round2(m.income - m.bills - m.saved),
  }));
  const income = round2(monthList.reduce((s, m) => s + m.income, 0));
  const bills = round2(monthList.reduce((s, m) => s + m.bills, 0));
  const saved = round2(monthList.reduce((s, m) => s + m.saved, 0));

  // Loans with an end inside the timeline: their last non-zero payday, and what's still to pay after today.
  const loans: LoanPayoff[] = model.items
    .filter((i) => i.type === 'Loans' && i.kind === 'bill')
    .flatMap((item) => {
      const active = model.paydays.filter((p) => model.amount(item.row, p) > 0);
      const last = active.at(-1);
      if (!last || last.index === model.paydays.length - 1 || last.index < (current?.index ?? 0)) return [];
      const remaining = active
        .filter((p) => p.index > (current?.index ?? -1) || cellState(model, item, p, current).status !== 'paid')
        .reduce((s, p) => s + model.amount(item.row, p), 0);
      return [{ item, monthly: item.monthly, last, remaining: round2(remaining) }];
    })
    .sort((a, b) => a.last.index - b.last.index);

  // Planned vs actual: paid bills in the period whose amount differs from their template.
  const variance = new Map<LineItem, Variance>();
  let paidCount = 0;
  for (const p of paydays) {
    if (current && p.index > current.index) continue;
    for (const item of model.items) {
      const c = cellState(model, item, p, current);
      const template = plannedFor(item, p);
      if (c.status !== 'paid' || template <= 0) continue;
      paidCount++;
      const v = variance.get(item) ?? { item, planned: 0, actual: 0, diff: 0, count: 0 };
      v.planned += template;
      v.actual += c.amount;
      v.count++;
      variance.set(item, v);
    }
  }
  const variances = [...variance.values()]
    .map((v) => ({ ...v, planned: round2(v.planned), actual: round2(v.actual), diff: round2(v.actual - v.planned) }))
    .filter((v) => Math.abs(v.diff) >= 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const upcoming = monthList.filter((m) => !current || m.date >= new Date(current.date.getFullYear(), current.date.getMonth(), 1));
  return {
    paydays,
    income,
    bills,
    saved,
    left: round2(income - bills - saved),
    savingsRate: income ? saved / income : null,
    categories: slices(byCategory),
    cards: slices(byCard),
    unplanned: slices(byUnplanned),
    unplannedTotal: round2(spends.reduce((t, s) => t + s.amount, 0)),
    top: [...byItem.entries()]
      .filter(([i]) => i.kind === 'bill')
      .map(([item, amount]) => ({ item, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10),
    months: monthList,
    loans,
    variances,
    paidCount,
    biggestMonths: [...upcoming].sort((a, b) => b.bills - a.bills).slice(0, 3),
  };
}

/** Fixed color slot per category (follows the entity, never its rank); "Other" is neutral. */
export const categorySlot = (name: string) => {
  const i = CATEGORIES.indexOf(name as (typeof CATEGORIES)[number]);
  return i >= 0 && i < 8 ? i + 1 : 0;
};
