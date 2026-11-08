/**
 * Hunter Manager page.
 *
 * Shows Logvex Hunter integration status, module status and the combat-testing authorisation gate.
 * Combat testing is off by default and requires an explicit per-instance authorisation plus an
 * allow-list; this page never arms combat on its own.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Pill, RolePill } from '../components/ui';
import { relativeTime } from '../lib/format';

interface Props { push: (message: string, tone?: string) => void }

export function HunterPage({ push }: Props) {
  const store = useStore();
  const [status, setStatus] = useState<{ connected: boolean; url: string; lastSync: number | null } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = async (): Promise<void> => {
    setStatus(await fleet.hunterStatus().catch(() => ({ connected: false, url: '', lastSync: null })));
  };

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const sync = async (): Promise<void> => {
    setSyncing(true);
    const result = await fleet.syncTargets();
    setSyncing(false);
    if (result.errors.length > 0) push(`Sync finished with ${result.errors.length} error(s)`, 'warning');
    else push(`Synced ${result.pulled} targets from Hunter`, 'success');
    await store.refreshTargets();
  };

  const hunterInstances = store.instances.filter((i) => i.role === 'HUNTER');

  const setCombat = async (instanceId: string, enabled: boolean): Promise<void> => {
    const instance = store.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    if (enabled && !confirm(
      'Enable controlled combat testing for this HUNTER?\n\n' +
      'This only arms targets on the explicit allow-list and must be used on a private test server you are authorised to use.',
    )) return;
    await fleet.updateInstance(instanceId, {
      config: { ...instance.config, combatEnabled: enabled, authorizedCombat: enabled },
    } as never);
    push(enabled ? 'Combat testing enabled (allow-list only)' : 'Combat testing disabled', enabled ? 'warning' : 'success');
    await store.refreshInstances();
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid cols-3">
        <Card title="Logvex Hunter link">
          <div className="col">
            <div className="row between"><span className="card-sub">Status</span><Pill tone={status?.connected ? 'success' : 'muted'}>{status?.connected ? 'connected' : 'offline'}</Pill></div>
            <div className="row between"><span className="card-sub">Endpoint</span><span className="mono" style={{ fontSize: 11 }}>{status?.url || '—'}</span></div>
            <div className="row between"><span className="card-sub">Last sync</span><span className="card-sub">{relativeTime(status?.lastSync)}</span></div>
            <Button small onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync targets now'}</Button>
          </div>
        </Card>
        <Card title="Shared target database">
          <div className="col">
            <div className="row between"><span className="card-sub">Targets</span><strong>{store.targets.length}</strong></div>
            <div className="row between"><span className="card-sub">Priority</span><strong>{store.targets.filter((t) => t.category === 'PRIORITY').length}</strong></div>
            <div className="row between"><span className="card-sub">Ignore list</span><strong>{store.targets.filter((t) => t.category === 'IGNORE').length}</strong></div>
            <div className="row between"><span className="card-sub">Encounter total</span><strong>{store.targets.reduce((sum, t) => sum + t.encounters, 0)}</strong></div>
          </div>
        </Card>
        <Card title="Meteor combat modules">
          <div className="col">
            {['KillAura', 'AutoTotem', 'AutoArmor', 'AutoWeapon', 'AutoEat', 'Surround', 'HoleFill'].map((module) => (
              <div key={module} className="row between">
                <span className="card-sub">{module}</span>
                <Pill tone={status?.connected ? 'info' : 'muted'}>{status?.connected ? 'available' : 'unknown'}</Pill>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="HUNTER instances" sub="Controlled combat testing is gated per instance and off by default.">
        {hunterInstances.length === 0 ? (
          <Empty>No HUNTER instances. Assign the HUNTER role in the Deployment Center or Instance Manager.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Instance</th><th>Account</th><th>State</th><th>Target list</th><th>Combat testing</th><th>Allow-list</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {hunterInstances.map((instance) => {
                const allowlist = Array.isArray(instance.config.allowlist) ? (instance.config.allowlist as string[]) : [];
                const combat = Boolean(instance.config.combatEnabled);
                return (
                  <tr key={instance.id}>
                    <td><strong>{instance.name}</strong></td>
                    <td className="card-sub">{instance.accountUsername}</td>
                    <td><Pill tone={instance.state === 'RUNNING' ? 'success' : 'muted'}>{instance.state}</Pill></td>
                    <td className="card-sub">{String(instance.config.targetListId ?? '—') || '—'}</td>
                    <td><Pill tone={combat ? 'warning' : 'muted'}>{combat ? 'enabled' : 'disabled'}</Pill></td>
                    <td className="card-sub" style={{ fontSize: 11 }}>{allowlist.length > 0 ? allowlist.join(', ') : 'none'}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        {combat
                          ? <Button small onClick={() => setCombat(instance.id, false)}>Disable combat</Button>
                          : <Button small variant="primary" onClick={() => setCombat(instance.id, true)}>Enable combat</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="card-sub" style={{ marginTop: 12 }}>
          <RolePill role="HUNTER" /> Combat is delegated to the Logvex Hunter addon and restricted to allow-listed targets on
          private test environments. The fleet never attacks arbitrary players.
        </div>
      </Card>
    </div>
  );
}
