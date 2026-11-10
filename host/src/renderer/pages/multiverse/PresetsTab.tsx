/**
 * Task presets tab.
 *
 * A preset is a task kind plus its parameters plus the workers/groups it targets. "Run" dispatches
 * it and shows the real per-worker outcome, including workers that were disconnected — a preset run
 * never claims success it did not get.
 */
import { useEffect, useState } from 'react';
import { fleet } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import type { TaskPreset } from '../../../shared/types';
import type { BulkResult } from '../../../shared/ipc';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function PresetsTab({ push }: Props) {
  const store = useStore();
  const { items: presets, loading, error, reload } = useCollection(() => fleet.listTaskPresets());
  const [kinds, setKinds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskPreset | null>(null);
  const [removing, setRemoving] = useState<TaskPreset | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ preset: string; result: BulkResult } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fleet.getWorkerTaskKinds().then(setKinds).catch(() => setKinds([]));
  }, []);

  const guarded = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await reload();
      push(success);
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async (preset: TaskPreset): Promise<void> => {
    setRunning(preset.id);
    try {
      const result = await fleet.runTaskPreset(preset.id);
      setLastResult({ preset: preset.name, result });
      push(result.message, result.ok ? undefined : 'error');
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Task presets"
        sub={`${presets.length} preset(s)`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New preset</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load task presets">{error}</Callout>}
        {!loading && presets.length === 0 && (
          <Empty>No presets yet. A preset is a task you can run again and again, by hand or on a schedule.</Empty>
        )}

        {presets.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Preset</th>
                <th>Task</th>
                <th>Targets</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {presets.map((preset) => {
                const targetCount = preset.targetWorkerIds.length + preset.targetGroupIds.length;
                return (
                  <tr key={preset.id}>
                    <td>
                      <div className="col" style={{ gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>{preset.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{preset.description || '—'}</span>
                      </div>
                    </td>
                    <td><Pill tone="info">{preset.kind}</Pill></td>
                    <td>
                      {targetCount === 0
                        ? <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>none</span>
                        : <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {preset.targetWorkerIds.length > 0 && <Pill tone="muted">{preset.targetWorkerIds.length} worker(s)</Pill>}
                            {preset.targetGroupIds.length > 0 && <Pill tone="muted">{preset.targetGroupIds.length} group(s)</Pill>}
                          </span>}
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{relativeTime(preset.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Button small variant="primary" disabled={running === preset.id} onClick={() => void run(preset)}>
                          {running === preset.id ? 'Running…' : 'Run'}
                        </Button>
                        <Button small variant="ghost" onClick={() => setEditing(preset)}>Edit</Button>
                        <Button small variant="ghost" onClick={() => setRemoving(preset)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {lastResult && (
        <Card title={`Last run — ${lastResult.preset}`} sub={lastResult.result.message}>
          <table>
            <thead>
              <tr><th>Worker</th><th>Outcome</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {lastResult.result.outcomes.map((outcome) => (
                <tr key={outcome.workerId}>
                  <td>{outcome.label}</td>
                  <td><Pill tone={outcome.ok ? 'success' : outcome.outcome === 'disconnected' ? 'warning' : 'error'}>{outcome.outcome}</Pill></td>
                  <td style={{ color: 'var(--text-dim)' }}>{outcome.detail}</td>
                </tr>
              ))}
              {lastResult.result.outcomes.length === 0 && (
                <tr><td colSpan={3} style={{ color: 'var(--text-dim)' }}>No workers matched the selection.</td></tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Callout tone="info" title="Presets are the unit a schedule fires">
        A schedule points at a preset, so editing a preset changes what every schedule using it does.
        That is the intended way to keep many clients consistent.
      </Callout>

      {(creating || editing) && (
        <PresetModal
          preset={editing}
          kinds={kinds}
          busy={busy}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (input) => {
            const target = editing;
            await guarded(
              async () => (target ? fleet.updateTaskPreset(target.id, input) : fleet.createTaskPreset(input)),
              target ? 'Preset updated' : 'Preset created',
            );
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          danger
          confirmLabel="Delete preset"
          message="The preset is removed. Schedules that pointed at it will fall back to their own stored task, and nothing is sent to any client."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const preset = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteTaskPreset(preset.id), 'Preset deleted');
          }}
        />
      )}
    </div>
  );
}

function PresetModal({
  preset, kinds, busy, onClose, onSubmit,
}: {
  preset: TaskPreset | null;
  kinds: string[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<TaskPreset, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}) {
  const store = useStore();
  const [name, setName] = useState(preset?.name ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [kind, setKind] = useState(preset?.kind ?? kinds[0] ?? 'inventory');
  const [workerIds, setWorkerIds] = useState<string[]>(preset?.targetWorkerIds ?? []);
  const [groupIds, setGroupIds] = useState<string[]>(preset?.targetGroupIds ?? []);
  const [params, setParams] = useState(JSON.stringify(preset?.params ?? {}, null, 2));
  const [paramsError, setParamsError] = useState<string | null>(null);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string): void => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const submit = (): void => {
    let parsed: Record<string, unknown>;
    try {
      parsed = params.trim() ? JSON.parse(params) : {};
    } catch {
      setParamsError('Parameters must be valid JSON.');
      return;
    }
    setParamsError(null);
    void onSubmit({ name: name.trim(), description, kind, params: parsed, targetWorkerIds: workerIds, targetGroupIds: groupIds });
  };

  return (
    <Modal
      title={preset ? `Edit ${preset.name}` : 'New task preset'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || name.trim().length === 0} onClick={submit}>
            {preset ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 2 }}>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hourly inventory" autoFocus />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Task">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this task is for" />
      </Field>
      <Field label="Target workers" hint="Select specific clients; combine with groups below.">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {store.workers.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No workers known yet.</span>}
          {store.workers.map((worker) => (
            <button
              key={worker.id}
              className={`pill ${workerIds.includes(worker.id) ? 'info' : 'muted'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => toggle(workerIds, setWorkerIds, worker.id)}
            >
              {worker.label || worker.username || worker.id}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Target groups" hint="Every worker in the group at run time.">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {store.workerGroups.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>No groups yet.</span>}
          {store.workerGroups.map((group) => (
            <button
              key={group.id}
              className={`pill ${groupIds.includes(group.id) ? 'info' : 'muted'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => toggle(groupIds, setGroupIds, group.id)}
            >
              {group.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Parameters (JSON)" hint="Task-specific options, e.g. { &quot;query&quot;: &quot;diamond&quot; }.">
        <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={4} style={{ fontFamily: 'var(--mono)' }} />
      </Field>
      {paramsError && <Callout tone="error" title="Invalid parameters">{paramsError}</Callout>}
    </Modal>
  );
}
