/**
 * Stasis Manager page.
 *
 * Named stasis locations, their state, history and manual (confirmed) state changes.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Pill } from '../components/ui';
import { formatDateTime } from '../lib/format';
import type { StasisLocation, StasisState } from '../../shared/types';
import type { StasisChange } from '../../main/services/stasis/stasis-manager';

interface Props { push: (message: string, tone?: string) => void }

const STATES: StasisState[] = ['READY', 'UNAVAILABLE', 'ACTIVE', 'UNKNOWN', 'ERROR'];

const blank = (): Partial<StasisLocation> => ({
  name: 'New stasis', instanceId: null, serverProfileId: null, dimension: 'minecraft:overworld', x: 0, y: 64, z: 0,
});

function stateTone(state: StasisState): string {
  if (state === 'READY' || state === 'ACTIVE') return 'success';
  if (state === 'UNAVAILABLE' || state === 'ERROR') return 'error';
  return 'muted';
}

export function StasisPage({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<Partial<StasisLocation> | null>(null);
  const [historyFor, setHistoryFor] = useState<StasisLocation | null>(null);
  const [history, setHistory] = useState<StasisChange[]>([]);
  const [confirmChange, setConfirmChange] = useState<{ location: StasisLocation; state: StasisState } | null>(null);

  const save = async (): Promise<void> => {
    if (!editing) return;
    try {
      if (editing.id) await fleet.updateStasis(editing.id, editing);
      else await fleet.createStasis(editing);
      push('Stasis location saved', 'success');
      setEditing(null);
      await store.refresh();
    } catch (error) {
      push((error as Error).message, 'error');
    }
  };

  const remove = async (location: StasisLocation): Promise<void> => {
    if (!confirm(`Delete stasis location "${location.name}"?`)) return;
    await fleet.deleteStasis(location.id);
    await store.refresh();
  };

  const openHistory = async (location: StasisLocation): Promise<void> => {
    setHistoryFor(location);
    setHistory(await fleet.getStasisHistory(location.id));
  };

  const applyState = async (): Promise<void> => {
    if (!confirmChange) return;
    await fleet.setStasisState(confirmChange.location.id, confirmChange.state, 'Manual change from dashboard');
    push(`Stasis "${confirmChange.location.name}" set to ${confirmChange.state}`, 'success');
    setConfirmChange(null);
    await store.refresh();
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Stasis locations"
        sub="Monitored defensive stasis setups. State changes require confirmation."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>+ New location</Button>}
      >
        {store.stasis.length === 0 ? (
          <Empty>No stasis locations configured.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Status</th><th>Instance</th><th>Dimension</th><th>Coordinates</th><th>Last verified</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {store.stasis.map((location) => (
                <tr key={location.id}>
                  <td><strong>{location.name}</strong></td>
                  <td><Pill tone={stateTone(location.state)}>{location.state}</Pill></td>
                  <td className="card-sub">{store.instances.find((i) => i.id === location.instanceId)?.name ?? '—'}</td>
                  <td className="card-sub">{location.dimension.replace('minecraft:', '') || '—'}</td>
                  <td className="mono">{location.x.toFixed(0)} {location.y.toFixed(0)} {location.z.toFixed(0)}</td>
                  <td className="card-sub">{formatDateTime(location.lastVerified)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button small onClick={() => setConfirmChange({ location, state: location.state === 'READY' ? 'UNAVAILABLE' : 'READY' })}>
                        {location.state === 'READY' ? 'Mark unavailable' : 'Mark ready'}
                      </Button>
                      <Button small onClick={() => openHistory(location)}>History</Button>
                      <Button small onClick={() => setEditing(location)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => remove(location)}>✕</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <Modal
          title={editing.id ? `Edit ${editing.name}` : 'New stasis location'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </>}
        >
          <Field label="Name">
            <input type="text" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <Field label="Associated instance">
            <select value={editing.instanceId ?? ''} onChange={(e) => setEditing({ ...editing, instanceId: e.target.value || null })}>
              <option value="">— none —</option>
              {store.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
          <Field label="Server profile">
            <select value={editing.serverProfileId ?? ''} onChange={(e) => setEditing({ ...editing, serverProfileId: e.target.value || null })}>
              <option value="">— none —</option>
              {store.servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Dimension">
            <input type="text" value={editing.dimension ?? ''} onChange={(e) => setEditing({ ...editing, dimension: e.target.value })} />
          </Field>
          <div className="grid cols-3">
            <Field label="X"><input type="number" value={editing.x ?? 0} onChange={(e) => setEditing({ ...editing, x: Number(e.target.value) })} /></Field>
            <Field label="Y"><input type="number" value={editing.y ?? 0} onChange={(e) => setEditing({ ...editing, y: Number(e.target.value) })} /></Field>
            <Field label="Z"><input type="number" value={editing.z ?? 0} onChange={(e) => setEditing({ ...editing, z: Number(e.target.value) })} /></Field>
          </div>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`State history — ${historyFor.name}`} wide onClose={() => setHistoryFor(null)} footer={<Button onClick={() => setHistoryFor(null)}>Close</Button>}>
          {history.length === 0 ? (
            <Empty>No recorded state changes yet.</Empty>
          ) : (
            <table>
              <thead><tr><th>Time</th><th>From</th><th>To</th><th>Reason</th></tr></thead>
              <tbody>
                {history.map((change) => (
                  <tr key={change.id}>
                    <td className="mono">{formatDateTime(change.timestamp)}</td>
                    <td><Pill tone={stateTone(change.from)}>{change.from}</Pill></td>
                    <td><Pill tone={stateTone(change.to)}>{change.to}</Pill></td>
                    <td className="card-sub">{change.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {confirmChange && (
        <Modal
          title="Confirm state change"
          onClose={() => setConfirmChange(null)}
          footer={<>
            <Button onClick={() => setConfirmChange(null)}>Cancel</Button>
            <Button variant="primary" onClick={applyState}>Confirm</Button>
          </>}
        >
          <p>
            Set <strong>{confirmChange.location.name}</strong> to <strong>{confirmChange.state}</strong>?
            This is a state-changing action and is recorded in the history.
          </p>
        </Modal>
      )}
    </div>
  );
}
