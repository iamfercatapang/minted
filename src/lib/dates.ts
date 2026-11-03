const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Local-date ISO key (YYYY-MM-DD) without timezone drift. */
export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parses payday column headers. Accepts the sheet's "Oct 15-2026" style plus a few
 * formats Google Sheets may produce after conversion ("Oct 15, 2026", "10/15/2026", "2026-10-15").
 */
export function parsePaydayHeader(raw: string): Date | null {
  const s = raw.trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[-,/ ]\s*(\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month >= 0) return new Date(Number(m[3]), month, Number(m[2]));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}

const shortFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' });
const longFmt = new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
const monthYearFmt = new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric' });

export const formatShort = (d: Date) => shortFmt.format(d);
export const formatLong = (d: Date) => longFmt.format(d);
export const formatMonthYear = (d: Date) => monthYearFmt.format(d);

export function daysBetween(a: Date, b: Date): number {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() -
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86_400_000);
}
