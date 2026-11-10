/**
 * Statistics: a single, honest report over the Host's own records.
 *
 * Every number is computed from rows that exist (tasks, commands, events, inventory captures,
 * schedules, rules, containers, audit entries). Where a metric has no underlying data it is `null`
 * with a zero sample size, never a misleading zero. The whole module is pure so it can be unit
 * tested and so the export path and the UI share exactly one calculation.
 *
 * There is deliberately no notion of a "kill" or a "death" here: the Host does not play the game and
 * must not invent combat numbers it cannot observe. What it *can* observe — tasks it dispatched and
 * how they went, commands sent, inventory captured, automation fired — is what is reported.
 */
import type {
  AuditEntry, AutomationRule, ContainerRecord, FleetEvent, ScheduleRecord,
  WorkerCommandRecord, WorkerInventorySnapshot, WorkerTaskRecord, WorkerView,
} from '../../../shared/types';
import { averageDuration, completionRate, failureRate, histogram, type ActivityBucket, type MetricValue, type TaskSample } from '../telemetry';

export interface CountedItem {
  key: string;
  count: number;
}

export interface StatisticsReport {
  generatedAt: number;
  /** The window the activity histogram covers, in ms. */
  windowMs: number;

  workers: {
    total: number;
    online: number;
    byStatus: CountedItem[];
    byGroup: CountedItem[];
    byMinecraftVersion: CountedItem[];
  };

  tasks: {
    total: number;
    byKind: CountedItem[];
    byStatus: CountedItem[];
    completion: MetricValue;
    failure: MetricValue;
    averageDurationMs: MetricValue;
    byActor: CountedItem[];
  };

  /** Task and command timestamps bucketed for the activity chart. */
  activity: {
    bucketMs: number;
    buckets: ActivityBucket[];
  };

  commands: {
    total: number;
    byKind: CountedItem[];
    delivered: number;
    refused: number;
  };

  events: {
    total: number;
    byType: CountedItem[];
  };

  inventory: {
    capturedWorkers: number;
    distinctItems: number;
    totalItems: number;
    /** How many workers have no captured inventory at all. */
    missing: number;
  };

  automation: {
    schedules: number;
    enabledSchedules: number;
    totalFires: number;
    rules: number;
    enabledRules: number;
    totalRuleRuns: number;
  };

  containers: number;

  audit: {
    total: number;
    byAction: CountedItem[];
  };
}

export interface StatisticsInput {
  workers: readonly WorkerView[];
  tasks: readonly WorkerTaskRecord[];
  commands: readonly WorkerCommandRecord[];
  events: readonly FleetEvent[];
  inventory: readonly WorkerInventorySnapshot[];
  schedules: readonly ScheduleRecord[];
  rules: readonly AutomationRule[];
  containers: readonly ContainerRecord[];
  audit: readonly AuditEntry[];
}

