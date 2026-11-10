/**
 * Statistics tests.
 *
 * The rules under test are the ones the brief cares about: every number is derived from records
 * that exist, an empty input yields "no data" rather than a misleading zero, and the CSV export
 * mirrors the report exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStatistics,
  formatMetricPercent,
  statisticsToCsv,
  type StatisticsInput,
} from '../../src/main/packages/statistics';
import type { WorkerView } from '../../src/shared/types';
import { emptySnapshot } from '../../src/shared/workers';

function worker(id: string, patch: Partial<WorkerView> = {}): WorkerView {
  return {
    id,
    label: id,
    username: id,
    minecraftVersion: '1.21.11',
    serverAddress: 'play.example.net',
    protocolVersion: 3,
    modVersion: '2.0.0',
    groupId: null,
    notes: '',
    firstSeen: 0,
    lastSeen: 0,
    lastAddress: '',
    status: 'ONLINE',
    tags: [],
    serverProfileId: null,
    fabricVersion: '',
    meteorVersion: '',
    capabilities: [],
    archived: false,
    online: true,
    lastHeartbeatAgeSeconds: 1,
    connectedAt: 0,
    snapshot: emptySnapshot(id),
    currentTask: '',
    busy: false,
    paused: false,
    stopped: false,
    ...patch,
  };
}

function emptyInput(): StatisticsInput {
  return { workers: [], tasks: [], commands: [], events: [], inventory: [], schedules: [], rules: [], containers: [], audit: [] };
}

describe('buildStatistics', () => {
  it('reports no data (null metrics, zero samples) for an empty fleet', () => {
    const report = buildStatistics(emptyInput(), 1_000);
    expect(report.tasks.completion.value).toBeNull();
    expect(report.tasks.completion.sampleSize).toBe(0);
    expect(report.tasks.failure.value).toBeNull();
    expect(report.tasks.averageDurationMs.value).toBeNull();
    expect(report.workers.total).toBe(0);
    expect(report.activity.buckets).toHaveLength(24);
    expect(report.activity.buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('counts workers by status, group and version', () => {
    const report = buildStatistics({
      ...emptyInput(),
      workers: [
        worker('w1', { status: 'ONLINE', groupId: 'g1' }),
        worker('w2', { status: 'ONLINE', groupId: 'g1' }),
        worker('w3', { status: 'BUSY', groupId: null, minecraftVersion: '1.20.4', online: false }),
      ],
    }, 1_000);
    expect(report.workers.total).toBe(3);
    expect(report.workers.online).toBe(2);
    expect(report.workers.byStatus[0]).toEqual({ key: 'ONLINE', count: 2 });
    expect(report.workers.byGroup[0]).toEqual({ key: 'g1', count: 2 });
    expect(report.workers.byMinecraftVersion.find((row) => row.key === '1.20.4')?.count).toBe(1);
  });

  it('computes completion and failure over finished tasks only', () => {
    const report = buildStatistics({
      ...emptyInput(),
      tasks: [
        { id: 't1', workerId: 'w1', kind: 'inventory', status: 'SUCCEEDED', params: {}, result: {}, error: null, createdAt: 0, dispatchedAt: 0, completedAt: 10, durationMs: 10, actor: 'operator' },
        { id: 't2', workerId: 'w1', kind: 'regear', status: 'FAILED', params: {}, result: null, error: 'x', createdAt: 0, dispatchedAt: 0, completedAt: 20, durationMs: 20, actor: 'rule:r1' },
        { id: 't3', workerId: 'w2', kind: 'inventory', status: 'PENDING', params: {}, result: null, error: null, createdAt: 0, dispatchedAt: null, completedAt: null, durationMs: null, actor: 'operator' },
      ],
    }, 1_000);
    expect(report.tasks.total).toBe(3);
    expect(report.tasks.completion.value).toBeCloseTo(0.5);
    expect(report.tasks.completion.sampleSize).toBe(2);
    expect(report.tasks.failure.value).toBeCloseTo(0.5);
    expect(report.tasks.averageDurationMs.value).toBe(15);
    expect(report.tasks.byActor.find((row) => row.key === 'rule:r1')?.count).toBe(1);
  });

  it('aggregates inventory totals and counts workers with none', () => {
    const item = (id: string, name: string, count: number, slot: number) => ({ id, name, count, slot, damage: 0, maxDamage: 0, damageable: false });
    const snapshot = {
      workerId: 'w1', capturedAt: 0, containerOpen: false,
      carried: [item('minecraft:diamond', 'Diamond', 10, 0)],
      accessible: [] as ReturnType<typeof item>[],
      armor: [item('minecraft:netherite_helmet', 'Helmet', 1, 39)],
    };
    const report = buildStatistics({
      ...emptyInput(),
      workers: [worker('w1'), worker('w2')],
      inventory: [snapshot],
    }, 1_000);
    expect(report.inventory.capturedWorkers).toBe(1);
    expect(report.inventory.distinctItems).toBe(2);
    expect(report.inventory.totalItems).toBe(11);
    expect(report.inventory.missing).toBe(1);
  });

  it('buckets task and command activity into the 24-hour window', () => {
    const now = 100 * 3_600_000;
    const report = buildStatistics({
      ...emptyInput(),
      tasks: [{ id: 't1', workerId: 'w1', kind: 'inventory', status: 'SUCCEEDED', params: {}, result: {}, error: null, createdAt: now - 60_000, dispatchedAt: now, completedAt: now, durationMs: 1, actor: 'operator' }],
      commands: [{ id: 'c1', workerId: 'w1', kind: 'chat', line: 'hi', ok: true, response: 'ok', createdAt: now - 120_000 }],
    }, now);
    const total = report.activity.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(2);
    expect(report.activity.buckets[report.activity.buckets.length - 1].count).toBeGreaterThan(0);
  });

  it('sums schedule fires and rule runs', () => {
    const report = buildStatistics({
      ...emptyInput(),
      schedules: [
        { id: 's1', name: 'a', presetId: null, kind: 'inventory', params: {}, targetWorkerIds: [], targetGroupIds: [], scheduleKind: 'interval', startAt: 0, intervalMs: 1000, timeOfDay: null, stopAt: null, enabled: true, lastFiredAt: null, fireCount: 5, createdAt: 0, updatedAt: 0 },
        { id: 's2', name: 'b', presetId: null, kind: 'position', params: {}, targetWorkerIds: [], targetGroupIds: [], scheduleKind: 'interval', startAt: 0, intervalMs: 1000, timeOfDay: null, stopAt: null, enabled: false, lastFiredAt: null, fireCount: 2, createdAt: 0, updatedAt: 0 },
      ],
      rules: [{ id: 'r1', name: 'r', event: 'WORKER_REGISTERED', conditions: [], action: 'inventory', cooldownMs: 0, maxRuns: null, enabled: true, runCount: 3, lastRunAt: null, createdAt: 0, updatedAt: 0 }],
    }, 1_000);
    expect(report.automation.schedules).toBe(2);
    expect(report.automation.enabledSchedules).toBe(1);
    expect(report.automation.totalFires).toBe(7);
    expect(report.automation.totalRuleRuns).toBe(3);
  });
});

describe('formatMetricPercent', () => {
  it('renders a percentage for a value and null for no data', () => {
    expect(formatMetricPercent({ value: 0.5, sampleSize: 2, description: '' })).toBe('50.0%');
    expect(formatMetricPercent({ value: null, sampleSize: 0, description: '' })).toBeNull();
  });
});

describe('statisticsToCsv', () => {
  it('emits a section per table and escapes cells with commas', () => {
    const report = buildStatistics({
      ...emptyInput(),
      audit: [{ id: 'a1', at: 0, actor: 'operator', action: 'server.create, "6b6t"', target: 's1', detail: 'created' }],
    }, 1_000);
    const csv = statisticsToCsv(report);
    expect(csv).toContain('# workers by status');
    expect(csv).toContain('# summary');
    expect(csv).toContain('"server.create, ""6b6t""",1');
  });
});
