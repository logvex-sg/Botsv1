/**
 * First screen: choose HOST MODE or WORKER MODE.
 *
 * The two are separate configuration modes and their settings are never mixed. Host mode is this
 * machine acting as the controller; Worker mode is this machine being controlled by another host.
 * The choice is persisted, and the correct setup panel is shown immediately afterwards.
 */
import { useState } from 'react';
import { fleet } from '../lib/api';
import { Button, Card, Field } from '../components/ui';
import { copyText, toFriendlyError } from '../lib/errors';
import type { AppSettings, AppMode, PairingCode } from '../../shared/types';

interface Props {
  settings: AppSettings;
  push: (message: string, tone?: string) => void;
  onDone: () => Promise<void>;
  onMode: (mode: AppMode) => Promise<void>;
}

export function ModePage({ settings, push, onDone, onMode }: Props) {
  const mode = settings.mode;
  return (
    <div className="app" style={{ display: 'block' }}>
      <div className="content" style={{ maxWidth: 980, margin: '0 auto' }}>
        <div className="hero">
          <h1>Logvex Fleet Manager</h1>
          <div className="card-sub">Control real Minecraft clients running the Logvex Worker mod — from one host.</div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <ModeCard
            title="HOST MODE"
            active={mode === 'host'}
            blurb="This computer controls the fleet. It listens for workers, shows every connected client, and sends tasks."
            bullets={['Accept worker connections', 'Pair clients with a code', 'Control workers individually or in groups']}
            onSelect={() => void onMode('host')}
          />
          <ModeCard
            title="WORKER MODE"
            active={mode === 'worker'}
            blurb="This computer is controlled by another host. It connects out to that host and runs the tasks it is given."
            bullets={['Connect to a host', 'Pair with a pairing code', 'No inbound port needed']}
            onSelect={() => void onMode('worker')}
          />
        </div>

        {mode === 'host'
          ? <HostSetup settings={settings} push={push} onDone={onDone} />
          : <WorkerSetup settings={settings} push={push} onDone={onDone} />}
      </div>
    </div>
  );
}

function ModeCard({ title, blurb, bullets, active, onSelect }: {
  title: string; blurb: string; bullets: string[]; active: boolean; onSelect: () => void;
}) {
  return (
    <div className="card" style={{ borderColor: active ? 'var(--accent)' : 'var(--border)' }}>
      <div className="card-title" style={{ fontSize: 18 }}>{title}</div>
      <div className="card-sub" style={{ marginBottom: 10 }}>{blurb}</div>
      <ul style={{ margin: '0 0 14px 18px', color: 'var(--text-dim)', lineHeight: 1.7 }}>
        {bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>
      <Button variant={active ? 'primary' : 'default'} onClick={onSelect}>
        {active ? '✓ Selected' : `Choose ${title.split(' ')[0]}`}
      </Button>
    </div>
  );
}

function HostSetup({ settings, push, onDone }: { settings: AppSettings; push: (m: string, t?: string) => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);

  const createCode = async (): Promise<void> => {
    setBusy(true);
    try {
      setCode(await fleet.createPairingCode());
      push('Pairing code created — it admits one worker and expires shortly.');
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Host setup" sub="Three steps. The service is already listening by default.">
      <ol style={{ margin: '0 0 14px 18px', lineHeight: 1.9 }}>
        <li>Create the host (this computer).</li>
        <li>Generate a pairing code and give it to each worker once.</li>
        <li>Open the dashboard.</li>
      </ol>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" disabled={busy} onClick={() => void createCode()}>Generate pairing code</Button>
        {code && (
          <>
            <span className="mono" style={{ fontSize: 22, letterSpacing: 4, padding: '4px 12px', border: '1px dashed var(--accent)', borderRadius: 8 }}>{code.code}</span>
            <Button small onClick={() => void copyText(code.code).then(() => push('Pairing code copied'))}>Copy</Button>
            <span className="card-sub" style={{ color: 'var(--text-dim)' }}>expires {new Date(code.expiresAt).toLocaleTimeString()}</span>
          </>
        )}
        <div className="spacer" />
        <Button onClick={() => void onDone()}>Open dashboard →</Button>
      </div>
      <div className="card-sub" style={{ marginTop: 12 }}>
        The host listens on <span className="mono">{settings.workerServerHost}:{settings.workerServerPort}</span>.
        Change the port or bind address on the Settings page if a worker is on another computer.
      </div>
    </Card>
  );
}

function WorkerSetup({ settings, push, onDone }: { settings: AppSettings; push: (m: string, t?: string) => void; onDone: () => Promise<void> }) {
  const [host, setHost] = useState(settings.workerServerHost === '127.0.0.1' ? '127.0.0.1' : settings.workerServerHost);
  const [port, setPort] = useState(String(settings.workerServerPort));
  const [pairingCode, setPairingCode] = useState('');

  const connect = async (): Promise<void> => {
    try {
      const portNumber = Number.parseInt(port, 10);
      if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
        push('Enter a valid port (1–65535).', 'error');
        return;
      }
      await fleet.saveSettings({ workerServerHost: host.trim(), workerServerPort: portNumber });
      push('Worker connection saved. Launch Minecraft with the Logvex Worker mod to connect.');
      await onDone();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  };

  return (
    <Card title="Worker setup" sub="Point this machine at the host, then pair it once.">
      <div className="grid" style={{ gridTemplateColumns: '1fr 140px', gap: 12 }}>
        <Field label="Host address" hint="The host computer's address or IP.">
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" />
        </Field>
        <Field label="Port">
          <input className="input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="8721" />
        </Field>
      </div>
      <Field label="Pairing code" hint="Shown on the host. One code pairs one worker.">
        <input className="input mono" value={pairingCode} onChange={(e) => setPairingCode(e.target.value.toUpperCase())} placeholder="ABCD2345" />
      </Field>
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <Button variant="primary" onClick={() => void connect()}>Save &amp; connect</Button>
      </div>
      <div className="card-sub" style={{ marginTop: 12 }}>
        In-game, open the Worker's settings (Meteor ClickGUI → Fleet Manager → Worker Connection) and enter the
        same host, port and pairing code. This desktop app shows the fleet; the Minecraft client does the work.
      </div>
    </Card>
  );
}
