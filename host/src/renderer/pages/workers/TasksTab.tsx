/**
 * Tasks: the dispatch console.
 *
 * Pick a task kind, pick who should run it, and send it. The history below shows the real outcome of
 * every dispatch, including the ones that timed out or were refused, so a green row always means the
 * worker confirmed success.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, Empty, Field, Pill, ProgressBar } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { toFriendlyError } from '../../lib/errors';
import type { WorkerView } from '../../../shared/types';
import { StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

const KIND_LABELS: Record<string, string> = {
  status: 'Status — full state snapshot',
  inventory: 'Inventory — carried, armor and any open container',
  count: 'Count — how much of one item',
  search: 'Search — list stacks matching a term',
  equipment: 'Equipment — check against a loadout',
  position: 'Position — coordinates, dimension, health',
  regear: 'Regear — compare and (optionally) withdraw',
  command: 'Command — send a server command',
  chat: 'Chat — send a chat message',
  efly: 'EFly — fly this client with its elytra (Meteor ElytraFly)',
};

const KIND_PARAMS: Record<string, { key: string; label: string; placeholder: string; hint?: string } | undefined> = {
  count: { key: 'query', label: 'Item to count', placeholder: 'diamond', hint: 'Friendly names work: totem, gapple, iron, pearl.' },
  search: { key: 'query', label: 'Search term', placeholder: 'netherite' },
};

/** EFly options, gathered separately because a flight has several fields, not one. */
interface EflyOptions {
  action: 'start' | 'stop';
  x: string;
  y: string;
  z: string;
  mode: string;
}

