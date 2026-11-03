import { useMemo, useState } from 'react';
import { nextPaydayDates, planExtend } from '../lib/edits';
import { formatLong, isoDate } from '../lib/dates';
import type { Model } from '../lib/model';
import { useLedger } from '../store';
import { useToast } from './toast';
import { Button } from './ui';
import { Sheet, SheetActions } from './Sheet';

const MONTHS = 6;

export function ExtendSheet({ model, onClose, onDone }: { model: Model; onClose: () => void; onDone: (lastIso: string) => void }) {
  const { applyPlan } = useLedger();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = model.paydays.at(-1)!;
  const dates = useMemo(() => nextPaydayDates(last.date, MONTHS * 2), [last]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const plan = planExtend(model, MONTHS);
      await applyPlan(plan);
      toast({ message: plan.summary, tone: 'info' });
      onDone(isoDate(dates.at(-1)!));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Add ${MONTHS} more months`} subtitle={`The timeline ends on ${formatLong(last.date)}`} onClose={onClose} busy={busy}>
      <div className="space-y-3 text-sm">
        <p>
          Adds {dates.length} paydays, <strong>{formatLong(dates[0])}</strong> to <strong>{formatLong(dates.at(-1)!)}</strong>, to your
          plan and savings schedule.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Every bill copies its own 15th / 30th formula, so ended loans stay ended.</li>
          <li>Goals with a target keep their last allocation until the target is reached; open-ended goals continue.</li>
        </ul>
        {error && <p role="alert" className="font-medium text-danger">{error}</p>}
      </div>
      <SheetActions>
        <Button onClick={run} busy={busy}>Add {MONTHS} months</Button>
      </SheetActions>
    </Sheet>
  );
}
