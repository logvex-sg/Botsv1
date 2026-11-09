/**
 * Console: what the workers are actually saying.
 *
 * A worker forwards its own link log here — connect, register, task outcomes, errors — at most one
 * line a second, so this is a real stream of the client's own view rather than something the host
 * inferred. Capabilities are shown alongside, which is the quickest way to see whether a worker is
 * running an older mod build that does not implement a task kind yet.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Card, Empty, Field, Pill } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

interface ConsoleLine {
  at: number;
  message: string;
}

export function ConsoleTab({ push }: Props) {
  const store = useStore();
  const [workerId, setWorkerId] = useState('');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  const workers = store.workers;

  const load = useCallback(async (id: string): Promise<void> => {
    if (!id) {
      setLines([]);
      setCapabilities([]);
      return;
    }
    try {
      const [console_, caps] = await Promise.all([
        fleet.getWorkerConsole(id),
        fleet.getWorkerCapabilities(id),
      ]);
      setLines(console_);
      setCapabilities(caps);
    } catch (error) {
      push(`Could not read the console: ${(error as Error).message}`, 'error');
    }
  }, [push]);

  useEffect(() => {
    if (!workerId && workers.length > 0) setWorkerId(workers[0].id);
  }, [workerId, workers]);

  useEffect(() => {
    void load(workerId);
    // Refresh on every worker event so the console follows along without a timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId, store.workerTasks.length, store.events.length]);

  useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lines, follow]);

  const clear = async (): Promise<void> => {
    if (!workerId) return;
    setBusy(true);
    try {
      await fleet.clearWorkerConsole(workerId);
      await load(workerId);
    } finally {
      setBusy(false);
    }
  };

  const selected = workers.find((w) => w.id === workerId);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Worker console" sub="Lines the selected client forwarded about its own connection.">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 1fr) auto auto', gap: 12, alignItems: 'end' }}>
          <Field label="Worker">
            <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
              <option value="">Select a worker…</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{workerTitle(worker)}</option>
              ))}
            </select>
          </Field>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            <span>Follow</span>
          </label>
          <Button small variant="ghost" disabled={busy || !workerId} onClick={() => void clear()}>Clear</Button>
        </div>

        {selected && (
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <StatusChip worker={selected} />
            {capabilities.length === 0
              ? <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No capabilities reported (worker has not sent a status yet).</span>
              : capabilities.map((cap) => <Pill key={cap}>{cap}</Pill>)}
          </div>
        )}
      </Card>

      <Card title="Stream" sub="Newest at the bottom. The worker rate-limits itself to one line a second.">
        {!workerId
          ? <Empty>Pick a worker to see its console.</Empty>
          : lines.length === 0
            ? <Empty>No lines yet. A worker logs when it connects, registers, and finishes a task.</Empty>
            : (
              <div
                ref={scroller}
                style={{
                  maxHeight: 420,
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  background: 'var(--bg-sunken, #0d1117)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                {lines.map((entry, index) => (
                  <div key={index} className="row" style={{ gap: 10 }}>
                    <span style={{ color: 'var(--text-dim)', minWidth: 72 }}>{relativeTime(entry.at)}</span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
      </Card>
    </div>
  );
}
