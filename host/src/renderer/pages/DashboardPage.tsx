/**
 * Dashboard: the "is everything all right?" screen.
 *
 * Shows the host's own listening address (with a copy button, so pasting it into a worker is one
 * click), a pairing-code panel, the worker roster at a glance, active tasks and the most recent
 * worker events. Everything is read from the store, which the main process keeps current.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Callout, Card, Empty, Pill, Ring, Stat } from '../components/ui';
import { copyText, toFriendlyError } from '../lib/errors';
import { relativeTime } from '../lib/format';
import { StatusChip, workerTitle } from './workers/shared';
import type { PairingCode } from '../../shared/types';
import type { PageId } from '../App';

interface Props {
  push: (message: string, tone?: string) => void;
  onNavigate: (page: PageId) => void;
}

export function DashboardPage({ push, onNavigate }: Props) {
  const store = useStore();
  const [code, setCode] = useState<PairingCode | null>(store.pairingCode);

  const overview = store.workerOverview;
  const workers = store.workers;
  const online = workers.filter((w) => w.online);
  const tasks = store.workerTasks;
  const activeTasks = tasks.filter((t) => t.status === 'PENDING' || t.status === 'DISPATCHED');

  useEffect(() => { setCode(store.pairingCode); }, [store.pairingCode]);

  const server = store.workerServer;
  const address = server ? `${server.host}:${server.port}` : '—';

  const createCode = useCallback(async (): Promise<void> => {
    try {
      const created = await fleet.createPairingCode();
      setCode(created);
      store.setPairingCode(created);
      push('Pairing code created — it admits one worker and expires shortly.');
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  }, [push, store]);

  const clearCode = useCallback(async (): Promise<void> => {
    await fleet.clearPairingCode();
    setCode(null);
    store.setPairingCode(null);
    push('Pairing code cleared');
  }, [push, store]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat value={online.length} label="Workers online" />
        <Stat value={workers.length} label="Workers known" />
        <Stat value={activeTasks.length} label="Active tasks" />
        <Stat value={overview?.trackedItems ?? 0} label="Tracked items" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <Card title="Host" sub="This computer is the controller. Workers connect out to it.">
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone={server?.bound ? 'online' : 'muted'}>{server?.bound ? 'Listening' : 'Not listening'}</Pill>
            <span className="mono" style={{ fontSize: 16 }}>{address}</span>
            <Button small onClick={() => void copyText(address).then((ok) => push(ok ? 'Address copied' : 'Copy failed', ok ? undefined : 'error'))}>Copy address</Button>
            <Button small onClick={() => onNavigate('settings')}>Worker server settings</Button>
          </div>
          <div className="card-sub" style={{ marginTop: 10 }}>
            A worker needs this address and a pairing code. One code pairs one worker and expires.
          </div>
        </Card>

        <Card title="Pairing" sub="Give a code to each worker once.">
          {code ? (
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 24, letterSpacing: 5, padding: '4px 12px', border: '1px dashed var(--accent)', borderRadius: 8 }}>{code.code}</span>
              <Button small onClick={() => void copyText(code.code).then(() => push('Pairing code copied'))}>Copy</Button>
              <Button small variant="ghost" onClick={() => void clearCode()}>Clear</Button>
              <span className="card-sub" style={{ color: 'var(--text-dim)' }}>expires {new Date(code.expiresAt).toLocaleTimeString()}</span>
            </div>
          ) : (
            <Button variant="primary" onClick={() => void createCode()}>Generate pairing code</Button>
          )}
        </Card>
      </div>

      <Card
        title="Workers"
        sub="Every client that has connected, newest state first."
        actions={<Button small onClick={() => onNavigate('workers')}>Open Workers</Button>}
      >
        {workers.length === 0 ? (
          <Empty>No workers yet. Launch Minecraft with the Logvex Worker mod, enter the host address and a pairing code, and it will appear here.</Empty>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {workers.slice(0, 8).map((worker) => (
              <div key={worker.id} className="bot-card" onClick={() => onNavigate('workers')} style={{ cursor: 'pointer' }}>
                <div className="row between">
                  <strong>{workerTitle(worker)}</strong>
                  <StatusChip worker={worker} />
                </div>
                <div className="card-sub" style={{ marginTop: 6 }}>
                  {worker.snapshot.inWorld ? `${worker.snapshot.dimension.split(':').pop()} · ${Math.round(worker.snapshot.x)}, ${Math.round(worker.snapshot.y)}, ${Math.round(worker.snapshot.z)}` : 'Not in a world'}
                </div>
                <div className="row" style={{ gap: 12, marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
                  <span>♥ {Math.round(worker.snapshot.health)}/{Math.round(worker.snapshot.maxHealth)}</span>
                  <span>◈ {worker.snapshot.armorPieces} armor</span>
                  <span>☗ {worker.snapshot.totems} totems</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card title="Recent worker events" actions={<Button small onClick={() => onNavigate('consoles')}>Consoles</Button>}>
          {(overview?.recent ?? store.events).length === 0 ? (
            <Empty>Nothing has happened yet.</Empty>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {(overview?.recent ?? store.events).slice(0, 8).map((event) => (
                <div key={event.id} className="row between" style={{ gap: 10 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{relativeTime(event.timestamp)}</span>
                  <span style={{ flex: 1 }}>{event.message}</span>
                  <Pill tone={event.severity === 'error' ? 'error' : event.severity === 'success' ? 'online' : 'muted'}>{event.type.replace('WORKER_', '')}</Pill>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Fleet health" sub="How many clients are reachable right now.">
          <div className="row" style={{ gap: 20, alignItems: 'center' }}>
            <Ring value={workers.length === 0 ? 0 : online.length / workers.length} label={`${online.length}/${workers.length}`} />
            <div className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}><Pill tone="online">Online</Pill> {online.length}</div>
              <div className="row" style={{ gap: 8 }}><Pill tone="warning">Unresponsive</Pill> {workers.filter((w) => w.status === 'DEGRADED').length}</div>
              <div className="row" style={{ gap: 8 }}><Pill tone="muted">Offline</Pill> {workers.filter((w) => !w.online).length}</div>
            </div>
          </div>
        </Card>
      </div>

      {workers.length === 0 && (
        <Callout tone="info" title="Getting a worker connected">
          <ol style={{ margin: '0 0 0 18px', lineHeight: 1.8 }}>
            <li>Copy the host address above into the worker's config (or enter it in the in-game Worker settings).</li>
            <li>Generate a pairing code and enter it on the worker once.</li>
            <li>When it connects, it appears here and you can send it tasks.</li>
          </ol>
        </Callout>
      )}
    </div>
  );
}
