const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const phpWhole = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });

/** Parses sheet strings like "₱ 1,234.56", "₱10,000.00", "(500)", "92.85%" into numbers. Blank/N/A → null. */
export function parseMoney(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || /^n\/?a$/i.test(s) || s === '-') return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[₱\s]/g, ''));
  const digits = s.replace(/[^0-9.]/g, '');
  if (!digits || digits === '.') return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** "Target ~186k", "Goal: ₱700k", "Target 1.2M" → 186000 / 700000 / 1200000 */
export function parseTarget(input: string | undefined): number | null {
  if (!input) return null;
  const m = input.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!m) return null;
  const mult = m[2] ? (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1;
  return Number(m[1]) * mult;
}

export const formatPHP = (n: number) => php.format(n);
export const formatPHPWhole = (n: number) => phpWhole.format(n);

/** Compact form for tight tiles: ₱186k, ₱1.2M */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `₱${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `₱${Math.round(n / 1_000)}k`;
  return formatPHPWhole(n);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
