/**
 * Group manager.
 *
 * Groups are lightweight labels used to filter instances and to issue group-wide administrative
 * commands. Group commands are limited to non-disruptive operations (start/stop/restart and
 * administrative chat); the manager never triggers combat or other disruptive actions.
 */
import type { AccountRepository, GroupRepository, InstanceRepository } from '../../db/repositories';
import type { Group } from '../../../shared/types';

export class GroupManager {
  constructor(
    private readonly groups: GroupRepository,
    private readonly instances: InstanceRepository,
    private readonly accounts: AccountRepository,
  ) {}

  list(): Group[] {
    return this.groups.list();
  }

  create(name: string, description = '', color = '#6d5efc'): Group {
    if (!name || name.trim().length === 0) throw new Error('Group name is required.');
    return this.groups.create(name.trim(), description, color);
  }

  rename(id: string, name: string, description?: string, color?: string): boolean {
    return this.groups.rename(id, name, description, color);
  }

  remove(id: string): boolean {
    return this.groups.remove(id);
  }

  /** Moves an instance into a group (or clears it when groupId is null). */
  assignInstance(instanceId: string, groupId: string | null): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;
    this.instances.update(instanceId, { groupId });
    return true;
  }

  assignAccount(accountId: string, groupId: string | null): boolean {
    const account = this.accounts.get(accountId);
    if (!account) return false;
    this.accounts.update(accountId, { groupId });
    return true;
  }

  members(groupId: string): { instances: string[]; accounts: string[] } {
    return {
      instances: this.instances.list().filter((i) => i.groupId === groupId).map((i) => i.id),
      accounts: this.accounts.list().filter((a) => a.groupId === groupId).map((a) => a.id),
    };
  }
}
