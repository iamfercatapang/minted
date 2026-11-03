import { describe, expect, it } from 'vitest';
import {
  applyToGrid, billsOnCard, nextPaydayDates, paidHistory, planAdd, planAddCard, planAddGoal, planChangeAmount, planDelete,
  planDeleteCard, planDeleteGoal, planEditCard, planEditDetails, planEditGoal, planEnd, planExtend, schedulePlan, surplusShortfalls,
  editableNotes, type CardInput, type EditPlan,
} from '../src/lib/edits';
import { fundStatus, fundTarget, planAddFund, planDeleteWithdrawal, planEditFund, planWithdraw } from '../src/lib/funds';
import { cardPayments } from '../src/lib/cards';
import { bestCardToday, cycleFor, payPayday, poorAssignment, rankCards } from '../src/lib/cards';
import { isoDate } from '../src/lib/dates';
import { buildModel, cellState, summarize, type Model } from '../src/lib/model';
import { sampleWorkbook } from './sample';

const today = new Date(2026, 10, 3);

export function applyPlan(plan: EditPlan, wb = sampleWorkbook()) {
  for (const g of plan.guards) {
    const tab = g.tab === 'goals' ? wb.goals! : g.tab === 'withdrawals' ? wb.withdrawals! : wb.rolling;
    expect(tab.rows[g.row]?.[g.col] ?? '').toBe(g.expect);
  }
  const out = applyToGrid(
    {
      rolling: { rows: wb.rolling.rows, notes: wb.rolling.notes },
      goals: { rows: wb.goals!.rows, notes: wb.goals!.notes },
      ...(wb.withdrawals ? { withdrawals: { rows: wb.withdrawals.rows, notes: wb.withdrawals.notes } } : {}),
    },
    plan.ops,
  );
  return {
    ...wb,
    rolling: { ...wb.rolling, rows: out.rolling.rows, notes: out.rolling.notes },
    goals: { ...wb.goals!, rows: out.goals.rows, notes: out.goals.notes },
    withdrawals: out.withdrawals ? { title: 'Fund Withdrawals', gid: 2, ...out.withdrawals } : wb.withdrawals,
  };
}

function apply(_model: Model, plan: EditPlan, wb = sampleWorkbook()): Model {
  return buildModel(applyPlan(plan, wb));
}

const base = buildModel(sampleWorkbook());
const find = (m: Model, name: string) => m.items.find((i) => i.name === name)!;
const p = (m: Model, iso: string) => m.paydays.find((x) => x.iso === iso)!;

describe('planAdd', () => {
  it('inserts a recurring 30th bill at the end of its section with formulas to the template', () => {
    const plan = planAdd(base, {
      type: 'recurring', name: 'Disney+', card: 'Maya Ben', notes: '', schedule: '30th',
      monthly: 369, startIso: '2026-11-30', endIso: '2027-05-30',
    });
    const lastThirtieth = base.layout.sectionLast['30th']!;
    expect(plan.ops[0]).toEqual({ op: 'insertRow', at: lastThirtieth + 1 });
    const nov30Col = p(base, '2026-11-30').col;
    expect(plan.ops).toContainEqual({ op: 'set', row: lastThirtieth + 1, col: nov30Col, input: { kind: 'ref', col: base.layout.cols.t30 } });

    const m = apply(base, plan);
    const d = find(m, 'Disney+');
    expect(d).toMatchObject({ category: '30th Payday', schedule: '30th', card: 'Maya Ben', monthly: 369, template30: 369, notes: 'until May 2027' });
    expect(m.amount(d.row, p(m, '2026-10-30'))).toBe(0);
    expect(m.amount(d.row, p(m, '2026-11-15'))).toBe(0);
    expect(m.amount(d.row, p(m, '2026-11-30'))).toBe(369);
    expect(m.amount(d.row, p(m, '2027-05-30'))).toBe(369);
    expect(m.amount(d.row, p(m, '2027-06-30'))).toBe(0);
    // Rows below moved down one; Equal Split items still parse.
    expect(find(m, 'Meralco').row).toBe(find(base, 'Meralco').row + 1);
  });

  it('splits an Equal Split bill in half', () => {
    const m = apply(base, planAdd(base, {
      type: 'recurring', name: 'Laundry', card: 'Bank ADA / Direct Cash', notes: 'weekly', schedule: 'split',
      monthly: 3000, startIso: '2026-11-15', endIso: null,
    }));
    const l = find(m, 'Laundry');
    expect(l).toMatchObject({ template15: 1500, template30: 1500, notes: 'weekly' });
    expect(m.amount(l.row, p(m, '2026-11-15'))).toBe(1500);
    expect(m.amount(l.row, p(m, '2028-03-30'))).toBe(1500);
  });

  it('adds a one-time payment that is due, not auto-paid, once its payday arrives', () => {
    const m = apply(base, planAdd(base, { type: 'oneTime', name: 'Aircon repair', card: 'BPI Ben', notes: '', paydayIso: '2026-11-15', amount: 4500 }));
    const a = find(m, 'Aircon repair');
    expect(a).toMatchObject({ category: '15th Payday', oneTime: true, notes: 'One-time Nov 15' });
    const nov15 = p(m, '2026-11-15');
    expect(cellState(m, a, nov15, nov15)).toMatchObject({ status: 'due', amount: 4500, planned: 4500 });
    expect(cellState(m, a, p(m, '2026-11-30'), nov15).status).toBe('not-due');
  });

  it('rejects bad input', () => {
    expect(() => planAdd(base, { type: 'oneTime', name: ' ', card: '', notes: '', paydayIso: '2026-11-15', amount: 5 })).toThrow(/name/);
    expect(() => planAdd(base, { type: 'oneTime', name: 'x', card: '', notes: '', paydayIso: '2026-11-15', amount: 0 })).toThrow(/amount/);
    expect(() => planAdd(base, {
      type: 'recurring', name: 'x', card: '', notes: '', schedule: '15th', monthly: 1, startIso: '2027-01-15', endIso: '2026-12-15',
    })).toThrow(/before/);
  });
});

