/**
 * Group templates tab.
 *
 * A template is a saved set of group defaults (task presets, equipment presets, permissions). It is
 * a starting point, not a live link: applying it creates a new group with those defaults copied in,
 * and later edits to either side do not affect the other.
 */
import { useState } from 'react';
import { fleet } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import type { GroupTemplate } from '../../../shared/types';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

const SWATCHES = ['#6d5efc', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b'];

export function TemplatesTab({ push }: Props) {
  const store = useStore();
  const { items: templates, loading, error, reload } = useCollection(() => fleet.listGroupTemplates());
  const [creating, setCreating] = useState(false);
  const [applying, setApplying] = useState<GroupTemplate | null>(null);
  const [removing, setRemoving] = useState<GroupTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  const guarded = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      await reload();
      await store.refreshWorkers();
      push(success);
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Group templates"
        sub={`${templates.length} template(s) · ${store.workerGroups.length} live group(s)`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New template</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load templates">{error}</Callout>}
        {!loading && templates.length === 0 && (
          <Empty>No templates yet. Save a set of defaults once and reuse it whenever you create a group.</Empty>
        )}

        {templates.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Defaults</th>
                <th>Permissions</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span style={{ width: 12, height: 12, borderRadius: 4, background: template.color }} />
                      <div className="col" style={{ gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>{template.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{template.description || '—'}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {template.defaultTaskPresetIds.length === 0 && template.defaultEquipmentPresetIds.length === 0
                        ? <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>none</span>
                        : <>
                            {template.defaultTaskPresetIds.length > 0 && <Pill tone="muted">{template.defaultTaskPresetIds.length} task</Pill>}
                            {template.defaultEquipmentPresetIds.length > 0 && <Pill tone="muted">{template.defaultEquipmentPresetIds.length} equip</Pill>}
                          </>}
                    </span>
                  </td>
                  <td>
                    {template.permissions.length === 0
                      ? <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>none</span>
                      : template.permissions.map((permission) => <Pill key={permission} tone="info">{permission}</Pill>)}
                  </td>
                  <td style={{ color: 'var(--text-dim)' }}>{relativeTime(template.createdAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="primary" onClick={() => setApplying(template)}>Create group</Button>
                      <Button small variant="ghost" onClick={() => setRemoving(template)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="Applying a template copies, it does not link">
        The new group gets a copy of the template's defaults. Editing the template afterwards leaves
        existing groups untouched, which is what makes a template safe to reuse.
      </Callout>

      {creating && (
        <TemplateModal
          busy={busy}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await guarded(() => fleet.createGroupTemplate(input), 'Template created');
            setCreating(false);
          }}
        />
      )}

      {applying && (
        <ApplyModal
          template={applying}
          busy={busy}
          onClose={() => setApplying(null)}
          onSubmit={async (name) => {
            await guarded(() => fleet.applyGroupTemplate(applying.id, name), 'Group created from template');
            setApplying(null);
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          danger
          confirmLabel="Delete template"
          message="The template is removed. Groups already created from it are unaffected."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const template = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteGroupTemplate(template.id), 'Template deleted');
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  busy, onClose, onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<GroupTemplate, 'id' | 'createdAt'>) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [taskPresetIds, setTaskPresetIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);

  const PERMISSIONS = ['run-task', 'regear', 'command', 'chat', 'position'];

  const toggle = (list: string[], setList: (v: string[]) => void, id: string): void =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Modal
      title="New group template"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || name.trim().length === 0}
            onClick={() => void onSubmit({
              name: name.trim(), description, color,
              defaultTaskPresetIds: taskPresetIds, defaultEquipmentPresetIds: [], permissions,
            })}
          >
            Create
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mining crew" autoFocus />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this template is for" />
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
      <Field label="Permissions" hint="What the group is allowed to do.">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {PERMISSIONS.map((permission) => (
            <button
              key={permission}
              className={`pill ${permissions.includes(permission) ? 'info' : 'muted'}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => toggle(permissions, setPermissions, permission)}
            >
              {permission}
            </button>
          ))}
        </div>
      </Field>
      <Callout tone="info" title="Task presets are attached later">
        Equipment and task presets can be attached to the group once it exists, from the Tasks and
        Groups pages.
      </Callout>
    </Modal>
  );
}

function ApplyModal({
  template, busy, onClose, onSubmit,
}: {
  template: GroupTemplate;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(`${template.name} group`);
  return (
    <Modal
      title={`Create a group from “${template.name}”`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || name.trim().length === 0} onClick={() => void onSubmit(name.trim())}>
            Create group
          </Button>
        </>
      }
    >
      <Field label="New group name" hint="The group is created with the template's defaults copied in.">
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
