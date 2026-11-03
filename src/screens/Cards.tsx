import { useState } from 'react';
import { CaretRight, CreditCard, Lightning, Plus, Warning } from '@phosphor-icons/react';
import { bestCardToday, cycleFor, poorAssignment } from '../lib/cards';
import { Amount, Button, Card, EmptyState, ProgressBar, SectionTitle } from '../components/ui';
import { CardSheet } from '../components/CardSheet';
import { currentPayday, nextPayday, type CardInfo, type Model } from '../lib/model';
import { formatShort } from '../lib/dates';
import { formatPHP } from '../lib/money';

const tone = (u: number) => (u >= 0.8 ? 'danger' : u >= 0.5 ? 'warn' : 'accent');
const level = (u: number) => (u >= 0.8 ? 'High' : u >= 0.5 ? 'Moderate' : 'Healthy');

export function Cards({ model, today }: { model: Model; today: Date }) {
  const upcoming = nextPayday(model, today) ?? currentPayday(model, today);
  const [editing, setEditing] = useState<CardInfo | 'new' | null>(null);
  const byCard = new Map<string, typeof model.items>();
  for (const i of model.items) byCard.set(i.card, [...(byCard.get(i.card) ?? []), i]);

  if (!model.cards.length && !byCard.size)
    return <EmptyState icon={<CreditCard size={40} />} title="No cards found" body="Add a card to start tracking what's charged to it." />;

  const best = bestCardToday(model, today);
  const flags = new Map(model.items.flatMap((i) => { const f = poorAssignment(model, i, today); return f ? [[i.id, f] as const] : []; }));

  const sheet = editing && (
    <CardSheet model={model} card={editing === 'new' ? undefined : editing} today={today} onClose={() => setEditing(null)} />
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Cards</h1>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus size={18} weight="bold" aria-hidden /> Add card
        </Button>
      </div>
      <ul className="space-y-3">
        {model.cards.map((c) => (
          <li key={c.name}>
            <button
              onClick={() => setEditing(c)}
              aria-label={`${c.name}: edit card`}
              className="w-full cursor-pointer rounded-2xl bg-card p-4 text-left transition-colors duration-150 hover:bg-elev"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1 truncate font-semibold leading-snug">{c.name}<CaretRight size={14} weight="bold" className="shrink-0 text-muted" aria-hidden /></h2>
                  <p className="mt-0.5 text-xs leading-snug text-muted">Pay: {c.dueNote || '—'}</p>
                  {c.notes && <p className="line-clamp-1 text-xs leading-snug text-muted">{c.notes}</p>}
                  {/* With a cycle, the next-statement line below says the days already. */}
                  {!(c.statementDay && c.dueDay) && c.limit !== null && (
                    <p className="text-xs leading-snug text-muted">Set statement and due days for suggestions</p>
                  )}
                </div>
                <div className="shrink-0 whitespace-nowrap text-right">
                  <p className="font-semibold leading-snug"><Amount value={c.charged} /></p>
                  <p className="num mt-0.5 text-xs leading-snug text-muted">{c.limit ? `limit ${formatPHP(c.limit)}` : 'monthly'}</p>
                </div>
              </div>
              {(() => {
                const cy = cycleFor(c, today);
                if (!cy) return null;
                return (
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug">
                    {best?.card === c && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-semibold text-accent [text-box:trim-both_cap_alphabetic]">
                        <Lightning size={12} weight="fill" aria-hidden /> Best today
                      </span>
                    )}
                    <span className="text-muted">
                      Statement {formatShort(cy.statement)} · due {formatShort(cy.due)} · {cy.float} days to pay a charge today
                    </span>
                  </p>
                );
              })()}
              {c.utilization !== null && (
                <div className="mt-3">
                  <ProgressBar value={c.utilization} label={`${c.name} utilization`} tone={tone(c.utilization)} />
                  <p className="num mt-1.5 text-xs text-muted">
                    {(c.utilization * 100).toFixed(1)}% used · {level(c.utilization)}
                  </p>
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      {upcoming && (
        <>
          <SectionTitle>Charged on {formatShort(upcoming.date)} payday</SectionTitle>
          <div className="space-y-3">
            {[...byCard.entries()].map(([card, items]) => {
              const rows = items
                .map((i) => ({ i, amount: model.amount(i.row, upcoming) }))
                .filter((r) => r.amount > 0);
              if (!rows.length) return null;
              const total = rows.reduce((s, r) => s + r.amount, 0);
              return (
                <Card key={card}>
                  <div className="mb-1 flex justify-between gap-3 font-semibold">
                    <h3 className="truncate">{card}</h3>
                    <Amount value={total} />
                  </div>
                  <ul className="text-sm">
                    {rows.map(({ i, amount }) => {
                      const f = flags.get(i.id);
                      return (
                        <li key={i.id} className="py-1 text-muted">
                          <div className="flex justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-1 truncate">
                              {f && <Warning size={14} weight="fill" className="shrink-0 text-warn" aria-label="Short float" />}
                              {i.name}
                            </span>
                            <span className="num">{formatPHP(amount)}</span>
                          </div>
                          {f && (
                            <p className="text-xs text-warn">
                              Charged {f.daysToStatement === 0 ? 'on' : `${f.daysToStatement}d before`} the statement, {f.float} days to pay
                              {f.better ? `. ${f.better.card.name} gives ${f.better.float}.` : '.'}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {sheet}
    </div>
  );
}