describe('changing existing bills', () => {
  it('changes the amount from a payday on and freezes earlier paydays', () => {
    const meralco = find(base, 'Meralco');
    const m = apply(base, planChangeAmount(base, meralco, 14000, '2026-12-15'));
    const x = find(m, 'Meralco');
    expect(x).toMatchObject({ monthly: 14000, template15: 7000, template30: 7000 });
    expect(m.amount(x.row, p(m, '2026-11-30'))).toBe(5200);
    expect(m.amount(x.row, p(m, '2026-12-15'))).toBe(7000);
    expect(m.amount(x.row, p(m, '2028-03-30'))).toBe(7000);
  });

  it('keeps ended loans ended when the amount changes', () => {
    const adv = find(base, 'Scooter Loan');
    const m = apply(base, planChangeAmount(base, adv, 7000, '2026-11-15'));
    expect(m.amount(adv.row, p(m, '2027-03-15'))).toBe(7000);
    expect(m.amount(adv.row, p(m, '2027-04-15'))).toBe(0);
  });

  it('ends a bill after a payday and records it in Notes', () => {
    const netflix = find(base, 'Netflix sub');
    const m = apply(base, planEnd(base, netflix, '2026-12-30'));
    const n = find(m, 'Netflix sub');
    expect(n.notes).toBe('until Dec 2026');
    expect(m.amount(n.row, p(m, '2026-12-30'))).toBe(495.2);
    expect(m.amount(n.row, p(m, '2027-01-30'))).toBe(0);
    // Replaces an existing "until" rather than stacking another one.
    const adv = find(base, 'Scooter Loan');
    expect(find(apply(base, planEnd(base, adv, '2027-01-15')), 'Scooter Loan').notes).toBe('until Jan 2027');
  });

  it('deletes a row and reports paid history', () => {
    const water = find(base, 'Water Bill');
    expect(paidHistory(base, water, today).map((x) => x.iso)).toEqual(['2026-10-15']);
    const m = apply(base, planDelete(base, water));
    expect(m.items.some((i) => i.name === 'Water Bill')).toBe(false);
    expect(m.items).toHaveLength(base.items.length - 1);
  });

  it('keeps payday totals consistent after an add', () => {
    const m = apply(base, planAdd(base, { type: 'oneTime', name: 'Gift', card: 'Maya Ben', notes: '', paydayIso: '2026-12-15', amount: 2000 }));
    const before = summarize(base, p(base, '2026-12-15'), p(base, '2026-10-30')).plannedTotal;
    expect(summarize(m, p(m, '2026-12-15'), p(m, '2026-10-30')).plannedTotal).toBe(before + 2000);
  });
});

