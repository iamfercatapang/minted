import { useState } from 'react';
import { Table } from '@phosphor-icons/react';
import { GoogleButton } from '../components/GoogleButton';
import { Button, Card } from '../components/ui';
import { extractSheetId, useLedger } from '../store';
import { getAuth } from '../lib/backend/googleAuth';

/** First-run screen: connect the household Google Sheet, or explore with sample data. */
export function Connect() {
  const { settings, updateSettings } = useLedger();
  const [sheet, setSheet] = useState(settings.sheetId);
  const [clientId, setClientId] = useState(settings.clientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsClient = !import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const needsSheet = !import.meta.env.VITE_SHEET_ID;

  async function connect() {
    const id = extractSheetId(sheet);
    if (!id) return setError('Paste the link to your Google Sheet.');
    if (!clientId.trim()) return setError('Add the OAuth client ID from Google Cloud Console (see README).');
    setError(null);
    setBusy(true);
    updateSettings({ sheetId: id, clientId: clientId.trim() });
    try {
      await getAuth(clientId.trim()).signIn();
      updateSettings({ mode: 'google' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10 pt-safe">
      <div className="mb-6 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={48} height={48} className="rounded-xl" />
        <div>
          <h1 className="text-2xl font-bold">Minted</h1>
          <p className="text-sm text-muted">Finance tracker &amp; wealth goals. Track &amp; grow.</p>
        </div>
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
          className="space-y-4"
        >
          {needsSheet ? (
            <div>
              <label htmlFor="c-sheet" className="mb-1 block text-sm font-medium">Google Sheet link</label>
              <input
                id="c-sheet"
                value={sheet}
                onChange={(e) => setSheet(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                inputMode="url"
                className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              <p className="mt-1 text-xs text-muted">Must be a native Google Sheet (not .xlsx) with a "Rolling Execution Plan" tab.</p>
            </div>
          ) : (
            <p className="text-sm text-muted">Sign in with the Google account that has access to your household's Google Sheet.</p>
          )}
          {needsClient && (
            <div>
              <label htmlFor="c-client" className="mb-1 block text-sm font-medium">OAuth client ID</label>
              <input
                id="c-client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="1234-abc.apps.googleusercontent.com"
                className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          <GoogleButton type="submit" busy={busy} />
        </form>
      </Card>

      {import.meta.env.DEV && (
        <Button variant="ghost" className="mt-3" onClick={() => updateSettings({ mode: 'demo' })}>
          <Table size={20} aria-hidden /> Try with sample data
        </Button>
      )}
    </div>
  );
}
