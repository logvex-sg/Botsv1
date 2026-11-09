/**
 * Workers: the roster.
 *
 * A searchable, filterable list of every client that has ever connected, with a detail panel for
 * the selected one. Actions here are the real ones the protocol supports — ping, refresh status,
 * pull inventory, send a command or chat line, move to a group, kick, forget. Every action reports
 * what the worker actually answered, and an action that is not possible right now is disabled with
 * the reason shown rather than silently doing nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill, ProgressBar } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { toFriendlyError } from '../../lib/errors';
import type { WorkerGroup, WorkerView } from '../../../shared/types';
import { Freshness, StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

type Filter = 'all' | 'online' | 'offline' | 'unresponsive';

export function WorkersTab({ push }: Props) {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmKick, setConfirmKick] = useState<WorkerView | null>(null);
  const [confirmForget, setConfirmForget] = useState<WorkerView | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [line, setLine] = useState('');
  const [bulkGroup, setBulkGroup] = useState(false);
  const [selectedForBulk, setSelectedForBulk] = useState<Record<string, boolean>>({});

  const groups = store.workerGroups;
  const workers = store.workers;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return workers.filter((worker) => {
      if (filter === 'online' && !worker.online) return false;
      if (filter === 'offline' && worker.online) return false;
      if (filter === 'unresponsive' && worker.status !== 'DEGRADED') return false;
      if (groupFilter === '__none__' && worker.groupId) return false;
      if (groupFilter && groupFilter !== '__none__' && worker.groupId !== groupFilter) return false;
      if (!needle) return true;
      return [worker.id, worker.username, worker.label, worker.snapshot.dimension, worker.snapshot.serverAddress]
        .some((value) => (value ?? '').toLowerCase().includes(needle));
    });
  }, [workers, query, filter, groupFilter]);

  const selected = workers.find((w) => w.id === selectedId) ?? filtered[0] ?? null;
  const bulkIds = Object.keys(selectedForBulk).filter((id) => selectedForBulk[id]);

  const run = async (label: string, action: () => Promise<unknown>): Promise<void> => {
    setBusy(label);
    try {
      await action();
      await store.refreshWorkers();
      await store.refreshWorkerTasks();
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  /** Applies one control action to every selected worker, and reports how many the host accepted. */
  const runBulk = async (label: string, action: (id: string) => Promise<boolean>): Promise<void> => {
    setBusy(label);
    try {
      let accepted = 0;
      for (const id of bulkIds) {
        try {
          if (await action(id)) accepted++;
        } catch {
          // A single worker failing must not stop the rest of the batch.
        }
      }
      await store.refreshWorkers();
      push(accepted === bulkIds.length
        ? `${label}: sent to all ${accepted} workers`
        : `${label}: sent to ${accepted} of ${bulkIds.length} workers (the rest are offline)`,
      accepted === 0 ? 'error' : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Workers"
        sub={`${workers.length} known · ${workers.filter((w) => w.online).length} connected`}
        actions={
          <>
            {bulkIds.length > 0 && (
              <>
                <Button small onClick={() => setBulkGroup(true)}>Move {bulkIds.length} to group…</Button>
                <Button small disabled={busy !== null} onClick={() => void runBulk('connect', (id) => fleet.connectWorker(id))}>Connect {bulkIds.length}</Button>
                <Button small disabled={busy !== null} onClick={() => void runBulk('pause', (id) => fleet.pauseWorker(id))}>Pause {bulkIds.length}</Button>
                <Button small disabled={busy !== null} onClick={() => void runBulk('resume', (id) => fleet.resumeWorker(id))}>Resume {bulkIds.length}</Button>
                <Button small disabled={busy !== null} onClick={() => void runBulk('restart', (id) => fleet.restartWorker(id))}>Restart {bulkIds.length}</Button>
                <Button small variant="danger" disabled={busy !== null} onClick={() => void runBulk('disconnect', (id) => fleet.disconnectWorker(id))}>Disconnect {bulkIds.length}</Button>
              </>
            )}
            <Button small variant="ghost" onClick={() => void store.refreshWorkers()}>Refresh</Button>
          </>
        }
      >
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            placeholder="Search by name, id, server or dimension…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: '1 1 260px' }}
          />
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ width: 150 }}>
            <option value="all">All statuses</option>
            <option value="online">Connected</option>
            <option value="offline">Offline</option>
            <option value="unresponsive">Unresponsive</option>
          </select>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} style={{ width: 170 }}>
            <option value="">All groups</option>
            <option value="__none__">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>

        {workers.length === 0 && (
          <Empty>No workers have connected yet. Install the mod, set the host address, and launch the client.</Empty>
        )}

        {workers.length > 0 && filtered.length === 0 && <Empty>No workers match that search.</Empty>}

        {filtered.length > 0 && (
          <table>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={filtered.length > 0 && filtered.every((w) => selectedForBulk[w.id])}
                    onChange={(e) => {
                      const next: Record<string, boolean> = { ...selectedForBulk };
                      for (const w of filtered) next[w.id] = e.target.checked;
                      setSelectedForBulk(next);
                    }}
                  />
                </th>
                <th>Worker</th>
                <th>Status</th>
                <th>Group</th>
                <th>World</th>
                <th>Health</th>
                <th>Gear</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((worker) => (
                <tr
                  key={worker.id}
                  onClick={() => setSelectedId(worker.id)}
                  style={{ cursor: 'pointer', background: selected?.id === worker.id ? 'var(--bg-hover)' : undefined }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedForBulk[worker.id])}
                      onChange={(e) => setSelectedForBulk((prev) => ({ ...prev, [worker.id]: e.target.checked }))}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{workerTitle(worker)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{worker.id} · MC {worker.minecraftVersion || '?'}</div>
                  </td>
                  <td><StatusChip worker={worker} /></td>
                  <td>
                    {worker.groupId
                      ? <Pill tone="muted">{groups.find((g) => g.id === worker.groupId)?.name ?? 'unknown'}</Pill>
                      : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {worker.snapshot.inWorld
                      ? <>{worker.snapshot.dimension.split(':').pop()} <span style={{ color: 'var(--text-dim)' }}>{worker.snapshot.x.toFixed(0)},{worker.snapshot.y.toFixed(0)},{worker.snapshot.z.toFixed(0)}</span></>
                      : <span style={{ color: 'var(--text-dim)' }}>not in a world</span>}
                  </td>
                  <td style={{ width: 90 }}>
                    <div style={{ fontSize: 11, marginBottom: 2 }}>❤ {worker.snapshot.health.toFixed(0)}/{worker.snapshot.maxHealth.toFixed(0)}</div>
                    <ProgressBar
                      value={worker.snapshot.maxHealth > 0 ? (worker.snapshot.health / worker.snapshot.maxHealth) * 100 : 0}
                      color={worker.snapshot.health < 8 ? 'var(--error)' : 'var(--success)'}
                    />
                  </td>
                  <td style={{ fontSize: 12 }}>{worker.snapshot.armorPieces}/4 · {worker.snapshot.totems} totem</td>
                  <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{relativeTime(worker.lastSeen)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="ghost" disabled={!worker.online || busy !== null} title={worker.online ? 'Ask for a fresh status' : 'Worker is offline'}
                        onClick={() => void run('status', () => fleet.runWorkerTask(worker.id, 'status'))}>Ping</Button>
                      <Button small variant="ghost" disabled={!worker.online || busy !== null} title="Pull a fresh inventory"
                        onClick={() => void run('inventory', () => fleet.runWorkerTask(worker.id, 'inventory'))}>Inv</Button>
                      <Button small variant="ghost" onClick={() => setSelectedId(worker.id)}>Details</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <WorkerDetail
          worker={selected}
          groups={groups}
          busy={busy}
          onRun={run}
          push={push}
          onCommand={() => { setLine(''); setCommandOpen(true); }}
          onChat={() => { setLine(''); setChatOpen(true); }}
          onKick={() => setConfirmKick(selected)}
          onForget={() => setConfirmForget(selected)}
        />
      )}

      {commandOpen && selected && (
        <LineModal
          title={`Send a command as ${workerTitle(selected)}`}
          label="Command (without the leading slash)"
          placeholder="spawn"
          value={line}
          onChange={setLine}
          hint="Only the commands on the worker's allow-list are accepted. Anything else is refused before it is sent."
          onClose={() => setCommandOpen(false)}
          onSubmit={async () => {
            const text = line;
            setCommandOpen(false);
            await run('command', async () => {
              const record = await fleet.sendWorkerLine(selected.id, 'command', text);
              push(record.ok ? `Sent /${text}` : `Refused: ${record.response}`, record.ok ? undefined : 'error');
            });
          }}
        />
      )}

      {chatOpen && selected && (
        <LineModal
          title={`Send chat as ${workerTitle(selected)}`}
          label="Message"
          placeholder="Hello"
          value={line}
          onChange={setLine}
          hint="The message is sent through the client's own chat, so server chat rules still apply."
          onClose={() => setChatOpen(false)}
          onSubmit={async () => {
            const text = line;
            setChatOpen(false);
            await run('chat', async () => {
              const record = await fleet.sendWorkerLine(selected.id, 'chat', text);
              push(record.ok ? 'Message sent' : `Refused: ${record.response}`, record.ok ? undefined : 'error');
            });
          }}
        />
      )}

      {bulkGroup && (
        <BulkGroupModal
          count={bulkIds.length}
          groups={groups}
          onClose={() => setBulkGroup(false)}
          onApply={async (groupId) => {
            setBulkGroup(false);
            await run('group', async () => {
              const moved = await fleet.assignWorkerGroupBulk(bulkIds, groupId);
              setSelectedForBulk({});
              push(`${moved} worker(s) moved`);
            });
          }}
        />
      )}

      {confirmKick && (
        <ConfirmDialog
          title={`Disconnect ${workerTitle(confirmKick)}?`}
          danger
          confirmLabel="Disconnect"
          message="The worker is told to stand down and its connection is closed. The client itself keeps running and will reconnect unless its config is changed."
          onCancel={() => setConfirmKick(null)}
          onConfirm={async () => {
            const target = confirmKick;
            setConfirmKick(null);
            await run('kick', async () => {
              const ok = await fleet.kickWorker(target.id, 'disconnected by the operator');
              push(ok ? 'Worker disconnected' : 'That worker was already offline', ok ? undefined : 'error');
            });
          }}
        />
      )}

      {confirmForget && (
        <ConfirmDialog
          title={`Forget ${workerTitle(confirmForget)}?`}
          danger
          confirmLabel="Forget worker"
          message="Removes the worker's record, its cached inventory and its task history. If the client is still running it will reappear the next time it connects."
          onCancel={() => setConfirmForget(null)}
          onConfirm={async () => {
            const target = confirmForget;
            setConfirmForget(null);
            await run('forget', async () => {
              await fleet.forgetWorker(target.id);
              if (selectedId === target.id) setSelectedId(null);
              push('Worker forgotten');
            });
          }}
        />
      )}
    </div>
  );
}

function WorkerDetail({
  worker, groups, busy, onRun, push, onCommand, onChat, onKick, onForget,
}: {
  worker: WorkerView;
  groups: WorkerGroup[];
  busy: string | null;
  onRun: (label: string, action: () => Promise<unknown>) => Promise<void>;
  push: (message: string, tone?: string) => void;
  onCommand: () => void;
  onChat: () => void;
  onKick: () => void;
  onForget: () => void;
}) {
  const store = useStore();
  const inventory = store.workers.find((w) => w.id === worker.id);
  const [labelDraft, setLabelDraft] = useState(worker.label);
  const [notesDraft, setNotesDraft] = useState(worker.notes);

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 1fr) 1fr', gap: 16 }}>
      <Card title={`${workerTitle(worker)} — live state`} sub="Reported by the client on its heartbeat; not a live view.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
          <Detail label="Worker id" value={worker.id} />
          <Detail label="Minecraft" value={worker.minecraftVersion || 'unknown'} />
          <Detail label="Server" value={worker.snapshot.serverAddress || 'unknown'} />
          <Detail label="Dimension" value={worker.snapshot.dimension} />
          <Detail label="Game mode" value={worker.snapshot.gameMode} />
          <Detail label="Coordinates" value={worker.snapshot.inWorld ? `${worker.snapshot.x.toFixed(1)}, ${worker.snapshot.y.toFixed(1)}, ${worker.snapshot.z.toFixed(1)}` : 'not in a world'} />
          <Detail label="Health" value={`${worker.snapshot.health.toFixed(1)} / ${worker.snapshot.maxHealth.toFixed(1)}`} />
          <Detail label="Food" value={`${worker.snapshot.food} (+${worker.snapshot.saturation.toFixed(1)})`} />
          <Detail label="Held" value={worker.snapshot.heldItem || '—'} />
          <Detail label="Offhand" value={worker.snapshot.offhandItem || '—'} />
          <Detail label="Carried stacks" value={`${worker.snapshot.distinctItems} kinds / ${worker.snapshot.totalItems} items`} />
          <Detail label="Free slots" value={String(worker.snapshot.freeSlots)} />
          <Detail label="Current task" value={worker.snapshot.currentTask || 'idle'} />
          <Detail label="Last activity" value={worker.snapshot.lastActivity ? `${worker.snapshot.lastActivity} (${relativeTime(worker.snapshot.lastActivityAt)})` : 'none'} />
          <Detail label="Heartbeat" value={worker.lastHeartbeatAgeSeconds === null ? 'offline' : `${worker.lastHeartbeatAgeSeconds}s ago`} />
          <Detail label="Protocol" value={`v${worker.protocolVersion}`} />
        </div>

        {worker.snapshot.lastError && (
          <Callout tone="warning" title="Last error reported">{worker.snapshot.lastError}</Callout>
        )}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('status', () => fleet.runWorkerTask(worker.id, 'status'))}>Refresh status</Button>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('inventory', () => fleet.runWorkerTask(worker.id, 'inventory'))}>Pull inventory</Button>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('position', () => fleet.runWorkerTask(worker.id, 'position'))}>Ask position</Button>
          <Button small disabled={!worker.online} onClick={onCommand}>Send command</Button>
          <Button small disabled={!worker.online} onClick={onChat}>Send chat</Button>
          <Button small variant="ghost" disabled={!worker.online || busy !== null} onClick={() => void onRun('ping', async () => {
            const ok = await fleet.pingWorker(worker.id);
            push(ok ? 'Ping sent' : 'The worker is not connected', ok ? undefined : 'error');
          })}>Socket ping</Button>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('pause', () => fleet.pauseWorker(worker.id))}>Pause</Button>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('resume', () => fleet.resumeWorker(worker.id))}>Resume</Button>
          <Button small disabled={!worker.online || busy !== null} onClick={() => void onRun('restart', () => fleet.restartWorker(worker.id))}>Restart service</Button>
          <Button small variant="danger" disabled={!worker.online} onClick={onKick}>Disconnect</Button>
          <Button small variant="ghost" onClick={onForget}>Forget</Button>
        </div>

        {!worker.online && (
          <div className="card-sub" style={{ marginTop: 8 }}>
            Controls that act on the client are disabled while it is offline. The state above is the
            last thing it reported.
          </div>
        )}
      </Card>

      <div className="col" style={{ gap: 16 }}>
        <Card title="Label, group and notes" sub="Host-side only; the client is not changed.">
          <Field label="Label">
            <div className="row" style={{ gap: 8 }}>
              <input value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} placeholder="e.g. miner-1" style={{ flex: 1 }} />
              <Button small disabled={busy !== null} onClick={() => void onRun('label', async () => {
                await fleet.setWorkerLabel(worker.id, labelDraft);
                push('Label saved');
              })}>Save</Button>
            </div>
          </Field>
          <Field label="Group">
            <select
              value={worker.groupId ?? ''}
              onChange={(e) => void onRun('group', async () => {
                await fleet.assignWorkerGroup(worker.id, e.target.value || null);
                push('Group updated');
              })}
            >
              <option value="">No group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <div className="row" style={{ gap: 8 }}>
              <input value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Anything worth remembering" style={{ flex: 1 }} />
              <Button small disabled={busy !== null} onClick={() => void onRun('notes', async () => {
                await fleet.setWorkerNotes(worker.id, notesDraft);
                push('Notes saved');
              })}>Save</Button>
            </div>
          </Field>
        </Card>

        <Card
          title="Last reported inventory"
          sub={inventory ? `Captured ${relativeTime(inventory.lastSeen)}` : 'No inventory reported yet'}
          actions={<Button small variant="ghost" disabled={!worker.online} onClick={() => void onRun('inventory', () => fleet.runWorkerTask(worker.id, 'inventory'))}>Refresh</Button>}
        >
          <InventoryPreview workerId={worker.id} />
        </Card>

        <Card title="Capabilities" sub="Task kinds this worker will execute.">
          {worker.capabilities.length === 0
            ? <Empty>The worker has not reported its capabilities yet.</Empty>
            : <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {worker.capabilities.map((cap) => <Pill key={cap} tone="muted">{cap}</Pill>)}
              </div>}
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{label}</span>
      <span style={{ wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function InventoryPreview({ workerId }: { workerId: string }) {
  const [snapshot, setSnapshot] = useState<import('../../../shared/types').WorkerInventorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fleet.getWorkerInventory(workerId).then((value) => {
      if (!cancelled) { setSnapshot(value ?? null); setLoading(false); }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [workerId]);

  if (loading) return <Empty>Loading…</Empty>;
  if (!snapshot || snapshot.carried.length === 0) return <Empty>No inventory has been reported for this worker.</Empty>;

  return (
    <div className="col" style={{ gap: 6, maxHeight: 260, overflowY: 'auto' }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Captured <Freshness capturedAt={snapshot.capturedAt} /> · {snapshot.containerOpen ? 'a container screen is open' : 'no container screen open'}
      </div>
      {snapshot.carried.map((item) => (
        <div key={`${item.id}-${item.slot}`} className="row between" style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
          <span>{item.name || item.id}</span>
          <span className="mono">×{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function LineModal({
  title, label, placeholder, hint, value, onChange, onClose, onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={value.trim().length === 0} onClick={() => void onSubmit()}>Send</Button>
        </>
      }
    >
      <Field label={label} hint={hint}>
        <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function BulkGroupModal({
  count, groups, onClose, onApply,
}: {
  count: number;
  groups: WorkerGroup[];
  onClose: () => void;
  onApply: (groupId: string | null) => Promise<void>;
}) {
  const [groupId, setGroupId] = useState<string>('');
  return (
    <Modal
      title={`Move ${count} worker(s)`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void onApply(groupId || null)}>Move</Button>
        </>
      }
    >
      <Field label="Destination group" hint="Choosing “No group” removes them from their current group.">
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">No group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