describe('extending the timeline', () => {
  it('continues the 15th / 30th pattern with Feb 28', () => {
    expect(nextPaydayDates(new Date(2028, 2, 30), 4).map(isoDate)).toEqual(['2028-04-15', '2028-04-30', '2028-05-15', '2028-05-30']);
    expect(nextPaydayDates(new Date(2029, 0, 30), 2).map(isoDate)).toEqual(['2029-02-15', '2029-02-28']);
  });

  it('adds 12 payday columns to both tabs with each row keeping its pattern', () => {
    const m = apply(base, planExtend(base, 6));
    expect(m.paydays).toHaveLength(48);
    expect(m.paydays.at(-1)!.iso).toBe('2028-09-30');
    const sep15 = p(m, '2028-09-15');
    const sep30 = p(m, '2028-09-30');
    expect(m.amount(find(m, 'Water Bill').row, sep15)).toBe(400);
    expect(m.amount(find(m, 'Water Bill').row, sep30)).toBe(0);
    expect(m.amount(find(m, 'Meralco').row, sep30)).toBe(5200);
    expect(m.amount(find(m, 'Scooter Loan').row, sep15)).toBe(0); // ended loan stays ended
    expect(m.income[sep15.index]).toBe(102664.4);
    const wealth = m.goals.find((g) => g.id === 'wealth')!;
    expect(wealth.planned[sep30.index]).toBe(33244); // open-ended goal continues
    expect(m.goals.find((g) => g.id === 'house')!.planned[sep30.index]).toBe(0);
  });
});

const ci = (x: Partial<CardInput> & { name: string }): CardInput => ({ limit: null, dueNote: '', statementDay: null, dueDay: null, ...x });

describe('cards', () => {
  const card = (m: Model, name: string) => m.cards.find((c) => c.name === name)!;

  it('adds a card with SUMIF over the bill rows', () => {
    const plan = planAddCard(base, ci({ name: 'Metrobank Ana', limit: 40000, dueNote: 'Every 15th' }));
    const set = plan.ops.find((o) => o.op === 'set' && o.col === 2);
    expect(set).toMatchObject({ input: { kind: 'formula', value: '=SUMIF($D$10:$D$40, A49, $E$10:$E$40)' } });
    const m = apply(base, plan);
    expect(card(m, 'Metrobank Ana')).toMatchObject({ limit: 40000, charged: 0, dueNote: 'Every 15th', utilization: 0 });
    expect(m.cards).toHaveLength(6);
  });

  it('renames a card and moves its bills, and edits limit / due date', () => {
    const ew = card(base, 'EastWest Ben');
    const m = apply(base, planEditCard(base, ew, ci({ name: 'EW Ben', limit: 30000, dueNote: 'Every 15th' })));
    expect(card(m, 'EW Ben')).toMatchObject({ limit: 30000, dueNote: 'Every 15th' });
    expect(find(m, 'HBO sub').card).toBe('EW Ben');
    expect(m.items.some((i) => i.card === 'EastWest Ben')).toBe(false);
  });

  it('only deletes cards with no bills', () => {
    expect(() => planDeleteCard(base, card(base, 'EastWest Ben'))).toThrow(/HBO sub/);
    const added = apply(base, planAddCard(base, ci({ name: 'Spare' })));
    const spare = card(added, 'Spare');
    expect(spare.limit).toBeNull();
    expect(billsOnCard(added, spare)).toHaveLength(0);
    const m = buildModel(applyPlan(planDeleteCard(added, spare), applyPlan(planAddCard(base, ci({ name: 'Spare' })))));
    expect(m.cards.map((c) => c.name)).not.toContain('Spare');
  });

  it('rejects duplicate names', () => {
    expect(() => planAddCard(base, ci({ name: 'maya ben', limit: 1 }))).toThrow(/already/);
  });

  it('adds Statement Day / Due Day columns and derives the payment payday', () => {
    const bpi = card(base, 'BPI Ben');
    expect(base.layout.cardCols.present).toBe(false);
    const m = apply(base, planEditCard(base, bpi, ci({ name: 'BPI Ben', limit: 35000, statementDay: 3, dueDay: 23, dueNote: 'Every 30th' })));
    expect(m.layout.cardCols).toEqual({ statement: 5, due: 6, present: true });
    expect(card(m, 'BPI Ben')).toMatchObject({ statementDay: 3, dueDay: 23, dueNote: '15th Payday' });
    expect(card(m, 'Maya Ben')).toMatchObject({ statementDay: null, dueDay: null, dueNote: '15th / 30th' });
    expect(() => planEditCard(base, bpi, ci({ name: 'BPI Ben', limit: 1, statementDay: 3 }))).toThrow(/both/);
  });

  it('moves bills to other cards, ends one, then deletes the card', () => {
    const bpi = card(base, 'BPI Ben');
    const bills = billsOnCard(base, bpi);
    expect(() => planDeleteCard(base, bpi, [{ item: bills[0], to: 'Maya Ben' }])).toThrow(/Choose where/);
    const moves = bills.map((item) => ({
      item,
      to: item.name === 'Gas' ? 'Bank ADA / Direct Cash' : 'Maya Ben',
      endIso: item.name === 'Gym Ben' ? '2026-11-15' : null,
    }));
    const m = apply(base, planDeleteCard(base, bpi, moves));
    expect(m.cards.map((c) => c.name)).not.toContain('BPI Ben');
    expect(m.items.filter((i) => i.card === 'BPI Ben')).toHaveLength(0);
    expect(find(m, 'Gas').card).toBe('Bank ADA / Direct Cash');
    expect(find(m, 'PLDT').card).toBe('Maya Ben');
    expect(find(m, 'Gym Ben').notes).toBe('until Nov 2026');
    expect(m.amount(find(m, 'Gym Ben').row, p(m, '2026-12-15'))).toBe(0);
  });
});

