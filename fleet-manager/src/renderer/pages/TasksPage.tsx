/**
 * Tasks.
 *
 * The one place to start and manage bots. Beginner mode shows a single, obvious flow: pick the
 * accounts you want online and press start. Advanced mode exposes the full deployment builder,
 * queue, validation preview and live monitor for people who want fine control.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Callout, Card, EmptyState, ErrorNotice, Pill, RolePill, Segmented } from '../components/ui';
import { InstancesPage } from './InstancesPage';
import { DeploymentPage } from './DeploymentPage';
import { toFriendlyError, type FriendlyError } from '../lib/errors';
import type { UiMode } from '../../shared/types';

interface Props {
  push: (message: string, tone?: string) => void;
  uiMode: UiMode;
}

type AdvancedTab = 'bots' | 'deployments';

export function TasksPage({ push, uiMode }: Props) {
  const store = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [combat, setCombat] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>('bots');

  const accounts = store.accounts;
  const instances = store.instances;
  const deployable = useMemo(() => accounts.filter((a) => a.deployable), [accounts]);
  const running = instances.filter((i) => i.state === 'RUNNING');

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startSelected = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const result = await fleet.quickDeploy({ accountIds: [...selected], authorizeCombat: combat });
      if (result.ok) {
        push('Bots are starting…', 'success');
        setSelected(new Set());
        await store.refresh();
      } else {
        const first = result.report.issues.find((i) => i.level === 'error');
        setError({ title: first?.message ?? 'The bots could not be started.', hint: 'Open Tasks to review the details and try again.', technical: JSON.stringify(result.report, null, 2) });
        push(first?.message ?? 'Could not start bots', 'error');
      }
    } catch (err) {
      setError(toFriendlyError(err));
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- advanced
  if (uiMode === 'advanced') {
    return (
      <div className="col" style={{ gap: 16 }}>
        <Segmented<AdvancedTab>
          value={advancedTab}
          onChange={setAdvancedTab}
          options={[{ value: 'bots', label: 'Bots' }, { value: 'deployments', label: 'Deployments' }]}
        />
        {advancedTab === 'bots' && <InstancesPage push={push} />}
        {advancedTab === 'deployments' && <DeploymentPage push={push} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- beginner
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Your bots"
        sub={running.length > 0 ? `${running.length} of ${instances.length} running` : 'No bots are running right now.'}
      >
        {instances.length === 0 ? (
          <EmptyState icon="🤖" title="No bots yet">
            Choose an account below and press start — the app takes care of the rest.
          </EmptyState>
        ) : (
          <div className="grid auto">
            {instances.map((instance) => (
              <div key={instance.id} className={`bot-card ${instance.state === 'RUNNING' ? 'running' : instance.state === 'FAILED' ? 'failed' : ''}`}>
                <div className="row">
                  <div className="avatar" style={{ background: instance.role === 'GEARER' ? 'var(--gearer)' : instance.role === 'STASIS' ? 'var(--stasis)' : 'var(--hunter)' }}>
                    {instance.accountUsername.charAt(0).toUpperCase()}
                  </div>
                  <div className="col" style={{ gap: 2, flex: 1 }}>
                    <strong>{instance.name}</strong>
                    <span className="card-sub" style={{ fontSize: 11 }}>{instance.accountUsername}</span>
                  </div>
                  <RolePill role={instance.role} />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Pill tone={instance.state === 'RUNNING' ? 'success' : instance.state === 'FAILED' ? 'error' : 'muted'}>{instance.state}</Pill>
                  <div className="spacer" />
                </div>
                {instance.lastError && <div className="card-sub" style={{ color: 'var(--error)', fontSize: 11 }}>{instance.lastError}</div>}
                <div className="row wrap" style={{ gap: 6 }}>
                  {instance.state !== 'RUNNING'
                    ? <Button small variant="primary" onClick={async () => { await fleet.startInstance(instance.id); push('Starting…', 'success'); await store.refreshInstances(); }}>Start</Button>
                    : <Button small onClick={async () => { await fleet.stopInstance(instance.id); push('Stopping…'); await store.refreshInstances(); }}>Stop</Button>}
                  <Button small onClick={async () => { await fleet.restartInstance(instance.id); push('Restarting…'); await store.refreshInstances(); }}>Restart</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Start bots" sub="Pick the accounts you want online, then press start.">
        {error && <div style={{ marginBottom: 12 }}><ErrorNotice error={error} onDismiss={() => setError(null)} /></div>}
        {accounts.length === 0 ? (
          <EmptyState icon="◐" title="No accounts yet">
            Add an account on the Dashboard or in Accounts, then come back here.
          </EmptyState>
        ) : (
          <>
            <div className="select-list" style={{ marginBottom: 12 }}>
              {accounts.map((account) => (
                <div key={account.id} className={`select-row ${!account.deployable ? 'disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(account.id)}
                    disabled={!account.deployable}
                    onChange={() => toggle(account.id)}
                  />
                  <div className="col" style={{ gap: 1, flex: 1 }}>
                    <strong>{account.username}</strong>
                    <span className="card-sub" style={{ fontSize: 11 }}>
                      {account.deployable ? 'Ready to start' : account.blockedReason ?? 'Not ready'}
                    </span>
                  </div>
                  <RolePill role={account.role} />
                </div>
              ))}
            </div>
            {accounts.some((a) => !a.deployable) && (
              <div style={{ marginBottom: 12 }}>
                <Callout
                  tone="warning"
                  title="Some accounts are not ready"
                  actions={<Button small onClick={() => push('Open Accounts to add passwords')}>Fix in Accounts</Button>}
                >
                  Accounts on online servers need a stored password before they can start.
                </Callout>
              </div>
            )}
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                disabled={busy || selected.size === 0}
                onClick={startSelected}
              >
                {busy
                  ? 'Starting…'
                  : selected.size === 0
                    ? '▶ Start bots'
                    : `▶ Start ${selected.size} bot${selected.size === 1 ? '' : 's'}`}
              </Button>
              <Button onClick={() => setSelected(new Set(deployable.map((a) => a.id)))} disabled={deployable.length === 0}>
                Select all ready ({deployable.length})
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Clear</Button>
              {selected.size > 0 && (
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={combat} onChange={(e) => setCombat(e.target.checked)} />
                  <span className="card-sub">Authorise combat testing</span>
                </label>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
