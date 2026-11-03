import { useMemo, useState } from 'react';
import { Flag, PencilSimple, PiggyBank, Plus, Warning } from '@phosphor-icons/react';
import { Button, Card, EmptyState, ProgressBar, SectionTitle } from '../components/ui';
import { GoalSheet } from '../components/GoalSheet';
import { FundSheet } from '../components/FundSheet';
import { fundStatus } from '../lib/funds';
import { surplusShortfalls } from '../lib/edits';
import { currentPayday, goalProgress, type Goal, type LineItem, type Model } from '../lib/model';
import { formatMonthYear, formatShort } from '../lib/dates';
import { formatCompact, formatPHP } from '../lib/money';

export function Goals({ model, today, go }: { model: Model; today: Date; go: (hash: string) => void }) {
  const current = currentPayday(model, today);
  const progress = model.goals.map((g) => goalProgress(model, g, current));
  const funds = model.items.filter((i) => i.kind === 'fund');
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [editingFund, setEditingFund] = useState<LineItem | 'new' | null>(null);
  const shortfalls = useMemo(() => surplusShortfalls(model, today), [model, today]);

  if (!progress.length)
    return (
      <EmptyState
        icon={<Flag size={40} />}
        title="No goals found"
        body="Add a goal to start saving toward it."
      />
    );

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Goals</h1>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={18} weight="bold" aria-hidden /> Add goal
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted">Saved so far, and what each payday sets aside to reach your targets.</p>

      {shortfalls.length > 0 && (
        <Card className="mb-3 border-warn/50">
          <p className="flex gap-2 text-sm">
            <Warning size={20} className="shrink-0 text-warn" aria-hidden />
            <span>
              Goal plans add up to more than the surplus on {shortfalls.length} payday{shortfalls.length === 1 ? '' : 's'}, starting{' '}
              {formatShort(shortfalls[0].payday.date)} {shortfalls[0].payday.date.getFullYear()} (over by {formatPHP(shortfalls[0].over)}).
            </span>
          </p>
        </Card>
      )}

      <ul className="space-y-3">
        {progress.map((p) => {
          const behind = p.plannedToDate - p.saved;
          return (
            <li key={p.goal.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{p.goal.name}</h2>
                    <p className="text-xs text-muted">{p.goal.targetLabel || 'Open-ended'}</p>
                  </div>
                  <div className="flex items-start gap-1">
                  <div className="text-right">
                    <p className="num font-semibold">{formatPHP(p.saved)}</p>
                    <p className="num text-xs text-muted">
                      {p.goal.target ? `of ${formatCompact(p.goal.target)}` : `${formatCompact(p.plannedTotal)} planned`}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(p.goal)}
                    aria-label={`Edit ${p.goal.name}`}
                    className="-mr-2 -mt-2 inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-elev"
                  >
                    <PencilSimple size={20} />
                  </button>
                  </div>
                </div>
                {p.goal.target && (
                  <div className="mt-3">
                    <ProgressBar value={p.pct ?? 0} label={`${p.goal.name} progress`} tone={p.pct === 1 ? 'accent' : 'primary'} />
                    <p className="num mt-1 text-xs text-muted">{Math.round((p.pct ?? 0) * 100)}% saved</p>
                  </div>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Plan to date</dt>
                  <dd className="num text-right">{formatPHP(p.plannedToDate)}</dd>
                  {behind > 1 && (
                    <>
                      <dt className="text-muted">Not yet recorded</dt>
                      <dd className="num text-right text-warn">{formatPHP(behind)}</dd>
                    </>
                  )}
                  {p.projectedDone && (
                    <>
                      <dt className="text-muted">On plan, done by</dt>
                      <dd className="text-right">{formatMonthYear(p.projectedDone.date)}</dd>
                    </>
                  )}
                </dl>
                {p.nextPlanned && (
                  <button
                    onClick={() => go(`#/timeline/${p.nextPlanned!.payday.iso}`)}
                    className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-between rounded-xl bg-elev px-3 text-sm hover:bg-line/60"
                  >
                    <span className="flex items-center gap-2">
                      <PiggyBank size={18} aria-hidden /> Next: {formatShort(p.nextPlanned.payday.date)}
                    </span>
                    <span className="num font-semibold">{formatPHP(p.nextPlanned.amount)}</span>
                  </button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <SectionTitle
        aside={
          <Button variant="ghost" onClick={() => setEditingFund('new')} className="-mr-2">
            <Plus size={18} weight="bold" aria-hidden /> Add fund
          </Button>
        }
      >
        Sinking funds
      </SectionTitle>
      {funds.length ? (
        <ul className="space-y-3">
          {funds.map((f) => {
            const st = fundStatus(model, f, current);
            return (
              <li key={f.id}>
                <button
                  onClick={() => setEditingFund(f)}
                  aria-label={`${f.name}: balance ${formatPHP(st.balance)}. Edit or withdraw.`}
                  className="w-full cursor-pointer rounded-2xl border border-line/70 bg-card p-4 text-left transition-colors duration-150 hover:bg-elev"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{f.name}</h3>
                      <p className="num text-xs text-muted">{formatPHP(f.monthly)}/mo · {f.card}</p>
                    </div>
                    <div className="text-right">
                      <p className="num font-semibold">{formatPHP(st.balance)}</p>
                      <p className="num text-xs text-muted">{st.target ? `of ${formatCompact(st.target)}` : 'balance'}</p>
                    </div>
                  </div>
                  {st.target !== null && (
                    <div className="mt-3">
                      <ProgressBar value={st.pct ?? 0} label={`${f.name} progress`} tone={st.pct === 1 ? 'accent' : 'primary'} />
                      <p className="num mt-1 text-xs text-muted">
                        {Math.round((st.pct ?? 0) * 100)}%{st.projectedDone ? ` · reaches target ${formatMonthYear(st.projectedDone.date)}` : ''}
                      </p>
                    </div>
                  )}
                  {st.withdrawn > 0 && (
                    <p className="num mt-2 text-xs text-muted">{formatPHP(st.contributed)} in · {formatPHP(st.withdrawn)} taken out</p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card><p className="text-sm text-muted">No sinking funds yet. Add one to set money aside for things like car maintenance or insurance.</p></Card>
      )}
      {editingFund && (
        <FundSheet model={model} fund={editingFund === 'new' ? undefined : editingFund} today={today} onClose={() => setEditingFund(null)} />
      )}
      {editing && (
        <GoalSheet model={model} goal={editing === 'new' ? undefined : editing} today={today} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
