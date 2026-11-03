import sample from '../src/data/sample.json';
import type { RawWorkbook } from '../src/lib/model';

/** The captured sheet as the Sheets API would return it, with optional notes injected. */
export function sampleWorkbook(notes: Record<string, string> = {}): RawWorkbook {
  const rows = sample.rolling as string[][];
  const noteGrid: (string | undefined)[][] = rows.map((r) => r.map(() => undefined));
  for (const [key, text] of Object.entries(notes)) {
    const [r, c] = key.split(',').map(Number);
    (noteGrid[r] ??= [])[c] = text;
  }
  return {
    rolling: { title: 'Rolling Execution Plan', gid: 127318224, rows, notes: noteGrid },
    goals: { title: 'Sheet2', gid: 819251395, rows: sample.sheet2 as string[][], notes: [] },
  };
}
