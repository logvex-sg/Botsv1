/**
 * Worker server and service integration tests.
 *
 * These drive a real worker-shaped WebSocket client against the real host server over a real
 * loopback socket, so the handshake, the task round-trip, the inventory cache and the regear
 * comparison are all exercised end to end rather than through a mock. The only thing faked is the
 * Minecraft client itself, which is exactly the boundary the protocol is meant to cross.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers';
import { FakeWorker, waitFor } from '../support/fake-worker';
import { WORKER_PROTOCOL_VERSION } from '../../src/shared/workers';

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

describe('worker handshake', () => {
  it('accepts a worker presenting the right token and protocol version', async () => {
    const worker = await startWorker({ workerId: 'w-1', username: 'Miner' });
    expect(worker.accepted).toBe(true);
    expect(worker.assignedId).toBe('w-1');

    worker.register({ username: 'Miner' });
    await waitFor(() => ctx.context.workers.list().length === 1);
    const view = ctx.context.workers.get('w-1');
    expect(view?.username).toBe('Miner');
    expect(view?.online).toBe(true);
  });

  it('refuses a worker with the wrong token', async () => {
    const worker = await startWorker({ workerId: 'w-2', token: 'nope' });
    expect(worker.accepted).toBe(false);
    expect(worker.refusalReason).toContain('token');
  });

  it('refuses a worker speaking a different protocol version', async () => {
    const worker = await startWorker({ workerId: 'w-3', protocolVersion: WORKER_PROTOCOL_VERSION + 5 });
    expect(worker.accepted).toBe(false);
    expect(worker.refusalReason).toContain('protocol');
  });

  it('drops a socket that sends anything other than hello first', async () => {
    const worker = new FakeWorker({ workerId: 'w-4' });
    workers.push(worker);
    // Bypass connect()'s hello by opening and sending a status frame straight away.
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/worker`);
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    socket.send(JSON.stringify({ v: 1, type: 'status', payload: {} }));
    await waitFor(() => socket.readyState === WebSocket.CLOSED, 3000);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it('replaces a stale connection when the same worker id reconnects', async () => {
    const first = await startWorker({ workerId: 'w-5' });
    first.register({ username: 'First' });
    await waitFor(() => ctx.context.workers.list().length === 1);

    const second = await startWorker({ workerId: 'w-5' });
    expect(second.accepted).toBe(true);
    await waitFor(() => ctx.context.workers.server.onlineIds().length === 1);
    expect(ctx.context.workers.server.isOnline('w-5')).toBe(true);
  });
});

describe('pairing', () => {
  it('admits a worker that presents a fresh pairing code and hands back the token', async () => {
    const code = ctx.context.createPairingCode().code;
    const worker = await startWorker({ workerId: 'w-p1', pairingCode: code });
    expect(worker.accepted).toBe(true);
    expect(worker.grantedToken).toBe('test-worker-token');
    // The code is single-use, so it is gone now.
    expect(ctx.context.currentPairingCode()).toBeNull();
  });

  it('refuses a worker whose pairing code is wrong', async () => {
    ctx.context.createPairingCode();
    const worker = await startWorker({ workerId: 'w-p2', pairingCode: 'WRONG234' });
    expect(worker.accepted).toBe(false);
    expect(worker.refusalReason).toContain('pairing code');
  });

  it('refuses a worker that presents no code and no token', async () => {
    const worker = await startWorker({ workerId: 'w-p3', token: '', pairingCode: '' });
    expect(worker.accepted).toBe(false);
    expect(worker.refusalReason).toContain('token');
  });

  it('consumes the code so a second worker cannot reuse it', async () => {
    const code = ctx.context.createPairingCode().code;
    const first = await startWorker({ workerId: 'w-p4', pairingCode: code });
    expect(first.accepted).toBe(true);
    const second = await startWorker({ workerId: 'w-p5', pairingCode: code });
    expect(second.accepted).toBe(false);
  });
});

describe('task dispatch', () => {
  it('round-trips a status task and records the result', async () => {
    const worker = await startWorker({ workerId: 'w-10' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const result = await ctx.context.workers.runTask('w-10', 'status');
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('status');
    expect(worker.tasks.map((t) => t.kind)).toContain('status');

    const tasks = ctx.context.workers.listTasks(10, 'w-10');
    expect(tasks[0].status).toBe('SUCCEEDED');
  });

  it('rejects a task sent to an offline worker', async () => {
    await expect(ctx.context.workers.runTask('ghost', 'status')).rejects.toThrow(/not connected/);
  });

  it('rejects an unknown task kind before it reaches the wire', async () => {
    const worker = await startWorker({ workerId: 'w-11' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);
    await expect(ctx.context.workers.runTask('w-11', 'rm-rf' as never)).rejects.toThrow(/unknown task kind/);
    expect(worker.tasks).toHaveLength(0);
  });

  it('times out when a worker never answers', async () => {
    const worker = await startWorker({ workerId: 'w-12', onTask: () => 'ignore' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);
    await expect(ctx.context.workers.server.sendTask('w-12', 'status', {}, 250)).rejects.toThrow(/did not answer/);
  });

  it('propagates a worker-reported failure instead of pretending success', async () => {
    const worker = await startWorker({
      workerId: 'w-13',
      onTask: () => ({ ok: false, message: 'no container open' }),
    });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);
    const result = await ctx.context.workers.runTask('w-13', 'regear', { allowMoves: true });
    expect(result.ok).toBe(false);
    expect(result.message).toBe('no container open');
  });

  it('refuses a second conflicting mutating task on the same worker', async () => {
    const worker = await startWorker({ workerId: 'w-14', onTask: () => 'ignore' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const first = ctx.context.workers.server.sendTask('w-14', 'command', { command: 'spawn' }, 1000);
    await expect(ctx.context.workers.server.sendTask('w-14', 'chat', { message: 'hi' }, 200))
      .rejects.toThrow(/conflicting/);
    first.catch(() => undefined);
  });
});

describe('inventory reporting', () => {
  it('stores an inventory the worker pushes, with a capture timestamp', async () => {
    const worker = await startWorker({ workerId: 'w-20' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.reportInventory([{ id: 'minecraft:diamond', name: 'Diamond', count: 32 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-20')));
    const snapshot = ctx.context.workers.inventory('w-20')!;
    expect(snapshot.carried[0].id).toBe('minecraft:diamond');
    expect(snapshot.carried[0].count).toBe(32);
    expect(snapshot.capturedAt).toBeGreaterThan(0);
  });

  it('refreshes the cached inventory when an inventory task returns data', async () => {
    const worker = await startWorker({ workerId: 'w-21' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    await ctx.context.workers.runTask('w-21', 'inventory');
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-21')));
    const snapshot = ctx.context.workers.inventory('w-21')!;
    // defaultData() returns 64 diamond for an inventory task.
    expect(snapshot.carried.find((item) => item.id === 'minecraft:diamond')?.count).toBe(64);
  });

  it('does not clear a stored inventory when a plain status heartbeat arrives', async () => {
    const worker = await startWorker({ workerId: 'w-22' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.reportInventory([{ id: 'minecraft:emerald', count: 5 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-22')));

    // A heartbeat carries no inventory fields; it must leave the cached one alone.
    worker.status({ health: 18 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ctx.context.workers.inventory('w-22')?.carried[0].id).toBe('minecraft:emerald');
  });
});

describe('item counting across the fleet', () => {
  it('sums a friendly query across workers and flags freshness', async () => {
    const a = await startWorker({ workerId: 'w-30' });
    a.register({ username: 'Alpha' });
    const b = await startWorker({ workerId: 'w-31' });
    b.register({ username: 'Bravo' });
    await waitFor(() => ctx.context.workers.list().length === 2);

    a.reportInventory([{ id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 3 }]);
    b.reportInventory([{ id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 2 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-30')) && Boolean(ctx.context.workers.inventory('w-31')));

    const report = ctx.context.workers.countItem('totem');
    expect(report.total).toBe(5);
    expect(report.rows).toHaveLength(2);
    expect(report.stale).toBe(false);
  });

  it('scopes a count to a group', async () => {
    const group = ctx.context.workers.createGroup('farm');
    const a = await startWorker({ workerId: 'w-32' });
    a.register({ username: 'FarmA' });
    const b = await startWorker({ workerId: 'w-33' });
    b.register({ username: 'Other' });
    await waitFor(() => ctx.context.workers.list().length === 2);
    ctx.context.workers.assignGroup('w-32', group.id);

    a.reportInventory([{ id: 'minecraft:wheat', count: 10 }]);
    b.reportInventory([{ id: 'minecraft:wheat', count: 99 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-32')) && Boolean(ctx.context.workers.inventory('w-33')));

    const report = ctx.context.workers.countItem('wheat', ['w-32']);
    expect(report.total).toBe(10);
  });

  it('combines totals across workers by item id', async () => {
    const a = await startWorker({ workerId: 'w-34' });
    a.register();
    const b = await startWorker({ workerId: 'w-35' });
    b.register();
    await waitFor(() => ctx.context.workers.list().length === 2);

    a.reportInventory([{ id: 'minecraft:iron_ingot', name: 'Iron Ingot', count: 12 }]);
    b.reportInventory([{ id: 'minecraft:iron_ingot', name: 'Iron Ingot', count: 8 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-34')) && Boolean(ctx.context.workers.inventory('w-35')));

    const totals = ctx.context.workers.combinedTotals();
    expect(totals.find((row) => row.id === 'minecraft:iron_ingot')?.count).toBe(20);
  });
});

describe('commands and chat', () => {
  it('sends a command and records the audit row', async () => {
    const worker = await startWorker({
      workerId: 'w-40',
      onTask: (kind, payload) => ({ ok: true, message: `ran ${payload.command ?? payload.message}`, data: { kind } }),
    });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const record = await ctx.context.workers.sendLine('w-40', 'command', '/spawn');
    expect(record.ok).toBe(true);
    // The leading slash is stripped before it reaches the wire.
    expect(worker.tasks.at(-1)?.payload.command).toBe('spawn');

    const log = ctx.context.workers.listCommands(10);
    expect(log[0].line).toBe('/spawn');
    expect(log[0].kind).toBe('command');
  });

  it('records a refusal rather than throwing', async () => {
    const worker = await startWorker({
      workerId: 'w-41',
      onTask: () => ({ ok: false, message: 'command not on the allow-list' }),
    });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const record = await ctx.context.workers.sendLine('w-41', 'command', 'op me');
    expect(record.ok).toBe(false);
    expect(record.response).toContain('allow-list');
  });
});

describe('regear comparison', () => {
  it('reports the gap between a preset and a reported inventory without moving anything', async () => {
    const worker = await startWorker({ workerId: 'w-50' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.reportInventory([
      { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 1 },
      { id: 'minecraft:golden_apple', name: 'Golden Apple', count: 2 },
    ]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-50')));

    const preset = ctx.context.workers.createPreset({
      name: 'standard',
      description: '',
      items: [
        { query: 'totem', count: 2, label: 'Totem' },
        { query: 'gapple', count: 8, label: 'Golden apples' },
      ],
      minArmorPieces: 0,
      minFood: 0,
      lowDurabilityPercent: 15,
    });

    const comparison = ctx.context.workers.comparePreset('w-50', preset.id);
    expect(comparison.ready).toBe(false);
    expect(comparison.gaps.find((g) => g.query === 'totem')?.missing).toBe(1);
    expect(comparison.gaps.find((g) => g.query === 'gapple')?.missing).toBe(6);
    // Comparison alone must not have dispatched a task.
    expect(worker.tasks).toHaveLength(0);
  });

  it('marks a loadout ready when every requirement is met', async () => {
    const worker = await startWorker({ workerId: 'w-51' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);
    worker.reportInventory([{ id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 4 }]);
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-51')));

    const preset = ctx.context.workers.createPreset({
      name: 'totems only', description: '',
      items: [{ query: 'totem', count: 2, label: 'Totem' }],
      minArmorPieces: 0, minFood: 0, lowDurabilityPercent: 15,
    });
    expect(ctx.context.workers.comparePreset('w-51', preset.id).ready).toBe(true);
  });
});

describe('robustness', () => {
  it('ignores malformed frames and keeps serving', async () => {
    const worker = await startWorker({ workerId: 'w-60' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.sendRaw('{not json');
    worker.sendRaw('null');
    worker.sendRaw('{"type":123}');

    // The connection is still usable afterwards.
    const result = await ctx.context.workers.runTask('w-60', 'status');
    expect(result.ok).toBe(true);
  });

  it('marks a worker offline when its socket closes and keeps the durable record', async () => {
    const worker = await startWorker({ workerId: 'w-61' });
    worker.register({ username: 'Gone' });
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.close();
    await waitFor(() => ctx.context.workers.list().every((w) => !w.online), 4000);
    const view = ctx.context.workers.get('w-61');
    expect(view).toBeDefined();
    expect(view?.online).toBe(false);
    expect(view?.username).toBe('Gone');
  });

  it('forgets a worker on request, removing its cached inventory', async () => {
    const worker = await startWorker({ workerId: 'w-62' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);
    worker.reportInventory([{ id: 'minecraft:dirt', count: 1 }]);
    worker.log('for me');
    await waitFor(() => Boolean(ctx.context.workers.inventory('w-62')) && ctx.context.workers.console('w-62').length === 1);

    expect(ctx.context.workers.forget('w-62')).toBe(true);
    expect(ctx.context.workers.get('w-62')).toBeUndefined();
    expect(ctx.context.workers.inventory('w-62')).toBeUndefined();
    expect(ctx.context.workers.console('w-62')).toEqual([]);
  });
});

describe('selector resolution', () => {
  it('resolves by id, username and group name', async () => {
    const group = ctx.context.workers.createGroup('miners');
    const worker = await startWorker({ workerId: 'w-70', username: 'Digger' });
    worker.register({ username: 'Digger' });
    await waitFor(() => ctx.context.workers.list().length === 1);
    ctx.context.workers.assignGroup('w-70', group.id);

    expect(ctx.context.workers.resolve('w-70').map((w) => w.id)).toEqual(['w-70']);
    expect(ctx.context.workers.resolve('Digger').map((w) => w.id)).toEqual(['w-70']);
    expect(ctx.context.workers.resolve('miners').map((w) => w.id)).toEqual(['w-70']);
  });
});

describe('worker console', () => {
  it('buffers forwarded log lines per worker, oldest first', async () => {
    const worker = await startWorker({ workerId: 'w-80' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.log('connecting to ws://host/worker', 1000);
    worker.log('registered as w-80', 2000);
    await waitFor(() => ctx.context.workers.console('w-80').length === 2);

    const lines = ctx.context.workers.console('w-80');
    expect(lines.map((l) => l.message)).toEqual(['connecting to ws://host/worker', 'registered as w-80']);
    expect(lines.map((l) => l.at)).toEqual([1000, 2000]);
  });

  it('keeps console lines separate between workers', async () => {
    const a = await startWorker({ workerId: 'w-81' });
    const b = await startWorker({ workerId: 'w-82' });
    a.register();
    b.register();
    await waitFor(() => ctx.context.workers.list().length === 2);

    a.log('alpha');
    b.log('bravo');
    await waitFor(() => ctx.context.workers.console('w-81').length === 1 && ctx.context.workers.console('w-82').length === 1);

    expect(ctx.context.workers.console('w-81')[0].message).toBe('alpha');
    expect(ctx.context.workers.console('w-82')[0].message).toBe('bravo');
  });

  it('drops a log line with no message and clears on request', async () => {
    const worker = await startWorker({ workerId: 'w-83' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    worker.send({ v: WORKER_PROTOCOL_VERSION, type: 'log', payload: { at: 1234 } });
    worker.log('real line');
    await waitFor(() => ctx.context.workers.console('w-83').length === 1);
    expect(ctx.context.workers.console('w-83')[0].message).toBe('real line');

    ctx.context.workers.clearConsole('w-83');
    expect(ctx.context.workers.console('w-83')).toEqual([]);
  });

  it('caps the buffer so a chatty worker cannot grow it without bound', async () => {
    const worker = await startWorker({ workerId: 'w-84' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    for (let i = 0; i < 260; i += 1) worker.log(`line ${i}`, i);
    await waitFor(() => ctx.context.workers.console('w-84').length === 200);

    const lines = ctx.context.workers.console('w-84');
    expect(lines).toHaveLength(200);
    expect(lines[0].message).toBe('line 60');
    expect(lines[199].message).toBe('line 259');
  });
});

describe('efly task', () => {
  it('dispatches an efly start to the worker and records the confirmed result', async () => {
    const worker = await startWorker({ workerId: 'w-90' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const result = await ctx.context.workers.runTask('w-90', 'efly', { action: 'start', x: 100, y: 120, z: -50, mode: 'packet' });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('efly');

    const sent = worker.tasks.find((t) => t.kind === 'efly');
    expect(sent?.payload).toMatchObject({ kind: 'efly', action: 'start', x: 100, y: 120, z: -50, mode: 'packet' });
  });

  it('refuses a second mutating task on the same worker while one is in flight', async () => {
    const worker = await startWorker({ workerId: 'w-91', onTask: () => 'ignore' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const first = ctx.context.workers.server.sendTask('w-91', 'efly', { action: 'start' }, 400);
    await waitFor(() => worker.tasks.length === 1);
    await expect(ctx.context.workers.runTask('w-91', 'command', { command: 'spawn' })).rejects.toThrow(/conflicting/);
    await expect(first).rejects.toThrow(/did not answer/);
  });
});

describe('remote control', () => {
  it('sends a control action and the worker reflects it in its status', async () => {
    const worker = await startWorker({ workerId: 'w-100' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    expect(ctx.context.workers.pause('w-100')).toBe(true);
    await waitFor(() => worker.controls.includes('pause'));
    await waitFor(() => ctx.context.workers.get('w-100')?.status === 'DEGRADED');
    const paused = ctx.context.workers.get('w-100');
    expect(paused?.paused).toBe(true);

    expect(ctx.context.workers.resume('w-100')).toBe(true);
    await waitFor(() => ctx.context.workers.get('w-100')?.status === 'ONLINE');
    expect(ctx.context.workers.get('w-100')?.paused).toBe(false);
  });

  it('reports DEGRADED when a worker is stopped, and ONLINE after connect', async () => {
    const worker = await startWorker({ workerId: 'w-101' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    ctx.context.workers.disconnect('w-101');
    await waitFor(() => ctx.context.workers.get('w-101')?.stopped === true);
    expect(ctx.context.workers.get('w-101')?.status).toBe('DEGRADED');

    ctx.context.workers.connect('w-101');
    await waitFor(() => ctx.context.workers.get('w-101')?.stopped === false);
    expect(ctx.context.workers.get('w-101')?.status).toBe('ONLINE');
  });

  it('refuses a control action for a worker that is not connected', async () => {
    expect(ctx.context.workers.sendControl('nobody', 'pause')).toBe(false);
  });

  it('reports BUSY while a mutating task is in flight', async () => {
    const worker = await startWorker({ workerId: 'w-102', onTask: () => 'ignore' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const inFlight = ctx.context.workers.server.sendTask('w-102', 'efly', { action: 'start' }, 500);
    await waitFor(() => worker.tasks.length === 1);
    expect(ctx.context.workers.get('w-102')?.status).toBe('BUSY');
    expect(ctx.context.workers.get('w-102')?.busy).toBe(true);
    await expect(inFlight).rejects.toThrow(/did not answer/);
  });

  it('the overview counts each status separately', async () => {
    const worker = await startWorker({ workerId: 'w-103' });
    worker.register();
    await waitFor(() => ctx.context.workers.list().length === 1);

    const before = ctx.context.workers.overview();
    expect(before.total).toBe(1);
    expect(before.online).toBe(1);

    ctx.context.workers.pause('w-103');
    await waitFor(() => ctx.context.workers.overview().degraded === 1);
    const after = ctx.context.workers.overview();
    expect(after.degraded).toBe(1);
    expect(after.offline).toBe(0);
  });
});
