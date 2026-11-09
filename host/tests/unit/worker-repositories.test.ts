/**
 * Worker persistence tests.
 *
 * These cover the storage layer on its own, including the two failure modes that matter for a
 * long-lived fleet: a corrupt JSON column must not throw, and a worker's host-side bookkeeping
 * (group, notes, label) must survive the reconnects that happen constantly in normal operation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import {
  RegearPresetRepository,
  WorkerCommandRepository,
  WorkerGroupRepository,
  WorkerInventoryRepository,
  WorkerRepository,
  WorkerTaskRepository,
} from '../../src/main/db/repositories';

let db: FleetDatabase;
beforeEach(() => { db = new FleetDatabase(':memory:'); });
afterEach(() => db.close());

describe('worker schema', () => {
  it('creates the worker tables and their indexes', () => {
    const names = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);
    for (const table of ['workers', 'worker_groups', 'worker_tasks', 'worker_commands', 'worker_inventory', 'regear_presets']) {
      expect(names).toContain(table);
    }
    const indexes = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((i) => i.name);
    expect(indexes).toContain('idx_worker_tasks_worker');
  });
});

describe('WorkerRepository', () => {
  it('inserts a worker and reads it back', () => {
    const repo = new WorkerRepository(db);
    const created = repo.upsert({ id: 'w-1', username: 'Miner', minecraftVersion: '1.21.11', status: 'ONLINE' });
    expect(created.username).toBe('Miner');
    expect(repo.list()).toHaveLength(1);
  });

  it('preserves group, notes and label across a reconnect upsert', () => {
    const repo = new WorkerRepository(db);
    const groups = new WorkerGroupRepository(db);
    const group = groups.create('farm', '', '#6d5efc');
    repo.upsert({ id: 'w-2', username: 'Farm' });
    repo.update('w-2', { groupId: group.id, notes: 'keep an eye on this one', label: 'farm-1' });

    // The worker reconnects and sends a fresh registration; its bookkeeping must not be lost.
    repo.upsert({ id: 'w-2', username: 'Farm', status: 'ONLINE' });
    const reloaded = repo.get('w-2')!;
    expect(reloaded.groupId).toBe(group.id);
    expect(reloaded.notes).toBe('keep an eye on this one');
    expect(reloaded.label).toBe('farm-1');
  });

  it('removes a worker', () => {
    const repo = new WorkerRepository(db);
    repo.upsert({ id: 'w-3' });
    expect(repo.remove('w-3')).toBe(true);
    expect(repo.get('w-3')).toBeUndefined();
    expect(repo.remove('w-3')).toBe(false);
  });
});

describe('WorkerTaskRepository', () => {
  it('records the full lifecycle of a task', () => {
    const repo = new WorkerTaskRepository(db);
    repo.create({ id: 't-1', workerId: 'w-1', kind: 'status', params: {} });
    expect(repo.get('t-1')?.status).toBe('PENDING');

    repo.markDispatched('t-1');
    expect(repo.get('t-1')?.status).toBe('DISPATCHED');
    expect(repo.activeCount()).toBe(1);

    const done = repo.complete('t-1', 'SUCCEEDED', { ok: true }, null);
    expect(done?.status).toBe('SUCCEEDED');
    expect(done?.durationMs).not.toBeNull();
    expect(repo.activeCount()).toBe(0);
  });

  it('does not resurrect a completed task on a late markDispatched', () => {
    const repo = new WorkerTaskRepository(db);
    repo.create({ id: 't-2', workerId: 'w-1', kind: 'status', params: {} });
    repo.complete('t-2', 'TIMEOUT', null, 'no answer');
    repo.markDispatched('t-2');
    expect(repo.get('t-2')?.status).toBe('TIMEOUT');
  });

  it('prunes old rows, keeping the newest', () => {
    const repo = new WorkerTaskRepository(db);
    for (let i = 0; i < 5; i++) repo.create({ id: `t-${i}`, workerId: 'w-1', kind: 'status', params: {} });
    repo.prune(2);
    expect(repo.list()).toHaveLength(2);
  });
});

describe('WorkerInventoryRepository', () => {
  it('overwrites the cached snapshot for a worker', () => {
    const repo = new WorkerInventoryRepository(db);
    repo.save({ workerId: 'w-1', capturedAt: 100, carried: [{ id: 'a', name: 'A', count: 1, slot: 0, damage: 0, maxDamage: 0, damageable: false }], accessible: [], armor: [], containerOpen: false });
    repo.save({ workerId: 'w-1', capturedAt: 200, carried: [{ id: 'b', name: 'B', count: 2, slot: 0, damage: 0, maxDamage: 0, damageable: false }], accessible: [], armor: [], containerOpen: false });
    const snapshot = repo.get('w-1')!;
    expect(snapshot.capturedAt).toBe(200);
    expect(snapshot.carried).toHaveLength(1);
    expect(snapshot.carried[0].id).toBe('b');
  });

  it('survives a corrupt JSON column instead of throwing', () => {
    const repo = new WorkerInventoryRepository(db);
    repo.save({ workerId: 'w-2', capturedAt: 1, carried: [], accessible: [], armor: [], containerOpen: false });
    db.run("UPDATE worker_inventory SET carried='{not json' WHERE worker_id='w-2'");
    const snapshot = repo.get('w-2');
    expect(snapshot?.carried).toEqual([]);
  });
});

describe('RegearPresetRepository', () => {
  it('round-trips preset items', () => {
    const repo = new RegearPresetRepository(db);
    const created = repo.create({
      name: 'standard', description: 'pvp kit',
      items: [{ query: 'totem', count: 2, label: 'Totem' }],
      minArmorPieces: 4, minFood: 8, lowDurabilityPercent: 15,
    });
    const reloaded = repo.get(created.id)!;
    expect(reloaded.items[0].query).toBe('totem');
    expect(reloaded.minArmorPieces).toBe(4);
    expect(repo.findByName('standard')?.id).toBe(created.id);
  });

  it('updates a preset and keeps the other fields', () => {
    const repo = new RegearPresetRepository(db);
    const created = repo.create({ name: 'p', description: '', items: [], minArmorPieces: 1, minFood: 2, lowDurabilityPercent: 3 });
    const updated = repo.update(created.id, { minFood: 20 })!;
    expect(updated.minFood).toBe(20);
    expect(updated.minArmorPieces).toBe(1);
  });
});

describe('WorkerCommandRepository', () => {
  it('records and lists commands newest first', () => {
    const repo = new WorkerCommandRepository(db);
    repo.record({ workerId: 'w-1', kind: 'command', line: '/spawn', ok: true, response: 'ok' });
    repo.record({ workerId: 'w-1', kind: 'chat', line: 'hi', ok: false, response: 'refused' });
    const list = repo.list(10, 'w-1');
    expect(list).toHaveLength(2);
    expect(list[0].line).toBe('hi');
    expect(list[0].ok).toBe(false);
  });
});
