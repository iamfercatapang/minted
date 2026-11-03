import type { LineItem } from './model';

export const CATEGORIES = [
  'Loans',
  'Utilities',
  'Subscriptions',
  'Household',
  'Transport',
  'Family & allowances',
  'Health & insurance',
  'Savings & funds',
  'Other',
] as const;

const RULES: [RegExp, string][] = [
  [/loan|mortgage|paylater|amorti/i, 'Loans'],
  [/sub\b|subscription|netflix|youtube|\byt\b|hbo|spotify|disney|copilot|claude|google/i, 'Subscriptions'],
  [/water|meralco|electric|pldt|globe|smart|postpaid|internet|wifi|hoa|bills?\b/i, 'Utilities'],
  [/grocer|cat\b|pet|essentials|household|market/i, 'Household'],
  [/\bgas\b|fuel|toll|grab|parking|transport/i, 'Transport'],
  [/allowance|handog|family|parents/i, 'Family & allowances'],
  [/gym|insurance|health|medical|hmo/i, 'Health & insurance'],
  [/fund|sinking|saving/i, 'Savings & funds'],
];

/** Best guess from the bill's name; sinking funds are always savings. */
export function guessCategory(name: string, kind?: LineItem['kind']): string {
  if (kind === 'fund') return 'Savings & funds';
  return RULES.find(([re]) => re.test(name))?.[1] ?? 'Other';
}

const TYPE_NOTE = /^\s*Type:\s*(.+?)\s*$/im;

/** A category set by hand is kept as a "Type: …" note on the bill's name cell. */
export const typeFromNote = (note: string | undefined) => (note ? TYPE_NOTE.exec(note)?.[1] ?? null : null);
export const typeNote = (type: string) => `Type: ${type}`;
