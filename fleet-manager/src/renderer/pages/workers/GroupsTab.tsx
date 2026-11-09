/**
 * Worker groups.
 *
 * Groups exist so the operator can address many clients at once ("everyone in farm"), both from the
 * inventory counters and from the task and regear screens. A worker belongs to at most one group.
 */
import { useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import type { WorkerGroup } from '../../../shared/types';
import { GroupChip, StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

const SWATCHES = ['#6d5efc', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b'];

export function GroupsTab({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<WorkerGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WorkerGroup | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = store.workerGroups;
  const workers = store.workers;

  const guarded = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await store.refreshWorkers();
      push(success);
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Worker groups"
        sub={`${groups.length} group(s) · ${workers.length} worker(s)`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New group</Button>}
      >
        {groups.length === 0 && (
          <Empty>No groups yet. Create one to run tasks and count items across several clients at once.</Empty>
        )}

        {groups.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Description</th>
                <th>Members</th>
                <th>Connected</th>
                <th>Members list</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const members = workers.filter((w) => w.groupId === group.id);
                return (
                  <tr key={group.id}>
                    <td><GroupChip name={group.name} color={group.color} /></td>
                    <td style={{ color: 'var(--text-dim)' }}>{group.description || '—'}</td>
                    <td>{members.length}</td>
                    <td>{members.filter((m) => m.online).length}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {members.length === 0
                          ? <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>nobody yet</span>
                          : members.slice(0, 6).map((member) => (
                              <span key={member.id} className="row" style={{ gap: 4 }}>
                                <StatusChip worker={member} />
                                <span style={{ fontSize: 12 }}>{workerTitle(member)}</span>
                              </span>
                            ))}
                        {members.length > 6 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>+{members.length - 6} more</span>}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Button small variant="ghost" onClick={() => setEditing(group)}>Edit</Button>
                        <Button small variant="ghost" onClick={() => setRemoving(group)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Unassigned workers" sub="Clients that are not in any group yet.">
        {workers.filter((w) => !w.groupId).length === 0
          ? <Empty>Every known worker is in a group.</Empty>
          : <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {workers.filter((w) => !w.groupId).map((worker) => (
                <Pill key={worker.id} tone="muted">{workerTitle(worker)}</Pill>
              ))}
            </div>}
      </Card>

      <Callout tone="info" title="Why groups matter">
        Groups are how you say "do this to all of them" without ticking boxes: item counts, equipment
        checks, regear runs and commands can all target a group by name.
      </Callout>

      {(creating || editing) && (
        <GroupModal
          group={editing}
          busy={busy}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (name, description, color) => {
            const target = editing;
            await guarded(async () => {
              if (target) await fleet.updateWorkerGroup(target.id, { name, description, color });
              else await fleet.createWorkerGroup(name, description, color);
            }, target ? 'Group updated' : 'Group created');
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          danger
          confirmLabel="Delete group"
          message="The group is removed. Its members are kept and simply become unassigned; nothing is sent to the clients."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const group = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteWorkerGroup(group.id), 'Group deleted');
          }}
        />
      )}
    </div>
  );
}

function GroupModal({
  group, busy, onClose, onSubmit,
}: {
  group: WorkerGroup | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [color, setColor] = useState(group?.color ?? SWATCHES[0]);

  return (
    <Modal
      title={group ? `Edit ${group.name}` : 'New worker group'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || name.trim().length === 0} onClick={() => void onSubmit(name.trim(), description, color)}>
            {group ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name" hint="This name is what you type when targeting the group.">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="farm" autoFocus />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What these clients are for" />
      </Field>
      <Field label="Colour">
        <div className="row" style={{ gap: 8 }}>
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              onClick={() => setColor(swatch)}
              title={swatch}
              style={{
                width: 26, height: 26, borderRadius: 6, background: swatch, cursor: 'pointer',
                border: color === swatch ? '2px solid var(--text)' : '1px solid var(--border)',
              }}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}
