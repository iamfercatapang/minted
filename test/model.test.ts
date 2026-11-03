import { describe, expect, it } from 'vitest';
import { buildModel, cellState, currentPayday, goalProgress, nextPayday, summarize, toA1 } from '../src/lib/model';
import { parseMoney, parseTarget } from '../src/lib/money';
import { parsePaydayHeader } from '../src/lib/dates';
import { sampleWorkbook } from './sample';

const today = new Date(2026, 10, 3); // Nov 3, 2026

describe('money + dates', () => {
  it('parses sheet currency strings', () => {
    expect(parseMoney('₱ 1,234.56')).toBe(1234.56);
    expect(parseMoney('₱10,000.00')).toBe(10000);
    expect(parseMoney('N/A')).toBeNull();
    expect(parseMoney('92.85%')).toBe(92.85);
    expect(parseTarget('Target ~186k')).toBe(186000);
    expect(parseTarget('Goal: ₱700k')).toBe(700000);
  });
  it('parses payday headers', () => {
    expect(parsePaydayHeader('Oct 15-2026')).toEqual(new Date(2026, 9, 15));
    expect(parsePaydayHeader('Feb 28-2027')).toEqual(new Date(2027, 1, 28));
    expect(parsePaydayHeader('Oct 15, 2026')).toEqual(new Date(2026, 9, 15));
    expect(parsePaydayHeader('15th Payday')).toBeNull();
  });
  it('builds A1 refs', () => {
    expect(toA1(9, 7)).toBe('H10');
    expect(toA1(0, 26)).toBe('AA1');
  });
});

describe('Rolling Execution Plan model', () => {
  const model = buildModel(sampleWorkbook());

  it('finds all payday columns', () => {
    expect(model.paydays).toHaveLength(36);
    expect(model.paydays[0]).toMatchObject({ iso: '2026-10-15', half: 15, col: 7 });
    expect(model.paydays.at(-1)!.iso).toBe('2028-03-30');
    expect(model.paydays.find((p) => p.iso === '2027-02-28')!.half).toBe(30);
  });

  it('reads bills and funds by section', () => {
    expect(model.items.filter((i) => i.kind === 'bill')).toHaveLength(28);
    expect(model.items.filter((i) => i.kind === 'fund').map((i) => i.name)).toEqual([
      'Leisure Fund', 'Life Insurance', 'Sinking Fund / Maint / Unplanned',
    ]);
    const meralco = model.items.find((i) => i.name === 'Meralco')!;
    expect(meralco).toMatchObject({ schedule: 'split', card: 'Maya Ben', monthly: 10400, template15: 5200, row: 28 });
  });

  it('reads income, summary and card table', () => {
    expect(model.income[0]).toBe(102664.4);
    expect(model.totalExpenses[0]).toBe(65055.26);
    expect(model.surplus[0]).toBe(37609.14);
    expect(model.cards.map((c) => c.name)).toEqual([
      'BPI Ben', 'HomeCredit Ana', 'EastWest Ben', 'Maya Ben', 'Bank ADA / Direct Cash',
    ]);
    expect(model.cards[0]).toMatchObject({ limit: 28000, charged: 25998.4, utilization: 0.9285 });
    expect(model.cards[4].limit).toBeNull();
  });

  it('treats an overwritten actual amount as paid', () => {
    const current = currentPayday(model, today)!;
    expect(current.iso).toBe('2026-10-30');
    expect(nextPayday(model, today)!.iso).toBe('2026-11-15');
    const water = model.items.find((i) => i.name === 'Water Bill')!;
    const oct15 = model.paydays[0];
    expect(cellState(model, water, oct15, current)).toMatchObject({ status: 'paid', amount: 315.66, planned: 400 });
    expect(cellState(model, water, model.paydays[1], current).status).toBe('not-due');
    expect(cellState(model, water, model.paydays[2], current).status).toBe('upcoming');
    const smart = model.items.find((i) => i.name === 'Smart Postpaid')!;
    expect(cellState(model, smart, oct15, current).status).toBe('due');
  });

  it('honours a Paid note when actual equals planned', () => {
    const smartRow = 10;
    const m = buildModel(sampleWorkbook({ [`${smartRow},7`]: 'Paid 2026-10-15 by Ana' }));
    const smart = m.items.find((i) => i.name === 'Smart Postpaid')!;
    expect(smart.row).toBe(smartRow);
    expect(cellState(m, smart, m.paydays[0], m.paydays[1]).status).toBe('paid');
  });

  it('does not treat future plan changes as payments', () => {
    const adv = model.items.find((i) => i.name === 'Scooter Loan')!;
    const apr = model.paydays.find((p) => p.iso === '2027-04-15')!;
    expect(cellState(model, adv, apr, currentPayday(model, today)).status).toBe('not-due');
  });

  it('summarizes a payday', () => {
    const s = summarize(model, model.paydays[0], currentPayday(model, today));
    expect(s.paidCount).toBe(1);
    expect(s.paidTotal).toBe(315.66);
    expect(s.plannedTotal).toBe(65055.26); // matches the sheet's own Total Expenses for Oct 15
  });
});

describe('goals', () => {
  const model = buildModel(sampleWorkbook());
  const byId = Object.fromEntries(model.goals.map((g) => [g.id, g]));

  it('merges Sheet2 targets and allocations with ledger rows', () => {
    expect(Object.keys(byId).sort()).toEqual(['debt', 'emergency', 'house', 'wealth']);
    expect(byId.debt.target).toBe(148800);
    expect(byId.emergency.target).toBe(400000);
    expect(byId.house.target).toBe(560000);
    expect(byId.wealth.target).toBeNull();
    expect(byId.debt.planned[0]).toBe(37524.8);
    expect(byId.debt.planned.reduce((a, b) => a + b, 0)).toBe(148800);
    expect(byId.emergency.row).toBe(5);
  });

  it('projects completion from the plan', () => {
    const p = goalProgress(model, byId.debt, currentPayday(model, today));
    expect(p.saved).toBe(0);
    expect(p.projectedDone?.iso).toBe('2026-11-30');
    const ef = goalProgress(model, byId.emergency, currentPayday(model, today));
    expect(ef.plannedTotal).toBeCloseTo(400000, 0);
  });
});
