/**
 * Storage page: the Autonomous Storage & World Maintenance console.
 *
 * One page with thirteen tabs that together expose the whole storage subsystem: the dashboard,
 * storage networks, registered containers, restock and disposal rules, the shulker registry, the
 * portal registry, the structure registry, reusable workflows, pending plans, the maintenance
 * assistant, the activity log and configuration profiles. Every tab talks to the real Host service
 * through the preload bridge, so a button here does exactly what the equivalent REST call or worker
 * task does.
 *
 * Two things are shown honestly and never faked:
 *  - container, shulker and portal contents are always labelled with when they were last inspected;
 *  - an operation that needs approval produces a plan you can read before anything runs.
 */
import { useCallback, useEffect, useState } from 'react';
import { fleet } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill, Segmented, Stat } from '../components/ui';
import { toFriendlyError } from '../lib/errors';
import type { StructureChangeView } from '../../shared/ipc';
import { relativeTime } from '../lib/format';
import type {
  AutomationPlan, ClassifierRule, ContainerKind, DisposalRule, MaintenanceAnswer, PortalRecord, RestockRule, ShulkerRecord,
  StorageActivityEntry, StorageCategory, StorageContainer, StorageNetwork, StorageOverview, StorageProfile, StructureRecord, WorkflowRecord,
} from '../../shared/types';

type TabId =
  | 'overview' | 'networks' | 'categories' | 'containers' | 'rules' | 'shulkers' | 'portals'
  | 'structures' | 'workflows' | 'plans' | 'assistant' | 'activity' | 'profiles';

interface Props {
  push: (message: string, tone?: string) => void;
}

/** A tiny load hook: keeps the last value, a loading flag and the last error message. */
function useAsync<T>(load: () => Promise<T>, deps: unknown[] = [], initial: T): {
  value: T; loading: boolean; error: string | null; reload: () => Promise<void>;
} {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setValue(await load());
      setError(null);
    } catch (err) {
      setError(toFriendlyError(err).title);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { value, loading, error, reload };
}

const CONTAINER_KINDS: ContainerKind[] = ['input', 'output', 'intermediate', 'disposal', 'shulker_reserve', 'general'];
const MODES = ['manual', 'supervised', 'automatic'] as const;

export function StoragePage({ push }: Props) {
  const [tab, setTab] = useState<TabId>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    const valid: TabId[] = ['overview', 'networks', 'categories', 'containers', 'rules', 'shulkers', 'portals', 'structures', 'workflows', 'plans', 'assistant', 'activity', 'profiles'];
    return valid.includes(requested as TabId) ? (requested as TabId) : 'overview';
  });
  const [tick, setTick] = useState(0);
  const reloadAll = (): void => setTick((value) => value + 1);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Segmented<TabId>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'networks', label: 'Networks' },
          { value: 'categories', label: 'Categories' },
          { value: 'containers', label: 'Containers' },
          { value: 'rules', label: 'Rules' },
          { value: 'shulkers', label: 'Shulkers' },
          { value: 'portals', label: 'Portals' },
          { value: 'structures', label: 'Structures' },
          { value: 'workflows', label: 'Workflows' },
          { value: 'plans', label: 'Plans' },
          { value: 'assistant', label: 'Assistant' },
          { value: 'activity', label: 'Activity' },
          { value: 'profiles', label: 'Profiles' },
        ]}
      />
      {tab === 'overview' && <OverviewTab push={push} tick={tick} onChanged={reloadAll} />}
      {tab === 'networks' && <NetworksTab push={push} onChanged={reloadAll} />}
      {tab === 'categories' && <CategoriesTab push={push} onChanged={reloadAll} />}
      {tab === 'containers' && <ContainersTab push={push} onChanged={reloadAll} />}
      {tab === 'rules' && <RulesTab push={push} onChanged={reloadAll} />}
      {tab === 'shulkers' && <ShulkersTab push={push} onChanged={reloadAll} />}
      {tab === 'portals' && <PortalsTab push={push} onChanged={reloadAll} />}
      {tab === 'structures' && <StructuresTab push={push} onChanged={reloadAll} />}
      {tab === 'workflows' && <WorkflowsTab push={push} onChanged={reloadAll} />}
      {tab === 'plans' && <PlansTab push={push} onChanged={reloadAll} />}
      {tab === 'assistant' && <AssistantTab push={push} onChanged={reloadAll} />}
      {tab === 'activity' && <ActivityTab push={push} tick={tick} />}
      {tab === 'profiles' && <ProfilesTab push={push} onChanged={reloadAll} />}
    </div>
  );
}

// --------------------------------------------------------------------- overview