describe('card cycles', () => {
  it('finds the statement and due date for a charge', () => {
    const c = { ...base.cards[0], statementDay: 20, dueDay: 10 };
    const cy = cycleFor(c, new Date(2026, 10, 15))!;
    expect(isoDate(cy.statement)).toBe('2026-11-20');
    expect(isoDate(cy.due)).toBe('2026-12-10');
    expect(cy.float).toBe(25);
    // Charged the day after closing → next statement, longest float.
    expect(cycleFor(c, new Date(2026, 10, 21))!.float).toBe(50);
    // Short months clamp the day.
    expect(isoDate(cycleFor({ ...c, statementDay: 31, dueDay: 25 }, new Date(2027, 1, 10))!.statement)).toBe('2027-02-28');
    expect(payPayday(10)).toBe('30th Payday');
    expect(payPayday(22)).toBe('15th Payday');
    expect(payPayday(30)).toBe('30th Payday');
  });

  it('ranks cards, picks the best one today and flags bills charged right before the statement', () => {
    const wb = sampleWorkbook();
    let raw = wb;
    let m = base;
    for (const [name, sd, dd] of [['BPI Ben', 14, 4], ['Maya Ben', 16, 6], ['HomeCredit Ana', 1, 21]] as const) {
      const c = m.cards.find((x) => x.name === name)!;
      raw = applyPlan(planEditCard(m, c, ci({ name, limit: c.limit, statementDay: sd, dueDay: dd })), raw);
      m = buildModel(raw);
    }
    // A 15th charge: BPI closes the 14th → lands on next month's statement; Maya closes the 16th → 1 day before.
    const ranked = rankCards(m, [new Date(2026, 10, 15)]);
    expect(ranked.map((o) => o.card.name)).toEqual(['HomeCredit Ana', 'Maya Ben', 'BPI Ben']); // BPI is near its limit
    expect(ranked[2].nearLimit).toBe(true);
    expect(bestCardToday(m, new Date(2026, 10, 3))?.card.name).toBe('HomeCredit Ana');
    const toll = poorAssignment(m, find(m, 'Toll'), today); // Maya, split: Nov 15 is 1 day before the 16th
    expect(toll).toMatchObject({ daysToStatement: 1 });
    expect(poorAssignment(m, find(m, 'Copilot sub'), today)).toBeNull();
  });
});

