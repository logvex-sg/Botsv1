import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import {
  EventRepository, NotificationRepository, SettingsRepository, ConfigVersionRepository,
  WorkerRepository, WorkerGroupRepository, WorkerTaskRepository, WorkerCommandRepository,
  RegearPresetRepository, WorkerInventoryRepository,
} from '../../src/main/db/repositories';

let db: FleetDatabase;
beforeEach(() => { db = new FleetDatabase(':memory:'); });
afterEach(() => db.close());

describe('FleetDatabase migrations', () => {
  it('creates the worker tables and records migrations', () => {
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);
    for (const expected of ['workers', 'worker_groups', 'worker_tasks', 'events', 'notifications', 'settings', 'schema_migrations']) {
      expect(tables).toContain(expected);
    }
    const applied = db.all<{ id: string }>('SELECT id FROM schema_migrations');
    expect(applied.length).toBeGreaterThanOrEqual(2);
  });

  it('drops the retired mineflayer tables', () => {
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);
    for (const gone of ['accounts', 'server_profiles', 'instances', 'targets', 'deployment_configs', 'stasis_locations']) {
      expect(tables).not.toContain(gone);
    }
  });

  it('is idempotent when migrated twice', () => {
    const before = db.all<{ id: string }>('SELECT id FROM schema_migrations').length;
    db.migrate();
    db.migrate();
    const applied = db.all<{ id: string }>('SELECT id FROM schema_migrations');
    expect(applied.length).toBe(before);
    expect(applied.length).toBeGreaterThanOrEqual(3);
  });

  it('runs a transaction and rolls back on throw', () => {
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    expect(() => db.transaction(() => {
      db.run('INSERT INTO t (v) VALUES (?)', ['a']);
      throw new Error('boom');
    })).toThrow('boom');
    expect(db.all('SELECT * FROM t')).toHaveLength(0);
  });

  it('exposes every repository over one connection', () => {
    expect(new EventRepository(db)).toBeInstanceOf(EventRepository);
    expect(new NotificationRepository(db)).toBeInstanceOf(NotificationRepository);
    expect(new SettingsRepository(db)).toBeInstanceOf(SettingsRepository);
    expect(new ConfigVersionRepository(db)).toBeInstanceOf(ConfigVersionRepository);
    expect(new WorkerRepository(db)).toBeInstanceOf(WorkerRepository);
    expect(new WorkerGroupRepository(db)).toBeInstanceOf(WorkerGroupRepository);
    expect(new WorkerTaskRepository(db)).toBeInstanceOf(WorkerTaskRepository);
    expect(new WorkerCommandRepository(db)).toBeInstanceOf(WorkerCommandRepository);
    expect(new RegearPresetRepository(db)).toBeInstanceOf(RegearPresetRepository);
    expect(new WorkerInventoryRepository(db)).toBeInstanceOf(WorkerInventoryRepository);
  });

  it('stores and reads back a worker-scoped event', () => {
    const events = new EventRepository(db);
    events.insert({
      id: 'e1', type: 'WORKER_REGISTERED', source: 'host', severity: 'success',
      workerId: 'w1', message: 'connected', payload: { a: 1 }, timestamp: Date.now(),
    });
    const [row] = events.list();
    expect(row.workerId).toBe('w1');
    expect(row.payload).toEqual({ a: 1 });
  });
});
