import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarCheck, TrendDown } from '@phosphor-icons/react';
import { Card, SectionTitle, StatTile } from '../components/ui';
import { Segmented } from '../components/Sheet';
import { SPEND_CATEGORIES } from '../lib/spending';
import { buildReport, categorySlot, type MonthTotals, type Period, type Slice } from '../lib/reports';
import { formatMonthYear, formatShort } from '../lib/dates';
import { formatCompact, formatPHP } from '../lib/money';
import type { Model } from '../lib/model';

const series = (slot: number) => `var(--series-${slot})`;
const monthShort = new Intl.DateTimeFormat('en-PH', { month: 'short' });
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Ranked horizontal bars: name and value as text (identity never by color alone), bar for magnitude. */
function RankedBars({ items, color, label }: { items: Slice[]; color: (name: string) => string; label: string }) {
  const max = Math.max(...items.map((i) => i.amount), 1);
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((s) => (
        <li key={s.name} title={`${s.name}: ${formatPHP(s.amount)} (${pct(s.share)})`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(s.name) }} aria-hidden />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="num shrink-0 text-muted">
              <span className="font-semibold text-fg">{formatCompact(s.amount)}</span> · {pct(s.share)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-elev">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (s.amount / max) * 100)}%`, background: color(s.name) }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Share of the whole as one stacked bar, 2px surface gaps between segments. */
function ShareBar({ items }: { items: Slice[] }) {
  return (
    <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md" aria-hidden>
      {items.map((s) => (
        <div key={s.name} style={{ flexGrow: s.amount, background: series(categorySlot(s.name)) }} title={`${s.name} ${pct(s.share)}`} />
      ))}
    </div>
  );
}

/** Columns per month: bills and savings stacked, income as a tick. Tap or hover a month for its numbers. */
function MonthChart({ months }: { months: MonthTotals[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...months.map((m) => Math.max(m.income, m.bills + m.saved)), 1);
  const H = 160;
  const W = 100 / months.length;
  const shown = months[active ?? months.length - 1] ?? months[0];
  const y = (v: number) => H - (v / max) * H;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: series(1) }} />Bills</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: series(3) }} />Saved</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-fg" />Income</span>
      </div>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="h-40 w-full overflow-visible" role="img" aria-label="Income, bills and savings by month">
        <line x1="0" x2="100" y1={H} y2={H} stroke="rgb(var(--line))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {months.map((m, i) => {
          const bw = Math.min(W * 0.62, 9);
          const x = i * W + (W - bw) / 2;
          const billsTop = y(m.bills);
          const savedTop = y(m.bills + m.saved);
          const dim = active !== null && active !== i;
          return (
            <g key={m.key} opacity={dim ? 0.45 : 1}>
              <rect x={x} y={billsTop} width={bw} height={H - billsTop} fill={series(1)} rx="0.8" />
              {m.saved > 0 && <rect x={x} y={savedTop} width={bw} height={Math.max(0, billsTop - savedTop - 1.2)} fill={series(3)} rx="0.8" />}
              <line x1={x - 0.8} x2={x + bw + 0.8} y1={y(m.income)} y2={y(m.income)} stroke="rgb(var(--fg))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {/* Hit target spans the whole column. */}
              <rect
                x={i * W}
                y="0"
                width={W}
                height={H}
                fill="transparent"
                className="cursor-pointer"
                onPointerEnter={() => setActive(i)}
                onClick={() => setActive(i)}
              />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[11px] text-muted" aria-hidden>
        {months.map((m, i) => (
          <span key={m.key} className="text-center" style={{ width: `${W}%` }}>
            {months.length <= 8 || i % 3 === 0 ? monthShort.format(m.date) : ''}
          </span>
        ))}
      </div>
      {shown && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-elev px-3 py-2 text-sm" aria-live="polite">
          <dt className="col-span-2 font-medium">{formatMonthYear(shown.date)}</dt>
          <dt className="text-muted">Income</dt><dd className="num text-right">{formatPHP(shown.income)}</dd>
          <dt className="text-muted">Bills</dt><dd className="num text-right">{formatPHP(shown.bills)}</dd>
          <dt className="text-muted">Saved</dt><dd className="num text-right">{formatPHP(shown.saved)}</dd>
          <dt className="text-muted">Left over</dt>
          <dd className={`num text-right font-semibold ${shown.left < 0 ? 'text-danger' : ''}`}>{formatPHP(shown.left)}</dd>
        </dl>
      )}
      <details className="mt-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-primary">Show as table</summary>
        <div className="overflow-x-auto">
          <table className="num w-full text-right text-xs">
            <thead className="text-muted">
              <tr><th className="py-1 text-left font-medium">Month</th><th className="font-medium">Income</th><th className="font-medium">Bills</th><th className="font-medium">Saved</th><th className="font-medium">Left</th></tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key} className="border-t border-line/60">
                  <td className="py-1 text-left">{monthShort.format(m.date)} {m.date.getFullYear()}</td>
                  <td>{formatCompact(m.income)}</td><td>{formatCompact(m.bills)}</td><td>{formatCompact(m.saved)}</td><td>{formatCompact(m.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function Reports({ model, today }: { model: Model; today: Date }) {
  const [period, setPeriod] = useState<Period>('6m');
  const r = useMemo(() => buildReport(model, period, today), [model, period, today]);
  const spending = r.bills + r.saved;

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Reports</h1>
      <Segmented
        name="period"
        legend="Period"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: 'This month' },
          { value: '6m', label: '6 months' },
          { value: 'all', label: 'Whole plan' },
        ]}
      />
      {r.paydays.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {formatShort(r.paydays[0].date)}, {r.paydays[0].date.getFullYear()} to {formatShort(r.paydays.at(-1)!.date)}, {r.paydays.at(-1)!.date.getFullYear()} · {r.paydays.length} paydays
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile label="Income" value={r.income} format={formatCompact} />
        <StatTile label="Bills" value={r.bills} format={formatCompact} hint={r.income ? `${pct(r.bills / r.income)} of income` : undefined} />
        <StatTile label="Saved" value={r.saved} format={formatCompact} hint={r.savingsRate !== null ? `${pct(r.savingsRate)} savings rate` : undefined} tone="good" />
        <StatTile label="Left over" value={r.left} format={formatCompact} tone={r.left >= 0 ? 'default' : 'warn'} />
      </div>

      <SectionTitle>Where the money goes</SectionTitle>
      <Card>
        <ShareBar items={r.categories} />
        <p className="num mb-4 mt-2 text-xs text-muted">{formatPHP(spending)} across bills and savings</p>
        <RankedBars items={r.categories} color={(n) => series(categorySlot(n))} label="Spending by category" />
        <p className="mt-3 text-xs text-muted">Categories are guessed from bill names. Change one in Edit bill.</p>
      </Card>

      <SectionTitle>Largest payments</SectionTitle>
      <Card>
        <ol className="divide-y divide-line/60">
          {r.top.map(({ item, amount }, i) => (
            <li key={item.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="num w-5 text-right text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block truncate text-xs text-muted">{item.type} · {item.card}</span>
              </span>
              <span className="num shrink-0 font-semibold">{formatPHP(amount)}</span>
            </li>
          ))}
        </ol>
      </Card>

      {r.months.length > 1 && (
        <>
          <SectionTitle>Income vs spending</SectionTitle>
          <Card><MonthChart months={r.months} /></Card>
        </>
      )}

      {r.unplanned.length > 0 && (
        <>
          <SectionTitle>Unplanned spending</SectionTitle>
          <Card>
            <p className="num mb-4 text-sm">
              <span className="font-semibold">{formatPHP(r.unplannedTotal)}</span>
              <span className="text-muted"> logged with quick spends{r.income ? ` · ${pct(r.unplannedTotal / r.income)} of income` : ''}</span>
            </p>
            <RankedBars
              items={r.unplanned}
              color={(n) => series(((SPEND_CATEGORIES as readonly string[]).indexOf(n) % 8) + 1)}
              label="Unplanned spending by category"
            />
          </Card>
        </>
      )}

      <SectionTitle>By card</SectionTitle>
      <Card>
        <RankedBars items={r.cards} color={() => series(1)} label="Bills by card or payment method" />
      </Card>

      {r.loans.length > 0 && (
        <>
          <SectionTitle>Debt payoff</SectionTitle>
          <Card>
            <ul className="divide-y divide-line/60">
              {r.loans.map((l) => (
                <li key={l.item.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <TrendDown size={20} className="shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.item.name}</span>
                    <span className="block text-xs text-muted">
                      Last payment {formatShort(l.last.date)}, {l.last.date.getFullYear()} · {formatPHP(l.remaining)} to go
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted">
                    frees<span className="num block text-sm font-semibold text-fg">{formatPHP(l.monthly)}/mo</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <SectionTitle>Planned vs actual</SectionTitle>
      <Card>
        {r.variances.length ? (
          <ul className="divide-y divide-line/60">
            {r.variances.slice(0, 8).map((v) => {
              const over = v.diff > 0;
              return (
                <li key={v.item.id} className="flex items-center gap-3 py-2 text-sm">
                  {over ? <ArrowUp size={18} className="shrink-0 text-warn" aria-label="Over plan" /> : <ArrowDown size={18} className="shrink-0 text-accent" aria-label="Under plan" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.item.name}</span>
                    <span className="num block text-xs text-muted">Paid {formatPHP(v.actual)} · plan {formatPHP(v.planned)}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{over ? '+' : '−'}{formatPHP(Math.abs(v.diff))}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">{r.paidCount ? `All ${r.paidCount} paid bills in this period matched their plan.` : 'Nothing paid yet in this period. Try Whole plan to see earlier paydays.'}</p>
        )}
      </Card>

      {r.biggestMonths.length > 1 && (
        <>
          <SectionTitle>Biggest months ahead</SectionTitle>
          <Card>
            <ul className="divide-y divide-line/60">
              {r.biggestMonths.map((m) => (
                <li key={m.key} className="flex items-center gap-3 py-2 text-sm">
                  <CalendarCheck size={18} className="shrink-0 text-muted" aria-hidden />
                  <span className="flex-1">{formatMonthYear(m.date)}</span>
                  <span className="num font-semibold">{formatPHP(m.bills)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
