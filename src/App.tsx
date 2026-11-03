import { useEffect, useState, type ComponentType } from 'react';
import {
  ArrowClockwise,
  CalendarDots,
  ChartPieSlice,
  CloudSlash,
  CreditCard,
  Flag,
  GearSix,
  House,
  Plus,
  WarningOctagon,
  type IconProps,
} from '@phosphor-icons/react';
import { useLedger } from './store';
import { Connect } from './screens/Connect';
import { Today } from './screens/Today';
import { Timeline } from './screens/Timeline';
import { Goals } from './screens/Goals';
import { Cards } from './screens/Cards';
import { Settings } from './screens/Settings';
import { Reports } from './screens/Reports';
import { Button, Card, Skeleton } from './components/ui';
import { GoogleButton } from './components/GoogleButton';
import { QuickSpendSheet } from './components/QuickSpendSheet';

type Tab = 'today' | 'timeline' | 'reports' | 'goals' | 'cards' | 'settings';
const TABS: { id: Tab; label: string; icon: ComponentType<IconProps> }[] = [
  { id: 'today', label: 'Today', icon: House },
  { id: 'timeline', label: 'Timeline', icon: CalendarDots },
  { id: 'reports', label: 'Reports', icon: ChartPieSlice },
  { id: 'goals', label: 'Goals', icon: Flag },
  { id: 'cards', label: 'Cards', icon: CreditCard },
];

function parseHash(): { tab: Tab; arg?: string } {
  const [, tab, arg] = window.location.hash.split('/');
  return { tab: (tab === 'settings' || TABS.some((t) => t.id === tab) ? tab : 'today') as Tab, arg };
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
      document.getElementById('main')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

function useTheme(theme: 'system' | 'dark' | 'light') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F1B33' : '#F6F7FB');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** False while scrolling down (so the floating button doesn't sit over list amounts), true on the way back up. */
function useShowOnScrollUp(): boolean {
  const [show, setShow] = useState(true);
  useEffect(() => {
    let last = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      const atEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 8;
      if (Math.abs(y - last) > 6 || atEnd) setShow(y < last || y < 80 || atEnd);
      last = y;
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return show;
}

/** ?today=YYYY-MM-DD lets you preview another date (handy for checking upcoming paydays). */
function useToday(): Date {
  const q = new URLSearchParams(window.location.search).get('today');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const [y, m, d] = q.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

export default function App() {
  const { settings, model, error, loading, fetching, refresh, backend, online, queued, auth, signedIn } = useLedger();
  const route = useHashRoute();
  const today = useToday();
  useTheme(settings.theme);
  const [spending, setSpending] = useState(false);
  const fabVisible = useShowOnScrollUp();
  const go = (hash: string) => {
    window.location.hash = hash;
  };

  if (!settings.mode) return <Connect />;

  const needsReauth = settings.mode === 'google' && !signedIn;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 pt-safe backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} className="rounded-lg" />
            Minted
            {backend?.kind === 'demo' && <span className="rounded-md bg-warn/15 px-1.5 py-0.5 text-xs font-semibold text-warn">Sample</span>}
          </span>
          <span className="flex items-center gap-1">
            {(!online || queued > 0) && (
              <span className="flex items-center gap-1 text-xs text-warn" role="status">
                <CloudSlash size={16} aria-hidden /> {queued > 0 ? `${queued} to sync` : 'Offline'}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={!backend || fetching}
              aria-label="Refresh"
              className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev disabled:opacity-50"
            >
              <ArrowClockwise size={20} className={fetching ? 'animate-spin' : ''} />
            </button>
            <a
              href="#/settings"
              aria-label="Settings"
              aria-current={route.tab === 'settings' ? 'page' : undefined}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full hover:bg-elev ${route.tab === 'settings' ? 'text-primary' : 'text-muted'}`}
            >
              <GearSix size={22} weight={route.tab === 'settings' ? 'fill' : 'regular'} />
            </a>
          </span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="px-4 pb-32 pt-4 outline-none">
        {route.tab === 'settings' ? (
          <Settings />
        ) : needsReauth ? (
          <Card className="mt-6 text-center">
            <p className="font-semibold">Your Google session ended</p>
            <p className="mt-1 text-sm text-muted">Sign in again to load your latest plan.</p>
            <div className="mt-4"><GoogleButton onClick={() => auth?.signIn().catch(() => {})} /></div>
          </Card>
        ) : error ? (
          <Card className="mt-6 border-danger/50">
            <div className="flex gap-3">
              <WarningOctagon size={24} className="shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-semibold">Couldn't load your plan</p>
                <p className="mt-1 text-sm text-muted">{error.message}</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="secondary" onClick={refresh}>Try again</Button>
                  <Button variant="ghost" onClick={() => go('#/settings')}>Settings</Button>
                </div>
              </div>
            </div>
          </Card>
        ) : loading || !model ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-10 w-1/2" />
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
            </div>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : route.tab === 'timeline' ? (
          <Timeline model={model} today={today} selected={route.arg} go={go} />
        ) : route.tab === 'reports' ? (
          <Reports model={model} today={today} />
        ) : route.tab === 'goals' ? (
          <Goals model={model} today={today} go={go} />
        ) : route.tab === 'cards' ? (
          <Cards model={model} today={today} />
        ) : (
          <Today model={model} today={today} go={go} />
        )}
      </main>

      {model && !needsReauth && !error && route.tab !== 'settings' && (
        <button
          onClick={() => setSpending(true)}
          aria-label="Log spending"
          title="Log spending"
          className={`fixed right-4 z-40 inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-primary text-on-primary shadow-lg shadow-black/30 transition-[transform,opacity] duration-200 hover:bg-primary/90 active:scale-95 motion-reduce:transition-none sm:right-[max(1rem,calc(50vw-21rem))] ${
            fabVisible ? '' : 'pointer-events-none translate-y-24 opacity-0 focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100'
          }`}
          style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
        >
          <Plus size={26} weight="bold" aria-hidden />
        </button>
      )}
      {spending && model && <QuickSpendSheet model={model} today={today} onClose={() => setSpending(false)} />}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-card/85 pb-safe backdrop-blur-md"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = route.tab === id;
            return (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors duration-150 ${
                    active ? 'text-primary' : 'text-muted hover:text-fg'
                  }`}
                >
                  <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
