/**
 * Overview / command center landing page.
 *
 * Summarises the whole fleet: role distribution, running instances, recent events and quick
 * navigation into the detailed pages.
 */
import { useStore } from '../lib/store';
import { Card, Stat, Pill, RolePill, Dot, Empty, Button } from '../components/ui';
import { formatUptime, formatTime } from '../lib/format';
import type { PageId } from '../App';

export function OverviewPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const store = useStore();
  const running = store.instances.filter((i) => i.state === 'RUNNING');
  const failed = store.instances.filter((i) => i.state === 'FAILED');
  const byRole = (role: string): number => store.instances.filter((i) => i.role === role).length;

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="grid cols-4">
        <Card><Stat value={store.instances.length} label="Total instances" /></Card>
        <Card><Stat value={<span style={{ color: 'var(--success)' }}>{running.length}</span>} label="Running" /></Card>
        <Card><Stat value={<span style={{ color: failed.length ? 'var(--error)' : undefined }}>{failed.length}</span>} label="Failed" /></Card>
        <Card><Stat value={store.targets.length} label="Tracked targets" /></Card>
      </div>

      <div className="grid cols-3">
        <Card title="Role distribution">
          <div className="col">
            {['GEARER', 'STASIS', 'HUNTER'].map((role) => (
              <div key={role} className="row between">
                <RolePill role={role} />
                <strong>{byRole(role)}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Fleet health" actions={<Button small onClick={() => onNavigate('instances')}>Manage</Button>}>
          <div className="col">
            <div className="row between"><span className="card-sub">Accounts</span><strong>{store.accounts.length}</strong></div>
            <div className="row between"><span className="card-sub">Deployable accounts</span><strong>{store.accounts.filter((a) => a.deployable).length}</strong></div>
            <div className="row between"><span className="card-sub">Server profiles</span><strong>{store.servers.length}</strong></div>
            <div className="row between"><span className="card-sub">Deployments</span><strong>{store.deployments.length}</strong></div>
            <div className="row between"><span className="card-sub">Uptime</span><strong>{formatUptime(store.health?.uptimeMs ?? 0)}</strong></div>
          </div>
        </Card>

        <Card title="Integrations">
          <div className="col">
            <div className="row between">
              <span className="card-sub">Logvex Hunter</span>
              <Pill tone={store.hunterConnected ? 'success' : 'muted'}>{store.hunterConnected ? 'linked' : 'offline'}</Pill>
            </div>
            <div className="row between"><span className="card-sub">Database</span><Pill tone={store.health?.database.ok ? 'success' : 'error'}>{store.health?.database.ok ? 'ok' : 'error'}</Pill></div>
            <div className="row between"><span className="card-sub">Stasis locations</span><strong>{store.stasis.length}</strong></div>
            <div className="row between"><span className="card-sub">Equipment profiles</span><strong>{store.equipment.length}</strong></div>
          </div>
        </Card>
      </div>

      <Card
        title="Bot cards"
        actions={<Button small onClick={() => onNavigate('deployment')}>Deploy bots</Button>}
      >
        {store.instances.length === 0 ? (
          <Empty>No instances yet. Create accounts and launch a deployment to populate the fleet.</Empty>
        ) : (
          <div className="grid auto">
            {store.instances.map((instance) => (
              <div key={instance.id} className={`bot-card ${instance.state === 'RUNNING' ? 'running' : instance.state === 'FAILED' ? 'failed' : ''}`}>
                <div className="row">
                  <div className="avatar">{instance.accountUsername.charAt(0).toUpperCase()}</div>
                  <div className="col" style={{ gap: 2, flex: 1 }}>
                    <strong>{instance.accountUsername}</strong>
                    <span className="card-sub mono" style={{ fontSize: 11 }}>{instance.name}</span>
                  </div>
                  <RolePill role={instance.role} />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Dot state={instance.connection} />
                  <span className="card-sub">{instance.state}</span>
                  <div className="spacer" />
                  <span className="card-sub">{formatUptime(instance.uptimeMs)}</span>
                </div>
                {instance.lastEvent && <div className="card-sub" style={{ fontSize: 11, opacity: 0.8 }}>{instance.lastEvent}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent combat & fleet events" actions={<Button small onClick={() => onNavigate('events')}>Event Center</Button>}>
        {store.events.length === 0 ? (
          <Empty>No events recorded yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Time</th><th>Type</th><th>Source</th><th>Message</th></tr>
            </thead>
            <tbody>
              {store.events.slice(0, 8).map((event) => (
                <tr key={event.id}>
                  <td className="mono">{formatTime(event.timestamp)}</td>
                  <td><Pill tone={event.severity}>{event.type}</Pill></td>
                  <td className="card-sub">{event.source}</td>
                  <td>{event.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