describe('goals', () => {
  const goal = (m: Model, id: string) => m.goals.find((g) => g.id === id)!;

  it('schedules a fixed amount until the target, with a partial last payday', () => {
    expect(schedulePlan([0, 0, 0, 0, 0], 25000, 10000, 1)).toEqual([0, 10000, 10000, 5000, 0]);
    expect(schedulePlan([7, 7, 0], null, 3, 1)).toEqual([7, 3, 3]);
  });

  it('adds a goal above Wealth in both tabs', () => {
    const plan = planAddGoal(base, { name: 'Car Fund', target: 100000 }, { perPayday: 20000, fromIso: '2026-11-15' });
    const m = apply(base, plan);
    const car = goal(m, 'car-fund');
    expect(car).toMatchObject({ name: 'Car Fund', target: 100000 });
    expect(car.row).toBe(goal(base, 'wealth').row);
    expect(goal(m, 'wealth').row).toBe(goal(base, 'wealth').row! + 1);
    expect(car.planned.slice(0, 8)).toEqual([0, 0, 20000, 20000, 20000, 20000, 20000, 0]);
    // Everything below shifted, but bills still parse.
    expect(find(m, 'Water Bill').row).toBe(find(base, 'Water Bill').row + 1);
    expect(m.items).toHaveLength(base.items.length);
  });

  it('edits name, target and the plan from a payday on', () => {
    const ef = goal(base, 'emergency');
    const plan = planEditGoal(base, ef, { name: 'Emergency Fund', target: 600000 }, { perPayday: 50000, fromIso: '2027-01-15' });
    const m = apply(base, plan);
    const next = goal(m, 'emergency');
    expect(next.target).toBe(600000);
    expect(next.planned[p(m, '2026-12-30').index]).toBe(ef.planned[p(base, '2026-12-30').index]);
    expect(next.planned[p(m, '2027-01-15').index]).toBe(50000);
    expect(next.planned.reduce((a, b) => a + b, 0)).toBeCloseTo(600000, 0);
  });

  it('warns when plans exceed the surplus', () => {
    expect(surplusShortfalls(base, today)).toEqual([]);
    const ef = goal(base, 'emergency');
    const planned = schedulePlan(ef.planned, 600000, 80000, p(base, '2027-01-15').index);
    const over = surplusShortfalls(base, today, { goalId: ef.id, planned });
    expect(over[0].payday.iso).toBe('2027-01-15');
    expect(over[0].over).toBeGreaterThan(0);
  });

  it('deletes a goal from both tabs', () => {
    const m = apply(base, planDeleteGoal(goal(base, 'house')));
    expect(m.goals.some((g) => g.id === 'house')).toBe(false);
    expect(m.goals).toHaveLength(3);
  });
});

describe('goal edits touch only what changed', () => {
  it('keeps Sheet2 names on a target-only edit', () => {
    const base2 = buildModel(sampleWorkbook());
    const ef = base2.goals.find((g) => g.id === 'emergency')!;
    const wb = applyPlan(planEditGoal(base2, ef, { name: ef.name, target: 600000 }));
    expect(wb.goals!.rows[ef.planRow!][1]).toBe('Emergency Fund Allocation');
    expect(wb.goals!.rows[ef.planRow!][2]).toBe('Target 600k');
  });
});

describe('planEditDetails', () => {
  it('renames, edits notes (keeping "until") and moves card without touching amounts', () => {
    const loan = find(base, 'Scooter Loan');
    expect(editableNotes(loan)).toBe('');
    const m = apply(base, planEditDetails(base, loan, { name: 'ADV Loan', notes: 'acct 1234', card: 'BPI Ben', schedule: '15th', monthly: 5520, fromIso: '2026-11-15' }));
    const item = find(m, 'ADV Loan');
    expect(item).toMatchObject({ notes: 'acct 1234 · until Mar 2027', card: 'BPI Ben', row: loan.row });
    expect(m.amount(item.row, p(m, '2027-03-15'))).toBe(5520);
    expect(() => planEditDetails(base, loan, { name: 'Scooter Loan', notes: '', card: loan.card, schedule: '15th', monthly: 5520, fromIso: '2026-11-15' })).toThrow(/Nothing/);
  });

  it('moves a bill to another schedule from a payday on, keeping history and the paid note', () => {
    const wb = sampleWorkbook({ '20,8': 'Paid 2026-10-30 by Ben' }); // PLDT Oct 30
    const m0 = buildModel(wb);
    const pldt = find(m0, 'PLDT');
    const m = buildModel(applyPlan(planEditDetails(m0, pldt, { name: 'PLDT', notes: '', card: pldt.card, schedule: 'split', monthly: 2499, fromIso: '2026-11-15' }), wb));
    const item = find(m, 'PLDT');
    expect(item.schedule).toBe('split');
    expect(item.category).toBe('Equal Split');
    expect(item.row).toBe(m.layout.sectionLast.split);
    expect([item.template15, item.template30]).toEqual([1249.5, 1249.5]);
    expect(m.note(item.row, p(m, '2026-10-30'))).toMatch(/^Paid/);
    expect(m.amount(item.row, p(m, '2026-10-15'))).toBe(0);
    expect(m.amount(item.row, p(m, '2026-11-15'))).toBe(1249.5);
    expect(m.amount(item.row, p(m, '2026-11-30'))).toBe(1249.5);
    // Rows after the old one shift up; the 30th section loses PLDT.
    expect(m.items.filter((i) => i.schedule === '30th').map((i) => i.name)).not.toContain('PLDT');
    expect(find(m, 'Globe Postpaid').row).toBe(pldt.row);
  });

  it('skips months already paid on the new schedule', () => {
    const wb = sampleWorkbook({ '20,10': 'Paid 2026-11-30 by Ben' }); // PLDT Nov 30
    const m0 = buildModel(wb);
    const pldt = find(m0, 'PLDT');
    const m = buildModel(applyPlan(planEditDetails(m0, pldt, { name: 'PLDT', notes: '', card: pldt.card, schedule: '15th', monthly: 2499, fromIso: '2026-11-15' }), wb));
    const item = find(m, 'PLDT');
    expect(m.amount(item.row, p(m, '2026-11-15'))).toBe(0);
    expect(m.amount(item.row, p(m, '2026-12-15'))).toBe(2499);
    expect(m.amount(item.row, p(m, '2026-12-30'))).toBe(0);
  });
});

