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
import { canRun } from '../../../shared/capabilities';
import type { TaskKind } from '../../../shared/workers';
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
  'container-read': 'Container read — list the contents of a container at a position',
  'container-move': 'Container move — quick-move matching items in or out of a container',
  'shulker-read': 'Shulker read — list the shulker boxes this worker carries',
  'shulker-unpack': 'Shulker unpack — empty a carried shulker box',
  restock: 'Restock — pull a shortfall from a storage container',
  'portal-scan': 'Portal scan — find (or remove) nearby nether portals',
};

/**
 * The parameter fields each task kind needs.
 *
 * Every kind the worker protocol knows is described here, so the console can build a valid request
 * for all of them rather than a handful. A field is either text or a number; a numeric field is sent
 * as a number and validated before dispatch, and an optional field left blank is simply omitted.
 */
interface KindField {
  key: string;
  label: string;
  placeholder?: string;
  hint?: string;
  numeric?: boolean;
  optional?: boolean;
  /** For a select field: the choices and the default. */
  choices?: readonly string[];
}

const KIND_FIELDS: Record<string, readonly KindField[]> = {
  count: [{ key: 'query', label: 'Item to count', placeholder: 'diamond', hint: 'Friendly names work: totem, gapple, iron, pearl.' }],
  search: [{ key: 'query', label: 'Search term', placeholder: 'netherite' }],
  regear: [
    { key: 'items', label: 'Loadout items', placeholder: 'totem 1, golden_apple 16', hint: 'Comma-separated "item" or "item count".' },
    { key: 'minArmorPieces', label: 'Minimum armour pieces', placeholder: '4', numeric: true, optional: true },
    { key: 'minFood', label: 'Minimum food', placeholder: '16', numeric: true, optional: true },
    { key: 'allowMoves', label: 'Allow moves', choices: ['no', 'yes'], hint: 'Off = dry run; on = withdraw from the open container.' },
  ],
  command: [{ key: 'command', label: 'Command', placeholder: 'spawn', hint: 'Sent without the leading slash.' }],
  chat: [{ key: 'message', label: 'Chat message', placeholder: 'hello' }],
  'container-read': [
    { key: 'x', label: 'X', placeholder: '100', numeric: true },
    { key: 'y', label: 'Y', placeholder: '64', numeric: true },
    { key: 'z', label: 'Z', placeholder: '-200', numeric: true },
    { key: 'dimension', label: 'Dimension', placeholder: 'minecraft:overworld', optional: true },
    { key: 'label', label: 'Label', placeholder: 'Main storage', optional: true },
  ],
  'container-move': [
    { key: 'direction', label: 'Direction', choices: ['withdraw', 'deposit'], hint: 'Withdraw takes items out; deposit puts them in.' },
    { key: 'query', label: 'Item to move', placeholder: 'cobblestone' },
    { key: 'limit', label: 'Limit', placeholder: '64', numeric: true, optional: true, hint: 'Blank moves as many as fit.' },
    { key: 'x', label: 'X (open this container first)', placeholder: '100', numeric: true, optional: true },
    { key: 'y', label: 'Y', placeholder: '64', numeric: true, optional: true },
    { key: 'z', label: 'Z', placeholder: '-200', numeric: true, optional: true },
  ],
  'shulker-read': [{ key: 'slot', label: 'Slot', placeholder: '', numeric: true, optional: true, hint: 'Blank reports every carried shulker box.' }],
  'shulker-pack': [
    { key: 'query', label: 'Items to pack', placeholder: 'diamond' },
    { key: 'limit', label: 'Limit', placeholder: '64', numeric: true, optional: true },
    { key: 'slot', label: 'Slot', placeholder: '', numeric: true, optional: true, hint: 'Blank picks the first carried shulker box.' },
  ],
  'shulker-unpack': [{ key: 'slot', label: 'Slot', placeholder: '', numeric: true, optional: true, hint: 'Blank empties every carried shulker box.' }],
  restock: [
    { key: 'query', label: 'Item to restock', placeholder: 'golden_apple' },
    { key: 'limit', label: 'Top up to', placeholder: '64', numeric: true, optional: true },
    { key: 'x', label: 'Source X', placeholder: '100', numeric: true, optional: true },
    { key: 'y', label: 'Source Y', placeholder: '64', numeric: true, optional: true },
    { key: 'z', label: 'Source Z', placeholder: '-200', numeric: true, optional: true },
  ],
  'portal-scan': [
    { key: 'action', label: 'Action', choices: ['scan', 'remove'] },
    { key: 'radius', label: 'Radius', placeholder: '24', numeric: true, optional: true, hint: 'How far to search, in blocks (1–64).' },
  ],
};

