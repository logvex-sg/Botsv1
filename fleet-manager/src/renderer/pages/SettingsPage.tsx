/**
 * Configuration page.
 *
 * Application settings, the local API token (for the Logvex Hunter addon), database backup and
 * full configuration import/export.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Field, Pill } from '../components/ui';
import type { AppSettings } from '../../shared/types';

interface Props { push: (message: string, tone?: string) => void }

export function SettingsPage({ push }: Props) {
  const store = useStore();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [token, setToken] = useState('');
  const [revealToken, setRevealToken] = useState(false);

  useEffect(() => {
    if (store.settings) setDraft(store.settings);
  }, [store.settings]);

  useEffect(() => {
    void fleet.getApiToken().then(setToken);
  }, []);

  const save = async (): Promise<void> => {
    if (!draft) return;
    await fleet.saveSettings(draft);
    push('Settings saved', 'success');
    await store.refresh();
  };

  const regenerate = async (): Promise<void> => {
    if (!confirm('Regenerate the API token? Existing Hunter addon clients will need the new token.')) return;
    const next = await fleet.regenerateApiToken();
    setToken(next);
    setRevealToken(true);
    push('API token regenerated', 'success');
  };

  const exportConfig = async (): Promise<void> => {
    const result = await fleet.exportConfig();
    push(`Exported configuration to ${result.path}`, 'success');
  };

  const importConfig = async (): Promise<void> => {
    const result = await fleet.importConfig();
    if (result) {
      push(`Imported ${result.imported} records`, 'success');
      await store.refresh();
    }
  };

  const backup = async (): Promise<void> => {
    const result = await fleet.backupDatabase();
    if (result) push(`Backup saved to ${result.path}`, 'success');
  };

  if (!draft) return <div className="empty">Loading settings…</div>;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid cols-2">
        <Card title="Local API" sub="The Logvex Hunter addon connects to this endpoint.">
          <Field label="Enabled">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={draft.apiEnabled} onChange={(e) => setDraft({ ...draft, apiEnabled: e.target.checked })} />
              <span className="card-sub">Serve the REST + WebSocket API</span>
            </label>
          </Field>
          <div className="grid cols-2">
            <Field label="Host">
              <input type="text" value={draft.apiHost} onChange={(e) => setDraft({ ...draft, apiHost: e.target.value })} />
            </Field>
            <Field label="Port">
              <input type="number" value={draft.apiPort} onChange={(e) => setDraft({ ...draft, apiPort: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="API token" hint="Used as a Bearer token by the Hunter addon. Never shared outside this machine.">
            <div className="row" style={{ gap: 8 }}>
              <input
                type="text"
                value={revealToken ? token : '•'.repeat(Math.min(32, token.length))}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button small onClick={() => setRevealToken((v) => !v)}>{revealToken ? 'Hide' : 'Show'}</Button>
              <Button small onClick={regenerate}>Regenerate</Button>
            </div>
          </Field>
        </Card>

        <Card title="Logvex Hunter integration">
          <Field label="Hunter companion URL">
            <input type="text" value={draft.hunterAddonUrl} onChange={(e) => setDraft({ ...draft, hunterAddonUrl: e.target.value })} placeholder="http://127.0.0.1:8080" />
          </Field>
          <Field label="Hunter companion token">
            <input type="password" value={draft.hunterAddonToken} onChange={(e) => setDraft({ ...draft, hunterAddonToken: e.target.value })} />
          </Field>
          <div className="row">
            <Pill tone={store.hunterConnected ? 'success' : 'muted'}>{store.hunterConnected ? 'connected' : 'offline'}</Pill>
            <Button small onClick={async () => { const s = await fleet.hunterStatus(); push(s.connected ? 'Hunter reachable' : 'Hunter unreachable', s.connected ? 'success' : 'error'); }}>Test connection</Button>
          </div>
        </Card>
      </div>

      <Card title="Runtime">
        <div className="grid cols-3">
          <Field label="Autosave">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={draft.autosave} onChange={(e) => setDraft({ ...draft, autosave: e.target.checked })} />
              <span className="card-sub">Persist changes automatically</span>
            </label>
          </Field>
          <Field label="Notifications">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={draft.notify} onChange={(e) => setDraft({ ...draft, notify: e.target.checked })} />
              <span className="card-sub">Show notifications for warnings and errors</span>
            </label>
          </Field>
          <Field label="Max memory (MB)">
            <input type="number" value={draft.maxMemoryMb} onChange={(e) => setDraft({ ...draft, maxMemoryMb: Number(e.target.value) })} />
          </Field>
          <Field label="Backup interval (minutes)">
            <input type="number" value={draft.backupIntervalMinutes} onChange={(e) => setDraft({ ...draft, backupIntervalMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Log level">
            <select value={draft.logLevel} onChange={(e) => setDraft({ ...draft, logLevel: e.target.value as never })}>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
          </Field>
        </div>
        <Button variant="primary" onClick={save}>Save settings</Button>
      </Card>

      <Card title="Configuration management" sub="Export/import never includes credentials or tokens.">
        <div className="row">
          <Button onClick={exportConfig}>Export configuration</Button>
          <Button onClick={importConfig}>Import configuration</Button>
          <Button onClick={backup}>Backup database</Button>
        </div>
      </Card>
    </div>
  );
}