describe('planEditDetails amount', () => {
  it('changes the amount from a payday together with other details', () => {
    const water = find(base, 'Water Bill');
    const m = apply(base, planEditDetails(base, water, { name: 'Water', notes: '', card: water.card, schedule: '15th', monthly: 650, fromIso: '2026-12-15' }));
    const item = find(m, 'Water');
    expect(item.monthly).toBe(650);
    expect(m.amount(item.row, p(m, '2026-11-15'))).toBe(400);
    expect(m.amount(item.row, p(m, '2026-12-15'))).toBe(650);
  });
});

describe('sinking funds', () => {
  it('adds a fund with a target, records withdrawals and keeps them across a rename', () => {
    let wb = applyPlan(planAddFund(base, { name: 'Car Maint', monthly: 4000, card: 'Bank ADA / Direct Cash', notes: 'PMS + tires', target: 30000, startIso: '2026-10-15', endIso: null }));
    let m = buildModel(wb);
    const fund = find(m, 'Car Maint');
    expect(fund).toMatchObject({ kind: 'fund', schedule: 'fund', template15: 2000, notes: 'Target 30k · PMS + tires' });
    expect(fundTarget(fund)).toBe(30000);
    // Oct 15 and Oct 30 are past and hold the planned amount; mark them paid with notes.
    wb.rolling.notes[fund.row][7] = 'Paid 2026-10-15 by Ben';
    wb.rolling.notes[fund.row][8] = 'Paid 2026-10-30 by Ben';
    m = buildModel(wb);
    const current = m.paydays.find((x) => x.iso === '2026-10-30');
    expect(fundStatus(m, find(m, 'Car Maint'), current)).toMatchObject({ contributed: 4000, balance: 4000 });

    wb = applyPlan(planWithdraw(m, find(m, 'Car Maint'), { amount: 1500, iso: '2026-11-02', note: 'Oil change', by: 'Ben' }), wb);
    m = buildModel(wb);
    expect(m.withdrawals).toEqual([{ row: 1, iso: '2026-11-02', fund: 'Car Maint', amount: 1500, note: 'Oil change', by: 'Ben' }]);
    expect(m.layout.withdrawalsRows).toBe(2);
    expect(fundStatus(m, find(m, 'Car Maint'), current).balance).toBe(2500);

    wb = applyPlan(planWithdraw(m, find(m, 'Car Maint'), { amount: 500, iso: '2026-11-03', note: '', by: 'Ana' }), wb);
    wb = applyPlan(planEditFund(buildModel(wb), find(buildModel(wb), 'Car Maint'), { name: 'Car Fund', monthly: 4000, card: 'Bank ADA / Direct Cash', notes: 'PMS + tires', target: 40000, fromIso: '2026-11-15' }), wb);
    m = buildModel(wb);
    expect(m.withdrawals.map((w) => w.fund)).toEqual(['Car Fund', 'Car Fund']);
    expect(fundTarget(find(m, 'Car Fund'))).toBe(40000);
    expect(fundStatus(m, find(m, 'Car Fund'), current).balance).toBe(2000);

    m = buildModel(applyPlan(planDeleteWithdrawal(m.withdrawals[0]), wb));
    expect(m.withdrawals).toHaveLength(1);
  });
});

