/**
 * Regear: loadout presets and the comparison against what a worker actually has.
 *
 * Two ideas are kept apart on purpose:
 *  - a *comparison* is a pure calculation over the last reported inventory. It moves nothing.
 *  - a *regear run* asks the worker to act. By default it is a dry run; withdrawing items requires
 *    the "allow moves" switch, and even then the worker only shift-clicks items out of a container
 *    screen it already has open, then re-reads its inventory and reports what actually changed.
 *
 * Nothing here attacks, equips or fights. It is an inventory bookkeeping tool.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, ConfirmDialog, Empty, Field, Modal, Pill } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { toFriendlyError } from '../../lib/errors';
import type { RegearComparison, RegearItem, RegearPreset } from '../../../shared/types';
import { Freshness, StatusChip, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

const STARTER: RegearItem[] = [
  { query: 'totem', count: 1, label: 'Totem of Undying' },
  { query: 'diamond_sword', count: 1, label: 'Sword' },
  { query: 'golden_apple', count: 8, label: 'Golden apples' },
];

export function RegearTab({ push }: Props) {
  const store = useStore();
  const [editing, setEditing] = useState<RegearPreset | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<RegearPreset | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [comparison, setComparison] = useState<RegearComparison | null>(null);
  const [comparisonWorker, setComparisonWorker] = useState<string>('');
  const [allowMoves, setAllowMoves] = useState(false);
  const [confirmRun, setConfirmRun] = useState<{ scope: 'one' | 'all'; workerId?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const presets = store.regearPresets;
  const workers = store.workers;
  const online = workers.filter((w) => w.online);

  useEffect(() => {
    if (!selectedPreset && presets.length > 0) setSelectedPreset(presets[0].id);
  }, [presets, selectedPreset]);

  useEffect(() => {
    if (!comparisonWorker && workers.length > 0) setComparisonWorker(workers[0].id);
  }, [workers, comparisonWorker]);

  const compare = async (): Promise<void> => {
    if (!comparisonWorker || !selectedPreset) return;
    try {
      setComparison(await fleet.compareRegearPreset(comparisonWorker, selectedPreset));
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    }
  };

  useEffect(() => {
    void compare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonWorker, selectedPreset, store.workers]);

  const runRegear = async (scope: 'one' | 'all', workerId?: string): Promise<void> => {
    if (!selectedPreset) return;
    setBusy(true);
    try {
      if (scope === 'one' && workerId) {
        const result = await fleet.regearWorker(workerId, selectedPreset, allowMoves);
        push(result.ok ? `Regear: ${result.message}` : `Regear failed: ${result.message}`, result.ok ? undefined : 'error');
      } else {
        const ids = online.map((w) => w.id);
        if (ids.length === 0) { push('No connected workers', 'error'); return; }
        const results = await fleet.regearWorkers(ids, selectedPreset, allowMoves);
        const ok = results.filter((r) => r.ok).length;
        push(`Regear sent to ${results.length} worker(s); ${ok} reported success`, ok === results.length ? undefined : 'error');
      }
      await store.refreshWorkers();
      await compare();
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Callout tone="info" title="What regear does">
        A regear compares a loadout against what a client is actually carrying. With moves off it is a
        dry run that only reports. With moves on, the worker shift-clicks the missing items out of a
        container screen it already has open and then re-reads its inventory, so the confirmation is
        what really happened. It never fights, and it never opens a container for you.
      </Callout>

      <Card
        title="Loadout presets"
        sub={`${presets.length} preset(s)`}
        actions={<Button small variant="primary" onClick={() => setCreating(true)}>New preset</Button>}
      >
        {presets.length === 0 && <Empty>No presets yet. Create one to define what a client should be carrying.</Empty>}
        {presets.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Items</th><th>Min armor</th><th>Min food</th><th>Low durability</th><th></th></tr>
            </thead>
            <tbody>
              {presets.map((preset) => (
                <tr key={preset.id} style={{ background: selectedPreset === preset.id ? 'var(--bg-hover)' : undefined }}>
                  <td>
                    <button className="btn ghost sm" onClick={() => setSelectedPreset(preset.id)}>
                      {preset.name}
                    </button>
                    {preset.description && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{preset.description}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>{preset.items.map((item) => `${item.count}× ${item.label || item.query}`).join(', ') || '—'}</td>
                  <td>{preset.minArmorPieces}/4</td>
                  <td>{preset.minFood}</td>
                  <td>{preset.lowDurabilityPercent}%</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Button small variant="ghost" onClick={() => setEditing(preset)}>Edit</Button>
                      <Button small variant="ghost" onClick={() => setRemoving(preset)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Compare a worker against a preset"
        sub="A calculation over the last reported inventory; nothing is sent to the client."
        actions={<Button small variant="ghost" onClick={() => void compare()}>Re-compare</Button>}
      >
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <Field label="Worker">
            <select value={comparisonWorker} onChange={(e) => setComparisonWorker(e.target.value)}>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{workerTitle(worker)}{worker.online ? '' : ' (offline)'}</option>
              ))}
            </select>
          </Field>
          <Field label="Preset">
            <select value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)}>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </Field>
          <label className="row" style={{ gap: 8, paddingBottom: 10 }}>
            <input type="checkbox" checked={allowMoves} onChange={(e) => setAllowMoves(e.target.checked)} />
            <span style={{ fontSize: 12 }}>Allow moves</span>
          </label>
        </div>

        {!comparison && <Empty>Select a worker and a preset to compare.</Empty>}

        {comparison && (
          <>
            <div className="row between" style={{ margin: '8px 0' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <Pill tone={comparison.ready ? 'online' : 'warning'}>{comparison.ready ? 'Loadout satisfied' : 'Missing items'}</Pill>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  from inventory reported <Freshness capturedAt={comparison.capturedAt} />
                </span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button small disabled={busy || !online.some((w) => w.id === comparisonWorker)} onClick={() => setConfirmRun({ scope: 'one', workerId: comparisonWorker })}>
                  Run regear on this worker
                </Button>
                <Button small variant="ghost" disabled={busy || online.length === 0} onClick={() => setConfirmRun({ scope: 'all' })}>
                  Run on all connected
                </Button>
              </div>
            </div>

            <table>
              <thead>
                <tr><th>Item</th><th style={{ textAlign: 'right' }}>Needed</th><th style={{ textAlign: 'right' }}>Has</th><th style={{ textAlign: 'right' }}>Missing</th><th></th></tr>
              </thead>
              <tbody>
                {comparison.gaps.map((gap) => (
                  <tr key={gap.query}>
                    <td>{gap.label}</td>
                    <td style={{ textAlign: 'right' }}>{gap.required}</td>
                    <td style={{ textAlign: 'right' }}>{gap.found}</td>
                    <td style={{ textAlign: 'right', color: gap.missing > 0 ? 'var(--error)' : 'var(--success)', fontWeight: 600 }}>
                      {gap.missing > 0 ? gap.missing : '✓'}
                    </td>
                    <td>
                      {gap.missing > 0 && (
                        <Button small variant="ghost" onClick={() => {
                          void (async () => {
                            const worker = store.workers.find((w) => w.id === comparisonWorker);
                            if (!worker?.online) { push('That worker is not connected', 'error'); return; }
                            await store.refreshWorkers();
                            push(`Tip: open a container on ${workerTitle(worker)}, then run the regear with "Allow moves" on.`);
                          })();
                        }}>How?</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="row" style={{ gap: 18, marginTop: 10, fontSize: 12, color: 'var(--text-dim)' }}>
              <span>Armor: {comparison.armorPieces}/{comparison.minArmorPieces}</span>
              <span>Food: {comparison.food}/{comparison.minFood}</span>
              {comparison.damaged.length > 0 && <span style={{ color: 'var(--warning)' }}>Worn out: {comparison.damaged.join(', ')}</span>}
            </div>

            {allowMoves && (
              <Callout tone="warning" title="Moves are enabled">
                The worker will shift-click missing items out of a container screen it currently has
                open. If no container is open it will report that and move nothing.
              </Callout>
            )}
          </>
        )}
      </Card>

      <Card title="All workers against this preset" sub="A quick sweep of the last reported inventories.">
        {!selectedPreset && <Empty>Select a preset first.</Empty>}
        {selectedPreset && (
          <table>
            <thead>
              <tr><th>Worker</th><th>Status</th><th>Ready</th><th>Missing</th><th>Reported</th></tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <WorkerPresetRow key={worker.id} workerId={worker.id} presetId={selectedPreset} />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(creating || editing) && (
        <PresetModal
          preset={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (input) => {
            try {
              if (editing) await fleet.updateRegearPreset(editing.id, input);
              else await fleet.createRegearPreset(input);
              await store.refreshRegearPresets();
              push(editing ? 'Preset saved' : 'Preset created');
              setCreating(false);
              setEditing(null);
            } catch (error) {
              const friendly = toFriendlyError(error);
              push(`${friendly.title} — ${friendly.hint}`, 'error');
            }
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete “${removing.name}”?`}
          danger
          confirmLabel="Delete preset"
          message="The preset is removed. Nothing is sent to any client."
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const preset = removing;
            setRemoving(null);
            try {
              await fleet.deleteRegearPreset(preset.id);
              await store.refreshRegearPresets();
              push('Preset deleted');
            } catch (error) {
              const friendly = toFriendlyError(error);
              push(`${friendly.title} — ${friendly.hint}`, 'error');
            }
          }}
        />
      )}

      {confirmRun && (
        <ConfirmDialog
          title={confirmRun.scope === 'all' ? 'Regear every connected worker?' : 'Regear this worker?'}
          danger={allowMoves}
          confirmLabel={allowMoves ? 'Run with moves' : 'Run dry'}
          message={allowMoves
            ? 'Each worker will withdraw the missing items from a container screen it already has open, then re-read its inventory and report the result.'
            : 'This is a dry run: each worker compares the preset against what it is carrying and reports the difference. Nothing is moved.'}
          onCancel={() => setConfirmRun(null)}
          onConfirm={async () => {
            const request = confirmRun;
            setConfirmRun(null);
            await runRegear(request.scope, request.workerId);
          }}
        />
      )}
    </div>
  );
}

/** One row of the fleet-wide sweep; loads its own comparison so the table stays responsive. */
function WorkerPresetRow({ workerId, presetId }: { workerId: string; presetId: string }) {
  const store = useStore();
  const worker = store.workers.find((w) => w.id === workerId);
  const [comparison, setComparison] = useState<RegearComparison | null>(null);

  useEffect(() => {
    void fleet.compareRegearPreset(workerId, presetId).then(setComparison).catch(() => setComparison(null));
  }, [workerId, presetId, store.workers]);

  if (!worker) return null;
  return (
    <tr>
      <td>{workerTitle(worker)}</td>
      <td><StatusChip worker={worker} /></td>
      <td>{comparison ? <Pill tone={comparison.ready ? 'online' : 'warning'}>{comparison.ready ? 'ready' : 'not ready'}</Pill> : '—'}</td>
      <td style={{ fontSize: 12 }}>{comparison && comparison.gaps.filter((g) => g.missing > 0).map((g) => `${g.missing}× ${g.label}`).join(', ') || '—'}</td>
      <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>{comparison ? relativeTime(comparison.capturedAt) : '—'}</td>
    </tr>
  );
}

