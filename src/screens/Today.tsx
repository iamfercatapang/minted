import { useMemo } from 'react';
import { CalendarBlank, Lightning, WarningCircle } from '@phosphor-icons/react';
import { bestCardToday } from '../lib/cards';
import { PaydayView } from '../components/PaydayView';
import { Card } from '../components/ui';
import { currentPayday, nextPayday, summarize, type Model } from '../lib/model';
import { daysBetween, formatLong, formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';

export function Today({ model, today, go }: { model: Model; today: Date; go: (hash: string) => void }) {
  const current = currentPayday(model, today);
  const next = nextPayday(model, today);

  const earlierOpen = useMemo(() => {
    if (!current) return [];
    return model.paydays
      .filter((p) => p.index < current.index)
      .map((p) => ({ p, s: summarize(model, p, current) }))
      .filter(({ s }) => s.dueCount > 0);
  }, [model, current]);

  const best = useMemo(() => bestCardToday(model, today), [model, today]);
  if (!current) return null;
  const daysToNext = next ? daysBetween(today, next.date) : null;

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Current payday</p>
          <h1 className="text-2xl font-bold">{formatLong(current.date)}</h1>
        </div>
        {next && (
          <button
            onClick={() => go(`#/timeline/${next.iso}`)}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full bg-elev px-3 text-sm font-medium hover:bg-line/60"
          >
            <CalendarBlank size={16} aria-hidden />
            Next {formatShort(next.date)} · {daysToNext === 0 ? 'today' : `${daysToNext}d`}
          </button>
        )}
      </div>

      {best && (
        <button
          onClick={() => go('#/cards')}
          className="mb-3 flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left text-sm hover:bg-elev"
        >
          <Lightning size={20} weight="fill" className="shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-medium">Best card today: {best.card.name}</span>
            <span className="block text-muted">A purchase now is due {best.float} days from today.</span>
          </span>
        </button>
      )}

      {earlierOpen.length > 0 && (
        <Card className="mb-3">
          <div className="flex gap-3">
            <WarningCircle size={22} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Unpaid items from earlier paydays</p>
              <ul className="mt-1 space-y-1">
                {earlierOpen.map(({ p, s }) => (
                  <li key={p.iso}>
                    <button
                      onClick={() => go(`#/timeline/${p.iso}`)}
                      className="min-h-11 cursor-pointer text-left text-sm text-primary underline-offset-2 hover:underline"
                    >
                      {formatShort(p.date)}: {s.dueCount} open · {formatPHP(s.remaining)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <PaydayView model={model} payday={current} current={current} today={today} />
    </div>
  );
}
