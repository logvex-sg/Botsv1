/**
 * Logs & Statistics page.
 *
 * Aggregated statistics from the shared database plus a live log view of the selected instance.
 * Statistics can be exported as CSV or JSON.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Stat } from '../components/ui';
import { formatUptime } from '../lib/format';

export function LogsPage() {
  const store = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!selected && store.instances.length > 0) setSelected(store.instances[0].id);
  }, [store.instances, selected]);

  useEffect(() => {
    if (!selected) return;
    const load = async (): Promise<void> => setLogs(await fleet.getInstanceLogs(selected));
    void load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [selected]);

  const stats = useMemo(() => {
    const events = store.events;
    const bySeverity = (severity: string): number => events.filter((e) => e.severity === severity).length;
    const byType = new Map<string, number>();
    for (const event of events) byType.set(event.type, (byType.get(event.type) ?? 0) + 1);
    return {
      totalEvents: events.length,
      errors: bySeverity('error'),
      warnings: bySeverity('warning'),
      kills: store.targets.reduce((sum, t) => sum + t.kills, 0),
      deaths: store.targets.reduce((sum, t) => sum + t.deaths, 0),
      encounters: store.targets.reduce((sum, t) => sum + t.encounters, 0),
      topTypes: [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      runningTime: store.instances.reduce((sum, i) => sum + i.uptimeMs, 0),
    };
  }, [store.events, store.targets, store.instances]);

  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fleet-stats-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = (): void => {
    const rows = [['metric', 'value'], ...Object.entries(stats).filter(([, v]) => typeof v === 'number')];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fleet-stats-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title="Fleet statistics" actions={<>
        <Button small onClick={exportCsv}>Export CSV</Button>
        <Button small onClick={exportJson}>Export JSON</Button>
      </>}>
        <div className="grid cols-4">
          <Card><Stat value={stats.totalEvents} label="Events" /></Card>
          <Card><Stat value={<span style={{ color: stats.errors ? 'var(--error)' : undefined }}>{stats.errors}</span>} label="Errors" /></Card>
          <Card><Stat value={stats.encounters} label="Encounters" /></Card>
          <Card><Stat value={stats.kills} label="Kills recorded" /></Card>
          <Card><Stat value={stats.deaths} label="Deaths recorded" /></Card>
          <Card><Stat value={stats.warnings} label="Warnings" /></Card>
          <Card><Stat value={store.instances.length} label="Instances" /></Card>
          <Card><Stat value={formatUptime(stats.runningTime)} label="Combined uptime" /></Card>
        </div>
      </Card>

      <Card title="Most frequent event types">
        {stats.topTypes.length === 0 ? (
          <Empty>No events yet.</Empty>
        ) : (
          <table>
            <thead><tr><th>Event type</th><th>Count</th></tr></thead>
            <tbody>
              {stats.topTypes.map(([type, count]) => (
                <tr key={type}><td>{type}</td><td>{count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Instance logs"
        actions={
          <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value || null)} style={{ maxWidth: 240 }}>
            <option value="">— select an instance —</option>
            {store.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        }
      >
        <div className="log-view">
          {logs.length === 0 ? <div className="line INFO">No log output.</div> : logs.map((line, index) => (
            <div key={index} className={`line ${line.includes(' ERROR ') ? 'ERROR' : line.includes(' WARN ') ? 'WARN' : 'INFO'}`}>{line}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}
