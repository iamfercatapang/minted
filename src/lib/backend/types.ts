import type { RawWorkbook } from '../model';
import type { EditPlan } from '../edits';

/** One cell write in the Rolling Execution Plan tab (0-based row/col). */
export interface CellWrite {
  row: number;
  col: number;
  value: number;
  /** Write this formula instead of the number (used to put the original formula back). */
  formula?: string;
  /** Note to leave on the cell; null clears it. */
  note: string | null;
  /** The formatted value the app last saw, used to detect someone else editing the cell first. */
  expected?: string;
}

/** What the cell held before a write, so it can be restored exactly (including formulas). */
export interface CellSnapshot {
  row: number;
  col: number;
  userEnteredValue: Record<string, unknown> | null;
  note: string | null;
}

export class RowsMovedError extends Error {
  constructor() {
    super("Your plan was changed somewhere else since it loaded. Refresh and try again.");
  }
}

export class ConflictError extends Error {
  constructor(public current: string, public expected: string) {
    super(`This was changed somewhere else (now "${current}"). Refresh to see the latest.`);
  }
}

export interface Backend {
  readonly kind: 'google' | 'demo';
  load(): Promise<RawWorkbook>;
  write(change: CellWrite): Promise<CellSnapshot>;
  restore(snapshot: CellSnapshot): Promise<void>;
  /** Structural edits: add, change, end or delete a bill row. */
  apply(plan: EditPlan): Promise<void>;
}
