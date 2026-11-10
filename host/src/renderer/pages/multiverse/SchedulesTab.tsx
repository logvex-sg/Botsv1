/**
 * Schedules tab.
 *
 * A schedule fires a task (or a preset) on a once/interval/daily rule. The Host tick evaluates it
 * once a second and a database guard makes each occurrence fire at most once, so the "runs missed
 * while offline" column is honest: it is the count of occurrences that went by without a run.
 */
import { useState } from 'react';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { formatDateTime, relativeTime } from '../../lib/format';
import type { TaskPreset } from '../../../shared/types';
import type { ScheduleView } from '../../../shared/ipc';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function SchedulesTab({ push }: Props) {
  const { items: schedules, loading, error, reload } = useCollection(() => fleet.listSchedules());
  const { items: presets } = useCollection(() => fleet.listTaskPresets());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduleView | null>(null);
  const [removing, setRemoving] = useState<ScheduleView | null>(null);
  const [ticking, setTicking] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const toggle = (schedule: ScheduleView): Promise<void> =>
    guarded(() => fleet.updateSchedule(schedule.id, { enabled: !schedule.enabled }), schedule.enabled ? 'Schedule paused' : 'Schedule enabled');

  const runTick = async (): Promise<void> => {
    setTicking(true);
    try {
      const ran = await fleet.tickSchedules();
      await reload();
      push(ran.length === 0 ? 'Nothing was due just now.' : `${ran.length} schedule(s) fired.`);
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setTicking(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Schedules"
        sub={`${schedules.length} schedule(s) · the Host checks every second`}
        actions={
          <>
            <Button small onClick={() => void runTick()} disabled={ticking}>{ticking ? 'Checking…' : 'Run due now'}</Button>
            <Button small variant="primary" onClick={() => setCreating(true)}>New schedule</Button>
          </>
        }
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load schedules">{error}</Callout>}
        {!loading && schedules.length === 0 && (
          <Empty>No schedules yet. Create one to run a task automatically at a set time or interval.</Empty>
        )}

        {schedules.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Schedule</th>
                <th>When</th>
                <th>Task</th>
                <th>Runs</th>
                <th>Last run</th>
                <th>Missed</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id} style={schedule.enabled ? undefined : { opacity: 0.6 }}>
                  <td style={{ fontWeight: 600 }}>{schedule.name}</td>
                  <td>{describeSchedule(schedule)}</td>
                  <td>
                    <Pill tone="info">{presets.find((p) => p.id === schedule.presetId)?.name ?? schedule.kind}</Pill>
                  </td>
                  <td>{schedule.fireCount}</td>
                  <td style={{ color: 'var(--text-dim)' }}>{schedule.lastFiredAt ? relativeTime(schedule.lastFiredAt) : 'never'}</td>
                  <td>
                    {schedule.missed > 0
                      ? <Pill tone="warning">{schedule.missed}</Pill>
                      : <span style={{ color: 'var(--text-dim)' }}>0</span>}
                  </td>
                  <td>
                    <Button small variant={schedule.enabled ? 'default' : 'ghost'} onClick={() => void toggle(schedule)}>
                      {schedule.enabled ? 'On' : 'Off'}
                    </Button>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="ghost" onClick={() => setEditing(schedule)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => setRemoving(schedule)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="Runs are guarded against duplicates">
        Each occurrence is recorded in the database before it is run, so a restart or a slow tick
        cannot fire the same slot twice. “Missed” counts occurrences that went by while the Host was
        not running; they are reported, never silently re-run.
      </Callout>

      {(creating || editing) && (
        <ScheduleModal
          schedule={editing}
          presets={presets}
          busy={busy}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (input) => {
            const target = editing;
            await guarded(
              async () => (target ? fleet.updateSchedule(target.id, input) : fleet.createSchedule(input)),
              target ? 'Schedule updated' : 'Schedule created',
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
          confirmLabel="Delete schedule"
          message="The schedule is removed and will not run again. Nothing already sent to a client is affected."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const schedule = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteSchedule(schedule.id), 'Schedule deleted');
          }}
        />
      )}
    </div>
  );
}

function describeSchedule(schedule: ScheduleView): string {
  if (schedule.scheduleKind === 'once') return `once at ${formatDateTime(schedule.startAt)}`;
  if (schedule.scheduleKind === 'daily') return `daily at ${schedule.timeOfDay ?? '??:??'}`;
  return `every ${humanInterval(schedule.intervalMs ?? 0)}`;
}

function humanInterval(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

function ScheduleModal({
  schedule, presets, busy, onClose, onSubmit,
}: {
  schedule: ScheduleView | null;
  presets: TaskPreset[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string; presetId: string | null; kind: string; scheduleKind: ScheduleView['scheduleKind'];
    intervalMs: number | null; timeOfDay: string | null; enabled: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [presetId, setPresetId] = useState(schedule?.presetId ?? presets[0]?.id ?? '');
  const [kind, setKind] = useState(schedule?.kind ?? 'inventory');
  const [scheduleKind, setScheduleKind] = useState<ScheduleView['scheduleKind']>(schedule?.scheduleKind ?? 'interval');
  const [minutes, setMinutes] = useState(String(schedule?.intervalMs ? Math.round(schedule.intervalMs / 60_000) : 60));
  const [timeOfDay, setTimeOfDay] = useState(schedule?.timeOfDay ?? '02:00');
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);

  const minutesNumber = Number.parseInt(minutes, 10);
  const valid =
    name.trim().length > 0 &&
    (scheduleKind !== 'interval' || (Number.isFinite(minutesNumber) && minutesNumber > 0)) &&
    (scheduleKind !== 'daily' || /^\d{1,2}:\d{2}$/.test(timeOfDay));

  return (
    <Modal
      title={schedule ? `Edit ${schedule.name}` : 'New schedule'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void onSubmit({
              name: name.trim(),
              presetId: presetId || null,
              kind,
              scheduleKind,
              intervalMs: scheduleKind === 'interval' ? minutesNumber * 60_000 : null,
              timeOfDay: scheduleKind === 'daily' ? timeOfDay : null,
              enabled,
            })}
          >
            {schedule ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly position check" autoFocus />
      </Field>
      <Field label="Task preset" hint="The schedule runs this preset. Leave as the default to use a bare task.">
        <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          <option value="">— bare task —</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Repeat">
            <select value={scheduleKind} onChange={(e) => setScheduleKind(e.target.value as ScheduleView['scheduleKind'])}>
              <option value="interval">Every N minutes</option>
              <option value="daily">Daily at a time</option>
              <option value="once">Once</option>
            </select>
          </Field>
        </div>
        {scheduleKind === 'interval' && (
          <div style={{ flex: 1 }}>
            <Field label="Minutes">
              <input value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ''))} />
            </Field>
          </div>
        )}
        {scheduleKind === 'daily' && (
          <div style={{ flex: 1 }}>
            <Field label="Time (HH:MM)">
              <input value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} placeholder="02:00" />
            </Field>
          </div>
        )}
      </div>
      {!presetId && (
        <Field label="Bare task kind" hint="Used only when no preset is selected.">
          <input value={kind} onChange={(e) => setKind(e.target.value)} />
        </Field>
      )}
      <Field label="Enabled">
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Run automatically while the Host is open</span>
        </label>
      </Field>
    </Modal>
  );
}
