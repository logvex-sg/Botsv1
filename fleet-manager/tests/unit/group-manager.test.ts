import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { AccountRepository, GroupRepository, InstanceRepository } from '../../src/main/db/repositories';
import { GroupManager } from '../../src/main/services/groups/group-manager';

let db: FleetDatabase;
let manager: GroupManager;
let accounts: AccountRepository;
let instances: InstanceRepository;

beforeEach(() => {
  db = new FleetDatabase(':memory:');
  accounts = new AccountRepository(db);
  instances = new InstanceRepository(db);
  manager = new GroupManager(new GroupRepository(db), instances, accounts);
});
afterEach(() => db.close());

describe('GroupManager', () => {
  it('creates groups and requires a name', () => {
    expect(() => manager.create('')).toThrow();
    expect(manager.create('Raiders', 'desc', '#f00').name).toBe('Raiders');
  });

  it('assigns instances and accounts to groups', () => {
    const group = manager.create('G');
    const account = accounts.create({ username: 'A', displayName: '', authMode: 'offline', role: 'HUNTER', groupId: null, lastLogin: null, lastLoginOk: false, serverProfileId: null, notes: '' });
    const instance = instances.create({ name: 'i', accountId: account.id, role: 'GEARER', groupId: null, serverProfileId: null, config: {}, priority: 0 });
    expect(manager.assignInstance(instance.id, group.id)).toBe(true);
    expect(manager.assignAccount(account.id, group.id)).toBe(true);
    const members = manager.members(group.id);
    expect(members.instances).toContain(instance.id);
    expect(members.accounts).toContain(account.id);
  });

  it('renames groups', () => {
    const group = manager.create('Old');
    manager.rename(group.id, 'New', 'updated');
    expect(manager.list()[0].name).toBe('New');
  });
});
