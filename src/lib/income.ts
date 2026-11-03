import { formatShort } from './dates';
import type { EditPlan, SheetOp } from './edits';
import { formatPHP, parseMoney, round2 } from './money';
import { ROLLING_TAB, toA1, type Model, type Payday } from './model';

export interface Earner {
  name: string;
  /** Pay per payday. */
  amount: number;
}

const EARNER = /([^+₱\d]+?)\s*₱\s*([\d,]+(?:\.\d+)?)/g;
const EXTRA = /^\s*Extra\s*\+?₱\s*([\d,]+(?:\.\d+)?)\s*(?:·\s*(.*))?$/i;
const letter = (col: number) => toA1(0, col).replace(/\d+$/, '');

/** "Ana ₱42,800 + Ben ₱59,864.40" → earners. */
export function parseEarners(note: string): Earner[] {
  return [...note.matchAll(EARNER)].map((m) => ({ name: m[1].replace(/^[\s+]+|\s+$/g, ''), amount: parseMoney(m[2]) ?? 0 }));
}

/** ₱42,800 for whole amounts, ₱59,864.40 otherwise, as the sheet's note writes them. */
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const earnersNote = (earners: Earner[]) => earners.map((e) => `${e.name.trim()} ${peso(round2(e.amount))}`).join(' + ');

/** A one-time extra on a payday's income cell, kept in its note: "Extra ₱10,000 · 13th month". */
export function incomeExtra(model: Model, payday: Payday): { amount: number; label: string } | null {
  const row = model.layout.incomeRow;
  if (row < 0) return null;
  const m = EXTRA.exec(model.note(row, payday) ?? '');
  return m ? { amount: parseMoney(m[1]) ?? 0, label: (m[2] ?? '').trim() } : null;
}

/** Regular pay per payday (the 15th / 30th template cells). */
export const basePay = (model: Model, half: 15 | 30) =>
  model.layout.incomeRow < 0 ? 0 : model.amount(model.layout.incomeRow, { col: half === 15 ? model.layout.cols.t15 : model.layout.cols.t30 } as Payday);

function incomeFormula(model: Model) {
  const r = model.layout.incomeRow + 1;
  const { t15, t30 } = model.layout.cols;
  return `=IF(MOD(COLUMN(),2)=0, $${letter(t15)}${r}, $${letter(t30)}${r})`;
}

/**
 * Sheet2's surplus row for a payday: the ledger's income for that payday minus Sheet2's own total expenses. The
 * sheet had the income typed in (e.g. =102664.4-E1), so it now points at the Income row instead.
 */
function goalsSurplusOp(model: Model, p: Payday, income: number): SheetOp[] {
  const { goalsSummary, goalsOffset, incomeRow } = model.layout;
  if (!goalsSummary) return [];
  const col = goalsOffset + p.index;
  const value = `='${ROLLING_TAB}'!${letter(p.col)}${incomeRow + 1}-${letter(col)}${goalsSummary.expenses + 1}`;
  const preview = formatPHP(round2(income - (model.goalsExpenses[p.index] ?? 0)));
  return [{ op: 'set', tab: 'goals', row: goalsSummary.surplus, col, input: { kind: 'formula', value, preview } }];
}

function guard(model: Model) {
  return { row: model.layout.incomeRow, col: model.layout.cols.category, expect: 'Income' };
}

/**
 * New regular pay from a payday on. Earlier paydays keep what they show now; later ones read the 15th / 30th cells
 * again (keeping any one-time extra on top), and the earners note is rewritten.
 */
export function planChangeIncome(model: Model, earners: Earner[], fromIso: string): EditPlan {
  const { incomeRow: row, cols } = model.layout;
  if (row < 0) throw new Error('Couldn\'t find the Income row.');
  const list = earners.filter((e) => e.name.trim() || e.amount);
  if (!list.length) throw new Error('Add at least one earner.');
  if (list.some((e) => !e.name.trim())) throw new Error('Give each earner a name.');
  if (list.some((e) => !(e.amount >= 0))) throw new Error('Enter each earner\'s pay.');
  const from = model.paydays.find((p) => p.iso === fromIso);
  if (!from) throw new Error(`Payday ${fromIso} is not in the plan.`);
  const total = round2(list.reduce((s, e) => s + e.amount, 0));
  if (!(total > 0)) throw new Error('Income must be above ₱0.');

  const ops: SheetOp[] = [
    { op: 'set', row, col: cols.notes, input: { kind: 'text', value: earnersNote(list) } },
    { op: 'set', row, col: cols.monthly, input: { kind: 'number', value: round2(total * 2) } },
    { op: 'set', row, col: cols.t15, input: { kind: 'number', value: total } },
    { op: 'set', row, col: cols.t30, input: { kind: 'number', value: total } },
  ];
  for (const p of model.paydays) {
    if (p.index < from.index) {
      ops.push({ op: 'set', row, col: p.col, input: { kind: 'number', value: model.amount(row, p) } });
      continue;
    }
    const extra = incomeExtra(model, p);
    ops.push(
      extra
        ? { op: 'set', row, col: p.col, input: { kind: 'number', value: round2(total + extra.amount) } }
        : { op: 'set', row, col: p.col, input: { kind: 'formula', value: incomeFormula(model), preview: formatPHP(total) } },
    );
    ops.push(...goalsSurplusOp(model, p, total + (extra?.amount ?? 0)));
  }
  const was = model.income[from.index] - (incomeExtra(model, from)?.amount ?? 0);
  return {
    ops,
    guards: [guard(model)],
    summary: `Income is now ${formatPHP(total)} a payday from ${formatShort(from.date)}${was ? ` (was ${formatPHP(was)})` : ''}`,
  };
}

/** Adds (or with amount 0, removes) a one-time extra such as a bonus on one payday. */
export function planIncomeExtra(model: Model, payday: Payday, amount: number, label: string): EditPlan {
  const row = model.layout.incomeRow;
  if (row < 0) throw new Error('Couldn\'t find the Income row.');
  if (!(amount >= 0)) throw new Error('Enter the extra amount.');
  const base = round2(model.income[payday.index] - (incomeExtra(model, payday)?.amount ?? 0));
  const ops: SheetOp[] = amount
    ? [
        { op: 'set', row, col: payday.col, input: { kind: 'number', value: round2(base + amount) } },
        { op: 'note', row, col: payday.col, note: [`Extra ${peso(round2(amount))}`, label.trim()].filter(Boolean).join(' · ') },
      ]
    : [
        // Back to the regular formula, unless this payday was frozen at an older amount by a pay change.
        base === basePay(model, payday.half)
          ? { op: 'set', row, col: payday.col, input: { kind: 'formula', value: incomeFormula(model), preview: formatPHP(base) } }
          : { op: 'set', row, col: payday.col, input: { kind: 'number', value: base } },
        { op: 'note', row, col: payday.col, note: '' },
      ];
  ops.push(...goalsSurplusOp(model, payday, base + amount));
  return {
    ops,
    guards: [guard(model)],
    summary: amount
      ? `Added ${formatPHP(amount)}${label.trim() ? ` (${label.trim()})` : ''} to ${formatShort(payday.date)} income`
      : `Removed the extra from ${formatShort(payday.date)} income`,
  };
}
