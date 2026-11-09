/**
 * Dashboard — the landing page.
 *
 * Designed so a brand-new user can see exactly what is happening and what to do next without
 * reading a guide: a guided setup checklist, one-click "start my bots", the live state of every
 * bot and the most recent activity. Everything important is reachable from here.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, EmptyState, ErrorNotice, Field, Pill, ProgressBar, Ring, RolePill, Stat, Tip } from '../components/ui';
import { formatTime, formatUptime } from '../lib/format';
import { toFriendlyError, type FriendlyError } from '../lib/errors';
import type { PageId } from '../App';
import type { FeatureTab } from './FeaturesPage';

interface Props {
  onNavigate: (page: PageId, tab?: FeatureTab) => void;
  push: (message: string, tone?: string) => void;
}

export function DashboardPage({ onNavigate, push }: Props) {
  const store = useStore();
  const [username, setUsername] = useState('');
  const [host, setHost] = useState('');
  const [combat, setCombat] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);

  const running = store.instances.filter((i) => i.state === 'RUNNING');
  const failed = store.instances.filter((i) => i.state === 'FAILED');
  const deployable = store.accounts.filter((a) => a.deployable);
  const setup = store.setup;
  const completion = setup?.completion ?? 0;

  const recentEvents = useMemo(() => store.events.slice(0, 6), [store.events]);

  const runStep = async (id: string): Promise<void> => {
    const step = setup?.steps.find((s) => s.id === id);
    if (!step) return;
    if (step.id === 'server') { onNavigate('features', 'servers'); return; }
    if (step.id === 'account' || step.id === 'credential') { onNavigate('accounts'); return; }
    if (step.id === 'deploy') { onNavigate('tasks'); return; }
    if (step.id === 'hunter') { onNavigate('features', 'hunter'); return; }
    onNavigate(step.page as PageId);
  };

  const quickStart = async (): Promise<void> => {
    setError(null);
    setBusy('setup');
    try {
      await fleet.quickSetup({ username: username.trim(), host: host.trim(), role: 'HUNTER' });
      setUsername(''); setHost('');
      push('Account created. You can start it now.', 'success');
      await store.refresh();
    } catch (err) {
      setError(toFriendlyError(err));
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(null);
    }
  };

  const startAll = async (): Promise<void> => {
    setError(null);
    setBusy('deploy');
    try {
      const ids = deployable.map((a) => a.id);
      const result = await fleet.quickDeploy({ accountIds: ids, authorizeCombat: combat });
      if (result.ok) {
        push(`Starting ${ids.length} bot${ids.length === 1 ? '' : 's'}…`, 'success');
        await store.refresh();
        onNavigate('tasks');
      } else {
        const first = result.report.issues.find((i) => i.level === 'error');
        setError({ title: first?.message ?? 'The bots could not be started.', hint: 'Open Tasks to review the details and try again.', technical: JSON.stringify(result.report, null, 2) });
        push(first?.message ?? 'Could not start bots', 'error');
      }
    } catch (err) {
      setError(toFriendlyError(err));
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(null);
    }
  };

  const stopAll = async (): Promise<void> => {
    await store.emergencyStop();
    push('All bots stopped', 'error');
    await store.refresh();
  };

  const anythingRunning = running.length > 0;

  return (
    <div className="col" style={{ gap: 18 }}>
      {/* Hero: where am I, and what next */}
      <div className="card hero">
        <Ring
          value={completion}
          color={completion >= 1 ? 'var(--success)' : 'var(--accent)'}
          label={completion >= 1 ? '✓' : `${Math.round(completion * 100)}%`}
        />
        <div className="grow">
          <h3>{setup?.ready ? 'Your fleet is ready' : 'Let\'s get your bots running'}</h3>
          <div className="card-sub" style={{ fontSize: 13, maxWidth: 560 }}>
            {setup?.nextHint ?? 'Loading your fleet…'}
          </div>
          <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            {anythingRunning ? (
              <>
                <Button variant="danger" onClick={stopAll}>⏹ Stop all bots</Button>
                <Button onClick={() => onNavigate('tasks')}>View running bots</Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={startAll}
                  disabled={busy !== null || deployable.length === 0}
                  title={deployable.length === 0 ? 'Add an account first' : 'Start every ready account'}
                >
                  {busy === 'deploy' ? 'Starting…' : '▶ Start my bots'}
                </Button>
                <Button onClick={() => onNavigate('accounts')}>Add an account</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorNotice error={error} onDismiss={() => setError(null)} />}

      {/* Guided setup checklist */}
      {setup && !setup.ready && (
        <Card title="Finish setting up" sub="Follow these steps — most people are done in a minute.">
          <div className="checklist">
            {setup.steps.map((step) => (
              <div key={step.id} className={`step ${step.status === 'done' ? 'done' : ''} ${step.id === setup.nextStepId ? 'current' : ''} ${step.status === 'blocked' ? 'blocked' : ''}`}>
                <div className="step-mark">{step.status === 'done' ? '✓' : step.id === setup.nextStepId ? '→' : ''}</div>
                <div className="step-body">
                  <div className="step-title">
                    {step.title}
                    {step.optional && <span className="card-sub" style={{ fontWeight: 400 }}> · optional</span>}
                  </div>
                  <div className="step-desc">{step.description}</div>
                </div>
                {step.status !== 'done' && (
                  <Button small variant={step.id === setup.nextStepId ? 'primary' : 'default'} onClick={() => runStep(step.id)}>
                    {step.actionLabel}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* One-click setup form, shown until an account exists */}
      {store.accounts.length === 0 && (
        <Card title="Quick start" sub="Add a server and an account together — no configuration files needed.">
          <div className="grid cols-2">
            <Field label="Account username" hint="The Minecraft name this bot will use.">
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="MyBotName" />
            </Field>
            <Field label="Server address" hint="For example play.example.net — the port defaults to 25565.">
              <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="play.example.net" />
            </Field>
          </div>
          <label className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input type="checkbox" checked={combat} onChange={(e) => setCombat(e.target.checked)} />
            <span className="card-sub">Enable combat testing for this account (HUNTER)</span>
            <Tip text="Off by default. Turn this on only in a private test environment — the Hunter will not attack anything until you authorise it here." />
          </label>
          <Button variant="primary" onClick={quickStart} disabled={busy !== null || !username.trim() || !host.trim()}>
            {busy === 'setup' ? 'Creating…' : 'Create account and server'}
          </Button>
        </Card>
      )}

      {/* Live fleet state */}
      <div className="grid cols-4">
        <Card><Stat value={<span style={{ color: running.length ? 'var(--success)' : undefined }}>{running.length}</span>} label="Bots running" /></Card>
        <Card><Stat value={<span style={{ color: failed.length ? 'var(--error)' : undefined }}>{failed.length}</span>} label="Bots failed" /></Card>
        <Card><Stat value={store.instances.length} label="Bots total" /></Card>
        <Card><Stat value={store.targets.length} label="Tracked targets" /></Card>
      </div>

      <div className="grid cols-3">
        <Card title="What to do next" className="card">
          <div className="col" style={{ gap: 8 }}>
            <button className="action-tile" onClick={() => onNavigate('tasks')}>
              <span className="ico">▶</span>
              <span className="t">Start & manage bots</span>
              <span className="d">Launch, stop and watch your bots in one place.</span>
            </button>
            <button className="action-tile" onClick={() => onNavigate('features')}>
              <span className="ico">◈</span>
              <span className="t">Main features</span>
              <span className="d">Hunter, Gearer, Stasis, targets and servers.</span>
            </button>
            <button className="action-tile" onClick={() => onNavigate('activity')}>
              <span className="ico">⚡</span>
              <span className="t">See what happened</span>
              <span className="d">Events, statistics and live logs.</span>
            </button>
          </div>
        </Card>

        <Card title="Fleet status">
          <div className="col">
            <div className="row between">
              <span className="card-sub">Logvex Hunter</span>
              <Pill tone={store.hunterConnected ? 'success' : 'muted'}>{store.hunterConnected ? 'linked' : 'not connected'}</Pill>
            </div>
            <div className="row between"><span className="card-sub">Ready accounts</span><strong>{deployable.length} of {store.accounts.length}</strong></div>
            <div className="row between"><span className="card-sub">Servers</span><strong>{store.servers.length}</strong></div>
            <div className="row between"><span className="card-sub">Uptime</span><strong>{formatUptime(store.health?.uptimeMs ?? 0)}</strong></div>
            {store.accounts.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="card-sub" style={{ marginBottom: 4 }}>Accounts ready to start</div>
                <ProgressBar value={store.accounts.length ? (deployable.length / store.accounts.length) * 100 : 0} color="var(--success)" />
              </div>
            )}
          </div>
        </Card>

        <Card title="Recent activity" actions={<Button small onClick={() => onNavigate('activity')}>All activity</Button>}>
          {recentEvents.length === 0 ? (
            <EmptyState icon="🌙" title="Nothing yet">Activity appears here once your bots connect.</EmptyState>
          ) : (
            <div className="col" style={{ gap: 8 }}>
              {recentEvents.map((event) => (
                <div key={event.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Pill tone={event.severity}>{event.severity}</Pill>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5 }}>{event.message}</div>
                    <div className="card-sub" style={{ fontSize: 11 }}>{formatTime(event.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {store.instances.length > 0 && (
        <Card title="Your bots" actions={<Button small onClick={() => onNavigate('tasks')}>Manage</Button>}>
          <div className="grid auto">
            {store.instances.map((instance) => (
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
                  <span className="card-sub">{formatUptime(instance.uptimeMs)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
