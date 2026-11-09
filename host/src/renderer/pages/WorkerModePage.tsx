/**
 * Worker Mode: this machine being controlled by a host.
 *
 * This is the counterpart to the Workers page. Where that page drives other people's clients, this
 * one configures *this* machine to be driven. It reuses the same protocol and the same wire client
 * the Fabric mod speaks, so a successful test here means a bot with the same settings will connect.
 *
 * The page is honest about what it is: the desktop app has no Minecraft client, so when it acts as a
 * worker it can answer status and inventory requests but refuses tasks that would need a game. The
 * panel says so rather than pretending otherwise. Its main job is to validate a host and to produce
 * the `logvex-worker.json` an operator drops into each bot's `mods/` folder.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fleet } from '../lib/api';
import { Button, Callout, Card, Field, Pill, Stat } from '../components/ui';
import { toFriendlyError } from '../lib/errors';
import { relativeTime } from '../lib/format';
import { WORKER_MODULES } from '../../shared/workers';
import type { WorkerClientStatus, WorkerModePatch, WorkerModeSettings } from '../../shared/types';

interface Props {
  push: (message: string, tone?: string) => void;
}

type State = WorkerClientStatus['state'];

const STATE_TONE: Record<State, string> = {
  idle: 'muted',
  connecting: 'accent',
  handshaking: 'accent',
  registered: 'online',
  refused: 'error',
  disconnected: 'warning',
};

const STATE_LABEL: Record<State, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  handshaking: 'Handshaking…',
  registered: 'Registered',
  refused: 'Refused',
  disconnected: 'Disconnected',
};

export function WorkerModePage({ push }: Props) {
  const [settings, setSettings] = useState<WorkerModeSettings | null>(null);
  const [status, setStatus] = useState<WorkerClientStatus | null>(null);
  const [logs, setLogs] = useState<{ at: number; message: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [provisionDir, setProvisionDir] = useState('');

  const load = useCallback(async () => {
    const [nextSettings, nextStatus, nextLogs] = await Promise.all([
      fleet.getWorkerModeSettings().catch(() => null),
      fleet.getWorkerModeStatus().catch(() => null),
      fleet.getWorkerModeLogs().catch(() => []),
    ]);
    if (nextSettings) setSettings(nextSettings);
    if (nextStatus) setStatus(nextStatus);
    setLogs(nextLogs);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void fleet.getWorkerModeStatus().then(setStatus).catch(() => {});
      void fleet.getWorkerModeLogs().then(setLogs).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async (patch: WorkerModePatch): Promise<void> => {
    const updated = await fleet.saveWorkerModeSettings(patch);
    setSettings(updated);
  };

  const run = async (label: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(label);
    try {
      await action();
      push(success);
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(null);
      await load();
    }
  };

  const registered = status?.state === 'registered';
  const moduleEntries = useMemo<[string, boolean][]>(
    () => Object.entries(settings?.modules ?? {}) as [string, boolean][],
    [settings],
  );

  if (!settings || !status) {
    return <Card title="Worker Mode"><div className="card-sub">Loading…</div></Card>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Worker Mode"
        sub="Make this machine a worker: it connects out to a host and runs the tasks it is given."
        actions={<Pill tone={STATE_TONE[status.state]}>{STATE_LABEL[status.state]}</Pill>}
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
          <Stat value={status.workerId || '—'} label="Worker id" />
          <Stat value={`v${status.protocolVersion}`} label="Protocol" />
          <Stat value={registered ? 'Yes' : 'No'} label="Registered" />
          <Stat value={status.paused ? 'Paused' : status.stopped ? 'Stopped' : 'Running'} label="Host control" />
        </div>

        <Callout tone={registered ? 'success' : 'info'} title={status.detail}>
          {registered
            ? 'The host accepted this machine. It will answer status and inventory requests; tasks that need a Minecraft client are refused, because this app has no game.'
            : 'Fill in the host address and either a shared token or a one-time pairing code, then test the connection before saving.'}
        </Callout>

        {status.lastError && <Callout tone="warning" title="Last error">{status.lastError}</Callout>}

        <div className="grid" style={{ gridTemplateColumns: '1fr 140px', gap: 12, marginTop: 14 }}>
          <Field label="Host address" hint="The controller's address or IP.">
            <input className="input" value={settings.hostAddress} onChange={(e) => void save({ hostAddress: e.target.value })} placeholder="192.168.1.20" />
          </Field>
          <Field label="Port">
            <input
              className="input"
              value={String(settings.hostPort)}
              onChange={(e) => {
                const port = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(port) && port > 0 && port <= 65535) void save({ hostPort: port });
              }}
              placeholder="8721"
            />
          </Field>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Shared token" hint="Used once paired. Leave blank to pair with a code.">
            <input className="input mono" value={settings.token} onChange={(e) => void save({ token: e.target.value.trim() })} placeholder="granted by the host" />
          </Field>
          <Field label="One-time pairing code" hint="Shown on the host; one code admits one worker.">
            <input className="input mono" value={settings.pairingCode} onChange={(e) => void save({ pairingCode: e.target.value.toUpperCase() })} placeholder="ABCD2345" />
          </Field>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 140px', gap: 12 }}>
          <Field label="Display name" hint="How the host labels this worker.">
            <input className="input" value={settings.workerName} onChange={(e) => void save({ workerName: e.target.value })} placeholder="Bot-A" />
          </Field>
          <Field label="Group" hint="A label the host can bulk-control by.">
            <input className="input" value={settings.groupName} onChange={(e) => void save({ groupName: e.target.value })} placeholder="default" />
          </Field>
          <Field label="Heartbeat (s)">
            <input
              className="input"
              value={String(settings.heartbeatSeconds)}
              onChange={(e) => {
                const seconds = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(seconds) && seconds >= 1 && seconds <= 120) void save({ heartbeatSeconds: seconds });
              }}
            />
          </Field>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <Button disabled={busy !== null} onClick={() => void run('test', async () => {
            const result = await fleet.testWorkerModeConnection();
            if (result.state !== 'registered') throw new Error(result.lastError || 'The host refused the connection');
          }, 'The host accepted the handshake')}>Test connection</Button>
          <Button
            variant="primary"
            disabled={busy !== null || registered}
            onClick={() => void run('connect', () => fleet.connectWorkerMode(), 'Worker Mode is connecting to the host')}
          >
            Connect
          </Button>
          <Button
            variant="danger"
            disabled={busy !== null || !registered}
            onClick={() => void run('disconnect', () => fleet.disconnectWorkerMode(), 'Worker Mode disconnected')}
          >
            Disconnect
          </Button>
          <label className="row" style={{ gap: 6, marginLeft: 8, fontSize: 13 }}>
            <input type="checkbox" checked={settings.autoConnect} onChange={(e) => void save({ autoConnect: e.target.checked })} />
            Connect automatically at start-up
          </label>
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Modules" sub="Turn parts of the worker on or off. The host only sees what is enabled.">
          <div className="col" style={{ gap: 6 }}>
            {moduleEntries.map(([name, enabled]) => (
              <label key={name} className="row" style={{ gap: 8, justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{name}</span>
                <input type="checkbox" checked={enabled} onChange={(e) => void save({ modules: { [name]: e.target.checked } })} />
              </label>
            ))}
            {moduleEntries.length === 0 && <div className="card-sub">No modules reported.</div>}
          </div>
        </Card>

        <Card title="Task permissions" sub="Which mutating task categories this worker will accept.">
          <div className="col" style={{ gap: 6 }}>
            {(['regear', 'command', 'chat', 'efly'] as const).map((key) => (
              <label key={key} className="row" style={{ gap: 8, justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ textTransform: 'capitalize' }}>{key}</span>
                <input
                  type="checkbox"
                  checked={settings.permissions[key]}
                  onChange={(e) => void save({ permissions: { [key]: e.target.checked } })}
                />
              </label>
            ))}
          </div>
          <div className="card-sub" style={{ marginTop: 10 }}>
            {WORKER_MODULES.length} modules are known to this build. A disabled module is not offered to the host.
          </div>
        </Card>
      </div>

      <Card title="Provision a bot" sub="Write the config file a Minecraft client needs, then drop it into that bot's mods/ folder.">
        <div className="grid" style={{ gridTemplateColumns: '1fr 200px', gap: 12 }}>
          <Field label="Target folder" hint="Usually the bot's .minecraft folder, or anywhere you collect configs.">
            <input className="input mono" value={provisionDir} onChange={(e) => setProvisionDir(e.target.value)} placeholder="/home/me/bots/bot-a/.minecraft" />
          </Field>
          <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
            <Button
              variant="primary"
              disabled={busy !== null || provisionDir.trim().length === 0}
              onClick={() => void run('provision', async () => {
                const result = await fleet.provisionWorkerConfig(provisionDir.trim());
                if (!result.ok) throw new Error(result.error ?? 'Could not write the worker config');
              }, 'Worker config written — copy logvex-worker.json into the bot\'s mods/ folder')}
            >
              Write config
            </Button>
          </div>
        </div>
        <div className="card-sub" style={{ marginTop: 8 }}>
          The file (<span className="mono">logvex-worker.json</span>) holds the host address, port, token or
          pairing code, a stable worker id, the module toggles and the permissions above. It is the same
          settings shown on this page, so what you test here is exactly what the bot will use.
        </div>
      </Card>

      <Card title="Connection log" sub="The most recent lines from this worker's connection." actions={<Button small variant="ghost" onClick={() => void load()}>Refresh</Button>}>
        {logs.length === 0
          ? <div className="card-sub">Nothing yet. Connect or test a connection to see activity.</div>
          : (
            <div
              style={{
                maxHeight: 220,
                overflowY: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                background: 'var(--bg-sunken, #0d1117)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {logs.slice(-60).reverse().map((line, index) => (
                <div key={`${line.at}-${index}`} className="row" style={{ gap: 10 }}>
                  <span style={{ color: 'var(--text-dim)', minWidth: 72 }}>{relativeTime(line.at)}</span>
                  <span>{line.message}</span>
                </div>
              ))}
            </div>
          )}
      </Card>
    </div>
  );
}
