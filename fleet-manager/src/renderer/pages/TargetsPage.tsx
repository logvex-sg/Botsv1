/**
 * Target Database page.
 *
 * The shared target list, mirrored with Logvex Hunter. Supports priority targets, bot accounts,
 * known opponents and the ignore list, plus import/export.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Pill } from '../components/ui';
import { relativeTime } from '../lib/format';
import type { TargetEntry } from '../../shared/types';

interface Props { push: (message: string, tone?: string) => void }

const CATEGORIES = ['PRIORITY', 'BOT', 'OPPONENT', 'TEMPORARY', 'FRIEND', 'IGNORE'];

const blank = (): Partial<TargetEntry> => ({
  username: '', displayName: '', category: 'TEMPORARY', priority: 5, notes: '', tags: [], uuid: null,
});

function categoryTone(category: string): string {
  if (category === 'PRIORITY') return 'error';
  if (category === 'BOT') return 'warning';
  if (category === 'IGNORE' || category === 'FRIEND') return 'info';
  return 'muted';
}

export function TargetsPage({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<Partial<TargetEntry> | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const filtered = store.targets.filter((target) => {
    if (categoryFilter !== 'ALL' && target.category !== categoryFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return target.username.toLowerCase().includes(q) || target.displayName.toLowerCase().includes(q) || target.notes.toLowerCase().includes(q);
  });

  const save = async (): Promise<void> => {
    if (!editing || !editing.username) return;
    try {
      if (editing.id) await fleet.updateTarget(editing.id, editing);
      else await fleet.upsertTarget(editing as { username: string });
      push('Target saved', 'success');
      setEditing(null);
      await store.refreshTargets();
    } catch (error) {
      push((error as Error).message, 'error');
    }
  };

  const remove = async (target: TargetEntry): Promise<void> => {
    if (!confirm(`Remove target "${target.username}"?`)) return;
    await fleet.deleteTarget(target.id);
    await store.refreshTargets();
  };

  const exportCsv = (): void => {
    const header = 'username,uuid,category,priority,encounters,kills,deaths,notes';
    const rows = store.targets.map((t) => [t.username, t.uuid ?? '', t.category, t.priority, t.encounters, t.kills, t.deaths, `"${t.notes.replace(/"/g, '""')}"`].join(','));
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `targets-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    push('Exported targets as CSV', 'success');
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Target database"
        sub="Shared with Logvex Hunter. Categories drive target selection."
        actions={<>
          <Button onClick={() => fleet.syncTargets().then(() => { push('Synced with Hunter', 'success'); void store.refreshTargets(); })}>Sync with Hunter</Button>
          <Button onClick={exportCsv}>Export CSV</Button>
          <Button variant="primary" onClick={() => setEditing(blank())}>+ New target</Button>
        </>}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="text" placeholder="Search targets…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 260 }} />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="spacer" />
          <span className="card-sub">{filtered.length} of {store.targets.length}</span>
        </div>

        {filtered.length === 0 ? (
          <Empty>No targets. Add one manually or sync with Logvex Hunter.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Username</th><th>Category</th><th>Priority</th><th>Encounters</th><th>K/D</th><th>Last seen</th><th>Source</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((target) => (
                <tr key={target.id}>
                  <td>
                    <strong>{target.username}</strong>
                    {target.displayName && target.displayName !== target.username && <div className="card-sub" style={{ fontSize: 11 }}>{target.displayName}</div>}
                  </td>
                  <td><Pill tone={categoryTone(target.category)}>{target.category}</Pill></td>
                  <td>{target.priority}</td>
                  <td>{target.encounters}</td>
                  <td className="card-sub">{target.kills}/{target.deaths}</td>
                  <td className="card-sub">{relativeTime(target.lastSeen)}</td>
                  <td><Pill tone="muted">{target.source}</Pill></td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button small onClick={() => setEditing(target)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => remove(target)}>✕</Button>
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
          title={editing.id ? `Edit ${editing.username}` : 'New target'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!editing.username}>Save</Button>
          </>}
        >
          <div className="grid cols-2">
            <Field label="Username">
              <input type="text" value={editing.username ?? ''} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
            </Field>
            <Field label="Display name">
              <input type="text" value={editing.displayName ?? ''} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
            </Field>
            <Field label="Category">
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Priority (1 = highest)">
              <input type="number" min={1} max={10} value={editing.priority ?? 5} onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="UUID (optional)">
            <input type="text" value={editing.uuid ?? ''} onChange={(e) => setEditing({ ...editing, uuid: e.target.value || null })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
          </Field>
          <Field label="Tags (comma separated)">
            <input
              type="text"
              value={(editing.tags ?? []).join(', ')}
              onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Field>
          <Field label="Notes">
            <textarea value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
