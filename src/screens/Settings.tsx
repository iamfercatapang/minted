import { useState } from 'react';
import { ArrowSquareOut, SignOut } from '@phosphor-icons/react';
import { Button, Card, SectionTitle } from '../components/ui';
import { useToast } from '../components/toast';
import { extractSheetId, useLedger, type Settings as S } from '../store';
import { DemoBackend } from '../lib/backend/demo';

/** Keeps the start and the ".apps.googleusercontent.com" end of a long client ID. */
const shortId = (id: string) => (id.length > 40 ? `${id.slice(0, 10)}…${id.slice(-27)}` : id);

export function Settings() {
  const { settings, updateSettings, auth, backend, refresh, queued } = useLedger();
  const toast = useToast();
  const [sheet, setSheet] = useState(settings.sheetId);
  const [clientId, setClientId] = useState(settings.clientId);
  const [editingClient, setEditingClient] = useState(false);

  const sheetUrl = settings.sheetId ? `https://docs.google.com/spreadsheets/d/${settings.sheetId}/edit` : null;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <SectionTitle>Account</SectionTitle>
      <Card>
        {backend?.kind === 'demo' ? (
          <p className="text-sm">You're using sample data. Changes stay on this device.</p>
        ) : auth?.user ? (
          <div className="flex items-center gap-3">
            {auth.user.picture && <img src={auth.user.picture} alt="" width={40} height={40} className="rounded-full" />}
            <div className="min-w-0">
              <p className="truncate font-medium">{auth.user.name}</p>
              <p className="truncate text-sm text-muted">{auth.user.email}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Not signed in.</p>
        )}
        {queued > 0 && <p className="mt-2 text-sm text-warn">{queued} change(s) waiting to sync.</p>}
      </Card>

      <SectionTitle>Who's using this phone</SectionTitle>
      <Card>
        <label htmlFor="payer" className="mb-1 block text-sm font-medium">Name in "Paid by" notes</label>
        <input
          id="payer"
          value={settings.payer}
          onChange={(e) => updateSettings({ payer: e.target.value })}
          placeholder={auth?.user?.name ?? 'e.g. Ana'}
          autoComplete="given-name"
          className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card>
        <fieldset>
          <legend className="sr-only">Theme</legend>
          <div className="grid grid-cols-3 gap-2">
            {(['system', 'light', 'dark'] as S['theme'][]).map((t) => (
              <label
                key={t}
                className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium capitalize ${
                  settings.theme === t ? 'border-primary bg-primary/10' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={t}
                  checked={settings.theme === t}
                  onChange={() => updateSettings({ theme: t })}
                  className="sr-only"
                />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <SectionTitle>Google Sheet</SectionTitle>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateSettings({ sheetId: extractSheetId(sheet), clientId: clientId.trim() });
            setEditingClient(false);
            toast({ message: 'Saved', tone: 'info' });
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="sheet" className="mb-1 block text-sm font-medium">Sheet link or ID</label>
            <input
              id="sheet"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label htmlFor="client" className="mb-1 block text-sm font-medium">Google OAuth client ID</label>
            {editingClient || !clientId ? (
              <input
                id="client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoFocus={editingClient}
                className="min-h-12 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
            ) : (
              <div className="flex min-h-12 items-center gap-2 rounded-xl border border-line bg-bg pl-3 pr-1">
                <span id="client" title={clientId} className="num min-w-0 flex-1 truncate text-sm text-muted">{shortId(clientId)}</span>
                <button type="button" onClick={() => setEditingClient(true)} className="min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold text-primary hover:bg-primary/10">
                  Change
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary">Save</Button>
            <Button variant="ghost" onClick={refresh}>Reload data</Button>
            {sheetUrl && (
              <a
                href={sheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center gap-1.5 rounded-xl px-4 font-semibold text-primary hover:bg-primary/10"
              >
                Open sheet <ArrowSquareOut size={16} aria-hidden />
              </a>
            )}
          </div>
        </form>
      </Card>

      <div className="mt-10 space-y-2 border-t border-line/70 pt-6">
        {backend?.kind === 'demo' && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              new DemoBackend().reset();
              refresh();
              toast({ message: 'Sample data reset', tone: 'info' });
            }}
          >
            Reset sample data
          </Button>
        )}
        <Button
          variant="danger"
          className="w-full"
          onClick={() => {
            auth?.signOut();
            updateSettings({ mode: null });
          }}
        >
          <SignOut size={18} aria-hidden /> {backend?.kind === 'demo' ? 'Leave demo' : 'Sign out'}
        </Button>
      </div>
    </div>
  );
}
