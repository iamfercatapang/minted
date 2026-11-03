import { formatPHP } from '../money';
import type { RawWorkbook } from '../model';
import { applyToGrid, type EditPlan, type Grid, type Tab } from '../edits';
import { RowsMovedError, type Backend, type CellSnapshot, type CellWrite } from './types';

const KEY = 'ledger.demo.grids';

type Sample = { rolling: string[][]; sheet2: string[][] };
type StoredTab = { rows: string[][]; notes: (string | null)[][] };
type Stored = Record<'rolling' | 'goals', StoredTab> & { withdrawals?: StoredTab; spending?: StoredTab; cardPayments?: StoredTab };

let sample: Sample = { rolling: [], sheet2: [] };

/** The snapshot holds real household figures, so it only exists in dev builds (never on GitHub Pages). */
async function loadSample(): Promise<Sample> {
  if (import.meta.env.DEV && !sample.rolling.length) sample = (await import('../../data/sample.json')).default as Sample;
  if (!sample.rolling.length) throw new Error('Sample data is only available when running locally.');
  return sample;
}

function readStored(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s?.rolling && s?.goals ? s : null;
  } catch {
    return null;
  }
}

const toGrid = (s: StoredTab): Grid => ({ rows: s.rows.map((r) => [...r]), notes: s.notes.map((r) => r.map((n) => n ?? undefined)) });
const fromGrid = (g: Grid): StoredTab => ({ rows: g.rows, notes: g.notes.map((r) => r.map((n) => n ?? null)) });

/** Sample data captured from the household sheet; the edited grids stay on this device. */
export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;
  private stored: Stored | null = readStored();

  private async state(): Promise<Stored> {
    await loadSample();
    this.stored ??= {
      rolling: { rows: sample.rolling.map((r) => [...r]), notes: sample.rolling.map(() => []) },
      goals: { rows: sample.sheet2.map((r) => [...r]), notes: sample.sheet2.map(() => []) },
    };
    return this.stored;
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.stored));
    } catch {
      /* demo only: edits stay in memory for this tab */
    }
  }

  async load(): Promise<RawWorkbook> {
    const s = await this.state();
    const rolling = toGrid(s.rolling);
    const goals = toGrid(s.goals);
    return {
      rolling: { title: 'Rolling Execution Plan', gid: 0, ...rolling },
      goals: { title: 'Sheet2', gid: 1, ...goals },
      withdrawals: s.withdrawals ? { title: 'Fund Withdrawals', gid: 2, ...toGrid(s.withdrawals) } : undefined,
      spending: s.spending ? { title: 'Spending Log', gid: 3, ...toGrid(s.spending) } : undefined,
      cardPayments: s.cardPayments ? { title: 'Card Payments', gid: 4, ...toGrid(s.cardPayments) } : undefined,
    };
  }

  async write(change: CellWrite): Promise<CellSnapshot> {
    await new Promise((r) => setTimeout(r, 250));
    const g = (await this.state()).rolling;
    const snapshot: CellSnapshot = {
      row: change.row,
      col: change.col,
      userEnteredValue: { stringValue: g.rows[change.row]?.[change.col] ?? '' },
      note: g.notes[change.row]?.[change.col] ?? null,
    };
    (g.rows[change.row] ??= [])[change.col] = formatPHP(change.value);
    (g.notes[change.row] ??= [])[change.col] = change.note;
    this.save();
    return snapshot;
  }

  async restore(s: CellSnapshot): Promise<void> {
    const g = (await this.state()).rolling;
    (g.rows[s.row] ??= [])[s.col] = String(s.userEnteredValue?.stringValue ?? '');
    (g.notes[s.row] ??= [])[s.col] = s.note;
    this.save();
  }

  async apply(plan: EditPlan): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
    const s = await this.state();
    for (const g of plan.guards) {
      const tab = s[g.tab ?? 'rolling'];
      if ((tab?.rows[g.row]?.[g.col] ?? '').trim() !== g.expect.trim()) throw new RowsMovedError();
    }
    const grids = { rolling: toGrid(s.rolling), goals: toGrid(s.goals) } as Record<Tab, Grid>;
    if (s.withdrawals) grids.withdrawals = toGrid(s.withdrawals);
    if (s.spending) grids.spending = toGrid(s.spending);
    if (s.cardPayments) grids.cardPayments = toGrid(s.cardPayments);
    const next = applyToGrid(grids, plan.ops);
    this.stored = { rolling: fromGrid(next.rolling), goals: fromGrid(next.goals), ...(next.withdrawals ? { withdrawals: fromGrid(next.withdrawals) } : {}),
      ...(next.spending ? { spending: fromGrid(next.spending) } : {}),
      ...(next.cardPayments ? { cardPayments: fromGrid(next.cardPayments) } : {}),
    };
    this.save();
  }

  reset() {
    this.stored = null;
    try {
      for (const k of [KEY, 'ledger.demo.grid', 'ledger.demo.edits']) localStorage.removeItem(k);
    } catch {
      /* nothing stored */
    }
  }
}
