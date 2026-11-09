/**
 * Inventory: aggregate item counts across the fleet.
 *
 * Every number here comes from the last inventory a worker *reported*, and every number is shown
 * with the age of that report. That distinction is the whole point of the screen: the host cannot
 * see inside another client, so it must never present a stale count as if it were live. The
 * "refresh selected" button asks the workers for a fresh snapshot and then re-counts.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../lib/store';
import { fleet } from '../../lib/api';
import { Button, Callout, Card, Empty, Field, Pill } from '../../components/ui';
import { relativeTime } from '../../lib/format';
import { toFriendlyError } from '../../lib/errors';
import type { ItemCountReport, WorkerInventorySnapshot } from '../../../shared/types';
import { Freshness, StatusChip, prettyId, workerTitle } from './shared';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function InventoryTab({ push }: Props) {
  const store = useStore();
  const [query, setQuery] = useState('diamond');
  const [report, setReport] = useState<ItemCountReport | null>(null);
  const [totals, setTotals] = useState<{ id: string; name: string; count: number }[]>([]);
  const [scope, setScope] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkerInventorySnapshot | null>(null);
  const [inspectId, setInspectId] = useState<string>('');

  const workers = store.workers;
  const groups = store.workerGroups;
  const scopeIds = useMemo(
    () => (scope ? workers.filter((w) => w.groupId === scope).map((w) => w.id) : undefined),
    [scope, workers],
  );

  const reload = async (): Promise<void> => {
    try {
      const [count, combined] = await Promise.all([
        fleet.countWorkerItem(query, scopeIds),
        fleet.getCombinedTotals(scopeIds),
      ]);
      setReport(count);
      setTotals(combined);
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    }
  };

  useEffect(() => {
    void reload();
    // Re-count whenever the roster changes, so a worker joining is reflected without a manual click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, scope, workers.length]);

  useEffect(() => {
    if (!inspectId) { setSnapshot(null); return; }
    void fleet.getWorkerInventory(inspectId).then((value) => setSnapshot(value ?? null)).catch(() => setSnapshot(null));
  }, [inspectId, workers]);

  const refreshFromWorkers = async (): Promise<void> => {
    const recipients = (scopeIds ?? workers.map((w) => w.id)).filter((id) => store.workers.find((w) => w.id === id)?.online);
    if (recipients.length === 0) {
      push('No connected workers in that scope', 'error');
      return;
    }
    setBusy(true);
    try {
      const results = await fleet.runWorkerTaskMany(recipients, 'inventory');
      const ok = results.filter((r) => r.ok).length;
      push(`Inventory refreshed from ${ok} of ${recipients.length} worker(s)`, ok === recipients.length ? undefined : 'error');
      await store.refreshWorkers();
      await reload();
    } catch (error) {
      const friendly = toFriendlyError(error);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Item counts across the fleet"
        sub="Totals come from each worker's last reported inventory, never from a live view."
        actions={
          <>
            <Button small variant="ghost" onClick={() => void reload()}>Re-count</Button>
            <Button small disabled={busy} onClick={() => void refreshFromWorkers()}>
              {busy ? 'Asking workers…' : 'Refresh from workers'}
            </Button>
            <Button small variant="ghost" onClick={async () => {
              const result = await fleet.exportWorkerReport('csv').catch(() => null);
              if (result) push(`Report written to ${result.path}`);
              else push('Export cancelled');
            }}>Export CSV</Button>
            <Button small variant="ghost" onClick={async () => {
              const result = await fleet.exportWorkerReport('json').catch(() => null);
              if (result) push(`Report written to ${result.path}`);
              else push('Export cancelled');
            }}>Export JSON</Button>
          </>
        }
      >
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <Field label="Item" hint="Friendly names work: totem, gapple, iron, pearl.">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="diamond" />
            </Field>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <Field label="Scope">
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All workers</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {report && (
          <>
            <div className="row between" style={{ margin: '8px 0' }}>
              <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
                <span style={{ fontSize: 26, fontWeight: 700 }}>{report.total}</span>
                <span style={{ color: 'var(--text-dim)' }}>{query}</span>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {report.oldestCapture ? <>oldest report <Freshness capturedAt={report.oldestCapture} /></> : 'no reports yet'}
              </span>
            </div>

            {report.stale && (
              <Callout tone="warning" title="These numbers may be out of date">
                At least one worker has not reported its inventory recently. Use "Refresh from workers"
                to ask for a fresh snapshot before acting on these figures.
              </Callout>
            )}

            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>{query}</th>
                  <th>Reported</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.workerId}>
                    <td>{row.label}</td>
                    <td><Pill tone={row.online ? 'online' : 'muted'}>{row.online ? 'Connected' : 'Offline'}</Pill></td>
                    <td style={{ textAlign: 'right', fontWeight: row.count > 0 ? 600 : 400 }}>{row.count}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {row.capturedAt ? relativeTime(row.capturedAt) : 'never'}
                    </td>
                    <td><Button small variant="ghost" onClick={() => setInspectId(row.workerId)}>Inspect</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      <Card title="Everything the fleet is carrying" sub="Combined totals by item, from the last reports.">
        {totals.length === 0
          ? <Empty>No inventory has been reported yet. Connect a worker and pull its inventory.</Empty>
          : (
            <table>
              <thead>
                <tr><th>Item</th><th>Id</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {totals.slice(0, 60).map((row) => (
                  <tr key={row.id}>
                    <td>{row.name || prettyId(row.id)}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{row.id}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>

      {snapshot && (
        <Card
          title={`Inventory of ${workerTitle(workers.find((w) => w.id === snapshot.workerId) ?? { id: snapshot.workerId, label: snapshot.workerId } as never)}`}
          sub={`Reported ${relativeTime(snapshot.capturedAt)}`}
          actions={<Button small variant="ghost" onClick={() => setInspectId('')}>Close</Button>}
        >
          {snapshot.containerOpen && (
            <Callout tone="info" title="A container screen is open">
              The items below marked "in open container" are inside that screen, not in the client's
              inventory. They are listed separately because they are not the same thing.
            </Callout>
          )}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div className="card-title" style={{ fontSize: 13 }}>Carried ({snapshot.carried.length} stacks)</div>
              {snapshot.carried.length === 0 && <Empty>Nothing carried.</Empty>}
              {snapshot.carried.map((item) => (
                <div key={`${item.id}-${item.slot}`} className="row between" style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
                  <span>{item.name || prettyId(item.id)}</span>
                  <span className="mono">×{item.count}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="card-title" style={{ fontSize: 13 }}>Armor</div>
              {snapshot.armor.filter((a) => a.count > 0).length === 0 && <Empty>No armor worn.</Empty>}
              {snapshot.armor.filter((a) => a.count > 0).map((item) => (
                <div key={`${item.id}-${item.slot}`} className="row between" style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
                  <span>{item.name || prettyId(item.id)}</span>
                  <span className="mono">{item.damageable && item.maxDamage > 0 ? `${Math.round(((item.maxDamage - item.damage) * 100) / item.maxDamage)}%` : '—'}</span>
                </div>
              ))}

              <div className="card-title" style={{ fontSize: 13, marginTop: 12 }}>In open container ({snapshot.accessible.length} stacks)</div>
              {snapshot.accessible.length === 0
                ? <Empty>No container screen is open on that client.</Empty>
                : snapshot.accessible.map((item) => (
                    <div key={`${item.id}-${item.slot}`} className="row between" style={{ fontSize: 12, borderBottom: '1px solid var(--border)', padding: '3px 0' }}>
                      <span>{item.name || prettyId(item.id)}</span>
                      <span className="mono">×{item.count}</span>
                    </div>
                  ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {workers.map((worker) => (
          <Card key={worker.id}>
            <div className="row between">
              <span className="row" style={{ gap: 8 }}>
                <StatusChip worker={worker} />
                <span style={{ fontWeight: 600 }}>{workerTitle(worker)}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{worker.snapshot.totalItems} items</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {worker.snapshot.distinctItems} kinds · {worker.snapshot.freeSlots} free slots · {worker.snapshot.armorPieces}/4 armor · {worker.snapshot.totems} totem
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
