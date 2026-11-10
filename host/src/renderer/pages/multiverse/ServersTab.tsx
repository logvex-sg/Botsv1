/**
 * Server profiles tab.
 *
 * A server profile is an organisational record: it says which server a set of workers is *meant* to
 * run on. The "connected to it" count is deliberately separate from the assigned count, because it
 * is a reported fact, not an assumption — the UI says so.
 */
import { useState } from 'react';
import { fleet } from '../../lib/api';
import { useStore } from '../../lib/store';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import type { ServerProfileView } from '../../../shared/types';
import { useCollection } from './MultiversePage';

interface Props {
  push: (message: string, tone?: string) => void;
}

const ENVIRONMENTS: ServerProfileView['environment'][] = ['production', 'staging', 'testing', 'development'];

const TONE: Record<string, string> = {
  production: 'error', staging: 'warning', testing: 'info', development: 'muted',
};

export function ServersTab({ push }: Props) {
  const store = useStore();
  const { items: servers, loading, error, reload } = useCollection(() => fleet.listServers(true));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServerProfileView | null>(null);
  const [removing, setRemoving] = useState<ServerProfileView | null>(null);
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
        title="Server profiles"
        sub={`${servers.length} profile(s) · ${store.workers.length} worker(s) known`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New profile</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load server profiles">{error}</Callout>}
        {!loading && servers.length === 0 && (
          <Empty>No server profiles yet. Add one to group workers by the server they run on.</Empty>
        )}

        {servers.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Address</th>
                <th>Environment</th>
                <th>Assigned</th>
                <th>Online</th>
                <th>Connected to it</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {servers.map((profile) => (
                <tr key={profile.id} style={profile.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 600 }}>{profile.name}</span>
                      {profile.tags.length > 0 && (
                        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                          {profile.tags.map((tag) => <Pill key={tag} tone="muted">{tag}</Pill>)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{profile.host ? `${profile.host}:${profile.port}` : '—'}</td>
                  <td><Pill tone={TONE[profile.environment]}>{profile.environment}</Pill></td>
                  <td>{profile.workers}</td>
                  <td>{profile.online}</td>
                  <td title="Assigned workers whose own report names this address">
                    {profile.connectedToIt}
                  </td>
                  <td style={{ color: 'var(--text-dim)' }}>{relativeTime(profile.updatedAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="ghost" onClick={() => setEditing(profile)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => setRemoving(profile)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Callout tone="info" title="Assigned is not the same as connected">
        A profile only says where workers are meant to run. The “connected to it” column counts the
        workers that actually report that address, so an assignment never hides a worker that is
        somewhere else.
      </Callout>

      {(creating || editing) && (
        <ServerModal
          profile={editing}
          busy={busy}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (input) => {
            const target = editing;
            await guarded(
              async () => (target ? fleet.updateServer(target.id, input) : fleet.createServer(input)),
              target ? 'Server profile updated' : 'Server profile created',
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
          confirmLabel="Delete profile"
          message="The profile is removed and its workers become unassigned. No worker is disconnected and nothing is sent to any client."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const profile = removing;
            setRemoving(null);
            await guarded(() => fleet.deleteServer(profile.id), 'Server profile deleted');
          }}
        />
      )}
    </div>
  );
}

function ServerModal({
  profile, busy, onClose, onSubmit,
}: {
  profile: ServerProfileView | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; host: string; port: number; version: string; environment: ServerProfileView['environment']; notes: string; tags: string[] }) => Promise<void>;
}) {
  const [name, setName] = useState(profile?.name ?? '');
  const [host, setHost] = useState(profile?.host ?? '');
  const [port, setPort] = useState(String(profile?.port ?? 25565));
  const [version, setVersion] = useState(profile?.version ?? '1.21.11');
  const [environment, setEnvironment] = useState<ServerProfileView['environment']>(profile?.environment ?? 'production');
  const [notes, setNotes] = useState(profile?.notes ?? '');
  const [tags, setTags] = useState((profile?.tags ?? []).join(', '));

  const portNumber = Number.parseInt(port, 10);
  const valid = name.trim().length > 0 && (port === '' || (Number.isFinite(portNumber) && portNumber > 0 && portNumber < 65536));

  return (
    <Modal
      title={profile ? `Edit ${profile.name}` : 'New server profile'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() => void onSubmit({
              name: name.trim(), host: host.trim(), port: portNumber || 25565, version: version.trim(),
              environment, notes, tags: tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0),
            })}
          >
            {profile ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name" hint="A short label you will recognise, e.g. the server's name.">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="6b6t" autoFocus />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 3 }}>
          <Field label="Host" hint="Address only; leave blank for a profile that is just a label.">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="mc.example.org" />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Port">
            <input value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))} placeholder="25565" />
          </Field>
        </div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Minecraft version">
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.21.11" />
          </Field>
        </div>
        <div style={{ flex: 1 }}>
          <Field label="Environment">
            <select value={environment} onChange={(e) => setEnvironment(e.target.value as ServerProfileView['environment'])}>
              {ENVIRONMENTS.map((env) => <option key={env} value={env}>{env}</option>)}
            </select>
          </Field>
        </div>
      </div>
      <Field label="Tags" hint="Comma separated; used by the search filter.">
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="anarchy, pvp" />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything worth remembering about this server." />
      </Field>
    </Modal>
  );
}