function PresetModal({
  preset, onClose, onSubmit,
}: {
  preset: RegearPreset | null;
  onClose: () => void;
  onSubmit: (input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}) {
  const [name, setName] = useState(preset?.name ?? '');
  const [description, setDescription] = useState(preset?.description ?? '');
  const [items, setItems] = useState<RegearItem[]>(preset?.items ?? STARTER);
  const [minArmorPieces, setMinArmorPieces] = useState(preset?.minArmorPieces ?? 4);
  const [minFood, setMinFood] = useState(preset?.minFood ?? 8);
  const [lowDurabilityPercent, setLowDurabilityPercent] = useState(preset?.lowDurabilityPercent ?? 15);

  const updateItem = (index: number, patch: Partial<RegearItem>): void => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <Modal
      title={preset ? `Edit ${preset.name}` : 'New loadout preset'}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={name.trim().length === 0}
            onClick={() => void onSubmit({
              name: name.trim(),
              description,
              items: items.filter((item) => item.query.trim().length > 0).map((item) => ({ ...item, label: item.label || item.query })),
              minArmorPieces,
              minFood,
              lowDurabilityPercent,
            })}
          >
            {preset ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="standard pvp" autoFocus />
      </Field>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this loadout is for" />
      </Field>

      <div className="card-title" style={{ fontSize: 13, marginTop: 8 }}>Items the client should carry</div>
      <div className="col" style={{ gap: 6 }}>
        {items.map((item, index) => (
          <div key={index} className="row" style={{ gap: 8 }}>
            <input
              value={item.query}
              onChange={(e) => updateItem(index, { query: e.target.value })}
              placeholder="totem / diamond_sword / iron"
              style={{ flex: 2 }}
            />
            <input
              value={item.label}
              onChange={(e) => updateItem(index, { label: e.target.value })}
              placeholder="Label (optional)"
              style={{ flex: 2 }}
            />
            <input
              type="number"
              min={1}
              value={item.count}
              onChange={(e) => updateItem(index, { count: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 80 }}
            />
            <Button small variant="ghost" onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}>✕</Button>
          </div>
        ))}
        <div>
          <Button small variant="ghost" onClick={() => setItems((prev) => [...prev, { query: '', count: 1, label: '' }])}>Add item</Button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="Minimum armor pieces" hint="0–4">
          <input type="number" min={0} max={4} value={minArmorPieces} onChange={(e) => setMinArmorPieces(Math.max(0, Math.min(4, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Minimum food" hint="Counted from food items carried.">
          <input type="number" min={0} value={minFood} onChange={(e) => setMinFood(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="Low durability warning" hint="Percent remaining.">
          <input type="number" min={0} max={100} value={lowDurabilityPercent} onChange={(e) => setLowDurabilityPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
        </Field>
      </div>
    </Modal>
  );
}
