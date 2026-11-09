/**
 * Server Profiles page.
 *
 * Manage server connection profiles and run DNS/TCP diagnostics. Credentials are never entered or
 * shown here.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Field, Modal, Pill } from '../components/ui';
import type { ServerProfile } from '../../shared/types';
import { toFriendlyError } from '../lib/errors';
import type { DiagnosticsReport } from '../../main/services/network/network-diagnostics';

interface Props { push: (message: string, tone?: string) => void }

const blank = (): Partial<ServerProfile> => ({
  name: 'New server', host: 'localhost', port: 25565, version: '', authMode: 'offline',
  connectionTimeoutMs: 15000, options: {},
});

export function ServersPage({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<Partial<ServerProfile> | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ name: string; report: DiagnosticsReport } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (!editing) return;
    try {
      if (editing.id) await fleet.updateServer(editing.id, editing);
      else await fleet.createServer(editing);
      push('Server profile saved', 'success');
      setEditing(null);
      await store.refresh();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  };

  const remove = async (server: ServerProfile): Promise<void> => {
    if (!confirm(`Delete server profile "${server.name}"?`)) return;
    await fleet.deleteServer(server.id);
    await store.refresh();
  };

  const test = async (server: ServerProfile): Promise<void> => {
    setTesting(server.id);
    try {
      const report = await fleet.testServer(server.id);
      setDiagnostics({ name: server.name, report });
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Server profiles"
        sub="Connection targets for bot deployments."
        actions={<Button variant="primary" onClick={() => setEditing(blank())}>+ New server</Button>}
      >
        {store.servers.length === 0 ? (
          <Empty>No server profiles yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Address</th><th>Version</th><th>Auth</th><th>Timeout</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {store.servers.map((server) => (
                <tr key={server.id}>
                  <td><strong>{server.name}</strong></td>
                  <td className="mono">{server.host}:{server.port}</td>
                  <td className="card-sub">{server.version || 'auto'}</td>
                  <td><Pill tone="muted">{server.authMode}</Pill></td>
                  <td className="card-sub">{server.connectionTimeoutMs}ms</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                      <Button small onClick={() => test(server)} disabled={testing === server.id}>{testing === server.id ? 'Testing…' : 'Test'}</Button>
                      <Button small onClick={() => setEditing(server)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => remove(server)}>✕</Button>
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
          title={editing.id ? `Edit ${editing.name}` : 'New server profile'}
          onClose={() => setEditing(null)}
          footer={<>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save}>Save</Button>
          </>}
        >
          <Field label="Display name">
            <input type="text" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </Field>
          <div className="grid cols-2">
            <Field label="Host">
              <input type="text" value={editing.host ?? ''} onChange={(e) => setEditing({ ...editing, host: e.target.value })} />
            </Field>
            <Field label="Port">
              <input type="number" value={editing.port ?? 25565} onChange={(e) => setEditing({ ...editing, port: Number(e.target.value) })} />
            </Field>
            <Field label="Minecraft version" hint="Leave blank to auto-detect.">
              <input type="text" value={editing.version ?? ''} onChange={(e) => setEditing({ ...editing, version: e.target.value })} />
            </Field>
            <Field label="Authentication mode">
              <select value={editing.authMode} onChange={(e) => setEditing({ ...editing, authMode: e.target.value as never })}>
                <option value="offline">Offline</option>
                <option value="microsoft">Microsoft</option>
              </select>
            </Field>
            <Field label="Connection timeout (ms)">
              <input type="number" value={editing.connectionTimeoutMs ?? 15000} onChange={(e) => setEditing({ ...editing, connectionTimeoutMs: Number(e.target.value) })} />
            </Field>
          </div>
        </Modal>
      )}

      {diagnostics && (
        <Modal title={`Diagnostics — ${diagnostics.name}`} wide onClose={() => setDiagnostics(null)} footer={<Button onClick={() => setDiagnostics(null)}>Close</Button>}>
          <div className="col" style={{ gap: 14 }}>
            <div>
              <div className="card-title">DNS</div>
              <div className="card-sub">{diagnostics.report.dns.host} → {diagnostics.report.dns.addresses.join(', ') || 'no addresses'} ({diagnostics.report.dns.durationMs}ms)</div>
              {diagnostics.report.dns.error && <div className="card-sub" style={{ color: 'var(--error)' }}>{diagnostics.report.dns.error}</div>}
            </div>
            <div>
              <div className="card-title">TCP reachability</div>
              <div className="row" style={{ gap: 8 }}>
                <Pill tone={diagnostics.report.latency.reachable ? 'success' : 'error'}>{diagnostics.report.latency.reachable ? 'reachable' : 'unreachable'}</Pill>
                {diagnostics.report.latency.latencyMs != null && <span className="card-sub">{diagnostics.report.latency.latencyMs}ms</span>}
                {diagnostics.report.latency.error && <span className="card-sub" style={{ color: 'var(--error)' }}>{diagnostics.report.latency.error}</span>}
              </div>
            </div>
            <div>
              <div className="card-title">Network interfaces</div>
              {diagnostics.report.interfaces.slice(0, 8).map((iface, index) => (
                <div key={index} className="card-sub mono" style={{ fontSize: 11 }}>{iface.name} · {iface.address} · {iface.family}{iface.internal ? ' (internal)' : ''}</div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