function OverviewTab({ push, tick, onChanged }: { push: Props['push']; tick: number; onChanged: () => void }) {
  const { value: overview, loading, error, reload } = useAsync<StorageOverview | null>(() => fleet.storageOverview(), [tick], null);
  const { value: report } = useAsync(() => fleet.storageMaintenanceReport(), [tick], null);
  const [busy, setBusy] = useState(false);

  const runOperation = async (operation: string): Promise<void> => {
    setBusy(true);
    try {
      const plan = await fleet.planStorageOperation(operation, null);
      push(`${operation}: planned ${plan.steps.length} step(s)${plan.actionable ? '' : ' (nothing to do)'} — see the Plans tab`);
      onChanged();
      await reload();
    } catch (err) {
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !overview) return <Empty>Loading storage overview…</Empty>;
  if (error && !overview) return <Callout tone="error" title="Could not load storage overview">{error}</Callout>;
  if (!overview) return <Empty>No storage data.</Empty>;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Storage overview"
        sub={`${overview.networks} network(s) · updated ${relativeTime(overview.lastActivityAt ?? Date.now())}`}
        actions={<Button small onClick={() => void reload()} disabled={busy}>Refresh</Button>}
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <Stat value={overview.networks} label="Networks" />
          <Stat value={overview.containers} label="Containers" />
          <Stat value={overview.shulkers} label="Shulkers" />
          <Stat value={overview.portals} label="Portals" />
          <Stat value={overview.fullContainers} label="Full containers" />
          <Stat value={overview.bottlenecks} label="Bottlenecks" />
          <Stat value={overview.pendingPlans} label="Pending plans" />
          <Stat value={overview.pendingSteps} label="Pending steps" />
        </div>
        {overview.globalPaused && <Callout tone="warning" title="All networks are paused">No automation will run until a network is resumed.</Callout>}
      </Card>

      <Card title="One-click operations" sub="Each builds a plan you can review in the Plans tab before it runs.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button small disabled={busy} onClick={() => void runOperation('inspect')}>Inspect containers</Button>
          <Button small disabled={busy} onClick={() => void runOperation('consolidate')}>Consolidate stacks</Button>
          <Button small disabled={busy} onClick={() => void runOperation('restock')}>Plan restock</Button>
          <Button small disabled={busy} onClick={() => void runOperation('shulker-cleanup')}>Shulker cleanup</Button>
          <Button small disabled={busy} onClick={() => void runOperation('portal-cleanup')}>Portal cleanup</Button>
          <Button small disabled={busy} onClick={() => void runOperation('maintain')}>Storage maintenance</Button>
        </div>
      </Card>

      {report && (
        <Card title="Maintenance report" sub={`Built ${relativeTime(report.generatedAt)}`}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <Stat value={report.emptyShulkers} label="Empty shulkers" />
            <Stat value={report.mixedShulkers} label="Mixed shulkers" />
            <Stat value={report.obsoletePortals} label="Obsolete portals" />
            <Stat value={report.unsortable.length} label="Unsortable items" />
          </div>
          {report.unsortable.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="card-sub">Items matching no category:</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {report.unsortable.slice(0, 20).map((item) => (
                  <Pill key={item.id} tone="warning">{item.name} ×{item.count}</Pill>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title="Recent activity" sub="The last few automation actions.">
        {overview.recent.length === 0 && <Empty>No storage actions yet.</Empty>}
        {overview.recent.length > 0 && <ActivityTable entries={overview.recent} />}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------- networks

function NetworksTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: networks, loading, error, reload } = useAsync(() => fleet.listStorageNetworks(), [], []);
  const { value: workers } = useAsync(() => fleet.listWorkers(), [], []);
  const [editing, setEditing] = useState<StorageNetwork | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<StorageNetwork | null>(null);

  const refresh = async (): Promise<void> => { await reload(); onChanged(); };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Storage networks"
        sub="A network is a named set of containers automation treats as one unit."
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New network</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load networks">{error}</Callout>}
        {!loading && networks.length === 0 && <Empty>No storage networks yet. Create one to start registering containers.</Empty>}
        {networks.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Mode</th><th>Workers</th><th>State</th><th></th></tr>
            </thead>
            <tbody>
              {networks.map((network) => (
                <tr key={network.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{network.name}</div>
                    <div className="card-sub" style={{ fontSize: 12 }}>{network.description || 'no description'}</div>
                  </td>
                  <td><Pill tone={network.mode === 'automatic' ? 'ok' : network.mode === 'supervised' ? 'warn' : 'muted'}>{network.mode}</Pill></td>
                  <td>{network.workerIds.length === 0 ? 'any online' : `${network.workerIds.length} assigned`}</td>
                  <td>{network.paused ? <Pill tone="warning">paused</Pill> : <Pill tone="success">active</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => setEditing(network)}>Edit</Button>
                      <Button small onClick={() => void fleet.pauseStorageNetwork(network.id, !network.paused).then(refresh)}>
                        {network.paused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button small variant="danger" onClick={() => setRemoving(network)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(creating || editing) && (
        <NetworkEditor
          network={editing}
          workerIds={workers.map((w) => w.id)}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await refresh(); push('Storage network saved'); }}
          push={push}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Delete storage network"
          danger
          message={<>Delete <b>{removing.name}</b> and unregister all of its containers? This cannot be undone.</>}
          confirmLabel="Delete network"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await fleet.deleteStorageNetwork(removing.id);
              setRemoving(null);
              await refresh();
              push('Storage network deleted');
            } catch (err) { push(toFriendlyError(err).title, 'error'); }
          }}
        />
      )}
    </div>
  );
}

function NetworkEditor({ network, workerIds, onClose, onSaved, push }: {
  network: StorageNetwork | null; workerIds: string[]; onClose: () => void; onSaved: () => Promise<void>; push: Props['push'];
}) {
  const [name, setName] = useState(network?.name ?? '');
  const [description, setDescription] = useState(network?.description ?? '');
  const [mode, setMode] = useState<StorageNetwork['mode']>(network?.mode ?? 'supervised');
  const [protectedItems, setProtectedItems] = useState((network?.protectedItems ?? []).join(', '));
  const [areas, setAreas] = useState((network?.exclusionAreas ?? []).join('\n'));
  const [reservations, setReservations] = useState((network?.reservations ?? []).map((r) => `${r.query}=${r.count}`).join('\n'));
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>(network?.workerIds ?? []);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const reservationsParsed = reservations.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [query, count] = line.split('=');
        return { query: (query ?? '').trim(), count: Number.parseInt((count ?? '0').trim(), 10) || 0 };
      });
      const input = {
        name: name.trim(),
        description: description.trim(),
        mode,
        workerIds: selectedWorkers,
        protectedItems: protectedItems.split(',').map((s) => s.trim()).filter(Boolean),
        exclusionAreas: areas.split('\n').map((s) => s.trim()).filter(Boolean),
        reservations: reservationsParsed,
      };
      if (network) await fleet.updateStorageNetwork(network.id, input);
      else await fleet.createStorageNetwork(input);
      await onSaved();
    } catch (err) {
      push(toFriendlyError(err).title, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={network ? `Edit ${network.name}` : 'New storage network'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main storage room" autoFocus /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this network covers" /></Field>
        <Field label="Automation mode" hint="manual: only act on request · supervised: approve every plan · automatic: run approved operations">
          <select value={mode} onChange={(e) => setMode(e.target.value as StorageNetwork['mode'])}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Assigned workers" hint="Leave empty to allow any online worker.">
          <div className="col" style={{ gap: 4, maxHeight: 140, overflow: 'auto' }}>
            {workerIds.length === 0 && <span className="card-sub">No workers known yet.</span>}
            {workerIds.map((id) => (
              <label key={id} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedWorkers.includes(id)}
                  onChange={(e) => setSelectedWorkers((prev) => e.target.checked ? [...prev, id] : prev.filter((x) => x !== id))}
                />
                <span>{id}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Protected items" hint="Comma-separated item queries that are never moved or disposed of.">
          <input value={protectedItems} onChange={(e) => setProtectedItems(e.target.value)} placeholder="shulker_box, diamond, totem_of_undying" />
        </Field>
        <Field label="Reservations" hint="One per line, query=count. Automation never drops below the reserved amount.">
          <textarea rows={2} value={reservations} onChange={(e) => setReservations(e.target.value)} placeholder="totem_of_undying=4" style={{ fontFamily: 'var(--mono)' }} />
        </Field>
        <Field label="Authorised areas" hint="One per line: dimension x1 y1 z1 x2 y2 z2. A portal removal is only allowed inside these areas.">
          <textarea rows={2} value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="minecraft:overworld 100 60 -400 200 80 -200" style={{ fontFamily: 'var(--mono)' }} />
        </Field>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- categories

const RULE_KINDS: ClassifierRule['kind'][] = [
  'tag', 'enchantment', 'component', 'namespace', 'custom-name', 'id-equals', 'id-contains', 'durability', 'stackable',
];

/** A human-readable one-line summary of a rule, for the table. */
function describeRule(rule: ClassifierRule): string {
  switch (rule.kind) {
    case 'id-equals': return `id = ${rule.id}`;
    case 'id-contains': return `id contains "${rule.contains}"`;
    case 'tag': return `tag ${rule.tag}`;
    case 'namespace': return `namespace ${rule.namespace}`;
    case 'enchantment': return `enchant ${rule.id}${rule.minLevel ? ` ≥ ${rule.minLevel}` : ''}`;
    case 'component': return `component ${rule.id}`;
    case 'custom-name': return `name contains "${rule.contains}"`;
    case 'durability': return `durability ${rule.minPercent ?? 0}–${rule.maxPercent ?? 100}%`;
    case 'stackable': return rule.stackable ? 'stackable' : 'unstackable';
  }
}

function CategoriesTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: categories, loading, error, reload } = useAsync(() => fleet.listStorageCategories(), [], []);
  const { value: containers } = useAsync(() => fleet.listStorageContainers(), [], []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StorageCategory | null>(null);
  const [removing, setRemoving] = useState<StorageCategory | null>(null);

  const refresh = async (): Promise<void> => { await reload(); onChanged(); };
  const usage = (id: string): number => containers.filter((c) => c.categoryId === id).length;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Item categories"
        sub="A category matches items by real signals — tags, enchantments, data components, namespace, durability — not just a name fragment, so two items that look alike are not treated as interchangeable. A category with no rules falls back to its substrings."
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New category</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load categories">{error}</Callout>}
        {!loading && categories.length === 0 && <Empty>No categories. A fresh install is seeded with the built-in families.</Empty>}
        {categories.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Matched by</th><th>Priority</th><th>Containers</th><th>State</th><th></th></tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: category.color, marginRight: 8 }} />
                    {category.name}
                  </td>
                  <td>
                    {category.rules && category.rules.length > 0
                      ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{category.rules.map(describeRule).join(' · ')}</span>
                      : <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{category.itemMatches.join(', ') || '—'}</span>}
                  </td>
                  <td>{category.priority}</td>
                  <td>{usage(category.id)}</td>
                  <td>{category.protected && <Pill tone="warning">exclusive</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => setEditing(category)}>Edit</Button>
                      <Button small variant="danger" onClick={() => setRemoving(category)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(creating || editing) && (
        <CategoryEditor
          category={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await refresh(); push('Category saved'); }}
          push={push}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Delete category"
          danger
          message={<>Delete <b>{removing.name}</b>?{usage(removing.id) > 0 && ` ${usage(removing.id)} container(s) dedicated to it become general.`} Nothing in the world changes.</>}
          confirmLabel="Delete"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try { await fleet.deleteStorageCategory(removing.id); setRemoving(null); await refresh(); push('Category deleted'); }
            catch (err) { push(toFriendlyError(err).title, 'error'); }
          }}
        />
      )}
    </div>
  );
}

function CategoryEditor({ category, onClose, onSaved, push }: {
  category: StorageCategory | null; onClose: () => void; onSaved: () => Promise<void>; push: Props['push'];
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [priority, setPriority] = useState(String(category?.priority ?? 0));
  const [color, setColor] = useState(category?.color ?? '#6d5efc');
  const [protectedFlag, setProtectedFlag] = useState(category?.protected ?? false);
  const [rules, setRules] = useState<ClassifierRule[]>(category?.rules ?? []);
  const [matches, setMatches] = useState((category?.itemMatches ?? []).join(', '));
  const [busy, setBusy] = useState(false);

  const addRule = (): void => setRules((current) => [...current, { kind: 'tag', tag: '' }]);
  const updateRule = (index: number, rule: ClassifierRule): void => setRules((current) => current.map((r, i) => (i === index ? rule : r)));
  const removeRule = (index: number): void => setRules((current) => current.filter((_, i) => i !== index));

  const valid = name.trim().length > 0 && rules.every((rule) => {
    switch (rule.kind) {
      case 'id-equals': return rule.id.trim().length > 0;
      case 'id-contains': return rule.contains.trim().length > 0;
      case 'tag': return rule.tag.trim().length > 0;
      case 'namespace': return rule.namespace.trim().length > 0;
      case 'enchantment': return rule.id.trim().length > 0;
      case 'component': return rule.id.trim().length > 0;
      case 'custom-name': return rule.contains.trim().length > 0;
      case 'durability': return true;
      case 'stackable': return true;
    }
  });

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const itemMatches = matches.split(',').map((m) => m.trim()).filter(Boolean);
      const input = {
        name: name.trim(), priority: Number(priority) || 0, color, protected: protectedFlag,
        itemMatches, rules,
      };
      if (category) await fleet.updateStorageCategory(category.id, input);
      else await fleet.createStorageCategory(input);
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={category ? `Edit ${category.name}` : 'New category'}
      onClose={onClose}
      wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={() => void save()}>Save</Button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enchanted gear" autoFocus /></Field>
          <Field label="Priority" hint="Higher wins when several categories match."><input value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: 90 }} /></Field>
          <Field label="Colour"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 60 }} /></Field>
        </div>

        <div className="card-title" style={{ fontSize: 13 }}>Rules</div>
        <div className="card-sub">A rule matches on a real signal. An item is classified by the most specific matching rule. With no rules, the category falls back to the substrings below.</div>
        {rules.map((rule, index) => (
          <div className="row" key={index} style={{ gap: 8, alignItems: 'flex-end' }}>
            <Field label="Kind">
              <select value={rule.kind} onChange={(e) => updateRule(index, defaultRule(e.target.value as ClassifierRule['kind']))}>
                {RULE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </Field>
            <RuleFields rule={rule} onChange={(next) => updateRule(index, next)} />
            <Button small variant="danger" onClick={() => removeRule(index)}>Remove</Button>
          </div>
        ))}
        <div><Button small onClick={addRule}>Add rule</Button></div>

        <Field label="Substring fallback" hint="Comma-separated id or name fragments, used only when there are no rules.">
          <input value={matches} onChange={(e) => setMatches(e.target.value)} placeholder="cobblestone, stone" />
        </Field>

        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={protectedFlag} onChange={(e) => setProtectedFlag(e.target.checked)} /> <span>Exclusive (routing will not mix other categories into a container dedicated to it)</span></label>
      </div>
    </Modal>
  );
}