/** Counts occurrences of a derived key, returning the highest counts first. */
function countBy<T>(rows: readonly T[], key: (row: T) => string): CountedItem[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** How many activity buckets the chart shows, and how wide each is. */
const ACTIVITY_BUCKETS = 24;
const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function buildStatistics(input: StatisticsInput, now = Date.now()): StatisticsReport {
  const { workers, tasks, commands, events, inventory, schedules, rules, containers, audit } = input;

  const taskSamples: TaskSample[] = tasks.map((task) => ({
    ok: task.status === 'SUCCEEDED',
    durationMs: task.durationMs,
    createdAt: task.createdAt,
  }));

  const inventoryWorkerIds = new Set(inventory.map((snapshot) => snapshot.workerId));
  const distinctItems = new Set<string>();
  let totalItems = 0;
  for (const snapshot of inventory) {
    for (const item of [...snapshot.carried, ...snapshot.accessible, ...snapshot.armor]) {
      distinctItems.add(item.id);
      totalItems += item.count;
    }
  }

  const activityTimestamps = [
    ...tasks.map((task) => task.createdAt),
    ...commands.map((command) => command.createdAt),
  ];

  return {
    generatedAt: now,
    windowMs: ACTIVITY_WINDOW_MS,
    workers: {
      total: workers.length,
      online: workers.filter((worker) => worker.online).length,
      byStatus: countBy(workers, (worker) => worker.status),
      byGroup: countBy(workers, (worker) => worker.groupId ?? 'unassigned'),
      byMinecraftVersion: countBy(workers, (worker) => worker.minecraftVersion || 'unknown'),
    },
    tasks: {
      total: tasks.length,
      byKind: countBy(tasks, (task) => task.kind),
      byStatus: countBy(tasks, (task) => task.status),
      completion: completionRate(taskSamples),
      failure: failureRate(taskSamples),
      averageDurationMs: averageDuration(taskSamples),
      byActor: countBy(tasks, (task) => task.actor || 'host'),
    },
    activity: {
      bucketMs: Math.round(ACTIVITY_WINDOW_MS / ACTIVITY_BUCKETS),
      buckets: histogram(activityTimestamps, Math.round(ACTIVITY_WINDOW_MS / ACTIVITY_BUCKETS), ACTIVITY_BUCKETS, now),
    },
    commands: {
      total: commands.length,
      byKind: countBy(commands, (command) => command.kind),
      delivered: commands.filter((command) => command.ok).length,
      refused: commands.filter((command) => !command.ok).length,
    },
    events: {
      total: events.length,
      byType: countBy(events, (event) => event.type),
    },
    inventory: {
      capturedWorkers: inventoryWorkerIds.size,
      distinctItems: distinctItems.size,
      totalItems,
      missing: workers.filter((worker) => !inventoryWorkerIds.has(worker.id)).length,
    },
    automation: {
      schedules: schedules.length,
      enabledSchedules: schedules.filter((schedule) => schedule.enabled).length,
      totalFires: schedules.reduce((sum, schedule) => sum + schedule.fireCount, 0),
      rules: rules.length,
      enabledRules: rules.filter((rule) => rule.enabled).length,
      totalRuleRuns: rules.reduce((sum, rule) => sum + rule.runCount, 0),
    },
    containers: containers.length,
    audit: {
      total: audit.length,
      byAction: countBy(audit, (entry) => entry.action),
    },
  };
}

/** A metric rendered as a percentage string, or `null` when there was nothing to compute. */
export function formatMetricPercent(metric: MetricValue): string | null {
  return metric.value === null ? null : `${(metric.value * 100).toFixed(1)}%`;
}

/** The report as CSV: one section per table, with a header row each. */
export function statisticsToCsv(report: StatisticsReport): string {
  const lines: string[] = [];
  const section = (title: string, header: string[], rows: (string | number)[][]): void => {
    lines.push(`# ${title}`);
    lines.push(header.join(','));
    for (const row of rows) lines.push(row.map(csvCell).join(','));
    lines.push('');
  };

  lines.push('# Logvex Host statistics');
  lines.push(`generated_at,${new Date(report.generatedAt).toISOString()}`);
  lines.push('');

  section('workers by status', ['status', 'count'], report.workers.byStatus.map((row) => [row.key, row.count]));
  section('workers by group', ['group_id', 'count'], report.workers.byGroup.map((row) => [row.key, row.count]));
  section('tasks by kind', ['kind', 'count'], report.tasks.byKind.map((row) => [row.key, row.count]));
  section('tasks by status', ['status', 'count'], report.tasks.byStatus.map((row) => [row.key, row.count]));
  section('commands by kind', ['kind', 'count'], report.commands.byKind.map((row) => [row.key, row.count]));
  section('events by type', ['type', 'count'], report.events.byType.map((row) => [row.key, row.count]));
  section('audit by action', ['action', 'count'], report.audit.byAction.map((row) => [row.key, row.count]));
  section(
    'summary',
    ['metric', 'value', 'sample_size'],
    [
      ['tasks_total', report.tasks.total, report.tasks.total],
      ['tasks_completion', report.tasks.completion.value ?? '', report.tasks.completion.sampleSize],
      ['tasks_failure', report.tasks.failure.value ?? '', report.tasks.failure.sampleSize],
      ['tasks_avg_duration_ms', report.tasks.averageDurationMs.value ?? '', report.tasks.averageDurationMs.sampleSize],
      ['commands_total', report.commands.total, report.commands.total],
      ['inventory_distinct_items', report.inventory.distinctItems, report.inventory.distinctItems],
      ['automation_schedule_fires', report.automation.totalFires, report.automation.schedules],
      ['automation_rule_runs', report.automation.totalRuleRuns, report.automation.rules],
      ['containers', report.containers, report.containers],
    ],
  );

  return lines.join('\n');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