/** The default value of each field, so switching kinds never leaves a stale number behind. */
function defaultFields(kind: string): Record<string, string> {
  const spec = KIND_FIELDS[kind];
  if (!spec) return {};
  const values: Record<string, string> = {};
  for (const field of spec) {
    if (field.choices) values[field.key] = field.choices[0];
  }
  return values;
}

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
  const [fields, setFields] = useState<Record<string, string>>(() => defaultFields('status'));
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
  const fieldSpec = KIND_FIELDS[kind] ?? [];
  const needsParam = fieldSpec.length > 0;

  const setField = (key: string, value: string): void =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const chooseKind = (next: string): void => {
    setKind(next);
    setFields(defaultFields(next));
  };

  // The Host never offers a task a worker cannot run. A worker's last reported capabilities decide
  // whether it may be asked to run a kind; a worker that has not reported any capabilities yet is
  // treated as eligible, so a first dispatch is not blocked before the worker has spoken.
  const workerCanRun = (worker: WorkerView, option: string): boolean => {
    const caps = worker.capabilities ?? [];
    return caps.length === 0 || canRun(caps, option as TaskKind).ok;
  };

  const eligible = (worker: WorkerView): boolean => workerCanRun(worker, kind);
  const eligibleTargets = targets.filter((id) => {
    const worker = workers.find((w) => w.id === id);
    return worker ? eligible(worker) : false;
  });
  const blockedTargets = targets.length - eligibleTargets.length;

  // A kind is offered only when at least one connected worker advertises the capabilities it needs.
  const runnableKinds = new Set(
    (kinds.length > 0 ? kinds : Object.keys(KIND_LABELS))
      .filter((option) => online.some((w) => workerCanRun(w, option))),
  );
  const selectedRunnable = runnableKinds.has(kind);

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
    if (eligibleTargets.length === 0) {
      push(`No selected worker advertises the capabilities "${kind}" needs`, 'error');
      return;
    }
    setBusy(true);
    try {
      let params: Record<string, unknown>;
      try {
        params = kind === 'efly' ? buildEflyParams(efly) : buildKindParams(kind, fields);
      } catch (error) {
        push((error as Error).message, 'error');
        return;
      }
      const results = await fleet.runWorkerTaskMany(eligibleTargets, kind as never, params);
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
          <Field label="Task" hint="Only kinds a connected worker can run are selectable.">
            <select value={kind} onChange={(e) => chooseKind(e.target.value)}>
              {(kinds.length > 0 ? kinds : Object.keys(KIND_LABELS)).map((option) => {
                const runnable = runnableKinds.has(option);
                return (
                  <option key={option} value={option} disabled={!runnable}>
                    {KIND_LABELS[option] ?? option}{runnable ? '' : ' — no connected worker can run this'}
                  </option>
                );
              })}
            </select>
          </Field>
        </div>

        {needsParam && (
          <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {fieldSpec.map((field) => (
                <Field key={field.key} label={field.label} hint={field.hint}>
                  {field.choices ? (
                    <select value={fields[field.key] ?? field.choices[0]} onChange={(e) => setField(field.key, e.target.value)}>
                      {field.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
                    </select>
                  ) : (
                    <input
                      value={fields[field.key] ?? ''}
                      placeholder={field.placeholder}
                      inputMode={field.numeric ? 'numeric' : undefined}
                      onChange={(e) => setField(field.key, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}

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
              {workers.map((worker) => {
                const canRunKind = workerCanRun(worker, kind);
                return (
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
                    {worker.online && !canRunKind && (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>cannot run {kind} — will be skipped</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

        {blockedTargets > 0 && (
          <Callout tone="warning" title="Some selected workers cannot run this task">
            {blockedTargets} selected worker(s) do not advertise the capabilities "{kind}" needs and will be skipped.
          </Callout>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <Button variant="primary" disabled={busy || eligibleTargets.length === 0} onClick={() => void dispatch()}>
            {busy ? 'Sending…' : `Send ${kind} to ${eligibleTargets.length} worker(s)`}
          </Button>
          {selectedRunnable ? null : (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No connected worker can run {kind}.</span>
          )}
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

/**
 * Turns the schema-driven form into task params.
 *
 * Required text fields must be present, numeric fields must parse, and a blank optional field is
 * omitted rather than sent as an empty string the worker would reject. Two kinds get a small shape
 * transform: `regear` turns the comma-separated loadout into the item list the worker expects, and
 * `container-move`/`restock`/`container-read` only include coordinates when all three are given, so a
 * half-filled position never becomes a request to open the block at (x, 0, z).
 *
 * Throws with a human-readable message when the form is incomplete, so the caller can show it.
 */
function buildKindParams(kind: string, values: Record<string, string>): Record<string, unknown> {
  const spec = KIND_FIELDS[kind] ?? [];
  const params: Record<string, unknown> = {};
  const coordKeys = ['x', 'y', 'z'];
  for (const field of spec) {
    const raw = (values[field.key] ?? '').trim();
    if (field.choices) {
      const choice = raw || field.choices[0];
      if (field.key === 'allowMoves') params.allowMoves = choice === 'yes';
      else params[field.key] = choice;
      continue;
    }
    if (raw === '') {
      if (!field.optional) throw new Error(`Enter a value for "${field.label}" first`);
      continue;
    }
    if (field.numeric) {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`"${field.label}" must be a number`);
      params[field.key] = Math.trunc(value);
    } else {
      params[field.key] = raw;
    }
  }

  // Only send coordinates when the whole triple is present.
  if (coordKeys.some((key) => params[key] !== undefined)) {
    if (coordKeys.every((key) => params[key] !== undefined)) {
      params.x = Number(params.x);
      params.y = Number(params.y);
      params.z = Number(params.z);
    } else {
      for (const key of coordKeys) delete params[key];
    }
  }

  if (kind === 'regear' && typeof params.items === 'string') {
    params.items = (params.items as string)
      .split(',')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [query, count] = line.split(/\s+/);
        const parsed = Number(count);
        return { query, count: Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1, label: query };
      });
  }

  return params;
}