export function TasksTab({ push }: Props) {
  const store = useStore();
  const [kind, setKind] = useState('status');
  const [param, setParam] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [kinds, setKinds] = useState<string[]>([]);
  const [efly, setEfly] = useState<EflyOptions>({ action: 'start', x: '', y: '120', z: '', mode: '' });

  useEffect(() => {
    void fleet.getWorkerTaskKinds().then(setKinds).catch(() => setKinds(Object.keys(KIND_LABELS)));
  }, []);

  const workers = store.workers;
  const online = workers.filter((w) => w.online);
  const targets = Object.keys(selected).filter((id) => selected[id]);
  const paramSpec = KIND_PARAMS[kind];
  const needsParam = Boolean(paramSpec);

  const summary = useMemo(() => {
    const tasks = store.workerTasks;
    return {
      total: tasks.length,
      succeeded: tasks.filter((t) => t.status === 'SUCCEEDED').length,
      failed: tasks.filter((t) => t.status === 'FAILED' || t.status === 'TIMEOUT' || t.status === 'REFUSED').length,
      running: tasks.filter((t) => t.status === 'PENDING' || t.status === 'DISPATCHED').length,
    };
  }, [store.workerTasks]);

  const dispatch = async (): Promise<void> => {
    if (targets.length === 0) {
      push('Select at least one connected worker first', 'error');
      return;
    }
    setBusy(true);
    try {
      let params: Record<string, unknown> = {};
      if (kind === 'efly') {
        params = buildEflyParams(efly);
      } else if (needsParam && paramSpec) {
        if (param.trim().length === 0) {
          push('Enter a value for that task first', 'error');
          return;
        }
        params = { [paramSpec.key]: param.trim() };
      }
      const results = await fleet.runWorkerTaskMany(targets, kind as never, params);
      const ok = results.filter((r) => r.ok).length;
      const failed = results.length - ok;
      push(
        failed === 0
          ? `${kind} sent to ${ok} worker(s) and confirmed`
          : `${ok} succeeded, ${failed} failed — see the history below`,
        failed === 0 ? undefined : 'error',
      );
      await store.refreshWorkerTasks();
      await store.refreshWorkers();
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Card><div className="stat"><div className="value">{summary.total}</div><div className="label">Tasks recorded</div></div></Card>
        <Card><div className="stat"><div className="value" style={{ color: 'var(--success)' }}>{summary.succeeded}</div><div className="label">Succeeded</div></div></Card>
        <Card><div className="stat"><div className="value" style={{ color: 'var(--error)' }}>{summary.failed}</div><div className="label">Failed or timed out</div></div></Card>
        <Card><div className="stat"><div className="value">{summary.running}</div><div className="label">In flight</div></div></Card>
      </div>

      <Card title="Dispatch a task" sub="The worker confirms completion; the host never assumes it worked.">
        {online.length === 0 && (
          <Callout tone="warning" title="No connected workers">
            Nothing can be dispatched right now. Connect a client from the Dashboard tab first.
          </Callout>
        )}

        <div className="grid" style={{ gridTemplateColumns: 'minmax(240px, 1fr) minmax(240px, 1fr)', gap: 12 }}>
          <Field label="Task" hint="These are the only task kinds a worker will execute.">
            <select value={kind} onChange={(e) => { setKind(e.target.value); setParam(''); }}>
              {(kinds.length > 0 ? kinds : Object.keys(KIND_LABELS)).map((option) => (
                <option key={option} value={option}>{KIND_LABELS[option] ?? option}</option>
              ))}
            </select>
          </Field>

          {needsParam && paramSpec && (
            <Field label={paramSpec.label} hint={paramSpec.hint}>
              <input value={param} placeholder={paramSpec.placeholder} onChange={(e) => setParam(e.target.value)} />
            </Field>
          )}
        </div>

        {kind === 'efly' && (
          <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="card-sub" style={{ marginBottom: 8 }}>
              EFly uses the worker's own elytra. The worker reports whether it engaged; the host never assumes flight.
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <Field label="Action">
                <select value={efly.action} onChange={(e) => setEfly((p) => ({ ...p, action: e.target.value as 'start' | 'stop' }))}>
                  <option value="start">Start flying</option>
                  <option value="stop">Stop flying</option>
                </select>
              </Field>
              {efly.action === 'start' && (
                <>
                  <Field label="Target X" hint="Leave blank to just engage flight.">
                    <input value={efly.x} placeholder="0" onChange={(e) => setEfly((p) => ({ ...p, x: e.target.value }))} />
                  </Field>
                  <Field label="Target Y">
                    <input value={efly.y} placeholder="120" onChange={(e) => setEfly((p) => ({ ...p, y: e.target.value }))} />
                  </Field>
                  <Field label="Target Z">
                    <input value={efly.z} placeholder="0" onChange={(e) => setEfly((p) => ({ ...p, z: e.target.value }))} />
                  </Field>
                  <Field label="Flight mode" hint="vanilla, packet, pitch40 or bounce (blank = keep current).">
                    <input value={efly.mode} placeholder="packet" onChange={(e) => setEfly((p) => ({ ...p, mode: e.target.value }))} />
                  </Field>
                </>
              )}
            </div>
            {efly.action === 'start' && (efly.x.trim() !== '') !== (efly.z.trim() !== '') && (
              <Callout tone="warning" title="Incomplete target">
                Give both X and Z to fly to a point, or leave both blank to engage flight in place.
              </Callout>
            )}
          </div>
        )}

        <div className="row between" style={{ marginTop: 4, marginBottom: 6 }}>
          <span className="card-sub">Recipients ({targets.length} selected of {online.length} connected)</span>
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
                  {!worker.online && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>offline — cannot receive tasks</span>}
                </label>
              ))}
            </div>
          )}

        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" disabled={busy || targets.length === 0} onClick={() => void dispatch()}>
            {busy ? 'Sending…' : `Send ${kind} to ${targets.length} worker(s)`}
          </Button>
        </div>
      </Card>

      <Card
        title="Task history"
        sub="Newest first. A green row means the worker confirmed the result."
        actions={<Button small variant="ghost" onClick={() => void store.refreshWorkerTasks()}>Refresh</Button>}
      >
        {store.workerTasks.length === 0
          ? <Empty>No tasks have been sent yet.</Empty>
          : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Worker</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {store.workerTasks.slice(0, 80).map((task) => (
                  <tr key={task.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{relativeTime(task.createdAt)}</td>
                    <td style={{ fontSize: 12 }}>{task.workerId}</td>
                    <td><Pill tone="muted">{task.kind}</Pill></td>
                    <td>
                      <Pill tone={
                        task.status === 'SUCCEEDED' ? 'online'
                          : task.status === 'PENDING' || task.status === 'DISPATCHED' ? 'connecting'
                            : 'error'
                      }>
                        {task.status}
                      </Pill>
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.error ?? (task.result && typeof task.result.message === 'string' ? task.result.message : '—')}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{task.durationMs === null ? '—' : `${task.durationMs} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      <Card title="In-flight detail" sub="Tasks a worker has not answered yet.">
        {summary.running === 0
          ? <Empty>Nothing is waiting.</Empty>
          : store.workerTasks.filter((t) => t.status === 'PENDING' || t.status === 'DISPATCHED').map((task) => (
              <div key={task.id} className="col" style={{ gap: 4, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="row between">
                  <span>{task.kind} → {task.workerId}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>sent {relativeTime(task.dispatchedAt ?? task.createdAt)}</span>
                </div>
                <ProgressBar value={100} color="var(--accent)" />
              </div>
            ))}
      </Card>
    </div>
  );
}

export function onlineWorkers(workers: WorkerView[]): WorkerView[] {
  return workers.filter((w) => w.online);
}

/**
 * Turns the EFly form into task params.
 *
 * Coordinates are only sent when both X and Z are given; a half-filled target becomes "engage in
 * place" rather than a flight to (x, 0), which would be a surprise the operator did not ask for.
 */
function buildEflyParams(efly: EflyOptions): Record<string, unknown> {
  const params: Record<string, unknown> = { action: efly.action };
  if (efly.action !== 'start') return params;
  const x = Number(efly.x);
  const z = Number(efly.z);
  const hasTarget = efly.x.trim() !== '' && efly.z.trim() !== '' && Number.isFinite(x) && Number.isFinite(z);
  if (hasTarget) {
    params.x = x;
    params.y = Number.isFinite(Number(efly.y)) ? Number(efly.y) : 120;
    params.z = z;
  }
  if (efly.mode.trim() !== '') params.mode = efly.mode.trim();
  return params;
}
