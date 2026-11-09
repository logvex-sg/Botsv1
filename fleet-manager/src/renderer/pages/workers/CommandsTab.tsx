/**
 * Commands: the audit log.
 *
 * Everything the host asked a client to say or type, with the worker's answer. Commands go through
 * the client's own command path, so the server's permissions and the worker's allow-list both apply;
 * a refused line is recorded with the reason rather than being retried silently.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, Empty, Field, Pill } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { toFriendlyError } from '../../lib/errors';
import type { WorkerCommandRecord } from '../../../shared/types';
import { StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

/** Common server commands offered as one-click buttons; the worker still validates them. */
const QUICK = ['spawn', 'home', 'sethome', 'tpa', 'back', 'kit', 'balance', 'list'];

export function CommandsTab({ push }: Props) {
  const store = useStore();
  const [history, setHistory] = useState<WorkerCommandRecord[]>([]);
  const [kind, setKind] = useState<'command' | 'chat'>('command');
  const [line, setLine] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [filterWorker, setFilterWorker] = useState('');

  const workers = store.workers;
  const online = workers.filter((w) => w.online);
  const targets = Object.keys(selected).filter((id) => selected[id]);

  const load = async (): Promise<void> => {
    try {
      setHistory(await fleet.listWorkerCommands(200, filterWorker || undefined));
    } catch {
      // Leave the previous list visible if the read fails.
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWorker, store.workerTasks.length]);

  const send = async (): Promise<void> => {
    const text = line.trim();
    if (text.length === 0) {
      push('Type a command or message first', 'error');
      return;
    }
    if (targets.length === 0) {
      push('Select at least one connected worker', 'error');
      return;
    }
    setBusy(true);
    try {
      const results = await fleet.sendWorkerLineMany(targets, kind, text);
      const ok = results.filter((r) => r.ok).length;
      push(ok === results.length ? `Sent to ${ok} worker(s)` : `${ok} of ${results.length} accepted`, ok === results.length ? undefined : 'error');
      setLine('');
      await load();
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout tone="info" title="How these are sent">
        Commands and chat lines are handed to the client's own connection, exactly as if they were
        typed in its chat box. That means the server's permission checks, anti-cheat and chat filters
        all still apply, and the worker refuses any command verb that is not on its allow-list before
        anything is sent.
      </Callout>

      <Card title="Send to the fleet" sub="Pick recipients, then send one line to all of them.">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 1fr) minmax(280px, 2fr)', gap: 12 }}>
          <Field label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'command' | 'chat')}>
              <option value="command">Server command (with /)</option>
              <option value="chat">Chat message</option>
            </select>
          </Field>
          <Field label={kind === 'command' ? 'Command' : 'Message'} hint={kind === 'command' ? 'The leading slash is added for you.' : 'Sent as plain chat.'}>
            <div className="row" style={{ gap: 8 }}>
              <input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                placeholder={kind === 'command' ? 'spawn' : 'Hello everyone'}
                onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                style={{ flex: 1 }}
              />
              <Button variant="primary" disabled={busy || targets.length === 0} onClick={() => void send()}>
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </Field>
        </div>

        {kind === 'command' && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {QUICK.map((quick) => (
              <Button key={quick} small variant="ghost" onClick={() => setLine(quick)}>/{quick}</Button>
            ))}
          </div>
        )}

        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="card-sub">{targets.length} of {online.length} connected selected</span>
          <div className="row" style={{ gap: 6 }}>
            <Button small variant="ghost" onClick={() => setSelected(Object.fromEntries(online.map((w) => [w.id, true])))}>All connected</Button>
            <Button small variant="ghost" onClick={() => setSelected({})}>None</Button>
          </div>
        </div>

        {workers.length === 0
          ? <Empty>No workers known yet.</Empty>
          : (
            <div className="col" style={{ gap: 4 }}>
              {workers.map((worker) => (
                <label key={worker.id} className="row" style={{ gap: 10, padding: '4px 0', opacity: worker.online ? 1 : 0.55 }}>
                  <input
                    type="checkbox"
                    disabled={!worker.online}
                    checked={Boolean(selected[worker.id])}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [worker.id]: e.target.checked }))}
                  />
                  <StatusChip worker={worker} />
                  <span>{workerTitle(worker)}</span>
                </label>
              ))}
            </div>
          )}
      </Card>

      <Card
        title="Command and chat history"
        sub="Every line the host sent, with the worker's answer."
        actions={
          <>
            <select value={filterWorker} onChange={(e) => setFilterWorker(e.target.value)} style={{ width: 180 }}>
              <option value="">All workers</option>
              {workers.map((worker) => <option key={worker.id} value={worker.id}>{workerTitle(worker)}</option>)}
            </select>
            <Button small variant="ghost" onClick={() => void load()}>Refresh</Button>
          </>
        }
      >
        {history.length === 0
          ? <Empty>Nothing has been sent yet.</Empty>
          : (
            <table>
              <thead>
                <tr><th>When</th><th>Worker</th><th>Type</th><th>Line</th><th>Result</th></tr>
              </thead>
              <tbody>
                {history.slice(0, 100).map((record) => (
                  <tr key={record.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{relativeTime(record.createdAt)}</td>
                    <td style={{ fontSize: 12 }}>{record.workerId}</td>
                    <td><Pill tone="muted">{record.kind}</Pill></td>
                    <td className="mono" style={{ fontSize: 12 }}>{record.line}</td>
                    <td>
                      <Pill tone={record.ok ? 'online' : 'error'}>{record.ok ? 'accepted' : 'refused'}</Pill>
                      {!record.ok && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>{record.response}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}