describe('card payments', () => {
  it('totals the bills charged in the statement cycle on the pay-from payday', () => {
    const bpi = base.cards.find((c) => c.name === 'BPI Ben')!;
    const m = apply(base, planEditCard(base, bpi, ci({ name: 'BPI Ben', limit: 35000, statementDay: 3, dueDay: 23 })));
    const nov15 = p(m, '2026-11-15');
    const [pay] = cardPayments(m, nov15);
    // Statement Nov 3 covers Oct 15 and Oct 30 charges; due Nov 23, paid from the 15th.
    expect(isoDate(pay.statement)).toBe('2026-11-03');
    expect(isoDate(pay.due)).toBe('2026-11-23');
    expect(pay.bills.every((b) => ['2026-10-15', '2026-10-30'].includes(b.payday.iso))).toBe(true);
    expect(pay.amount).toBe(25914.06); // the Oct 15 water bill was paid at ₱315.66
    expect(cardPayments(m, p(m, '2026-11-30'))).toHaveLength(0);
  });
});

describe('reports', () => {
  it('adds up a month and ranks where the money goes', async () => {
    const { buildReport } = await import('../src/lib/reports');
    const r = buildReport(base, 'month', today); // November 2026
    expect(r.paydays.map((x) => x.iso)).toEqual(['2026-11-15', '2026-11-30']);
    expect(r.income).toBe(205328.8);
    const catTotal = r.categories.reduce((s, c) => s + c.amount, 0);
    expect(Math.round(catTotal)).toBe(Math.round(r.bills + r.saved));
    expect(r.top[0].item.name).toBe('House Mortgage');
    expect(r.loans.map((l) => l.item.name)).toContain('Phone Loan');
    expect(r.left).toBe(Math.round((r.income - r.bills - r.saved) * 100) / 100);
  });
});

describe('income', () => {
  it('parses earners and changes pay from a payday on, pointing Sheet2 at the Income row', async () => {
    const { parseEarners, planChangeIncome, earnersNote } = await import('../src/lib/income');
    const row = base.layout.incomeRow;
    expect(row).toBe(1);
    const earners = parseEarners(base.incomeNote);
    expect(earners).toEqual([{ name: 'Ana', amount: 42800 }, { name: 'Ben', amount: 59864.4 }]);
    expect(earnersNote(earners)).toBe('Ana ₱42,800 + Ben ₱59,864.40');

    const plan = planChangeIncome(base, [{ name: 'Ana', amount: 55000 }, { name: 'Ben', amount: 59864.4 }], '2027-01-15');
    const s2 = plan.ops.find((o) => o.op === 'set' && o.tab === 'goals' && o.col === base.layout.goalsOffset + p(base, '2027-01-15').index);
    expect(s2).toMatchObject({ row: 1, input: { kind: 'formula', value: "='Rolling Execution Plan'!N2-M1" } });
    const m = apply(base, plan);
    expect(m.income[p(m, '2026-12-30').index]).toBe(102664.4);
    expect(m.income[p(m, '2027-01-15').index]).toBe(114864.4);
    expect(m.items.length).toBe(base.items.length);
    // Sheet2 still lines up with the ledger after the change.
    expect(m.layout.goalsOffset).toBe(base.layout.goalsOffset);
  });

  it('adds and removes a one-time extra on a payday', async () => {
    const { planIncomeExtra, incomeExtra } = await import('../src/lib/income');
    const dec15 = p(base, '2026-12-15');
    const wb = applyPlan(planIncomeExtra(base, dec15, 20000, '13th month'));
    let m = buildModel(wb);
    expect(m.income[dec15.index]).toBe(122664.4);
    expect(incomeExtra(m, p(m, '2026-12-15'))).toEqual({ amount: 20000, label: '13th month' });
    m = buildModel(applyPlan(planIncomeExtra(m, p(m, '2026-12-15'), 0, ''), wb));
    expect(m.income[dec15.index]).toBe(102664.4);
    expect(incomeExtra(m, p(m, '2026-12-15'))).toBeNull();
  });
});
