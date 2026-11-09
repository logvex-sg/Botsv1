/**
 * Instance Manager page.
 *
 * Live view of every instance with start/stop/restart controls, health, metrics, role config
 * editing and per-instance logs. Role can only be changed while the instance is stopped.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Dot, Empty, Field, Modal, Pill, ProgressBar, RolePill, Expandable } from '../components/ui';
import { formatUptime, formatBytes } from '../lib/format';
import { toFriendlyError } from '../lib/errors';
import type { RoleDefinition } from '../../main/services/roles/roles';
import type { InstanceRecord } from '../../shared/types';

interface Props { push: (message: string, tone?: string) => void }

export function InstancesPage({ push }: Props) {
  const store = useStore();
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RoleDefinition[]>([]);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    void fleet.getRoleCatalog().then(setCatalog);
  }, []);

  useEffect(() => {
    if (!logsFor) return;
    const load = async (): Promise<void> => setLogs(await fleet.getInstanceLogs(logsFor));
    void load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [logsFor]);

  const action = async (id: string, kind: 'start' | 'stop' | 'restart'): Promise<void> => {
    try {
      await fleet[`${kind}Instance` as const](id);
      push(`${kind} requested`, 'success');
      await store.refreshInstances();
    } catch (error) {
      push(toFriendlyError(error).title, 'error');
    }
  };

  const openConfig = async (instanceId: string): Promise<void> => {
    const instance = store.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    const roleDef = catalog.find((c) => c.role === instance.role);
    const base: Record<string, unknown> = { ...(instance.config ?? {}) };
    for (const field of roleDef?.fields ?? []) {
      if (base[field.key] === undefined) base[field.key] = field.default;
    }
    setDraft(base);
    setConfigFor(instanceId);
  };

  const saveConfig = async (): Promise<void> => {
    if (!configFor) return;
    await fleet.updateInstance(configFor, { config: draft } as Partial<InstanceRecord>);
    push('Instance configuration saved', 'success');
    setConfigFor(null);
    await store.refreshInstances();
  };

  const changeRole = async (id: string, role: string): Promise<void> => {
    const instance = store.instances.find((i) => i.id === id);
    if (!instance) return;
    if (instance.state !== 'STOPPED' && instance.state !== 'FAILED') {
      push('Stop the instance before changing its role.', 'error');
      return;
    }
    const roleDef = catalog.find((c) => c.role === role);
    const defaults: Record<string, unknown> = {};
    for (const field of roleDef?.fields ?? []) defaults[field.key] = field.default;
    await fleet.updateInstance(id, { role: role as never, config: defaults });
    push(`Role changed to ${role}`, 'success');
    await store.refreshInstances();
  };

  const remove = async (id: string, name: string): Promise<void> => {
    if (!confirm(`Delete instance "${name}"?`)) return;
    await fleet.deleteInstance(id);
    await store.refreshInstances();
  };

  const activeInstance = store.instances.find((i) => i.id === configFor);
  const activeRole = catalog.find((c) => c.role === activeInstance?.role);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Instances" sub="Runtime state for every controlled Minecraft client.">
        {store.instances.length === 0 ? (
          <Empty>No instances. Launch a deployment or create one manually.</Empty>
        ) : (
          <div className="grid auto">
            {store.instances.map((instance) => (
              <div key={instance.id} className={`bot-card ${instance.state === 'RUNNING' ? 'running' : instance.state === 'FAILED' ? 'failed' : ''}`}>
                <div className="row">
                  <div className="avatar" style={{ background: instance.role === 'GEARER' ? 'var(--gearer)' : instance.role === 'STASIS' ? 'var(--stasis)' : 'var(--hunter)' }}>
                    {instance.accountUsername.charAt(0).toUpperCase()}
                  </div>
                  <div className="col" style={{ gap: 2, flex: 1 }}>
                    <strong>{instance.name}</strong>
                    <span className="card-sub mono" style={{ fontSize: 11 }}>{instance.accountUsername}</span>
                  </div>
                  <RolePill role={instance.role} />
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <Dot state={instance.connection} />
                  <Pill tone={instance.state === 'RUNNING' ? 'success' : instance.state === 'FAILED' ? 'error' : 'muted'}>{instance.state}</Pill>
                  <div className="spacer" />
                  <span className="card-sub">{formatUptime(instance.uptimeMs)}</span>
                </div>

                <div className="col" style={{ gap: 6 }}>
                  <div className="row between">
                    <span className="card-sub" style={{ fontSize: 11 }}>Health {instance.health}%</span>
                    <span className="card-sub" style={{ fontSize: 11 }}>{formatBytes(instance.metrics.memoryBytes)} · {instance.metrics.cpuPercent.toFixed(0)}% cpu · {instance.metrics.ping}ms</span>
                  </div>
                  <ProgressBar value={instance.health} color={instance.health > 60 ? 'var(--success)' : instance.health > 30 ? 'var(--warning)' : 'var(--error)'} />
                </div>

                {instance.metrics.position && (
                  <div className="card-sub mono" style={{ fontSize: 11 }}>
                    {instance.metrics.position.x.toFixed(0)} {instance.metrics.position.y.toFixed(0)} {instance.metrics.position.z.toFixed(0)}
                    {instance.metrics.dimension && ` · ${instance.metrics.dimension.replace('minecraft:', '')}`}
                  </div>
                )}
                {instance.lastError && <div className="card-sub" style={{ color: 'var(--error)', fontSize: 11 }}>{instance.lastError}</div>}

                <div className="row wrap" style={{ gap: 6 }}>
                  {instance.state !== 'RUNNING' ? (
                    <Button small variant="primary" onClick={() => action(instance.id, 'start')}>Start</Button>
                  ) : (
                    <Button small onClick={() => action(instance.id, 'stop')}>Stop</Button>
                  )}
                  <Button small onClick={() => action(instance.id, 'restart')}>Restart</Button>
                  <Button small onClick={() => openConfig(instance.id)}>Config</Button>
                  <Button small onClick={() => setLogsFor(instance.id)}>Logs</Button>
                  <Button small variant="ghost" onClick={() => remove(instance.id, instance.name)}>✕</Button>
                </div>

                <select
                  value={instance.role}
                  onChange={(e) => changeRole(instance.id, e.target.value)}
                  disabled={instance.state !== 'STOPPED' && instance.state !== 'FAILED'}
                  title={instance.state !== 'STOPPED' && instance.state !== 'FAILED' ? 'Stop the instance before changing its role' : ''}
                >
                  {['GEARER', 'STASIS', 'HUNTER'].map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </Card>

      {logsFor && (
        <Modal title="Instance logs" wide onClose={() => setLogsFor(null)}>
          <div className="log-view">
            {logs.length === 0 ? <div className="line INFO">No log output yet.</div> : logs.map((line, index) => (
              <div key={index} className={`line ${line.includes(' ERROR ') ? 'ERROR' : line.includes(' WARN ') ? 'WARN' : 'INFO'}`}>{line}</div>
            ))}
          </div>
        </Modal>
      )}

      {configFor && activeInstance && (
        <Modal
          title={`Configure ${activeInstance.name}`}
          wide
          onClose={() => setConfigFor(null)}
          footer={<>
            <Button onClick={() => setConfigFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={saveConfig}>Save configuration</Button>
          </>}
        >
          <div className="row" style={{ marginBottom: 14 }}>
            <RolePill role={activeInstance.role} />
            <span className="card-sub">{activeRole?.description}</span>
          </div>
          {(activeRole?.fields ?? []).map((field) => (
            <Expandable key={field.key} title={field.label} defaultOpen>
              <div className="card-sub" style={{ marginBottom: 8, fontSize: 12 }}>{field.description}</div>
              {field.type === 'boolean' ? (
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={Boolean(draft[field.key])} onChange={(e) => setDraft({ ...draft, [field.key]: e.target.checked })} />
                  <span className="card-sub">Enabled</span>
                </label>
              ) : field.type === 'number' ? (
                <input type="number" value={Number(draft[field.key] ?? 0)} onChange={(e) => setDraft({ ...draft, [field.key]: Number(e.target.value) })} />
              ) : field.type === 'stringList' ? (
                <input
                  type="text"
                  value={Array.isArray(draft[field.key]) ? (draft[field.key] as string[]).join(', ') : ''}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="comma, separated, values"
                />
              ) : (
                <input type="text" value={String(draft[field.key] ?? '')} onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })} />
              )}
            </Expandable>
          ))}
        </Modal>
      )}
    </div>
  );
}
