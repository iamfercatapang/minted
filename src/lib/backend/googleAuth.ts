// Google Identity Services (token model). The access token lives in memory plus sessionStorage so a reload
// within the hour doesn't need another popup; there is no refresh token in the browser flow.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';
const STORE_KEY = 'ledger.token';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type: string; message?: string }) => void;
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

export interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

interface Stored {
  token: string;
  expiresAt: number;
  user?: GoogleUser;
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load Google Sign-In. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s.expiresAt > Date.now() + 60_000 ? s : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored | null) {
  try {
    if (s) sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* storage blocked: keep the in-memory copy only */
  }
}

export class GoogleAuth {
  private client: TokenClient | null = null;
  private state: Stored | null = readStored();
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
  private listeners = new Set<() => void>();

  constructor(private clientId: string) {}

  get user(): GoogleUser | undefined {
    return this.state?.user;
  }
  get signedIn(): boolean {
    return !!this.state && this.state.expiresAt > Date.now();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    await loadScript();
    this.client = window.google!.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      callback: (r) => this.onToken(r),
      error_callback: (e) => {
        this.pending?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled.' : e.message || e.type));
        this.pending = null;
      },
    });
    return this.client;
  }

  private async onToken(r: TokenResponse) {
    const p = this.pending;
    this.pending = null;
    if (r.error || !r.access_token) {
      p?.reject(new Error(r.error_description || r.error || 'Google sign-in failed.'));
      return;
    }
    const next: Stored = {
      token: r.access_token,
      expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
      user: this.state?.user,
    };
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${r.access_token}` },
      });
      if (res.ok) {
        const u = await res.json();
        next.user = { email: u.email, name: u.given_name || u.name || u.email, picture: u.picture };
      }
    } catch {
      /* profile is cosmetic */
    }
    this.state = next;
    writeStored(next);
    this.emit();
    p?.resolve(next.token);
  }

  /** Must be called from a user gesture the first time (opens the Google popup). */
  async signIn(): Promise<string> {
    const client = await this.ensureClient();
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      client.requestAccessToken({ prompt: this.state?.user ? '' : 'consent', login_hint: this.state?.user?.email });
    });
  }

  /** Returns a valid token, re-requesting silently when the hour is up. */
  async token(): Promise<string> {
    if (this.state && this.state.expiresAt > Date.now() + 60_000) return this.state.token;
    return this.signIn();
  }

  signOut() {
    const t = this.state?.token;
    this.state = null;
    writeStored(null);
    if (t && window.google) window.google.accounts.oauth2.revoke(t);
    this.emit();
  }
}

const instances = new Map<string, GoogleAuth>();
/** One auth instance per client ID so every screen sees the same sign-in state. */
export function getAuth(clientId: string): GoogleAuth {
  let a = instances.get(clientId);
  if (!a) instances.set(clientId, (a = new GoogleAuth(clientId)));
  return a;
}
