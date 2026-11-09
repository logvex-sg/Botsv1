/**
 * Fleet dashboard: the "is everything all right?" screen.
 *
 * Shows the host's own listening address (with a copy button, so pasting it into a worker's config
 * is one click), the worker roster at a glance, active tasks and the most recent worker events.
 * Everything on this page is read from the store, which the main process keeps current.
 */
import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, Empty, Pill, Ring, Stat } from '../../components/ui';
import { copyText } from '../../lib/errors';
import { relativeTime } from '../../lib/format';
import { StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
  onOpenTab: (tab: 'workers' | 'tasks' | 'inventory' | 'commands') => void;
}

export function FleetDashboardTab({ push, onOpenTab }: Props) {
  const store = useStore();
  const [server, setServer] = useState<{ enabled: boolean; host: string; port: number; bound: boolean; token: string } | null>(null);

  const overview = store.workerOverview;
  const workers = store.workers;
  const online = workers.filter((w) => w.online);
  const tasks = store.workerTasks;
  const activeTasks = tasks.filter((t) => t.status === 'PENDING' || t.status === 'DISPATCHED');

  const loadServer = useCallback(async (): Promise<void> => {
    try {
      setServer(await fleet.getWorkerServer());
    } catch {
      // The host may be shutting down; the card simply stays blank rather than throwing.
    }
  }, []);

  useEffect(() => {
    void loadServer();
  }, [loadServer]);

  const healthy = workers.length > 0 ? online.length / workers.length : 0;
  const connectHint = server
    ? `${server.host === '127.0.0.1' ? '127.0.0.1' : server.host}:${server.port}`
    : '—';

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Card><Stat value={workers.length} label="Workers known" /></Card>
        <Card><Stat value={online.length} label="Connected now" /></Card>
        <Card><Stat value={activeTasks.length} label="Tasks in flight" /></Card>
        <Card><Stat value={overview?.trackedItems ?? 0} label="Items tracked" /></Card>
      </div>

      <Card
        title="Host listening address"
        sub="Put this in each worker's config/logvex-worker.json, together with the token below."
        actions={<Button small variant="ghost" onClick={() => void loadServer()}>Refresh</Button>}
      >
        {server && !server.enabled && (
          <Callout tone="warning" title="The worker server is switched off">
            Turn on "Accept worker connections" in Settings so clients can connect.
          </Callout>
        )}
        {server && server.enabled && !server.bound && (
          <Callout tone="error" title="The worker server is not listening">
            The port could not be opened. Check the port in Settings; another program may be using it.
          </Callout>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: server && server.enabled ? 8 : 0 }}>
          <div className="mono" style={{ fontSize: 13 }}>{connectHint}</div>
          <Button
            small
            variant="ghost"
            onClick={async () => {
              const ok = await copyText(connectHint);
              push(ok ? 'Address copied' : 'Could not copy the address');
            }}
          >
            Copy address
          </Button>
          <Button
            small
            variant="ghost"
            onClick={async () => {
              if (!server) return;
              const ok = await copyText(server.token);
              push(ok ? 'Token copied' : 'Could not copy the token');
            }}
          >
            Copy token
          </Button>
        </div>
        <div className="card-sub" style={{ marginTop: 8 }}>
          Workers dial out to this address, so no worker needs an open inbound port. Keep the host
          reachable: on a home network use this machine's LAN address instead of 127.0.0.1.
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 16 }}>
        <Card title="Fleet health">
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <Ring value={healthy} label={`${Math.round(healthy * 100)}%`} color={healthy === 1 ? 'var(--success)' : healthy > 0.5 ? 'var(--accent)' : 'var(--warning)'} />
            <div className="col" style={{ gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
              <span>{online.length} of {workers.length} clients connected</span>
              <span>{overview?.degraded ?? 0} unresponsive</span>
              <span>{overview?.activeTasks ?? 0} task(s) in flight</span>
            </div>
          </div>
          {workers.length === 0 && (
            <Callout tone="info" title="No workers yet" >
              Install the worker mod in a Minecraft client, point it at the address above, and it will
              appear here within a few seconds of joining a world.
            </Callout>
          )}
        </Card>

        <Card
          title="Connected workers"
          sub="Live state reported by each client on its heartbeat."
          actions={<Button small variant="ghost" onClick={() => onOpenTab('workers')}>Open roster</Button>}
        >
          {workers.length === 0 && <Empty>Nothing connected yet.</Empty>}
          {workers.slice(0, 8).map((worker) => (
            <div key={worker.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 10 }}>
                <StatusChip worker={worker} />
                <span style={{ fontWeight: 600 }}>{workerTitle(worker)}</span>
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{worker.snapshot.dimension}</span>
              </div>
              <div className="row" style={{ gap: 10, fontSize: 12, color: 'var(--text-dim)' }}>
                <span>{worker.snapshot.inWorld ? `${worker.snapshot.x.toFixed(0)}, ${worker.snapshot.y.toFixed(0)}, ${worker.snapshot.z.toFixed(0)}` : 'not in a world'}</span>
                <span>❤ {worker.snapshot.health.toFixed(0)}</span>
                <span>{worker.snapshot.armorPieces}/4 armor</span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card
          title="Active tasks"
          sub="Only tasks a worker has not answered yet."
          actions={<Button small variant="ghost" onClick={() => onOpenTab('tasks')}>All tasks</Button>}
        >
          {activeTasks.length === 0 && <Empty>No tasks are running.</Empty>}
          {activeTasks.slice(0, 8).map((task) => (
            <div key={task.id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span><Pill tone="connecting">{task.kind}</Pill> {task.workerId}</span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{relativeTime(task.createdAt)}</span>
            </div>
          ))}
        </Card>

        <Card
          title="Recent worker activity"
          sub="Connection, task and command events."
          actions={<Button small variant="ghost" onClick={() => onOpenTab('commands')}>Command log</Button>}
        >
          {(overview?.recent ?? []).length === 0 && <Empty>No worker activity recorded yet.</Empty>}
          {(overview?.recent ?? []).slice(0, 10).map((event) => (
            <div key={event.id} className="row between" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12 }}>{event.message}</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{relativeTime(event.timestamp)}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
