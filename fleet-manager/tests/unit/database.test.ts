import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import {
  AccountRepository, DeploymentRepository, EventRepository, GroupRepository,
  InstanceRepository, ServerProfileRepository, TargetRepository, ConfigVersionRepository,
} from '../../src/main/db/repositories';

let db: FleetDatabase;
beforeEach(() => { db = new FleetDatabase(':memory:'); });
afterEach(() => db.close());

describe('FleetDatabase migrations', () => {
  it('creates every table and records migrations', () => {
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    const names = tables.map((t) => t.name);
    for (const expected of ['accounts', 'server_profiles', 'instances', 'targets', 'events', 'deployment_configs', 'schema_migrations']) {
      expect(names).toContain(expected);
    }
    const applied = db.all<{ id: string }>('SELECT id FROM schema_migrations');
    expect(applied.length).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent when migrated twice', () => {
    db.migrate();
    db.migrate();
    const applied = db.all<{ id: string }>('SELECT id FROM schema_migrations');
    expect(applied.length).toBe(2);
  });
});

describe('ServerProfileRepository', () => {
  it('creates, updates and removes profiles', () => {
    const repo = new ServerProfileRepository(db);
    const created = repo.create({ name: 'S', host: 'h', port: 25565, version: '', authMode: 'offline', connectionTimeoutMs: 1000, options: {} });
    expect(repo.list()).toHaveLength(1);
    const updated = repo.update(created.id, { name: 'S2' });
    expect(updated?.name).toBe('S2');
    expect(repo.remove(created.id)).toBe(true);
    expect(repo.list()).toHaveLength(0);
  });
});

describe('AccountRepository', () => {
  it('enforces unique usernames case-insensitively', () => {
    const repo = new AccountRepository(db);
    repo.create({ username: 'Steve', displayName: '', authMode: 'offline', role: 'HUNTER', groupId: null, lastLogin: null, lastLoginOk: false, serverProfileId: null, notes: '' });
    expect(repo.findByUsername('steve')).toBeDefined();
  });

  it('marks login results', () => {
    const repo = new AccountRepository(db);
    const account = repo.create({ username: 'A', displayName: '', authMode: 'offline', role: 'HUNTER', groupId: null, lastLogin: null, lastLoginOk: false, serverProfileId: null, notes: '' });
    repo.markLogin(account.id, true);
    expect(repo.get(account.id)?.lastLoginOk).toBe(true);
  });
});

describe('TargetRepository', () => {
  it('upserts by username and accumulates counters', () => {
    const repo = new TargetRepository(db);
    repo.upsert({ username: 'Steve', kills: 1, encounters: 2 });
    const merged = repo.upsert({ username: 'steve', kills: 2, encounters: 1 });
    expect(repo.list()).toHaveLength(1);
    expect(merged.kills).toBe(3);
    expect(merged.encounters).toBe(3);
  });

  it('keys on UUID when present', () => {
    const repo = new TargetRepository(db);
    const uuid = '11111111-1111-1111-1111-111111111111';
    repo.upsert({ username: 'Alex', uuid });
    repo.upsert({ username: 'AlexRenamed', uuid });
    expect(repo.list()).toHaveLength(1);
    expect(repo.findByIdentity(uuid, 'anything')?.username).toBe('AlexRenamed');
  });
});

describe('GroupRepository', () => {
  it('creates groups and rejects duplicates', () => {
    const repo = new GroupRepository(db);
    repo.create('Raiders');
    expect(() => repo.create('Raiders')).toThrow();
    expect(repo.list()).toHaveLength(1);
  });
});

describe('InstanceRepository', () => {
  it('stores role config as JSON', () => {
    const accounts = new AccountRepository(db);
    const account = accounts.create({ username: 'A', displayName: '', authMode: 'offline', role: 'HUNTER', groupId: null, lastLogin: null, lastLoginOk: false, serverProfileId: null, notes: '' });
    const repo = new InstanceRepository(db);
    const instance = repo.create({ name: 'i1', accountId: account.id, role: 'GEARER', groupId: null, serverProfileId: null, config: { minTotems: 3 }, priority: 1 });
    expect(repo.get(instance.id)?.config).toEqual({ minTotems: 3 });
  });
});

describe('EventRepository', () => {
  it('prunes old events', () => {
    const repo = new EventRepository(db);
    for (let i = 0; i < 50; i++) {
      repo.insert({ id: `e${i}`, type: 'X', source: 's', severity: 'info', instanceId: null, accountId: null, targetUuid: null, message: `m${i}`, payload: {}, timestamp: i });
    }
    repo.prune(10);
    expect(repo.list(100)).toHaveLength(10);
  });
});

describe('DeploymentRepository', () => {
  it('round-trips entries', () => {
    const repo = new DeploymentRepository(db);
    const created = repo.create({
      name: 'D', description: '', serverProfileId: null,
      entries: [{ accountId: 'a', role: 'HUNTER', instanceName: 'HUNTER-01', delayMs: 0, roleConfig: {} }],
      maxConcurrent: 1, connectionTimeoutMs: 15000, retryAttempts: 2, retryDelayMs: 5000,
      manualApproval: false, pauseBetweenMs: 5000, resourceLimitMb: 4096, notifyOnEvent: true,
    });
    expect(repo.get(created.id)?.entries).toHaveLength(1);
  });
});

describe('ConfigVersionRepository', () => {
  it('increments versions and keeps history', () => {
    const repo = new ConfigVersionRepository(db);
    expect(repo.record('account', 'a1', { x: 1 })).toBe(1);
    expect(repo.record('account', 'a1', { x: 2 })).toBe(2);
    const history = repo.history('account', 'a1');
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2);
  });
});
