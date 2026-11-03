import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuth, type GoogleAuth } from './lib/backend/googleAuth';
import { GoogleSheetsBackend, originalFormula } from './lib/backend/googleSheets';
import { DemoBackend } from './lib/backend/demo';
import type { Backend, CellSnapshot, CellWrite } from './lib/backend/types';
import type { EditPlan } from './lib/edits';
import { buildModel, type CellState, type Model, type RawWorkbook } from './lib/model';
import { formatPHP } from './lib/money';
import { isoDate } from './lib/dates';

export interface Settings {
  clientId: string;
  sheetId: string;
  payer: string;
  theme: 'system' | 'dark' | 'light';
  mode: 'google' | 'demo' | null;
}

const SETTINGS_KEY = 'ledger.settings';
const QUEUE_KEY = 'ledger.queue';

/** Accepts a full Google Sheets URL or a bare ID. */
export function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return (m ? m[1] : input).trim();
}

function loadSettings(): Settings {
  const defaults: Settings = {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
    sheetId: import.meta.env.VITE_SHEET_ID ?? '',
    payer: '',
    theme: 'system',
    mode: null,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { ...defaults, ...saved, clientId: saved.clientId || defaults.clientId, sheetId: saved.sheetId || defaults.sheetId };
  } catch {
    return defaults;
  }
}

function readQueue(): CellWrite[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function saveQueue(q: CellWrite[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* queue stays in memory */
  }
}

const isNetworkError = (e: unknown) => e instanceof TypeError || !navigator.onLine;

interface LedgerCtx {
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  auth: GoogleAuth | null;
  signedIn: boolean;
  backend: Backend | null;
  model: Model | undefined;
  error: Error | null;
  loading: boolean;
  fetching: boolean;
  refresh(): void;
  /** Writes the actual amount (and a Paid note) into the payday cell. Returns an undo function. */
  markPaid(cell: CellState, amount: number): Promise<() => Promise<void>>;
  /** Puts the planned amount back and clears the note. */
  markUnpaid(cell: CellState): Promise<void>;
  /** Adds, changes, ends or deletes a bill row, then reloads the sheet. Needs a connection. */
  applyPlan(plan: EditPlan): Promise<void>;
  queued: number;
  online: boolean;
}

const Ctx = createContext<LedgerCtx | null>(null);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: true } },
});

function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
}

function LedgerProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);
  const [queue, setQueue] = useState(readQueue);
  const online = useOnline();
  const refetchTimer = useRef<number>();
  const qc = useQueryClient();

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* settings apply for this session only */
      }
      return next;
    });
  }, []);

  const auth = useMemo(() => (settings.clientId ? getAuth(settings.clientId) : null), [settings.clientId]);
  const signedIn = useSyncExternalStore(
    (cb) => auth?.subscribe(cb) ?? (() => {}),
    () => auth?.signedIn ?? false,
  );

  const backend = useMemo<Backend | null>(() => {
    if (settings.mode === 'demo') return new DemoBackend();
    if (settings.mode === 'google' && auth && settings.sheetId && signedIn) return new GoogleSheetsBackend(auth, settings.sheetId);
    return null;
  }, [settings.mode, settings.sheetId, auth, signedIn]);

  const queryKey = useMemo(() => ['workbook', settings.mode, settings.sheetId], [settings.mode, settings.sheetId]);
  const query = useQuery({
    queryKey,
    queryFn: () => backend!.load(),
    enabled: !!backend,
  });

  const patchCache = useCallback(
    (row: number, col: number, display: string, note: string | null) => {
      qc.setQueryData<RawWorkbook>(queryKey, (wb) => {
        if (!wb) return wb;
        const rows = wb.rolling.rows.map((r) => r);
        const notes = wb.rolling.notes.map((r) => r);
        rows[row] = [...(rows[row] ?? [])];
        rows[row][col] = display;
        notes[row] = [...(notes[row] ?? [])];
        notes[row][col] = note ?? undefined;
        return { ...wb, rolling: { ...wb.rolling, rows, notes } };
      });
    },
    [qc, queryKey],
  );

  const enqueue = useCallback((w: CellWrite) => {
    setQueue((q) => {
      const next = [...q.filter((x) => !(x.row === w.row && x.col === w.col)), w];
      saveQueue(next);
      return next;
    });
  }, []);

  // Replay writes made while offline once we're back.
  useEffect(() => {
    if (!online || !backend || !queue.length) return;
    let cancelled = false;
    (async () => {
      const remaining: CellWrite[] = [];
      for (const w of queue) {
        try {
          await backend.write({ ...w, expected: undefined });
        } catch (e) {
          if (isNetworkError(e)) remaining.push(w);
        }
      }
      if (cancelled) return;
      saveQueue(remaining);
      setQueue(remaining);
      qc.invalidateQueries({ queryKey });
    })();
    return () => {
      cancelled = true;
    };
  }, [online, backend, queue, qc, queryKey]);

  const write = useCallback(
    async (w: CellWrite): Promise<CellSnapshot | null> => {
      if (!backend) throw new Error('Not connected to a Google Sheet.');
      const prevDisplay = query.data?.rolling.rows[w.row]?.[w.col] ?? '';
      const prevNote = query.data?.rolling.notes[w.row]?.[w.col] ?? null;
      patchCache(w.row, w.col, formatPHP(w.value), w.note);
      try {
        const snapshot = await backend.write(w);
        // Pull the sheet's recalculated totals once a burst of writes settles.
        if (backend.kind === 'google') {
          window.clearTimeout(refetchTimer.current);
          refetchTimer.current = window.setTimeout(() => qc.invalidateQueries({ queryKey }), 1500);
        }
        return snapshot;
      } catch (e) {
        if (isNetworkError(e)) {
          enqueue(w);
          return null;
        }
        patchCache(w.row, w.col, prevDisplay, prevNote);
        throw e;
      }
    },
    [backend, query.data, patchCache, enqueue, qc, queryKey],
  );

  const markPaid = useCallback(
    async (cell: CellState, amount: number) => {
      const who = settings.payer || (backend?.kind === 'demo' ? 'demo' : auth?.user?.name || 'app');
      const note = `Paid ${isoDate(new Date())} by ${who}`;
      const prevDisplay = query.data?.rolling.rows[cell.item.row]?.[cell.payday.col] ?? '';
      const snapshot = await write({
        row: cell.item.row,
        col: cell.payday.col,
        value: amount,
        note,
        expected: prevDisplay,
      });
      return async () => {
        if (snapshot && backend) {
          patchCache(snapshot.row, snapshot.col, prevDisplay, snapshot.note);
          await backend.restore(snapshot);
          qc.invalidateQueries({ queryKey });
        } else {
          // Write was queued offline: just drop it.
          setQueue((q) => {
            const next = q.filter((x) => !(x.row === cell.item.row && x.col === cell.payday.col));
            saveQueue(next);
            return next;
          });
          patchCache(cell.item.row, cell.payday.col, prevDisplay, cell.note ?? null);
        }
      };
    },
    [settings.payer, backend, auth, query.data, write, patchCache, qc, queryKey],
  );

  const markUnpaid = useCallback(
    async (cell: CellState) => {
      await write({
        row: cell.item.row,
        col: cell.payday.col,
        // Goal rows hold 0 until a contribution is recorded; bill rows go back to the plan.
        value: cell.item.kind === 'goal' ? 0 : cell.planned,
        formula: originalFormula(cell.note),
        note: null,
        expected: query.data?.rolling.rows[cell.item.row]?.[cell.payday.col],
      });
    },
    [write, query.data],
  );

  const applyPlan = useCallback(
    async (plan: EditPlan) => {
      if (!backend) throw new Error('Not connected to a Google Sheet.');
      if (!navigator.onLine) throw new Error("You're offline. Adding or changing bills needs a connection.");
      if (queue.length) throw new Error('Some payments are still waiting to sync. Try again in a moment.');
      await backend.apply(plan);
      await qc.invalidateQueries({ queryKey });
    },
    [backend, queue.length, qc, queryKey],
  );

  const { model, parseError } = useMemo(() => {
    if (!query.data) return { model: undefined, parseError: null };
    try {
      return { model: buildModel(query.data), parseError: null };
    } catch (e) {
      return { model: undefined, parseError: e as Error };
    }
  }, [query.data]);

  const value: LedgerCtx = {
    settings,
    updateSettings,
    auth,
    signedIn,
    backend,
    model,
    error: (query.error as Error | null) ?? parseError,
    loading: query.isLoading,
    fetching: query.isFetching,
    refresh: () => qc.invalidateQueries({ queryKey }),
    markPaid,
    markUnpaid,
    applyPlan,
    queued: queue.length,
    online,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <LedgerProvider>{children}</LedgerProvider>
    </QueryClientProvider>
  );
}

export function useLedger(): LedgerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLedger outside provider');
  return c;
}
