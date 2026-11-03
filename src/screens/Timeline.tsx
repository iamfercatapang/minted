import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle } from '@phosphor-icons/react';
import { ExtendSheet } from '../components/ExtendSheet';
import { PaydayView } from '../components/PaydayView';
import { currentPayday, summarize, type Model } from '../lib/model';
import { formatLong, formatShort } from '../lib/dates';

export function Timeline({ model, today, selected, go }: {
  model: Model;
  today: Date;
  selected?: string;
  go: (hash: string) => void;
}) {
  const current = currentPayday(model, today);
  const payday = model.paydays.find((p) => p.iso === selected) ?? current ?? model.paydays[0];
  const activeRef = useRef<HTMLButtonElement>(null);
  const [extending, setExtending] = useState(false);

  const status = useMemo(
    () => new Map(model.paydays.map((p) => [p.iso, summarize(model, p, current)])),
    [model, current],
  );

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [payday?.iso]);

  if (!payday) return null;

  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold">Timeline</h1>
      <nav aria-label="Paydays" className="-mx-4 mb-4">
        <ul className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1">
          {model.paydays.map((p) => {
            const s = status.get(p.iso)!;
            const active = p.iso === payday.iso;
            const complete = s.cells.length > 0 && s.dueCount === 0;
            const past = !!current && p.index <= current.index;
            return (
              <li key={p.iso} className="shrink-0">
                <button
                  ref={active ? activeRef : undefined}
                  onClick={() => go(`#/timeline/${p.iso}`)}
                  aria-current={active ? 'date' : undefined}
                  className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-xl border px-3 text-sm transition-colors duration-150 ${
                    active
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-line/70 bg-card hover:bg-elev'
                  }`}
                >
                  <span className="font-semibold">{formatShort(p.date)}</span>
                  <span className={`flex items-center gap-1 text-[11px] ${active ? 'text-on-primary/90' : 'text-muted'}`}>
                    {complete ? (
                      <>
                        <CheckCircle size={12} weight="fill" aria-hidden /> Done
                      </>
                    ) : past ? (
                      `${s.dueCount} open`
                    ) : (
                      p.date.getFullYear()
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          <li className="shrink-0">
            <button
              onClick={() => setExtending(true)}
              className="flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/60 px-3 text-sm font-semibold text-primary transition-colors duration-150 hover:bg-primary/10"
            >
              <CalendarPlus size={18} aria-hidden />
              <span className="text-[11px]">+6 months</span>
            </button>
          </li>
        </ul>
      </nav>
      <h2 className="mb-3 text-lg font-semibold">{formatLong(payday.date)}</h2>
      <PaydayView model={model} payday={payday} current={current} today={today} />
      {extending && <ExtendSheet model={model} onClose={() => setExtending(false)} onDone={(iso) => go(`#/timeline/${iso}`)} />}
    </div>
  );
}
