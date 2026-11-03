import { GOALS_TAB, ROLLING_TAB, WITHDRAWALS_TAB, toA1, type RawTab, type RawWorkbook } from '../model';
import { parseMoney } from '../money';
import type { GoogleAuth } from './googleAuth';
import { ConflictError, RowsMovedError, type Backend, type CellSnapshot, type CellWrite } from './types';
import type { CellInput, EditPlan, Tab } from '../edits';

/** Column letters only, e.g. 5 → "F". */
const colLetter = (col: number) => toA1(0, col).replace(/\d+$/, '');

function userEntered(input: CellInput, row: number): Record<string, unknown> | undefined {
  switch (input.kind) {
    case 'number':
      return { numberValue: input.value };
    case 'text':
      return { stringValue: input.value };
    case 'ref':
      return { formulaValue: `=$${colLetter(input.col)}${row + 1}` };
    case 'formula':
      return { formulaValue: input.value };
    case 'blank':
      return undefined;
  }
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

interface GridCell {
  formattedValue?: string;
  note?: string;
  userEnteredValue?: Record<string, unknown>;
}
interface GridSheet {
  properties?: { sheetId: number; title: string };
  data?: { startRow?: number; startColumn?: number; rowData?: { values?: GridCell[] }[] }[];
}

const ORIGINAL_PREFIX = 'Original: ';

/** Formula saved in a Paid note by an earlier write, if any. */
export function originalFormula(note: string | undefined | null): string | undefined {
  const line = note?.split('\n').find((l) => l.startsWith(ORIGINAL_PREFIX));
  return line?.slice(ORIGINAL_PREFIX.length).trim() || undefined;
}

const tabTitle = (tab: Tab | undefined) => (tab === 'goals' ? GOALS_TAB : tab === 'withdrawals' ? WITHDRAWALS_TAB : ROLLING_TAB);

export const quote = (title: string) => `'${title.replace(/'/g, "''")}'`;

export class GoogleSheetsBackend implements Backend {
  readonly kind = 'google' as const;
  private gids = new Map<string, number>();

  constructor(private auth: GoogleAuth, private sheetId: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.auth.token();
    const res = await fetch(`${API}/${encodeURIComponent(this.sheetId)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      let message = `Google Sheets error ${res.status}`;
      try {
        const body = await res.json();
        message = body?.error?.message ?? message;
      } catch {
        /* non-JSON body */
      }
      if (/not supported for this document/i.test(message))
        message = 'This file is still an .xlsx. In Google Drive open it and choose File → Save as Google Sheets, then use the new sheet link.';
      else if (res.status === 403) message = "Your Google account doesn't have access to this sheet. Ask for Editor access.";
      else if (res.status === 404) message = 'Sheet not found. Check the sheet link in Settings.';
      throw new Error(message);
    }
    return res.json() as Promise<T>;
  }

  async load(): Promise<RawWorkbook> {
    const meta = await this.call<{ sheets: GridSheet[] }>(`?fields=sheets.properties(sheetId,title)`);
    for (const s of meta.sheets) if (s.properties) this.gids.set(s.properties.title, s.properties.sheetId);
    if (!this.gids.has(ROLLING_TAB)) throw new Error(`The sheet has no "${ROLLING_TAB}" tab.`);

    const titles = [ROLLING_TAB, ...[GOALS_TAB, WITHDRAWALS_TAB].filter((t) => this.gids.has(t))];
    const params = new URLSearchParams({
      includeGridData: 'true',
      fields: 'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(formattedValue,note))))',
    });
    titles.forEach((t) => params.append('ranges', quote(t)));
    const data = await this.call<{ sheets: GridSheet[] }>(`?${params}`);

    const tabs = new Map<string, RawTab>();
    for (const s of data.sheets) {
      if (!s.properties) continue;
      const rows: string[][] = [];
      const notes: (string | undefined)[][] = [];
      const block = s.data?.[0];
      const r0 = block?.startRow ?? 0;
      const c0 = block?.startColumn ?? 0;
      (block?.rowData ?? []).forEach((row, ri) => {
        const vals = row.values ?? [];
        const r = r0 + ri;
        rows[r] = [];
        notes[r] = [];
        vals.forEach((v, ci) => {
          rows[r][c0 + ci] = v.formattedValue ?? '';
          if (v.note) notes[r][c0 + ci] = v.note;
        });
      });
      for (let i = 0; i < rows.length; i++) rows[i] = Array.from(rows[i] ?? [], (v) => v ?? '');
      tabs.set(s.properties.title, { title: s.properties.title, gid: s.properties.sheetId, rows, notes });
    }
    return { rolling: tabs.get(ROLLING_TAB)!, goals: tabs.get(GOALS_TAB), withdrawals: tabs.get(WITHDRAWALS_TAB) };
  }

  private async readCell(row: number, col: number): Promise<GridCell> {
    const params = new URLSearchParams({
      includeGridData: 'true',
      ranges: `${quote(ROLLING_TAB)}!${toA1(row, col)}`,
      fields: 'sheets(data(rowData(values(formattedValue,userEnteredValue,note))))',
    });
    const data = await this.call<{ sheets: GridSheet[] }>(`?${params}`);
    return data.sheets[0]?.data?.[0]?.rowData?.[0]?.values?.[0] ?? {};
  }

  private async updateCell(row: number, col: number, cell: { userEnteredValue?: unknown; note?: string }) {
    const sheetId = this.gids.get(ROLLING_TAB);
    if (sheetId === undefined) throw new Error('Load the sheet before writing.');
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateCells: {
              start: { sheetId, rowIndex: row, columnIndex: col },
              rows: [{ values: [cell] }],
              fields: 'userEnteredValue,note',
            },
          },
        ],
      }),
    });
  }

  async write(change: CellWrite): Promise<CellSnapshot> {
    const before = await this.readCell(change.row, change.col);
    if (change.expected !== undefined) {
      const now = parseMoney(before.formattedValue ?? '') ?? 0;
      const was = parseMoney(change.expected) ?? 0;
      if (Math.abs(now - was) > 0.004) throw new ConflictError(before.formattedValue ?? '', change.expected);
    }
    // Overwriting replaces the cell's formula; keep it in the Paid note so "Mark as not paid" can put it back.
    const formula = before.userEnteredValue?.formulaValue;
    const priorFormula = typeof formula === 'string' ? formula : originalFormula(before.note);
    const note = change.note && priorFormula ? `${change.note}\n${ORIGINAL_PREFIX}${priorFormula}` : change.note;
    await this.updateCell(change.row, change.col, {
      userEnteredValue: change.formula ? { formulaValue: change.formula } : { numberValue: change.value },
      ...(note ? { note } : {}),
    });
    return {
      row: change.row,
      col: change.col,
      userEnteredValue: before.userEnteredValue ?? null,
      note: before.note ?? null,
    };
  }

  async restore(s: CellSnapshot): Promise<void> {
    await this.updateCell(s.row, s.col, {
      ...(s.userEnteredValue ? { userEnteredValue: s.userEnteredValue } : {}),
      ...(s.note ? { note: s.note } : {}),
    });
  }

  async apply(plan: EditPlan): Promise<void> {
    const sheetIdFor = (tab: Tab | undefined) => {
      const id = this.gids.get(tabTitle(tab));
      if (id === undefined) throw new Error(`Load the sheet before editing (missing ${tabTitle(tab)}).`);
      return id;
    };
    // New tabs get their id up front so later requests in the same batch can address them.
    for (const o of plan.ops)
      if (o.op === 'addTab' && !this.gids.has(tabTitle(o.tab))) this.gids.set(tabTitle(o.tab), 100000 + Math.floor(Math.random() * 900000));
    // Rows are addressed by index, so make sure nobody inserted or removed rows since we loaded.
    if (plan.guards.length) {
      // values:batchGet answers in request order, unlike grid data which groups by sheet.
      const params = new URLSearchParams();
      for (const g of plan.guards) params.append('ranges', `${quote(tabTitle(g.tab))}!${toA1(g.row, g.col)}`);
      const data = await this.call<{ valueRanges: { values?: string[][] }[] }>(`/values:batchGet?${params}`);
      const values = data.valueRanges.map((v) => v.values?.[0]?.[0] ?? '');
      if (plan.guards.some((g, i) => (values[i] ?? '').trim() !== g.expect.trim())) throw new RowsMovedError();
    }

    const requests = plan.ops.map((o) => {
      const sheetId = sheetIdFor(o.tab);
      switch (o.op) {
        case 'insertRow':
          return {
            insertDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: o.at, endIndex: o.at + 1 },
              inheritFromBefore: o.at > 0,
            },
          };
        case 'deleteRow':
          return { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: o.row, endIndex: o.row + 1 } } };
        case 'note':
          return {
            updateCells: {
              start: { sheetId, rowIndex: o.row, columnIndex: o.col },
              rows: [{ values: [{ note: o.note }] }],
              fields: 'note',
            },
          };
        case 'addTab':
          return { addSheet: { properties: { sheetId, title: tabTitle(o.tab) } } };
        case 'moveRow':
          return {
            moveDimension: {
              source: { sheetId, dimension: 'ROWS', startIndex: o.from, endIndex: o.from + 1 },
              destinationIndex: o.to,
            },
          };
        case 'appendCols':
          return { appendDimension: { sheetId, dimension: 'COLUMNS', length: o.count } };
        case 'copyCols': {
          const range = (cols: [number, number]) => ({
            sheetId,
            startRowIndex: o.rows[0],
            endRowIndex: o.rows[1],
            startColumnIndex: cols[0],
            endColumnIndex: cols[1],
          });
          // A destination wider than the source repeats the source pattern across it.
          return { copyPaste: { source: range(o.src), destination: range(o.dst), pasteType: 'PASTE_NORMAL' } };
        }
        case 'set': {
          const value = userEntered(o.input, o.row);
          return {
            updateCells: {
              start: { sheetId, rowIndex: o.row, columnIndex: o.col },
              rows: [{ values: [value ? { userEnteredValue: value } : {}] }],
              fields: 'userEnteredValue',
            },
          };
        }
      }
    });
    await this.call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) });
  }
}
