import { useState } from 'react';
import { PiggyBank, Receipt } from '@phosphor-icons/react';
import { spendSummary } from '../lib/spending';
import { formatShort, fromIso } from '../lib/dates';
import { formatPHP } from '../lib/money';
import type { Model, Payday, Spend } from '../lib/model';
import { Amount, Card, ProgressBar, SectionTitle } from './ui';
import { QuickSpendSheet, SpendLimitSheet } from './QuickSpendSheet';

/** A payday's quick spends, with the optional limit, under the bills. */
export function UnplannedSpending({ model, payday, today }: { model: Model; payday: Payday; today: Date }) {
  const s = spendSummary(model, payday);
  const [editing, setEditing] = useState<Spend | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const used = s.limit ? s.total / s.limit : 0;

  return (
    <>
      <SectionTitle
        count={s.all.length}
        aside={
          <button
            onClick={() => setLimitOpen(true)}
            className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            {s.limit ? 'Change limit' : 'Set limit'}
          </button>
        }
      >
        Unplanned spending
      </SectionTitle>
      <Card>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">{s.all.length ? 'Spent from this payday' : 'Nothing logged for this payday'}</span>
          <span className="font-semibold">
            <Amount value={s.total} />
            {s.limit ? <span className="font-normal text-muted"> of {formatPHP(s.limit)}</span> : null}
          </span>
        </div>
        {s.limit !== null && (
          <div className="mt-2">
            <ProgressBar value={Math.min(1, used)} label="Unplanned spending used" tone={used > 1 ? 'danger' : used >= 0.8 ? 'warn' : 'accent'} />
            <p className={`num mt-1 text-xs ${s.left! < 0 ? 'text-danger' : 'text-muted'}`}>
              {s.left! < 0 ? `${formatPHP(-s.left!)} over the limit` : `${formatPHP(s.left!)} left`}
            </p>
          </div>
        )}
        {s.all.length > 0 ? (
          <ul className="-mx-2 mt-2 divide-y divide-line/60">
            {[...s.all].sort((a, b) => b.iso.localeCompare(a.iso)).map((x) => (
              <li key={x.row}>
                <button
                  onClick={() => setEditing(x)}
                  aria-label={`${x.what || x.category}, ${formatPHP(x.amount)}. Edit.`}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-elev"
                >
                  {x.fund ? <PiggyBank size={20} className="shrink-0 text-muted" aria-hidden /> : <Receipt size={20} className="shrink-0 text-muted" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{x.what || x.category}</span>
                    <span className="block truncate text-xs text-muted">
                      {formatShort(fromIso(x.iso))} · {x.category}
                      {x.fund ? ` · from ${x.fund}` : x.card ? ` · ${x.card}` : ''}
                    </span>
                  </span>
                  <span className="num shrink-0 text-sm font-semibold">{formatPHP(x.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">Tap + to log lunch out, a quick trip or anything unplanned.</p>
        )}
      </Card>
      {editing && <QuickSpendSheet model={model} today={today} spend={editing} onClose={() => setEditing(null)} />}
      {limitOpen && <SpendLimitSheet model={model} onClose={() => setLimitOpen(false)} />}
    </>
  );
}
