/**
 * Storage worker integration tests.
 *
 * These drive a real worker-shaped WebSocket client against the real host over a loopback socket,
 * so the two ends of the storage subsystem are exercised together: the Host plans an operation, the
 * worker answers the task, and the Host records what the worker reported. The other half pins the
 * dispatch gate — the Host must never ask a worker for a task its advertised capabilities do not
 * cover.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers';
import { FakeWorker, waitFor } from '../support/fake-worker';

let ctx: TestContext;
let port: number;
const workers: FakeWorker[] = [];

async function startWorker(options: ConstructorParameters<typeof FakeWorker>[0] = {}): Promise<FakeWorker> {
  const worker = new FakeWorker(options);
  workers.push(worker);
  await worker.connect(port);
  await waitFor(() => worker.accepted || worker.closed);
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

describe('storage dispatch gate', () => {
  it('refuses a task the worker did not advertise, before dispatching it', async () => {
    const worker = await startWorker({ workerId: 's-1' });
    worker.register({ capabilities: ['inventory'] });
    await waitFor(() => ctx.context.workers.list().length === 1);

    // The worker would happily answer an efly task (the fake answers everything), so a refusal here
    // can only come from the gate, not from the worker.
    await expect(ctx.context.workers.runTask('s-1', 'efly', { action: 'start' }))
      .rejects.toThrow(/cannot run efly/);
    expect(worker.tasks).toHaveLength(0);
  });

  it('lets a worker run a task its reported kinds cover', async () => {
    const worker = await startWorker({ workerId: 's-2' });
    worker.register({ capabilities: ['inventory', 'container-read', 'container-move'] });
    await waitFor(() => ctx.context.workers.list().length === 1);

    const result = await ctx.context.workers.runTask('s-2', 'container-move', { query: 'dirt', direction: 'withdraw' });
    expect(result.ok).toBe(true);
    expect(worker.tasks.map((t) => t.kind)).toContain('container-move');
  });

  it('does not gate a worker that has not reported capabilities yet', async () => {
    const worker = await startWorker({ workerId: 's-3' });
    // No register() call: the worker has said nothing, so the Host does not refuse the first task.
    const result = await ctx.context.workers.runTask('s-3', 'container-read', { x: 0, y: 0, z: 0 });
    expect(result.ok).toBe(true);
  });
});

describe('storage plan execution', () => {
  it('inspects a registered container and records what the worker read', async () => {
    const worker = await startWorker({
      workerId: 's-10',
      onTask: (kind) => {
        if (kind === 'container-read') {
          return {
            ok: true,
            message: 'read',
            data: {
              items: [{ id: 'minecraft:diamond', name: 'Diamond', count: 64, slot: 0, damage: 0, maxDamage: 0, damageable: false }],
              capacity: 27,
              freeSlots: 26,
            },
          };
        }
        if (kind === 'shulker-read') {
          return {
            ok: true,
            message: 'read',
            data: {
              shulkers: [{
                slot: 3,
                label: 'Shulker Box',
                items: [{ id: 'minecraft:cobblestone', name: 'Cobblestone', count: 32, slot: 0, damage: 0, maxDamage: 0, damageable: false }],
              }],
            },
          };
        }
        return { ok: true, message: `did ${kind}` };
      },
    });
    worker.register({ capabilities: ['inventory', 'container-read', 'shulker-read'] });
    await waitFor(() => ctx.context.workers.list().length === 1);

    const network = ctx.context.storage.createNetwork({ name: 'Main' });
    const container = ctx.context.storage.createContainer({
      networkId: network.id, workerId: 's-10', label: 'Diamonds', x: 10, y: 64, z: 20, dimension: 'minecraft:overworld',
    });

    const plan = ctx.context.storage.plan('inspect', network.id);
    expect(plan.steps.length).toBeGreaterThan(0);
    const outcome = await ctx.context.storage.executePlan(plan.id, { force: true });
    expect(outcome.ok).toBe(true);

    const stored = ctx.context.storage.listContainers(network.id).find((c) => c.id === container.id);
    expect(stored?.items[0]?.id).toBe('minecraft:diamond');
    expect(stored?.freeSlots).toBe(26);
    expect(worker.tasks.map((t) => t.kind)).toContain('container-read');

    const shulkers = ctx.context.storage.listShulkers('s-10');
    expect(shulkers).toHaveLength(1);
    expect(shulkers[0].slot).toBe(3);
    expect(shulkers[0].itemCount).toBe(32);
  });

  it('reports the shulkers a worker is carrying on request', async () => {
    const worker = await startWorker({
      workerId: 's-11',
      onTask: (kind) => kind === 'shulker-read'
        ? { ok: true, message: 'read', data: { shulkers: [{ slot: 1, label: 'Box', items: [] }, { slot: 2, label: 'Box', items: [] }] } }
        : { ok: true, message: `did ${kind}` },
    });
    worker.register({ capabilities: ['inventory', 'shulker-read'] });
    await waitFor(() => ctx.context.workers.list().length === 1);

    const count = await ctx.context.storage.reportShulkers('s-11');
    expect(count).toBe(2);
    expect(ctx.context.storage.listShulkers('s-11')).toHaveLength(2);
  });

  it('treats a worker that reports no shulkers as contributing none', async () => {
    const worker = await startWorker({
      workerId: 's-12',
      onTask: () => ({ ok: true, message: 'none', data: { shulkers: [] } }),
    });
    worker.register({ capabilities: ['inventory', 'shulker-read'] });
    await waitFor(() => ctx.context.workers.list().length === 1);

    expect(await ctx.context.storage.reportShulkers('s-12')).toBe(0);
    expect(ctx.context.storage.listShulkers('s-12')).toHaveLength(0);
  });
});

describe('maintenance assistant', () => {
  it('answers a recognised request with an operation, a plan and an AI plan', () => {
    const answer = ctx.context.storage.ask('organize my storage');
    expect(answer.operation).toBe('sort');
    expect(answer.plan).not.toBeNull();
    expect(answer.ai).not.toBeNull();
    expect(answer.ai?.intent).toBe('storage.sort');
    expect(answer.ai?.steps.length).toBeGreaterThan(0);
    expect(answer.ai?.executable).toBe(true);
  });

  it('surfaces the planner refusal honestly when nothing matches', () => {
    const answer = ctx.context.storage.ask('please make me a sandwich');
    expect(answer.ai).toBeNull();
    expect(answer.operation).toBeNull();
  });

  it('reports the AI plan even when only the planner recognises the request', () => {
    const answer = ctx.context.storage.ask('check my registered portals');
    expect(answer.ai).not.toBeNull();
    expect(answer.ai?.intent).toBe('portal.maintenance');
  });
});

describe('structure registry', () => {
  const base = {
    kind: 'storage_room' as const, dimension: 'minecraft:overworld',
    x1: 0, y1: 60, z1: 0, x2: 10, y2: 70, z2: 10,
    ownership: '', protected: false, maintenance: 'ok' as const,
    lastSeenBy: null, lastSeenAt: null, notes: '',
  };

  it('persists a registered structure and reads it back', () => {
    const created = ctx.context.storage.createStructure({ ...base, name: 'Main room' });
    expect(created.id).toBeTruthy();

    const again = ctx.context.storage.getStructure(created.id);
    expect(again?.name).toBe('Main room');
    expect(again?.kind).toBe('storage_room');
    expect(ctx.context.storage.listStructures().some((s) => s.id === created.id)).toBe(true);
  });

  it('refuses a duplicate name and an unknown kind', () => {
    ctx.context.storage.createStructure({ ...base, name: 'Unique room' });
    expect(() => ctx.context.storage.createStructure({ ...base, name: 'Unique room' })).toThrow(/already exists/);
    expect(() => ctx.context.storage.createStructure({ ...base, name: 'Odd', kind: 'nonsense' as never })).toThrow(/Unknown structure kind/);
  });

  it('projects portals into the structure list without duplicating them', () => {
    const portal = ctx.context.storage.createPortal({
      name: 'Nether link', category: 'nether', dimension: 'minecraft:overworld',
      x: 128, y: 65, z: -300, permanent: true, temporary: false, needsMaintenance: false,
      tracking: true, lastSeenBy: null, lastSeenAt: null, obsolete: false, notes: '',
    });
    const structures = ctx.context.storage.listStructures();
    const projected = structures.find((s) => s.id === portal.id);
    expect(projected?.kind).toBe('portal');
    expect(projected?.protected).toBe(true);
    expect(structures.filter((s) => s.id === portal.id)).toHaveLength(1);
  });

  it('flags protected, overdue and unconfirmed structures, and overlaps', () => {
    ctx.context.storage.createStructure({ ...base, name: 'Protected room', protected: true, maintenance: 'overdue' });
    ctx.context.storage.createStructure({ ...base, name: 'Neighbour A' });
    ctx.context.storage.createStructure({ ...base, name: 'Neighbour B' });

    const issues = ctx.context.storage.structureIssues();
    const reasons = issues.map((issue) => `${issue.name}:${issue.reason}`);
    expect(reasons).toContain('Protected room:protected');
    expect(reasons).toContain('Protected room:maintenance');
    expect(reasons).toContain('Protected room:unconfirmed');
    expect(reasons).toContain('Neighbour A:overlap');
    expect(reasons).toContain('Neighbour B:overlap');
  });

  it('previews a change in a region and marks protected structures not actionable', () => {
    const protectedRoom = ctx.context.storage.createStructure({ ...base, name: 'Protected vault', protected: true });
    const openRoom = ctx.context.storage.createStructure({ ...base, name: 'Open room', x1: 20, x2: 30, z1: 20, z2: 30 });

    const preview = ctx.context.storage.previewStructureChange({ dimension: 'minecraft:overworld', minX: 0, minY: 60, minZ: 0, maxX: 25, maxY: 70, maxZ: 25 });
    const vault = preview.find((entry) => entry.structureId === protectedRoom.id);
    const open = preview.find((entry) => entry.structureId === openRoom.id);
    expect(vault?.actionable).toBe(false);
    expect(vault?.reasons.join(' ')).toMatch(/protected/);
    expect(open?.actionable).toBe(true);
    expect(open?.estimatedBlocks).toBeGreaterThan(0);
  });

  it('counts structures by kind and removes one', () => {
    const room = ctx.context.storage.createStructure({ ...base, name: 'Countable room' });
    ctx.context.storage.createStructure({ ...base, name: 'Countable farm', kind: 'farm' });
    const counts = ctx.context.storage.structureCounts();
    expect(counts.storage_room).toBeGreaterThanOrEqual(1);
    expect(counts.farm).toBeGreaterThanOrEqual(1);

    expect(ctx.context.storage.removeStructure(room.id)).toBe(true);
    expect(ctx.context.storage.getStructure(room.id)).toBeUndefined();
  });

  it('lists structures due for maintenance for a given interval', () => {
    const fresh = ctx.context.storage.createStructure({ ...base, name: 'Fresh room', lastSeenBy: 'w1', lastSeenAt: Date.now() });
    const stale = ctx.context.storage.createStructure({ ...base, name: 'Stale room', lastSeenBy: 'w1', lastSeenAt: Date.now() - 10 * 24 * 3600_000 });
    const due = ctx.context.storage.structuresDueForMaintenance(7 * 24 * 3600_000).map((s) => s.id);
    expect(due).toContain(stale.id);
    expect(due).not.toContain(fresh.id);
  });
});