/** The editable fields for one rule, which depend on its kind. */
function RuleFields({ rule, onChange }: { rule: ClassifierRule; onChange: (rule: ClassifierRule) => void }) {
  switch (rule.kind) {
    case 'id-equals':
      return <Field label="Item id"><input value={rule.id} onChange={(e) => onChange({ kind: 'id-equals', id: e.target.value })} placeholder="minecraft:diamond_sword" /></Field>;
    case 'id-contains':
      return <Field label="Contains"><input value={rule.contains} onChange={(e) => onChange({ kind: 'id-contains', contains: e.target.value })} placeholder="sword" /></Field>;
    case 'tag':
      return <Field label="Tag"><input value={rule.tag} onChange={(e) => onChange({ kind: 'tag', tag: e.target.value })} placeholder="minecraft:logs" /></Field>;
    case 'namespace':
      return <Field label="Namespace"><input value={rule.namespace} onChange={(e) => onChange({ kind: 'namespace', namespace: e.target.value })} placeholder="create" /></Field>;
    case 'enchantment':
      return (
        <>
          <Field label="Enchantment"><input value={rule.id} onChange={(e) => onChange({ ...rule, id: e.target.value })} placeholder="minecraft:efficiency" /></Field>
          <Field label="Min level"><input value={rule.minLevel ?? ''} onChange={(e) => onChange({ ...rule, minLevel: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 80 }} /></Field>
        </>
      );
    case 'component':
      return <Field label="Component"><input value={rule.id} onChange={(e) => onChange({ kind: 'component', id: e.target.value })} placeholder="minecraft:container" /></Field>;
    case 'custom-name':
      return <Field label="Name contains"><input value={rule.contains} onChange={(e) => onChange({ kind: 'custom-name', contains: e.target.value })} placeholder="Shulker" /></Field>;
    case 'durability':
      return (
        <>
          <Field label="Min %"><input value={rule.minPercent ?? ''} onChange={(e) => onChange({ ...rule, minPercent: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 80 }} /></Field>
          <Field label="Max %"><input value={rule.maxPercent ?? ''} onChange={(e) => onChange({ ...rule, maxPercent: e.target.value ? Number(e.target.value) : undefined })} style={{ width: 80 }} /></Field>
        </>
      );
    case 'stackable':
      return (
        <Field label="Stackable">
          <select value={rule.stackable ? 'yes' : 'no'} onChange={(e) => onChange({ kind: 'stackable', stackable: e.target.value === 'yes' })}>
            <option value="yes">yes</option><option value="no">no</option>
          </select>
        </Field>
      );
  }
}

/** A fresh rule of the given kind, with its fields empty. */
function defaultRule(kind: ClassifierRule['kind']): ClassifierRule {
  switch (kind) {
    case 'id-equals': return { kind, id: '' };
    case 'id-contains': return { kind, contains: '' };
    case 'tag': return { kind, tag: '' };
    case 'namespace': return { kind, namespace: '' };
    case 'enchantment': return { kind, id: '' };
    case 'component': return { kind, id: '' };
    case 'custom-name': return { kind, contains: '' };
    case 'durability': return { kind };
    case 'stackable': return { kind, stackable: true };
  }
}

// --------------------------------------------------------------------- containers

function ContainersTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: networks } = useAsync(() => fleet.listStorageNetworks(), [], []);
  const { value: categories } = useAsync(() => fleet.listStorageCategories(), [], []);
  const { value: containers, loading, error, reload } = useAsync(() => fleet.listStorageContainers(), [], []);
  const { value: workers } = useAsync(() => fleet.listWorkers(), [], []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StorageContainer | null>(null);
  const [removing, setRemoving] = useState<StorageContainer | null>(null);

  const refresh = async (): Promise<void> => { await reload(); onChanged(); };
  const workerName = (id: string): string => workers.find((w) => w.id === id)?.label || id;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Registered containers"
        sub={`${containers.length} container(s). Contents are the last report a worker gave.`}
        actions={<Button small variant="primary" disabled={networks.length === 0} onClick={() => setCreating(true)}>Register container</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load containers">{error}</Callout>}
        {networks.length === 0 && <Callout tone="warning" title="No storage network">Create a network first, then register its containers.</Callout>}
        {!loading && containers.length === 0 && networks.length > 0 && <Empty>No containers registered yet.</Empty>}
        {containers.length > 0 && (
          <table>
            <thead>
              <tr><th>Label</th><th>Kind</th><th>Worker</th><th>Position</th><th>Category</th><th>Slots</th><th>Inspected</th><th></th></tr>
            </thead>
            <tbody>
              {containers.map((container) => (
                <tr key={container.id}>
                  <td style={{ fontWeight: 600 }}>{container.label}{container.locked && <Pill tone="warning">locked</Pill>}</td>
                  <td>{container.kind}</td>
                  <td>{workerName(container.workerId)}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{container.x},{container.y},{container.z}</td>
                  <td>{categories.find((c) => c.id === container.categoryId)?.name ?? '—'}</td>
                  <td>{container.freeSlots === null ? 'unknown' : `${container.freeSlots} free`}{container.full && <Pill tone="error">full</Pill>}</td>
                  <td>{container.inspectedAt ? relativeTime(container.inspectedAt) : 'never'}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => setEditing(container)}>Edit</Button>
                      <Button small variant="danger" onClick={() => setRemoving(container)}>Remove</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(creating || editing) && (
        <ContainerEditor
          container={editing}
          networks={networks}
          categories={categories}
          workers={workers.map((w) => w.id)}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await refresh(); push('Container saved'); }}
          push={push}
        />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove container"
          danger
          message={<>Stop tracking <b>{removing.label}</b>? Its recorded contents are forgotten; nothing in the world changes.</>}
          confirmLabel="Remove"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try { await fleet.deleteStorageContainer(removing.id); setRemoving(null); await refresh(); push('Container removed'); }
            catch (err) { push(toFriendlyError(err).title, 'error'); }
          }}
        />
      )}
    </div>
  );
}

