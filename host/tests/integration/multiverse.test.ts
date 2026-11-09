/**
 * Multiverse service integration tests.
 *
 * These exercise the new organisational layer over the real database and the real worker service:
 * server profiles, group templates, task presets, schedules, automation rules, container records,
 * inventory history and the audit trail. Worker-shaped WebSocket clients are used where a live
 * worker is needed, so the dispatch path is real rather than mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers';
import { FakeWorker, waitFor } from '../support/fake-worker';

let ctx: TestContext;
let port: number;
const workers: FakeWorker[] = [];

async function startWorker(id: string, username = 'Steve'): Promise<FakeWorker> {
  const worker = new FakeWorker({ workerId: id, username });
  workers.push(worker);
  await worker.connect(port);
  await waitFor(() => worker.accepted || worker.closed);
  worker.register({ username });
  await waitFor(() => ctx.context.workers.get(id)?.online === true);
  return worker;
}

beforeEach(async () => {
  ctx = await createTestContext({ startWorkerServer: false, workerToken: 'test-worker-token' });
  port = await ctx.context.workers.server.start();
});

afterEach(async () => {
  for (const worker of workers.splice(0)) worker.close();
  await ctx.context.workers.server.stop();
  await ctx.context.shutdown();
});

describe('server profiles', () => {
  it('creates, lists and deletes a profile', () => {
    const mv = ctx.context.multiverse;
    const profile = mv.createServer({ name: '6b6t', host: 'mc.6b6t.org', port: 25565 });
    expect(profile.id).toBeTruthy();
    expect(mv.listServers().map((s) => s.name)).toEqual(['6b6t']);
    expect(mv.removeServer(profile.id)).toBe(true);
    expect(mv.listServers()).toHaveLength(0);
  });

  it('refuses a duplicate name', () => {
    const mv = ctx.context.multiverse;
    mv.createServer({ name: 'Alpha' });
    expect(() => mv.createServer({ name: 'Alpha' })).toThrow(/already exists/);
  });

  it('counts only workers that reported that server address', async () => {
    const mv = ctx.context.multiverse;
    const profile = mv.createServer({ name: 'Reach', host: 'mc.example.org', port: 25565 });
    await startWorker('w-a');
    mv.assignServer(['w-a'], profile.id);
    const view = mv.getServer(profile.id)!;
    expect(view.workers).toBe(1);
    expect(view.online).toBe(1);
    // The worker has not reported that address, so it is not counted as connected to it.
    expect(view.connectedToIt).toBe(0);
  });

  it('unassigns workers when a profile is deleted', async () => {
    const mv = ctx.context.multiverse;
    const profile = mv.createServer({ name: 'Temp' });
    await startWorker('w-b');
    mv.assignServer(['w-b'], profile.id);
    expect(ctx.context.workerRepo.get('w-b')?.serverProfileId).toBe(profile.id);
    mv.removeServer(profile.id);
    expect(ctx.context.workerRepo.get('w-b')?.serverProfileId).toBeNull();
  });
});

describe('group templates', () => {
  it('creates a group from a template with its defaults', () => {
    const mv = ctx.context.multiverse;
    const template = mv.createGroupTemplate({
      name: 'Miners', description: 'Digging crew', color: '#123456',
      defaultTaskPresetIds: ['p1'], defaultEquipmentPresetIds: ['e1'], permissions: ['run-task'],
    });
    const group = mv.createGroupFromTemplate(template.id, 'Crew A');
    expect(group.name).toBe('Crew A');
    expect(group.defaultTaskPresetIds).toEqual(['p1']);
    expect(group.defaultEquipmentPresetIds).toEqual(['e1']);
    expect(group.permissions).toEqual(['run-task']);
  });

  it('refuses a duplicate template name', () => {
    const mv = ctx.context.multiverse;
    mv.createGroupTemplate({ name: 'X', description: '', color: '#000', defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [] });
    expect(() => mv.createGroupTemplate({ name: 'X', description: '', color: '#000', defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [] })).toThrow(/already exists/);
  });
});

describe('task presets', () => {
  it('creates and runs a preset against a live worker', async () => {
    const mv = ctx.context.multiverse;
    await startWorker('w-c');
    const preset = mv.createTaskPreset({
      name: 'Inventory sweep', description: '', kind: 'inventory', params: {},
      targetWorkerIds: ['w-c'], targetGroupIds: [],
    });
    const summary = await mv.runTaskPreset(preset.id);
    expect(summary.total).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('reports a disconnected target honestly', async () => {
    const mv = ctx.context.multiverse;
    const preset = mv.createTaskPreset({
      name: 'Offline', description: '', kind: 'inventory', params: {},
      targetWorkerIds: ['nobody'], targetGroupIds: [],
    });
    const summary = await mv.runTaskPreset(preset.id);
    // The id is not a known worker, so it is not even a target.
    expect(summary.total).toBe(0);
  });
});

describe('schedules', () => {
  it('rejects an interval schedule without an interval', () => {
    const mv = ctx.context.multiverse;
    expect(() => mv.createSchedule({ name: 'Bad', kind: 'inventory', scheduleKind: 'interval' })).toThrow(/interval/);
  });

  it('rejects a daily schedule without a valid time', () => {
    const mv = ctx.context.multiverse;
    expect(() => mv.createSchedule({ name: 'Bad', kind: 'inventory', scheduleKind: 'daily' })).toThrow(/time of day/);
  });

  it('fires a due schedule exactly once per slot', async () => {
    const mv = ctx.context.multiverse;
    await startWorker('w-d');
    const preset = mv.createTaskPreset({
      name: 'Sweep', description: '', kind: 'inventory', params: {},
      targetWorkerIds: ['w-d'], targetGroupIds: [],
    });
    const schedule = mv.createSchedule({
      name: 'Every hour', presetId: preset.id, kind: 'inventory', scheduleKind: 'interval',
      intervalMs: 60_000, startAt: Date.now() - 120_000, enabled: true,
    });
    const first = await mv.tick();
    expect(first.map((r) => r.scheduleId)).toEqual([schedule.id]);
    // A second tick at the same instant must not fire again.
    const second = await mv.tick();
    expect(second).toHaveLength(0);
    const stored = mv.listSchedules().find((s) => s.id === schedule.id)!;
    expect(stored.fireCount).toBe(1);
  });

  it('reports how many runs a schedule missed', () => {
    const mv = ctx.context.multiverse;
    const schedule = mv.createSchedule({
      name: 'Every minute', kind: 'inventory', scheduleKind: 'interval',
      intervalMs: 60_000, startAt: Date.now() - 300_000, enabled: true,
    });
    expect(mv.missedFor(schedule)).toBeGreaterThanOrEqual(4);
  });
});

describe('automation rules', () => {
  it('fires a rule when its event arrives and runs its action', async () => {
    const mv = ctx.context.multiverse;
    await startWorker('w-e');
    mv.createRule({ name: 'On join', event: 'WORKER_REGISTERED', conditions: [], action: 'inventory' });
    const ran = await mv.onEvent({ type: 'WORKER_REGISTERED', workerId: 'w-e', payload: {} });
    expect(ran).toHaveLength(1);
    expect(ran[0].summary.completed).toBe(1);
    const rule = mv.listRules()[0];
    expect(rule.runCount).toBe(1);
  });

  it('does not fire for a non-matching event', async () => {
    const mv = ctx.context.multiverse;
    await startWorker('w-f');
    mv.createRule({ name: 'On join', event: 'WORKER_REGISTERED', conditions: [], action: 'inventory' });
    const ran = await mv.onEvent({ type: 'WORKER_DISCONNECTED', workerId: 'w-f', payload: {} });
    expect(ran).toHaveLength(0);
  });

  it('honours a condition on the payload', async () => {
    const mv = ctx.context.multiverse;
    await startWorker('w-g', 'Griefer');
    mv.createRule({
      name: 'Only griefer', event: 'WORKER_REGISTERED', action: 'inventory',
      conditions: [{ field: 'username', operator: 'eq', value: 'Griefer' }],
    });
    const miss = await mv.onEvent({ type: 'WORKER_REGISTERED', workerId: 'w-g', payload: { username: 'Steve' } });
    expect(miss).toHaveLength(0);
    const hit = await mv.onEvent({ type: 'WORKER_REGISTERED', workerId: 'w-g', payload: { username: 'Griefer' } });
    expect(hit).toHaveLength(1);
  });

  it('rejects a rule with no event', () => {
    const mv = ctx.context.multiverse;
    expect(() => mv.createRule({ name: 'Bad', event: '', action: 'inventory' })).toThrow(/event/);
  });
});

describe('containers and inventory history', () => {
  it('saves a container and updates it in place on re-inspection', () => {
    const mv = ctx.context.multiverse;
    const first = mv.saveContainer({ workerId: 'w-1', label: 'Chest', x: 1, y: 2, z: 3, dimension: 'overworld', items: [], inspectedAt: 1 });
    const second = mv.saveContainer({ workerId: 'w-1', label: 'Chest', x: 1, y: 2, z: 3, dimension: 'overworld', items: [{ id: 'minecraft:stone', name: 'Stone', count: 5 }], inspectedAt: 2 });
    expect(second.id).toBe(first.id);
    expect(mv.listContainers('w-1')).toHaveLength(1);
    expect(mv.listContainers('w-1')[0].items).toHaveLength(1);
  });

  it('records inventory history and reports a trend', () => {
    const mv = ctx.context.multiverse;
    mv.recordInventory('w-1', 1_000, [{ id: 'minecraft:stone', name: 'Stone', count: 10 }]);
    mv.recordInventory('w-1', 2_000, [{ id: 'minecraft:stone', name: 'Stone', count: 25 }]);
    const trend = mv.inventoryTrend('w-1', 'minecraft:stone');
    expect(trend.map((point) => point.count)).toEqual([10, 25]);
  });
});

describe('audit trail', () => {
  it('records an entry for a mutating operation', () => {
    const mv = ctx.context.multiverse;
    mv.createServer({ name: 'Audited' });
    const entries = mv.listAudit();
    expect(entries.some((entry) => entry.action === 'server.create')).toBe(true);
  });
});

describe('worker tags', () => {
  it('adds, de-duplicates and removes tags', async () => {
    await startWorker('w-h');
    const workers = ctx.context.workers;
    expect(workers.addTag('w-h', 'farmer')).toBe(true);
    expect(workers.addTag('w-h', 'farmer')).toBe(false);
    expect(workers.get('w-h')?.tags).toEqual(['farmer']);
    expect(workers.allTags()).toEqual(['farmer']);
    expect(workers.removeTag('w-h', 'farmer')).toBe(true);
    expect(workers.get('w-h')?.tags).toEqual([]);
  });
});
