/**
 * Statistics page.
 *
 * One honest report over the Host's own records. Every figure comes from the same pure
 * `buildStatistics` calculation the export uses, so what you see is exactly what you export. Where
 * a metric has no data behind it the page says "no data" instead of showing a zero, because a
 * completion rate of 0% and "nothing has finished yet" mean very different things.
 */
import { useCallback, useEffect, useState } from 'react';
import { fleet } from '../lib/api';
import { Button, Callout, Card, Empty, ProgressBar, Stat } from '../components/ui';
import { toFriendlyError } from '../lib/errors';
import { formatMetricPercent, type CountedItem, type StatisticsReport } from '../../main/packages/statistics';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function StatisticsPage({ push }: Props) {
  const [report, setReport] = useState<StatisticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fleet.getStatistics());
      setError(null);
    } catch (err) {
      setError(toFriendlyError(err).title);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  const exportReport = async (format: 'json' | 'csv'): Promise<void> => {
    setBusy(true);
    try {
      const result = await fleet.exportStatistics(format);
      push(result ? `Exported to ${result.path}` : 'Export cancelled');
    } catch (err) {
      const friendly = toFriendlyError(err);
      push(`${friendly.title} — ${friendly.hint}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !report) return <Empty>Building the report…</Empty>;
  if (error && !report) return <Callout tone="error" title="Could not load statistics">{error}</Callout>;
  if (!report) return <Empty>No report.</Empty>;

  const completion = formatMetricPercent(report.tasks.completion);
  const failure = formatMetricPercent(report.tasks.failure);
  const avgDuration = report.tasks.averageDurationMs.value;

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Host statistics"
        sub={`Report built ${new Date(report.generatedAt).toLocaleTimeString()} · refreshes every 10s`}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button small onClick={() => void reload()} disabled={busy}>Refresh</Button>
            <Button small onClick={() => void exportReport('json')} disabled={busy}>Export JSON</Button>
            <Button small onClick={() => void exportReport('csv')} disabled={busy}>Export CSV</Button>
          </div>
        }
      >
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <Stat value={`${report.workers.online}/${report.workers.total}`} label="Workers online" />
          <Stat value={report.tasks.total} label="Tasks recorded" />
          <Stat value={report.commands.total} label="Commands sent" />
          <Stat value={report.inventory.distinctItems} label="Distinct items seen" />
          <Stat value={report.automation.totalFires} label="Schedule fires" />
          <Stat value={report.automation.totalRuleRuns} label="Rule runs" />
          <Stat value={report.containers} label="Containers recorded" />
          <Stat value={report.audit.total} label="Audit entries" />
        </div>
      </Card>

      <Card title="Task outcomes" sub="Computed over tasks that reached a terminal state.">
        <div className="col" style={{ gap: 10 }}>
          <OutcomeRow
            label="Completion rate"
            value={completion}
            sample={report.tasks.completion.sampleSize}
            tone="success"
            hint={report.tasks.completion.description}
          />
          <OutcomeRow
            label="Failure rate"
            value={failure}
            sample={report.tasks.failure.sampleSize}
            tone="error"
            hint={report.tasks.failure.description}
          />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-dim)' }}>Average task duration</span>
            <span style={{ fontFamily: 'var(--mono)' }}>
              {avgDuration === null ? 'no data' : `${Math.round(avgDuration)} ms`}
              <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>
                {report.tasks.averageDurationMs.sampleSize} sample(s)
              </span>
            </span>
          </div>
        </div>
      </Card>

      <Card title="Activity" sub="Tasks and commands per hour over the last 24 hours.">
        <ActivityChart buckets={report.activity.buckets} bucketMs={report.activity.bucketMs} />
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <BreakdownCard title="Tasks by kind" rows={report.tasks.byKind} />
        <BreakdownCard title="Tasks by status" rows={report.tasks.byStatus} />
        <BreakdownCard title="Tasks by actor" rows={report.tasks.byActor} />
        <BreakdownCard title="Workers by status" rows={report.workers.byStatus} />
        <BreakdownCard title="Events by type" rows={report.events.byType} />
        <BreakdownCard title="Audit by action" rows={report.audit.byAction} />
      </div>

      <Callout tone="info" title="Why there are no kill or death numbers here">
        The Host is a control plane: it never joins a world, so it cannot observe combat. Reporting a
        kill count would mean inventing a number. Everything on this page is derived from records the
        Host actually holds — tasks it dispatched, commands it sent, inventory its workers reported,
        and the automation it fired.
      </Callout>
    </div>
  );
}

function OutcomeRow({
  label, value, sample, tone, hint,
}: {
  label: string;
  value: string | null;
  sample: number;
  tone: string;
  hint: string;
}) {
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--text-dim)' }} title={hint}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)' }}>
          {value ?? 'no data'}
          <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>{sample} sample(s)</span>
        </span>
      </div>
      <ProgressBar
        value={value === null ? 0 : Number.parseFloat(value)}
        color={tone === 'success' ? 'var(--success)' : 'var(--error)'}
      />
    </div>
  );
}

function ActivityChart({ buckets, bucketMs }: { buckets: StatisticsReport['activity']['buckets']; bucketMs: number }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return <Empty>No task or command activity in the last 24 hours.</Empty>;
  const hours = Math.max(1, Math.round(bucketMs / 3_600_000));

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: 'flex-end', gap: 3, height: 120 }}>
        {buckets.map((bucket) => (
          <div
            key={bucket.at}
            title={`${new Date(bucket.at).toLocaleTimeString([], { hour: '2-digit' })} · ${bucket.count}`}
            style={{
              flex: 1,
              height: `${(bucket.count / max) * 100}%`,
              minHeight: bucket.count > 0 ? 3 : 0,
              background: bucket.count > 0 ? 'var(--accent)' : 'var(--bg-hover)',
              borderRadius: '3px 3px 0 0',
            }}
          />
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-faint)' }}>
        <span>{buckets.length * hours}h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: CountedItem[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <Card title={title} sub={`${rows.length} value(s)`}>
      {rows.length === 0 ? (
        <Empty>Nothing recorded.</Empty>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {rows.map((row) => (
            <div key={row.key} className="col" style={{ gap: 3 }}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ fontFamily: 'var(--mono)' }}>{row.key}</span>
                <span style={{ color: 'var(--text-dim)' }}>{row.count}</span>
              </div>
              <ProgressBar value={(row.count / max) * 100} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