function ContainerEditor({ container, networks, categories, workers, onClose, onSaved, push }: {
  container: StorageContainer | null; networks: StorageNetwork[]; categories: StorageCategory[]; workers: string[];
  onClose: () => void; onSaved: () => Promise<void>; push: Props['push'];
}) {
  const [networkId, setNetworkId] = useState(container?.networkId ?? networks[0]?.id ?? '');
  const [workerId, setWorkerId] = useState(container?.workerId ?? workers[0] ?? '');
  const [label, setLabel] = useState(container?.label ?? '');
  const [kind, setKind] = useState<ContainerKind>(container?.kind ?? 'general');
  const [x, setX] = useState(String(container?.x ?? 0));
  const [y, setY] = useState(String(container?.y ?? 0));
  const [z, setZ] = useState(String(container?.z ?? 0));
  const [dimension, setDimension] = useState(container?.dimension ?? 'minecraft:overworld');
  const [categoryId, setCategoryId] = useState(container?.categoryId ?? '');
  const [locked, setLocked] = useState(container?.locked ?? false);
  const [permanent, setPermanent] = useState(container?.permanent ?? false);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const input = {
        networkId, workerId, label: label.trim(), kind,
        x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0, dimension,
        categoryId: categoryId || null, locked, permanent,
      };
      if (container) await fleet.updateStorageContainer(container.id, input);
      else await fleet.createStorageContainer(input);
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal
      title={container ? `Edit ${container.label}` : 'Register container'}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !workerId} onClick={() => void save()}>Save</Button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        <Field label="Network">
          <select value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
            {networks.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </Field>
        <Field label="Worker" hint="A container is only reachable from the worker that reported it.">
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            {workers.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Input chest" autoFocus /></Field>
        <Field label="Kind" hint="input/output route items; disposal receives removed items; shulker_reserve holds spare shulkers.">
          <select value={kind} onChange={(e) => setKind(e.target.value as ContainerKind)}>
            {CONTAINER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label="X"><input value={x} onChange={(e) => setX(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Y"><input value={y} onChange={(e) => setY(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Z"><input value={z} onChange={(e) => setZ(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        <Field label="Dimension"><input value={dimension} onChange={(e) => setDimension(e.target.value)} /></Field>
        <Field label="Category" hint="A dedicated container only accepts its own category.">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— general —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> <span>Locked (automation never modifies it)</span></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> <span>Permanent (never suggested for removal)</span></label>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- rules

function RulesTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: restock, reload: reloadRestock } = useAsync(() => fleet.listRestockRules(), [], []);
  const { value: disposal, reload: reloadDisposal } = useAsync(() => fleet.listDisposalRules(), [], []);
  const [newRule, setNewRule] = useState(false);
  const [newDisposal, setNewDisposal] = useState(false);

  const refresh = async (): Promise<void> => { await Promise.all([reloadRestock(), reloadDisposal()]); onChanged(); };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Restock rules"
        sub="Keep at least the minimum and at most the maximum of an item on a worker."
        actions={<Button small variant="primary" onClick={() => setNewRule(true)}>New rule</Button>}
      >
        {restock.length === 0 && <Empty>No restock rules.</Empty>}
        {restock.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Item</th><th>Min</th><th>Max</th><th>Batch</th><th>State</th><th></th></tr></thead>
            <tbody>
              {restock.map((rule) => (
                <tr key={rule.id}>
                  <td style={{ fontWeight: 600 }}>{rule.name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{rule.query}</td>
                  <td>{rule.min}</td>
                  <td>{rule.max}</td>
                  <td>{rule.batch}</td>
                  <td>{rule.enabled ? <Pill tone="success">on</Pill> : <Pill tone="muted">off</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => void fleet.updateRestockRule(rule.id, { enabled: !rule.enabled }).then(refresh)}>{rule.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button small variant="danger" onClick={() => void fleet.deleteRestockRule(rule.id).then(refresh)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Disposal rules"
        sub="Items matching an enabled rule may be moved to a disposal container. Valuables and protected items are always refused."
        actions={<Button small variant="primary" onClick={() => setNewDisposal(true)}>New rule</Button>}
      >
        {disposal.length === 0 && <Empty>No disposal rules. Nothing may be disposed of.</Empty>}
        {disposal.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Item</th><th>State</th><th></th></tr></thead>
            <tbody>
              {disposal.map((rule) => (
                <tr key={rule.id}>
                  <td style={{ fontWeight: 600 }}>{rule.name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{rule.query}</td>
                  <td>{rule.enabled ? <Pill tone="warning">on</Pill> : <Pill tone="muted">off</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => void fleet.updateDisposalRule(rule.id, { enabled: !rule.enabled }).then(refresh)}>{rule.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button small variant="danger" onClick={() => void fleet.deleteDisposalRule(rule.id).then(refresh)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {newRule && <RestockRuleModal onClose={() => setNewRule(false)} onSaved={async () => { setNewRule(false); await refresh(); push('Restock rule saved'); }} push={push} />}
      {newDisposal && <DisposalRuleModal onClose={() => setNewDisposal(false)} onSaved={async () => { setNewDisposal(false); await refresh(); push('Disposal rule saved'); }} push={push} />}
    </div>
  );
}

function RestockRuleModal({ onClose, onSaved, push }: { onClose: () => void; onSaved: () => Promise<void>; push: Props['push'] }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [min, setMin] = useState('16');
  const [max, setMax] = useState('64');
  const [batch, setBatch] = useState('16');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await fleet.createRestockRule({
        networkId: null, name: name.trim(), query: query.trim(), label: name.trim(),
        min: Number(min) || 0, max: Number(max) || 0, batch: Number(batch) || 0,
        workerIds: [], enabled: true, priority: 0,
      });
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New restock rule" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim() || !query.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Keep food stocked" autoFocus /></Field>
        <Field label="Item query" hint="An item id or a name fragment, e.g. cooked_beef."><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="cooked_beef" /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Minimum"><input value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 90 }} /></Field>
          <Field label="Maximum"><input value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} /></Field>
          <Field label="Batch"><input value={batch} onChange={(e) => setBatch(e.target.value)} style={{ width: 90 }} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function DisposalRuleModal({ onClose, onSaved, push }: { onClose: () => void; onSaved: () => Promise<void>; push: Props['push'] }) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await fleet.createDisposalRule({ name: name.trim(), query: query.trim(), label: name.trim(), targetContainerId: null, enabled: false });
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New disposal rule" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim() || !query.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Callout tone="info" title="Starts disabled">A new disposal rule is created disabled; enable it only once you are sure it matches what you want thrown away.</Callout>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Excess cobblestone" autoFocus /></Field>
        <Field label="Item query" hint="An item id or a name fragment, e.g. gravel."><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="gravel" /></Field>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- shulkers

function ShulkersTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: shulkers, loading, error, reload } = useAsync(() => fleet.listShulkers(), [], []);
  const { value: suggestions } = useAsync(() => fleet.shulkerSuggestions(), [], []);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Shulker registry" sub={`${shulkers.length} shulker(s) reported by workers.`} actions={<Button small onClick={() => void reload()}>Refresh</Button>}>
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load shulkers">{error}</Callout>}
        {!loading && shulkers.length === 0 && <Empty>No shulkers reported yet. A worker reports them when it inspects its own inventory.</Empty>}
        {shulkers.length > 0 && (
          <table>
            <thead><tr><th>Worker</th><th>Slot</th><th>Contents</th><th>State</th><th>Inspected</th><th></th></tr></thead>
            <tbody>
              {shulkers.map((shulker) => (
                <tr key={shulker.id}>
                  <td>{shulker.workerId}</td>
                  <td>{shulker.slot}</td>
                  <td>{shulker.itemCount} item(s){shulker.items.length > 0 && <div className="card-sub" style={{ fontSize: 12 }}>{shulker.items.slice(0, 3).map((i) => `${i.name} ×${i.count}`).join(', ')}</div>}</td>
                  <td>
                    {shulker.empty ? <Pill tone="muted">empty</Pill> : shulker.mixed ? <Pill tone="warning">mixed</Pill> : <Pill tone="success">organised</Pill>}
                    {shulker.reserved && <Pill tone="success">reserve</Pill>}
                  </td>
                  <td>{relativeTime(shulker.inspectedAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => void fleet.updateShulker(shulker.id, { reserved: !shulker.reserved }).then(async () => { await reload(); onChanged(); })}>
                        {shulker.reserved ? 'Unreserve' : 'Reserve'}
                      </Button>
                      <Button small onClick={() => void fleet.updateShulker(shulker.id, { markedForRemoval: !shulker.markedForRemoval }).then(async () => { await reload(); onChanged(); })}>
                        {shulker.markedForRemoval ? 'Unmark' : 'Mark'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Organisation suggestions" sub="What the engine recommends for each shulker.">
        {suggestions.length === 0 && <Empty>No shulkers to organise.</Empty>}
        {suggestions.length > 0 && (
          <div className="col" style={{ gap: 6 }}>
            {suggestions.map((s) => (
              <div key={s.shulkerId} className="row" style={{ gap: 10 }}>
                <span style={{ fontWeight: 600, minWidth: 160 }}>{s.label}</span>
                <span className="card-sub">{s.suggestion}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------- portals

function PortalsTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: portals, loading, error, reload } = useAsync(() => fleet.listPortals(), [], []);
  const { value: flagged, reload: reloadFlagged } = useAsync(() => fleet.flaggedPortals(), [], []);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ portalId: string; name: string; dimension: string; x: number; y: number; z: number; authorised: boolean; reasons: string[]; estimatedBlocks: number }[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const refresh = async (): Promise<void> => { await Promise.all([reload(), reloadFlagged()]); onChanged(); };

  const runPreview = async (): Promise<void> => {
    try { setPreview(await fleet.previewPortalRemoval(selected)); }
    catch (err) { push(toFriendlyError(err).title, 'error'); }
  };

  const planRemoval = async (): Promise<void> => {
    try {
      const plan = await fleet.planStorageOperation('portal-cleanup', null, { portalIds: selected });
      setPreview(null);
      onChanged();
      push(`Portal cleanup: planned ${plan.steps.length} step(s) — review in the Plans tab`);
    } catch (err) { push(toFriendlyError(err).title, 'error'); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Portal registry"
        sub="Registered portals. Removal is always a separate, approved operation."
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>Register portal</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load portals">{error}</Callout>}
        {!loading && portals.length === 0 && <Empty>No portals registered.</Empty>}
        {portals.length > 0 && (
          <table>
            <thead><tr><th></th><th>Name</th><th>Category</th><th>Position</th><th>Flags</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              {portals.map((portal) => (
                <tr key={portal.id}>
                  <td><input type="checkbox" checked={selected.includes(portal.id)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, portal.id] : prev.filter((x) => x !== portal.id))} /></td>
                  <td style={{ fontWeight: 600 }}>{portal.name}</td>
                  <td>{portal.category}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{portal.dimension.replace('minecraft:', '')} {portal.x},{portal.y},{portal.z}</td>
                  <td>
                    {portal.permanent && <Pill tone="success">permanent</Pill>}
                    {portal.temporary && <Pill tone="muted">temporary</Pill>}
                    {portal.obsolete && <Pill tone="error">obsolete</Pill>}
                    {portal.needsMaintenance && <Pill tone="warning">maintenance</Pill>}
                  </td>
                  <td>{portal.lastSeenAt ? relativeTime(portal.lastSeenAt) : 'never'}</td>
                  <td>
                    <Button small variant="danger" onClick={() => void fleet.deletePortal(portal.id).then(refresh)}>Forget</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {portals.length > 0 && (
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Button small disabled={selected.length === 0} onClick={() => void runPreview()}>Preview removal</Button>
            <Button small variant="danger" disabled={selected.length === 0} onClick={() => void planRemoval()}>Plan removal</Button>
            <span className="card-sub">{selected.length} selected</span>
          </div>
        )}
      </Card>

      <Card title="Flagged portals" sub="Portals the engine thinks need attention.">
        {flagged.length === 0 && <Empty>No flagged portals.</Empty>}
        {flagged.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Reason</th><th>Detail</th></tr></thead>
            <tbody>
              {flagged.map((flag) => (
                <tr key={`${flag.portalId}-${flag.reason}`}>
                  <td>{flag.name}</td>
                  <td><Pill tone="warning">{flag.reason}</Pill></td>
                  <td className="card-sub">{flag.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && <PortalModal onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh(); push('Portal registered'); }} push={push} />}

      {preview && (
        <Modal title="Portal removal preview" onClose={() => setPreview(null)} wide
          footer={<><Button onClick={() => setPreview(null)}>Close</Button><Button variant="danger" disabled={!preview.some((p) => p.authorised)} onClick={() => void planRemoval()}>Plan removal</Button></>}>
          <Callout tone="warning" title="Nothing is removed here">This is a preview. Planning adds an approval-gated step to the Plans tab; no blocks are touched until it runs.</Callout>
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Portal</th><th>Position</th><th>Blocks</th><th>Allowed?</th></tr></thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.portalId}>
                  <td>{p.name}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.dimension.replace('minecraft:', '')} {p.x},{p.y},{p.z}</td>
                  <td>{p.estimatedBlocks}</td>
                  <td>{p.authorised ? <Pill tone="success">allowed</Pill> : <Pill tone="error">{p.reasons.join('; ')}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}

function PortalModal({ onClose, onSaved, push }: { onClose: () => void; onSaved: () => Promise<void>; push: Props['push'] }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('nether');
  const [dimension, setDimension] = useState('minecraft:overworld');
  const [x, setX] = useState('0');
  const [y, setY] = useState('64');
  const [z, setZ] = useState('0');
  const [permanent, setPermanent] = useState(false);
  const [temporary, setTemporary] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await fleet.createPortal({
        name: name.trim(), category, dimension, x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0,
        permanent, temporary, needsMaintenance: false, tracking: true, lastSeenBy: null, lastSeenAt: null, obsolete: false, notes: '',
      });
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Register portal" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Base nether portal" autoFocus /></Field>
        <Field label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="nether" /></Field>
        <Field label="Dimension"><input value={dimension} onChange={(e) => setDimension(e.target.value)} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label="X"><input value={x} onChange={(e) => setX(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Y"><input value={y} onChange={(e) => setY(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Z"><input value={z} onChange={(e) => setZ(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> <span>Permanent (never suggested for cleanup)</span></label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} /> <span>Temporary (a cleanup candidate)</span></label>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- structures

const STRUCTURE_KIND_LABELS: Record<string, string> = {
  storage_room: 'Storage room', farm: 'Farm', workshop: 'Workshop', processing: 'Processing',
  portal: 'Portal', temporary: 'Temporary', other: 'Other',
};

const MAINTENANCE_TONE: Record<string, string> = { ok: 'success', due: 'warning', overdue: 'error', disabled: 'muted' };

function StructuresTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: structures, loading, error, reload } = useAsync(() => fleet.listStructures(), [], []);
  const { value: issues, reload: reloadIssues } = useAsync(() => fleet.structureIssues(), [], []);
  const { value: counts, reload: reloadCounts } = useAsync(() => fleet.structureCounts(), [], {} as Record<string, number>);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<StructureRecord | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const refresh = async (): Promise<void> => { await Promise.all([reload(), reloadIssues(), reloadCounts()]); onChanged(); };

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Structure registry"
        sub="Every structure the operator has registered: storage rooms, farms, workshops, processing areas, temporary builds. Portals appear here too. A protected structure is never modified by automation."
        actions={<>
          <Button small onClick={() => setPreviewing(true)}>Preview change</Button>
          <Button small variant="primary" onClick={() => setCreating(true)}>Register structure</Button>
        </>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load structures">{error}</Callout>}
        {!loading && structures.length === 0 && <Empty>No structures registered yet.</Empty>}
        {structures.length > 0 && (
          <>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="card-sub">{total} structure(s):</span>
              {Object.entries(counts).filter(([, n]) => n > 0).map(([kind, n]) => (
                <Pill key={kind} tone="muted">{STRUCTURE_KIND_LABELS[kind] ?? kind} {n}</Pill>
              ))}
            </div>
            <table>
              <thead><tr><th>Name</th><th>Kind</th><th>Region</th><th>Ownership</th><th>Maintenance</th><th>Last seen</th><th></th></tr></thead>
              <tbody>
                {structures.map((structure) => (
                  <tr key={structure.id}>
                    <td style={{ fontWeight: 600 }}>{structure.name}{structure.protected && <> <Pill tone="success">protected</Pill></>}</td>
                    <td><Pill tone="muted">{STRUCTURE_KIND_LABELS[structure.kind] ?? structure.kind}</Pill></td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{structure.dimension.replace('minecraft:', '')} {structure.x1},{structure.y1},{structure.z1} → {structure.x2},{structure.y2},{structure.z2}</td>
                    <td className="card-sub">{structure.ownership || '—'}</td>
                    <td><Pill tone={MAINTENANCE_TONE[structure.maintenance] ?? 'muted'}>{structure.maintenance}</Pill></td>
                    <td>{structure.lastSeenAt ? relativeTime(structure.lastSeenAt) : 'never'}</td>
                    <td><Button small variant="danger" onClick={() => setRemoving(structure)}>Remove</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Flagged structures" sub="Structures the registry thinks need attention: overdue maintenance, unconfirmed, overlapping, or protected.">
        {issues.length === 0 && <Empty>No flagged structures.</Empty>}
        {issues.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Reason</th><th>Detail</th></tr></thead>
            <tbody>
              {issues.map((issue, i) => (
                <tr key={`${issue.structureId}-${issue.reason}-${i}`}>
                  <td>{issue.name}</td>
                  <td><Pill tone="warning">{issue.reason}</Pill></td>
                  <td className="card-sub">{issue.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && <StructureModal onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await refresh(); push('Structure registered'); }} push={push} />}

      {previewing && <StructurePreviewModal onClose={() => setPreviewing(false)} push={push} />}

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}`}
          message={<>Forget this structure from the registry? Nothing in the world is changed.</>}
          confirmLabel="Remove"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try { await fleet.deleteStructure(removing.id); setRemoving(null); await refresh(); push('Structure removed'); }
            catch (err) { push(toFriendlyError(err).title, 'error'); }
          }}
        />
      )}
    </div>
  );
}

function StructureModal({ onClose, onSaved, push }: { onClose: () => void; onSaved: () => Promise<void>; push: Props['push'] }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<StructureRecord['kind']>('storage_room');
  const [dimension, setDimension] = useState('minecraft:overworld');
  const [x1, setX1] = useState('0');
  const [y1, setY1] = useState('64');
  const [z1, setZ1] = useState('0');
  const [x2, setX2] = useState('0');
  const [y2, setY2] = useState('64');
  const [z2, setZ2] = useState('0');
  const [ownership, setOwnership] = useState('');
  const [isProtected, setIsProtected] = useState(false);
  const [maintenance, setMaintenance] = useState<StructureRecord['maintenance']>('ok');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await fleet.createStructure({
        name: name.trim(), kind, dimension,
        x1: Number(x1) || 0, y1: Number(y1) || 0, z1: Number(z1) || 0,
        x2: Number(x2) || 0, y2: Number(y2) || 0, z2: Number(z2) || 0,
        ownership: ownership.trim(), protected: isProtected, maintenance,
        lastSeenBy: null, lastSeenAt: null, notes: '',
      });
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="Register structure" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main storage room" autoFocus /></Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as StructureRecord['kind'])}>
            {Object.entries(STRUCTURE_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Dimension"><input value={dimension} onChange={(e) => setDimension(e.target.value)} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Corner 1 X"><input value={x1} onChange={(e) => setX1(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Y"><input value={y1} onChange={(e) => setY1(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Z"><input value={z1} onChange={(e) => setZ1(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Corner 2 X"><input value={x2} onChange={(e) => setX2(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Y"><input value={y2} onChange={(e) => setY2(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Z"><input value={z2} onChange={(e) => setZ2(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        <Field label="Ownership"><input value={ownership} onChange={(e) => setOwnership(e.target.value)} placeholder="base team" /></Field>
        <Field label="Maintenance">
          <select value={maintenance} onChange={(e) => setMaintenance(e.target.value as StructureRecord['maintenance'])}>
            <option value="ok">Ok</option><option value="due">Due</option><option value="overdue">Overdue</option><option value="disabled">Disabled</option>
          </select>
        </Field>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={isProtected} onChange={(e) => setIsProtected(e.target.checked)} /> <span>Protected (automation never modifies this structure)</span></label>
      </div>
    </Modal>
  );
}

function StructurePreviewModal({ onClose, push }: { onClose: () => void; push: Props['push'] }) {
  const [dimension, setDimension] = useState('minecraft:overworld');
  const [minX, setMinX] = useState('0');
  const [minY, setMinY] = useState('60');
  const [minZ, setMinZ] = useState('0');
  const [maxX, setMaxX] = useState('16');
  const [maxY, setMaxY] = useState('70');
  const [maxZ, setMaxZ] = useState('16');
  const [result, setResult] = useState<StructureChangeView[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setResult(await fleet.previewStructureChange({
        dimension: dimension.trim() || 'minecraft:overworld',
        minX: Number(minX) || 0, minY: Number(minY) || 0, minZ: Number(minZ) || 0,
        maxX: Number(maxX) || 0, maxY: Number(maxY) || 0, maxZ: Number(maxZ) || 0,
      }));
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };

  const blocked = (result ?? []).filter((entry) => !entry.actionable).length;

  return (
    <Modal title="Preview a change in a region" onClose={onClose} wide
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={busy} onClick={() => void run()}>Preview</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Callout tone="info" title="Nothing is changed here">The preview only reports which registered structures a change in this region would touch, and whether each one may be changed. A protected structure is always listed as not actionable.</Callout>
        <Field label="Dimension"><input value={dimension} onChange={(e) => setDimension(e.target.value)} /></Field>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Min X"><input value={minX} onChange={(e) => setMinX(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Min Y"><input value={minY} onChange={(e) => setMinY(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Min Z"><input value={minZ} onChange={(e) => setMinZ(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Field label="Max X"><input value={maxX} onChange={(e) => setMaxX(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Max Y"><input value={maxY} onChange={(e) => setMaxY(e.target.value)} style={{ width: 80 }} /></Field>
          <Field label="Max Z"><input value={maxZ} onChange={(e) => setMaxZ(e.target.value)} style={{ width: 80 }} /></Field>
        </div>
        {result && (
          result.length === 0
            ? <Empty>No registered structure overlaps this region.</Empty>
            : <>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Pill tone="muted">{result.length} structure(s) touched</Pill>
                  {blocked > 0 && <Pill tone="error">{blocked} not actionable</Pill>}
                </div>
                <table>
                  <thead><tr><th>Name</th><th>Kind</th><th>Actionable</th><th>Estimated blocks</th><th>Reasons</th></tr></thead>
                  <tbody>
                    {result.map((entry) => (
                      <tr key={entry.structureId}>
                        <td style={{ fontWeight: 600 }}>{entry.name}</td>
                        <td><Pill tone="muted">{STRUCTURE_KIND_LABELS[entry.kind] ?? entry.kind}</Pill></td>
                        <td><Pill tone={entry.actionable ? 'success' : 'error'}>{entry.actionable ? 'yes' : 'no'}</Pill></td>
                        <td>{entry.estimatedBlocks}</td>
                        <td className="card-sub">{entry.reasons.join('; ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
        )}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- workflows

function WorkflowsTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: workflows, loading, error, reload } = useAsync(() => fleet.listWorkflows(), [], []);
  const { value: operations } = useAsync(() => fleet.storageOperations(), [], []);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<WorkflowRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const runWorkflow = async (workflow: WorkflowRecord): Promise<void> => {
    setBusy(true);
    try {
      let planned = 0;
      for (const operation of workflow.operations) {
        const plan = await fleet.planStorageOperation(operation, workflow.networkId);
        planned += plan.steps.length;
      }
      push(`${workflow.name}: planned ${planned} step(s) — review in the Plans tab`);
      onChanged();
    } catch (err) { push(toFriendlyError(err).title, 'error'); }
    finally { setBusy(false); setRunning(null); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Workflows"
        sub="A workflow is a named sequence of operations you can plan in one click."
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New workflow</Button>}
      >
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load workflows">{error}</Callout>}
        {workflows.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Operations</th><th>Mode</th><th>State</th><th></th></tr></thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{workflow.name}</div>
                    <div className="card-sub" style={{ fontSize: 12 }}>{workflow.description}</div>
                  </td>
                  <td>{workflow.operations.join(' → ')}</td>
                  <td><Pill tone={workflow.mode === 'automatic' ? 'ok' : 'warn'}>{workflow.mode}</Pill></td>
                  <td>{workflow.enabled ? <Pill tone="success">on</Pill> : <Pill tone="muted">off</Pill>}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small disabled={busy} onClick={() => setRunning(workflow)}>Plan</Button>
                      <Button small onClick={() => void fleet.updateWorkflow(workflow.id, { enabled: !workflow.enabled }).then(reload)}>{workflow.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button small variant="danger" onClick={() => void fleet.deleteWorkflow(workflow.id).then(reload)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {creating && <WorkflowModal operations={operations} onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await reload(); onChanged(); push('Workflow saved'); }} push={push} />}

      {running && (
        <ConfirmDialog
          title={`Plan ${running.name}`}
          message={<>This will build a plan for {running.operations.length} operation(s) and store it in the Plans tab. Nothing runs until you approve and execute it there.</>}
          confirmLabel="Build plan"
          onCancel={() => setRunning(null)}
          onConfirm={() => void runWorkflow(running)}
        />
      )}
    </div>
  );
}

function WorkflowModal({ operations, onClose, onSaved, push }: {
  operations: { id: string; label: string; description: string }[]; onClose: () => void; onSaved: () => Promise<void>; push: Props['push'];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<WorkflowRecord['mode']>('supervised');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await fleet.createWorkflow({ name: name.trim(), description: description.trim(), operations: selected, networkId: null, mode, enabled: true });
      await onSaved();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="New workflow" onClose={onClose} wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !name.trim() || selected.length === 0} onClick={() => void save()}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly storage tidy" autoFocus /></Field>
        <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Automation mode">
          <select value={mode} onChange={(e) => setMode(e.target.value as WorkflowRecord['mode'])}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Operations" hint="Click to add in order; the order is preserved.">
          <div className="col" style={{ gap: 4 }}>
            {operations.map((operation) => (
              <label key={operation.id} className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={selected.includes(operation.id)} onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, operation.id] : prev.filter((x) => x !== operation.id))} />
                <span style={{ fontWeight: 600 }}>{operation.label}</span>
                <span className="card-sub">{operation.description}</span>
              </label>
            ))}
          </div>
        </Field>
        {selected.length > 0 && <div className="card-sub">Order: {selected.join(' → ')}</div>}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------- plans

function PlansTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: plans, loading, error, reload } = useAsync(() => fleet.listStoragePlans(), [], []);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<AutomationPlan | null>(null);

  const refresh = async (): Promise<void> => { await reload(); onChanged(); };

  const approve = async (plan: AutomationPlan): Promise<void> => {
    setBusy(plan.id);
    try { await fleet.approveStoragePlan(plan.id); push('Plan approved'); await refresh(); }
    catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(null); }
  };

  const execute = async (plan: AutomationPlan): Promise<void> => {
    setBusy(plan.id);
    try {
      const result = await fleet.executeStoragePlan(plan.id);
      push(`${plan.operation}: ${result.message}`, result.failed > 0 ? 'error' : undefined);
      await refresh();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(null); setConfirm(null); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Plans" sub={`${plans.length} stored plan(s). A plan only runs when you execute it.`} actions={<Button small onClick={() => void refresh()}>Refresh</Button>}>
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load plans">{error}</Callout>}
        {!loading && plans.length === 0 && <Empty>No plans yet. Build one from the Overview, Workflows or Assistant tab.</Empty>}
        {plans.length > 0 && (
          <table>
            <thead><tr><th>Operation</th><th>Steps</th><th>State</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id}>
                  <td style={{ fontWeight: 600 }}>{plan.operation}</td>
                  <td>{plan.steps.length}{plan.notes.length > 0 && <span className="card-sub"> · {plan.notes.length} note(s)</span>}</td>
                  <td>
                    {plan.executed ? <Pill tone="success">executed</Pill> : plan.approved ? <Pill tone="success">approved</Pill> : <Pill tone="warning">needs approval</Pill>}
                  </td>
                  <td>{relativeTime(plan.createdAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small onClick={() => setExpanded(expanded === plan.id ? null : plan.id)}>{expanded === plan.id ? 'Hide' : 'Details'}</Button>
                      {!plan.approved && !plan.executed && <Button small disabled={busy === plan.id} onClick={() => void approve(plan)}>Approve</Button>}
                      {!plan.executed && <Button small variant="primary" disabled={busy === plan.id} onClick={() => setConfirm(plan)}>Execute</Button>}
                      <Button small variant="danger" disabled={busy === plan.id} onClick={() => void fleet.discardStoragePlan(plan.id).then(refresh)}>Discard</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {expanded && (() => {
        const plan = plans.find((p) => p.id === expanded);
        if (!plan) return null;
        return (
          <Card title={`Plan: ${plan.operation}`} sub={plan.actionable ? 'This plan has executable steps.' : 'Nothing to do for this plan.'}>
            {plan.steps.length === 0 && <Empty>No steps.</Empty>}
            {plan.steps.length > 0 && (
              <table>
                <thead><tr><th>Action</th><th>Detail</th><th>Worker</th><th>Count</th><th>Flags</th></tr></thead>
                <tbody>
                  {plan.steps.map((step) => (
                    <tr key={step.id}>
                      <td>{step.action}</td>
                      <td>{step.detail}</td>
                      <td>{step.workerId || '—'}</td>
                      <td>{step.count}</td>
                      <td>
                        {step.blocked && <Pill tone="error">blocked: {step.blockedReason}</Pill>}
                        {!step.blocked && step.requiresApproval && <Pill tone="warning">needs approval</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {plan.notes.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="card-sub">Notes:</div>
                <ul>{plan.notes.map((note, index) => <li key={index} className="card-sub">{note}</li>)}</ul>
              </div>
            )}
          </Card>
        );
      })()}

      {confirm && (
        <ConfirmDialog
          title={`Execute ${confirm.operation}`}
          message={<>Run {confirm.steps.filter((s) => !s.blocked).length} step(s) now? Steps that need approval but were not approved will be skipped.</>}
          confirmLabel="Execute"
          onCancel={() => setConfirm(null)}
          onConfirm={() => void execute(confirm)}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------------- assistant

function AssistantTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const [request, setRequest] = useState('');
  const [answer, setAnswer] = useState<MaintenanceAnswer | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (): Promise<void> => {
    if (!request.trim()) return;
    setBusy(true);
    try {
      const result = await fleet.storageAsk(request.trim());
      setAnswer(result);
      onChanged();
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };

  const examples = [
    'find all full containers',
    'find empty shulkers',
    'organize all my shulkers',
    'consolidate my storage',
    'restock my workers',
    'check my registered portals',
    'move all building materials into assigned storage',
    'what items cannot be sorted',
  ];

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Maintenance assistant" sub="Describe what you want in plain language. It maps to a real operation and builds a plan you can review.">
        <div className="row" style={{ gap: 8 }}>
          <input
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
            placeholder="find all full containers"
            style={{ flex: 1 }}
          />
          <Button variant="primary" disabled={busy || !request.trim()} onClick={() => void ask()}>Ask</Button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {examples.map((example) => (
            <Button key={example} small onClick={() => setRequest(example)}>{example}</Button>
          ))}
        </div>
      </Card>

      {answer && (
        <Card title="Answer" sub={answer.operation ? `Matched operation: ${answer.operation}` : 'No operation matched'}>
          <div style={{ lineHeight: 1.6 }}>{answer.answer}</div>
          {answer.ai && (
            <div style={{ marginTop: 12 }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <span className="card-sub">AI plan — intent <code>{answer.ai.intent}</code>, confidence {(answer.ai.confidence * 100).toFixed(0)}%</span>
                <Pill tone={answer.ai.executable ? (answer.ai.needsConfirmation ? 'warning' : 'success') : 'error'}>
                  {answer.ai.executable ? (answer.ai.needsConfirmation ? 'needs confirmation' : 'ready') : 'blocked'}
                </Pill>
              </div>
              {answer.ai.note && <div className="card-sub" style={{ marginTop: 4 }}>{answer.ai.note}</div>}
              <ol style={{ marginTop: 8, lineHeight: 1.6 }}>
                {answer.ai.steps.map((step) => (
                  <li key={step.id}>
                    {step.summary}
                    {step.destructive && <Pill tone="warning">destructive</Pill>}
                    {!step.authorised && <Pill tone="error">{step.blockedReason || 'not authorised'}</Pill>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {answer.plan && (
            <div style={{ marginTop: 12 }}>
              <div className="card-sub">Plan built: {answer.plan.steps.length} step(s){answer.plan.actionable ? '' : ' (nothing to do)'} — review it in the Plans tab.</div>
              {answer.plan.notes.length > 0 && <ul>{answer.plan.notes.slice(0, 8).map((note, i) => <li key={i} className="card-sub">{note}</li>)}</ul>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- activity

function ActivityTab({ push, tick }: { push: Props['push']; tick: number }) {
  const { value: activity, loading, error, reload } = useAsync(() => fleet.storageActivity(200), [tick], []);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Storage activity" sub={`${activity.length} recent action(s).`} actions={<Button small onClick={() => void reload()}>Refresh</Button>}>
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load activity">{error}</Callout>}
        {!loading && activity.length === 0 && <Empty>No storage actions recorded yet.</Empty>}
        {activity.length > 0 && <ActivityTable entries={activity} />}
      </Card>
    </div>
  );
}

function ActivityTable({ entries }: { entries: StorageActivityEntry[] }) {
  return (
    <table>
      <thead><tr><th>When</th><th>Operation</th><th>Worker</th><th>Item</th><th>Count</th><th>Result</th><th>Detail</th></tr></thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>{relativeTime(entry.at)}</td>
            <td>{entry.operation}</td>
            <td>{entry.workerId || '—'}</td>
            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{entry.query || '—'}</td>
            <td>{entry.count}</td>
            <td>{entry.ok ? <Pill tone="success">ok</Pill> : <Pill tone="error">failed</Pill>}</td>
            <td className="card-sub">{entry.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --------------------------------------------------------------------- profiles

function ProfilesTab({ push, onChanged }: { push: Props['push']; onChanged: () => void }) {
  const { value: profiles, loading, error, reload } = useAsync(() => fleet.listStorageProfiles(), [], []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<StorageProfile | null>(null);

  const save = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await fleet.saveStorageProfile(name.trim(), 'Saved from the Storage page');
      setName('');
      await reload();
      onChanged();
      push('Profile saved');
    } catch (err) { push(toFriendlyError(err).title, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Configuration profiles" sub="Save the current networks, categories, rules and workflows as a named snapshot.">
        <div className="row" style={{ gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Profile name" style={{ flex: 1 }} />
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>Save profile</Button>
        </div>
      </Card>

      <Card title="Saved profiles" sub={`${profiles.length} profile(s).`}>
        {loading && <Empty>Loading…</Empty>}
        {error && <Callout tone="error" title="Could not load profiles">{error}</Callout>}
        {!loading && profiles.length === 0 && <Empty>No profiles saved.</Empty>}
        {profiles.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th>Description</th><th>Saved</th><th></th></tr></thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td style={{ fontWeight: 600 }}>{profile.name}</td>
                  <td className="card-sub">{profile.description}</td>
                  <td>{relativeTime(profile.createdAt)}</td>
                  <td><Button small variant="danger" onClick={() => setRemoving(profile)}>Delete</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {removing && (
        <ConfirmDialog
          title="Delete profile"
          danger
          message={<>Delete the profile <b>{removing.name}</b>?</>}
          confirmLabel="Delete"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try { await fleet.deleteStorageProfile(removing.id); setRemoving(null); await reload(); onChanged(); push('Profile deleted'); }
            catch (err) { push(toFriendlyError(err).title, 'error'); }
          }}
        />
      )}
    </div>
  );
}
