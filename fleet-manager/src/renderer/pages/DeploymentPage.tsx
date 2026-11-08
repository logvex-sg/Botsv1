/**
 * Deployment Center.
 *
 * The heart of the app: build a deployment visually, pick bots, assign roles, order the queue,
 * validate, preview and launch it, then watch the live monitor. Everything is persisted as a
 * reusable deployment configuration (preset) in the shared database.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Dot, Empty, Field, Modal, Pill, RolePill, ProgressBar, Expandable } from '../components/ui';
import { formatUptime } from '../lib/format';
import type { DeploymentConfig, DeploymentEntry, DeploymentStage, ValidationReport } from '../../shared/types';
import type { DeploymentPreview, DeploymentMonitor } from '../../shared/ipc';
import type { RoleDefinition } from '../../main/services/roles/roles';

interface Props { push: (message: string, tone?: string) => void }

type Tab = 'builder' | 'queue' | 'preview' | 'monitor';

const STAGES: DeploymentStage[] = ['WAITING', 'VALIDATING', 'AUTHENTICATING', 'CONNECTING', 'INITIALIZING', 'RUNNING', 'FAILED', 'STOPPED'];

export function DeploymentPage({ push }: Props) {
  const store = useStore();
  const [tab, setTab] = useState<Tab>('builder');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RoleDefinition[]>([]);
  const [draft, setDraft] = useState<DeploymentConfig | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [preview, setPreview] = useState<DeploymentPreview | null>(null);
  const [monitor, setMonitor] = useState<DeploymentMonitor | null>(null);
  const [roleEditor, setRoleEditor] = useState<number | null>(null);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'ALL' | 'GEARER' | 'STASIS' | 'HUNTER' | 'AVAILABLE'>('ALL');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    void fleet.getRoleCatalog().then(setCatalog);
  }, []);

  useEffect(() => {
    if (store.deployments.length > 0 && !selectedId) setSelectedId(store.deployments[0].id);
  }, [store.deployments, selectedId]);

  useEffect(() => {
    const config = store.deployments.find((d) => d.id === selectedId);
    setDraft(config ? structuredClone(config) : null);
  }, [selectedId, store.deployments]);

  // Poll the live monitor while the monitor tab is open.
  useEffect(() => {
    if (tab !== 'monitor') return;
    const load = async (): Promise<void> => setMonitor(await fleet.getDeploymentMonitor());
    void load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [tab]);

  const accountsById = useMemo(() => new Map(store.accounts.map((a) => [a.id, a])), [store.accounts]);

  const filteredAccounts = store.accounts.filter((account) => {
    if (accountFilter === 'AVAILABLE' && !account.deployable) return false;
    if (accountFilter !== 'ALL' && accountFilter !== 'AVAILABLE' && account.role !== accountFilter) return false;
    const q = accountSearch.trim().toLowerCase();
    if (!q) return true;
    return account.username.toLowerCase().includes(q);
  });

  // ------------------------------------------------------------------ CRUD
  const newDeployment = async (): Promise<void> => {
    const created = await fleet.createDeployment({
      name: `Deployment ${store.deployments.length + 1}`,
      description: '',
      serverProfileId: store.servers[0]?.id ?? null,
      entries: [],
      maxConcurrent: 1,
      connectionTimeoutMs: 15000,
      retryAttempts: 2,
      retryDelayMs: 5000,
      manualApproval: false,
      pauseBetweenMs: 5000,
      resourceLimitMb: 4096,
      notifyOnEvent: true,
    });
    await store.refreshDeployments();
    setSelectedId(created.id);
    push('Deployment created', 'success');
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    await fleet.updateDeployment(draft.id, draft);
    await store.refreshDeployments();
    push('Deployment saved', 'success');
  };

  const remove = async (): Promise<void> => {
    if (!draft || !confirm(`Delete deployment "${draft.name}"?`)) return;
    await fleet.deleteDeployment(draft.id);
    setSelectedId(null);
    await store.refreshDeployments();
  };

  const duplicate = async (): Promise<void> => {
    if (!draft) return;
    const copy = await fleet.duplicateDeployment(draft.id);
    await store.refreshDeployments();
    if (copy) { setSelectedId(copy.id); push('Deployment duplicated', 'success'); }
  };

  // ------------------------------------------------------------- selection
  const toggleAccount = (accountId: string, role: string): void => {
    if (!draft) return;
    const existingIndex = draft.entries.findIndex((e) => e.accountId === accountId);
    if (existingIndex >= 0) {
      draft.entries.splice(existingIndex, 1);
    } else {
      const account = accountsById.get(accountId);
      if (!account || !account.deployable) {
        push('That account has no stored credential and cannot be deployed.', 'error');
        return;
      }
      const roleDef = catalog.find((c) => c.role === role);
      const roleConfig: Record<string, unknown> = {};
      for (const field of roleDef?.fields ?? []) roleConfig[field.key] = field.default;
      const count = draft.entries.filter((e) => e.role === role).length + 1;
      draft.entries.push({
        accountId,
        role: role as DeploymentEntry['role'],
        instanceName: `${role}-${String(count).padStart(2, '0')}`,
        delayMs: 0,
        roleConfig,
      });
    }
    setDraft({ ...draft, entries: [...draft.entries] });
  };

  const move = (from: number, to: number): void => {
    if (!draft || to < 0 || to >= draft.entries.length) return;
    const entries = [...draft.entries];
    const [item] = entries.splice(from, 1);
    entries.splice(to, 0, item);
    setDraft({ ...draft, entries });
  };

  const setEntry = (index: number, patch: Partial<DeploymentEntry>): void => {
    if (!draft) return;
    const entries = [...draft.entries];
    entries[index] = { ...entries[index], ...patch };
    setDraft({ ...draft, entries });
  };

  const changeEntryRole = (index: number, role: string): void => {
    if (!draft) return;
    const roleDef = catalog.find((c) => c.role === role);
    const roleConfig: Record<string, unknown> = {};
    for (const field of roleDef?.fields ?? []) roleConfig[field.key] = field.default;
    setEntry(index, { role: role as DeploymentEntry['role'], roleConfig });
  };

  // ------------------------------------------------------- validate/preview
  const runValidation = async (): Promise<void> => {
    if (!draft) return;
    await save();
    const result = await fleet.validateDeployment(draft.id);
    setReport(result);
    setTab('preview');
    push(result.ok ? 'Validation passed' : 'Validation found blocking errors', result.ok ? 'success' : 'error');
  };

  const loadPreview = async (): Promise<void> => {
    if (!draft) return;
    await save();
    setPreview(await fleet.previewDeployment(draft.id));
    setTab('preview');
  };

  const start = async (): Promise<void> => {
    if (!draft) return;
    await save();
    const result = await fleet.startDeployment(draft.id);
    if (result.ok) {
      setTab('monitor');
      push('Deployment started', 'success');
    } else {
      setReport(result.report);
      setTab('preview');
      push('Deployment blocked by validation', 'error');
    }
  };

  const importPreset = async (): Promise<void> => {
    const imported = await fleet.importPreset();
    await store.refreshDeployments();
    if (imported) { setSelectedId(imported.id); push('Preset imported', 'success'); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Deployments"
        sub="Configure, validate, preview and launch bot deployments."
        actions={<>
          <select value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value || null)} style={{ maxWidth: 260 }}>
            <option value="">— select a deployment —</option>
            {store.deployments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <Button variant="primary" onClick={newDeployment}>+ New</Button>
          <Button onClick={importPreset}>Import preset</Button>
        </>}
      >
        {!draft ? (
          <Empty>No deployment selected. Create a new one or import a preset to begin.</Empty>
        ) : (
          <>
            <div className="tabs">
              {(['builder', 'queue', 'preview', 'monitor'] as Tab[]).map((t) => (
                <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {t === 'builder' ? 'Builder' : t === 'queue' ? 'Deployment Queue' : t === 'preview' ? 'Validation & Preview' : 'Live Monitor'}
                </button>
              ))}
            </div>

            {tab === 'builder' && (
              <BuilderTab
                draft={draft}
                setDraft={setDraft}
                catalog={catalog}
                filteredAccounts={filteredAccounts}
                accountSearch={accountSearch}
                setAccountSearch={setAccountSearch}
                accountFilter={accountFilter}
                setAccountFilter={setAccountFilter}
                toggleAccount={toggleAccount}
                onSave={save}
                onDelete={remove}
                onDuplicate={duplicate}
                onExport={async () => { await fleet.exportPreset(draft.id); push('Preset exported', 'success'); }}
              />
            )}

            {tab === 'queue' && (
              <QueueTab
                draft={draft}
                setDraft={setDraft}
                accountsById={accountsById}
                move={move}
                setEntry={setEntry}
                changeEntryRole={changeEntryRole}
                dragIndex={dragIndex}
                setDragIndex={setDragIndex}
                onEditRole={(index) => setRoleEditor(index)}
              />
            )}

            {tab === 'preview' && (
              <PreviewTab
                draft={draft}
                report={report}
                preview={preview}
                onValidate={runValidation}
                onPreview={loadPreview}
                onStart={start}
              />
            )}

            {tab === 'monitor' && (
              <MonitorTab
                monitor={monitor}
                accountsById={accountsById}
                onPause={async () => { await fleet.pauseDeployment(); push('Queue paused'); }}
                onResume={async () => { await fleet.resumeDeployment(); push('Queue resumed'); }}
                onCancel={async () => { await fleet.cancelDeployment(); push('Deployment cancelled'); }}
                onApprove={async () => { await fleet.approveDeployment(); push('Approved next instance'); }}
                onRetry={async (itemId) => { await fleet.retryDeploymentItem(itemId); push('Retrying instance'); }}
                onStopInstance={async (id) => { await fleet.stopInstance(id); await store.refreshInstances(); }}
              />
            )}
          </>
        )}
      </Card>

      {roleEditor !== null && draft && (
        <RoleConfigModal
          entry={draft.entries[roleEditor]}
          catalog={catalog}
          onClose={() => setRoleEditor(null)}
          onSave={(config) => { setEntry(roleEditor, { roleConfig: config }); setRoleEditor(null); }}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------- Builder

function BuilderTab(props: {
  draft: DeploymentConfig;
  setDraft: (d: DeploymentConfig) => void;
  catalog: RoleDefinition[];
  filteredAccounts: ReturnType<typeof useStore>['accounts'];
  accountSearch: string;
  setAccountSearch: (v: string) => void;
  accountFilter: string;
  setAccountFilter: (v: never) => void;
  toggleAccount: (id: string, role: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  const { draft, setDraft } = props;
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="grid cols-2">
        <div>
          <Field label="Deployment name">
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <Field label="Server profile">
            <select value={draft.serverProfileId ?? ''} onChange={(e) => setDraft({ ...draft, serverProfileId: e.target.value || null })}>
              <option value="">— select a server —</option>
              {useStore().servers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.host}:{s.port})</option>)}
            </select>
          </Field>
        </div>
        <div>
          <div className="grid cols-2">
            <Field label="Max concurrent">
              <input type="number" min={1} value={draft.maxConcurrent} onChange={(e) => setDraft({ ...draft, maxConcurrent: Number(e.target.value) })} />
            </Field>
            <Field label="Startup delay (ms)">
              <input type="number" min={0} value={draft.pauseBetweenMs} onChange={(e) => setDraft({ ...draft, pauseBetweenMs: Number(e.target.value) })} />
            </Field>
            <Field label="Connection timeout (ms)">
              <input type="number" min={1000} value={draft.connectionTimeoutMs} onChange={(e) => setDraft({ ...draft, connectionTimeoutMs: Number(e.target.value) })} />
            </Field>
            <Field label="Retry attempts">
              <input type="number" min={0} value={draft.retryAttempts} onChange={(e) => setDraft({ ...draft, retryAttempts: Number(e.target.value) })} />
            </Field>
            <Field label="Retry delay (ms)">
              <input type="number" min={0} value={draft.retryDelayMs} onChange={(e) => setDraft({ ...draft, retryDelayMs: Number(e.target.value) })} />
            </Field>
            <Field label="Memory limit (MB)">
              <input type="number" min={0} value={draft.resourceLimitMb} onChange={(e) => setDraft({ ...draft, resourceLimitMb: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="row" style={{ gap: 8, marginTop: 4 }}>
            <input type="checkbox" checked={draft.manualApproval} onChange={(e) => setDraft({ ...draft, manualApproval: e.target.checked })} />
            <span className="card-sub">Require manual approval before each launch</span>
          </label>
          <label className="row" style={{ gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={draft.notifyOnEvent} onChange={(e) => setDraft({ ...draft, notifyOnEvent: e.target.checked })} />
            <span className="card-sub">Send notifications for deployment events</span>
          </label>
        </div>
      </div>

      <div>
        <div className="card-title">Bot selection</div>
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" placeholder="Search accounts…" value={props.accountSearch} onChange={(e) => props.setAccountSearch(e.target.value)} style={{ maxWidth: 260 }} />
          <select value={props.accountFilter} onChange={(e) => props.setAccountFilter(e.target.value as never)} style={{ maxWidth: 180 }}>
            <option value="ALL">All accounts</option>
            <option value="GEARER">Gearer</option>
            <option value="STASIS">Stasis</option>
            <option value="HUNTER">Hunter</option>
            <option value="AVAILABLE">Available only</option>
          </select>
          <div className="spacer" />
          <span className="card-sub">{draft.entries.length} selected</span>
        </div>
        <div className="select-list">
          {props.filteredAccounts.length === 0 ? (
            <Empty>No accounts match the filter.</Empty>
          ) : props.filteredAccounts.map((account) => {
            const selected = draft.entries.some((e) => e.accountId === account.id);
            return (
              <div key={account.id} className={`select-row ${!account.deployable ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!account.deployable}
                  onChange={() => props.toggleAccount(account.id, account.role)}
                />
                <div className="col" style={{ gap: 1, flex: 1 }}>
                  <strong>{account.username}</strong>
                  <span className="card-sub" style={{ fontSize: 11 }}>
                    {account.authMode} · {account.lastLogin ? `last login ok` : 'never logged in'}
                    {account.blockedReason ? ` · ${account.blockedReason}` : ''}
                  </span>
                </div>
                <RolePill role={account.role} />
                <Pill tone={account.deployable ? 'success' : 'error'}>{account.deployable ? 'ready' : 'blocked'}</Pill>
              </div>
            );
          })}
        </div>
      </div>

      <div className="row">
        <Button variant="primary" onClick={props.onSave}>Save deployment</Button>
        <Button onClick={props.onDuplicate}>Duplicate</Button>
        <Button onClick={props.onExport}>Export preset</Button>
        <div className="spacer" />
        <Button variant="danger" onClick={props.onDelete}>Delete</Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- Queue

function QueueTab(props: {
  draft: DeploymentConfig;
  setDraft: (d: DeploymentConfig) => void;
  accountsById: Map<string, { username: string }>;
  move: (from: number, to: number) => void;
  setEntry: (index: number, patch: Partial<DeploymentEntry>) => void;
  changeEntryRole: (index: number, role: string) => void;
  dragIndex: number | null;
  setDragIndex: (v: number | null) => void;
  onEditRole: (index: number) => void;
}) {
  const { draft } = props;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card-sub">Drag to reorder, or use the arrows. Each instance starts in order with its own delay.</div>
      {draft.entries.length === 0 ? (
        <Empty>No bots selected. Add accounts in the Builder tab.</Empty>
      ) : draft.entries.map((entry, index) => (
        <div
          key={`${entry.accountId}-${index}`}
          className={`queue-item ${props.dragIndex === index ? 'dragging' : ''}`}
          draggable
          onDragStart={() => props.setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (props.dragIndex !== null) props.move(props.dragIndex, index); props.setDragIndex(null); }}
        >
          <div className="queue-pos">{index + 1}</div>
          <div className="col" style={{ gap: 1, flex: 1 }}>
            <strong>{entry.instanceName}</strong>
            <span className="card-sub" style={{ fontSize: 11 }}>{props.accountsById.get(entry.accountId)?.username ?? 'unknown'}</span>
          </div>
          <RolePill role={entry.role} />
          <select value={entry.role} onChange={(e) => props.changeEntryRole(index, e.target.value)} style={{ width: 120 }}>
            {['GEARER', 'STASIS', 'HUNTER'].map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <input
            type="text"
            value={entry.instanceName}
            onChange={(e) => props.setEntry(index, { instanceName: e.target.value })}
            style={{ width: 130 }}
          />
          <input
            type="number"
            min={0}
            value={entry.delayMs}
            onChange={(e) => props.setEntry(index, { delayMs: Number(e.target.value) })}
            title="Delay before this instance starts (ms)"
            style={{ width: 90 }}
          />
          <Button small onClick={() => props.onEditRole(index)}>Role config</Button>
          <Button small variant="ghost" onClick={() => props.move(index, index - 1)} disabled={index === 0}>↑</Button>
          <Button small variant="ghost" onClick={() => props.move(index, index + 1)} disabled={index === draft.entries.length - 1}>↓</Button>
          <Button small variant="ghost" onClick={() => {
            const entries = [...draft.entries];
            entries.splice(index, 1);
            props.setDraft({ ...draft, entries });
          }}>✕</Button>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------- Preview

function PreviewTab(props: {
  draft: DeploymentConfig;
  report: ValidationReport | null;
  preview: DeploymentPreview | null;
  onValidate: () => void;
  onPreview: () => void;
  onStart: () => void;
}) {
  const { report, preview } = props;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <Button onClick={props.onValidate}>Validate</Button>
        <Button onClick={props.onPreview}>Build preview</Button>
        <div className="spacer" />
        <Button variant="primary" onClick={props.onStart} disabled={report ? !report.ok : false}>🚀 Launch deployment</Button>
      </div>

      {report && (
        <Card title="Validation report" sub={report.ok ? 'All checks passed.' : 'Blocking errors found — deployment will not start.'}>
          {report.issues.length === 0 ? (
            <Empty>No issues.</Empty>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {report.issues.map((issue, index) => (
                <div key={index} className="row" style={{ gap: 8 }}>
                  <Pill tone={issue.level === 'error' ? 'error' : 'warning'}>{issue.level}</Pill>
                  <span>{issue.message}</span>
                  {issue.subject && <span className="card-sub">({issue.subject})</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {preview && (
        <Card title="Deployment preview">
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <div><div className="stat"><div className="value">{preview.totalAccounts}</div><div className="label">Accounts</div></div></div>
            <div><div className="stat"><div className="value" style={{ color: 'var(--gearer)' }}>{preview.byRole.GEARER ?? 0}</div><div className="label">Gearer</div></div></div>
            <div><div className="stat"><div className="value" style={{ color: 'var(--stasis)' }}>{preview.byRole.STASIS ?? 0}</div><div className="label">Stasis</div></div></div>
            <div><div className="stat"><div className="value" style={{ color: 'var(--hunter)' }}>{preview.byRole.HUNTER ?? 0}</div><div className="label">Hunter</div></div></div>
          </div>
          <div className="col" style={{ gap: 4, marginBottom: 14 }}>
            <div className="row between"><span className="card-sub">Server</span><strong>{preview.serverName ?? '—'}</strong></div>
            <div className="row between"><span className="card-sub">Max concurrency</span><strong>{preview.maxConcurrent}</strong></div>
            <div className="row between"><span className="card-sub">Estimated memory</span><strong>{preview.estimatedMemoryMb} MB</strong></div>
          </div>
          <div className="card-title">Deployment order</div>
          {preview.order.map((item, index) => (
            <div key={index} className="row" style={{ gap: 10, padding: '6px 0' }}>
              <span className="queue-pos">{index + 1}</span>
              <strong>{item.instanceName}</strong>
              <RolePill role={item.role} />
              <span className="card-sub">{item.account}</span>
              {item.delayMs > 0 && <span className="card-sub">+{item.delayMs}ms</span>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- Monitor

function MonitorTab(props: {
  monitor: DeploymentMonitor | null;
  accountsById: Map<string, { username: string }>;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onApprove: () => void;
  onRetry: (itemId: string) => void;
  onStopInstance: (id: string) => void;
}) {
  const { monitor } = props;
  if (!monitor) return <Empty>No active deployment.</Empty>;
  const running = monitor.items.filter((i) => i.stage === 'RUNNING').length;
  const done = monitor.items.filter((i) => i.stage === 'RUNNING' || i.stage === 'FAILED').length;
  const progress = monitor.items.length ? (done / monitor.items.length) * 100 : 0;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <Pill tone={monitor.state === 'RUNNING' ? 'success' : monitor.state === 'WAITING_APPROVAL' ? 'warning' : 'muted'}>{monitor.state}</Pill>
        <span className="card-sub">{running} running · {monitor.items.length} total</span>
        <div className="spacer" />
        <Button small onClick={props.onPause} disabled={monitor.state !== 'RUNNING'}>Pause queue</Button>
        <Button small onClick={props.onResume} disabled={monitor.state !== 'PAUSED'}>Resume queue</Button>
        <Button small onClick={props.onApprove} disabled={monitor.state !== 'WAITING_APPROVAL'}>Approve next</Button>
        <Button small variant="danger" onClick={props.onCancel}>Cancel all</Button>
      </div>
      <ProgressBar value={progress} />

      <table>
        <thead>
          <tr><th>#</th><th>Instance</th><th>Role</th><th>Account</th><th>Stage</th><th>Attempts</th><th>Error</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
        </thead>
        <tbody>
          {monitor.items.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <td><strong>{item.instanceName}</strong></td>
              <td><RolePill role={item.role} /></td>
              <td className="card-sub">{props.accountsById.get(item.accountId)?.username ?? 'unknown'}</td>
              <td><Pill tone={item.stage === 'RUNNING' ? 'success' : item.stage === 'FAILED' ? 'error' : 'muted'}>{item.stage}</Pill></td>
              <td>{item.attempts}</td>
              <td className="card-sub" style={{ color: item.error ? 'var(--error)' : undefined, fontSize: 11 }}>{item.error ?? '—'}</td>
              <td>
                <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                  {item.stage === 'FAILED' && <Button small onClick={() => props.onRetry(item.id)}>Retry</Button>}
                  {item.stage === 'RUNNING' && <Button small onClick={() => props.onStopInstance(item.id)}>Stop</Button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card-sub">Stage legend: {STAGES.join(' · ')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Role modal

function RoleConfigModal(props: {
  entry: DeploymentEntry;
  catalog: RoleDefinition[];
  onClose: () => void;
  onSave: (config: Record<string, unknown>) => void;
}) {
  const roleDef = props.catalog.find((c) => c.role === props.entry.role);
  const [config, setConfig] = useState<Record<string, unknown>>({ ...props.entry.roleConfig });
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);

  const validate = async (): Promise<void> => {
    const result = await fleet.validateRoleConfig(props.entry.role, config);
    setIssues(result);
  };

  return (
    <Modal
      title={`${roleDef?.title ?? props.entry.role} configuration — ${props.entry.instanceName}`}
      wide
      onClose={props.onClose}
      footer={<>
        <Button onClick={validate}>Validate</Button>
        <div className="spacer" />
        <Button onClick={props.onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => props.onSave(config)}>Save</Button>
      </>}
    >
      <p className="card-sub" style={{ marginBottom: 14 }}>{roleDef?.description}</p>
      {issues.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--error)', marginBottom: 14 }}>
          {issues.map((issue, index) => <div key={index} className="card-sub" style={{ color: 'var(--error)' }}>{issue.message}</div>)}
        </div>
      )}
      {(roleDef?.fields ?? []).map((field) => (
        <Expandable key={field.key} title={field.label} defaultOpen>
          <div className="card-sub" style={{ marginBottom: 8, fontSize: 12 }}>{field.description}</div>
          {field.type === 'boolean' ? (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={Boolean(config[field.key])} onChange={(e) => setConfig({ ...config, [field.key]: e.target.checked })} />
              <span className="card-sub">Enabled</span>
            </label>
          ) : field.type === 'number' ? (
            <input type="number" value={Number(config[field.key] ?? 0)} onChange={(e) => setConfig({ ...config, [field.key]: Number(e.target.value) })} />
          ) : field.type === 'stringList' ? (
            <input
              type="text"
              value={Array.isArray(config[field.key]) ? (config[field.key] as string[]).join(', ') : ''}
              onChange={(e) => setConfig({ ...config, [field.key]: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="comma, separated"
            />
          ) : (
            <input type="text" value={String(config[field.key] ?? '')} onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })} />
          )}
        </Expandable>
      ))}
    </Modal>
  );
}
