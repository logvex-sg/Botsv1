/**
 * Settings: the small set of host knobs that actually matter.
 *
 * The worker server (address, port, shared token), pairing-code lifetime, appearance and the local
 * API. Nothing here is decorative — each control writes through to the host and takes effect.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Callout, Card, Field } from '../components/ui';
import { copyText, toFriendlyError } from '../lib/errors';
import type { AppSettings, UiMode } from '../../shared/types';
import type { WorkerServerStatus } from '../../shared/ipc';

interface Props {
  push: (message: string, tone?: string) => void;
  uiMode: UiMode;
}

export function SettingsPage({ push }: Props) {
  const store = useStore();
  const [settings, setSettings] = useState<AppSettings | null>(store.settings);
  const [server, setServer] = useState<WorkerServerStatus | null>(store.workerServer);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [ttl, setTtl] = useState('600');
  const [revealToken, setRevealToken] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [next, srv] = await Promise.all([fleet.getSettings(), fleet.getWorkerServer()]);
      setSettings(next);
      setServer(srv);
      setHost(next.workerServerHost);
      setPort(String(next.workerServerPort));
      setTtl(String(next.pairingCodeTtlSeconds));
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  }, [push]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    try {
      const next = await fleet.saveSettings(patch);
      setSettings(next);
      await store.refresh();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  }, [push, store]);

  const saveServer = useCallback(async (): Promise<void> => {
    const portNumber = Number.parseInt(port, 10);
    if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
      push('Enter a valid port (1–65535).', 'error');
      return;
    }
    const ttlNumber = Number.parseInt(ttl, 10);
    await save({
      workerServerHost: host.trim() || '127.0.0.1',
      workerServerPort: portNumber,
      pairingCodeTtlSeconds: Number.isFinite(ttlNumber) && ttlNumber >= 30 ? ttlNumber : 600,
    });
    push('Worker server settings saved');
    await load();
  }, [host, port, ttl, save, push, load]);

  const regenerate = useCallback(async (): Promise<void> => {
    await fleet.regenerateWorkerToken();
    push('Worker token regenerated — connected workers must be re-paired.', 'error');
    await load();
  }, [push, load]);

  if (!settings) return <div className="empty">Loading settings…</div>;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Worker server" sub="Where workers connect to this host.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 140px 160px', gap: 12 }}>
          <Field label="Bind address" hint="127.0.0.1 keeps it local; use 0.0.0.0 to reach other PCs.">
            <input className="input" value={host} onChange={(e) => setHost(e.target.value)} />
          </Field>
          <Field label="Port">
            <input className="input" value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
          <Field label="Pairing code TTL (s)">
            <input className="input" value={ttl} onChange={(e) => setTtl(e.target.value)} />
          </Field>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <Button variant="primary" onClick={() => void saveServer()}>Save &amp; restart listener</Button>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings.workerServerEnabled}
              onChange={(e) => void save({ workerServerEnabled: e.target.checked })}
            />
            Accept worker connections
          </label>
          <span className="card-sub" style={{ color: server?.bound ? 'var(--ok)' : 'var(--text-dim)' }}>
            {server?.bound ? `Listening on ${server.host}:${server.port}` : 'Not listening'}
          </span>
        </div>
      </Card>

      <Card title="Shared token" sub="What a worker presents after pairing. Regenerating invalidates every paired worker.">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 15 }}>{revealToken ? server?.token ?? '' : '••••••••••••••••••••'}</span>
          <Button small onClick={() => setRevealToken((v) => !v)}>{revealToken ? 'Hide' : 'Reveal'}</Button>
          <Button small onClick={() => void copyText(server?.token ?? '').then(() => push('Token copied'))}>Copy</Button>
          <Button small variant="danger" onClick={() => void regenerate()}>Regenerate</Button>
        </div>
      </Card>

      <Card title="Appearance" sub="Local to this app.">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button onClick={() => void save({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
            {settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          </Button>
          <Button onClick={() => void save({ uiMode: settings.uiMode === 'beginner' ? 'advanced' : 'beginner' })}>
            {settings.uiMode === 'beginner' ? 'Switch to advanced mode' : 'Switch to beginner mode'}
          </Button>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={settings.notify} onChange={(e) => void save({ notify: e.target.checked })} />
            Desktop notifications
          </label>
        </div>
      </Card>

      <Card title="Local API" sub="For scripts and other tools. Bearer token, loopback by default.">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="mono">{settings.apiHost}:{settings.apiPort}</span>
          <Button small onClick={() => void fleet.getApiToken().then((t) => copyText(t)).then(() => push('API token copied'))}>Copy API token</Button>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={settings.apiEnabled} onChange={(e) => void save({ apiEnabled: e.target.checked })} />
            Enable local API
          </label>
        </div>
      </Card>

      <Card title="Configuration" sub="Export or import worker groups and regear presets. The token is never included.">
        <div className="row" style={{ gap: 10 }}>
          <Button onClick={() => void fleet.exportConfig().then((r) => push(r ? `Exported to ${r.path}` : 'Export cancelled'))}>Export configuration</Button>
          <Button onClick={() => void fleet.importConfig().then((r) => push(r ? `Imported ${r.imported} records` : 'Import cancelled'))}>Import configuration</Button>
        </div>
      </Card>

      <Card title="Mode" sub="Host mode controls workers; Worker mode points this machine at another host.">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Callout tone="info" title="Currently in HOST mode">
            To re-run the first-time setup and choose a mode again, use the button below.
          </Callout>
          <Button onClick={() => void save({ onboarded: false })}>Run first-time setup again</Button>
        </div>
      </Card>
    </div>
  );
}
