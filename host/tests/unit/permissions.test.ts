/**
 * Permissions tests: the level ladder, action requirements, protected/locked objects, destructive
 * confirmation, and the fail-closed normalisation of an untrusted level.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  PERMISSION_LEVELS,
  allows,
  atLeast,
  authorize,
  describeGrant,
  isDestructive,
  normalizeLevel,
  permittedActions,
  rank,
  reachable,
  requiredLevel,
  requiresConfirmation,
  type ActionId,
  type Grant,
} from '../../src/main/packages/permissions';

const admin: Grant = { subject: 'admin', level: 'administer' };
const viewer: Grant = { subject: 'viewer', level: 'view' };

describe('level ladder', () => {
  it('orders the levels', () => {
    expect(rank('view')).toBe(0);
    expect(rank('administer')).toBe(PERMISSION_LEVELS.length - 1);
    expect(rank('nonsense')).toBe(-1);
  });

  it('treats a higher level as holding every lower one', () => {
    expect(atLeast('transfer', 'sort')).toBe(true);
    expect(atLeast('sort', 'transfer')).toBe(false);
    expect(atLeast('view', 'view')).toBe(true);
    expect(atLeast('garbage', 'view')).toBe(false);
  });

  it('lists reachable levels up to the held one', () => {
    expect(reachable({ subject: 's', level: 'sort' })).toEqual(['view', 'inspect', 'sort']);
  });
});

describe('allows', () => {
  it('permits an action when the level suffices', () => {
    expect(allows({ subject: 's', level: 'transfer' }, 'items.transfer').allowed).toBe(true);
  });

  it('refuses an action when the level is short, with a reason naming the level', () => {
    const decision = allows({ subject: 's', level: 'sort' }, 'items.transfer');
    expect(decision.allowed).toBe(false);
    expect(decision.required).toBe('transfer');
    expect(decision.reason).toContain('transfer');
  });

  it('honours an explicit deny override even for an administrator', () => {
    const grant: Grant = { subject: 's', level: 'administer', overrides: { 'items.transfer': false } };
    const decision = allows(grant, 'items.transfer');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('explicit rule denies');
  });

  it('honours an explicit allow override below the level', () => {
    const grant: Grant = { subject: 's', level: 'view', overrides: { 'storage.inspect': true } };
    expect(allows(grant, 'storage.inspect').allowed).toBe(true);
  });

  it('marks a destructive action as needing a confirmation', () => {
    expect(allows(admin, 'items.dispose').needsConfirmation).toBe(true);
    expect(allows(admin, 'storage.view').needsConfirmation).toBe(false);
  });
});

describe('authorize with a target object', () => {
  it('refuses a locked object at any level', () => {
    const decision = authorize(admin, 'items.transfer', { kind: 'container', id: 'c1', locked: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('locked');
  });

  it('refuses a protected object for a non-administrator', () => {
    const decision = authorize({ subject: 's', level: 'manage_networks' }, 'network.edit', { kind: 'network', id: 'n1', protected: true });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('protected');
  });

  it('allows a protected object for an administrator', () => {
    expect(authorize(admin, 'network.edit', { kind: 'network', id: 'n1', protected: true }).allowed).toBe(true);
  });

  it('allows an override to reach a protected object without administration', () => {
    const grant: Grant = { subject: 's', level: 'transfer', overrides: { 'items.transfer': true } };
    expect(authorize(grant, 'items.transfer', { kind: 'container', id: 'c1', protected: true }).allowed).toBe(true);
  });

  it('still applies the level check before the object check', () => {
    expect(authorize(viewer, 'items.transfer', { kind: 'container', id: 'c1' }).allowed).toBe(false);
  });
});

describe('destructive actions', () => {
  it('names the destructive actions', () => {
    expect(isDestructive('items.dispose')).toBe(true);
    expect(isDestructive('shulker.destroy')).toBe(true);
    expect(isDestructive('storage.view')).toBe(false);
  });

  it('requires a confirmation until one is given', () => {
    expect(requiresConfirmation(admin, 'shulker.destroy')).toBe(true);
    expect(requiresConfirmation(admin, 'shulker.destroy', { confirmed: true })).toBe(false);
    expect(requiresConfirmation(admin, 'storage.view')).toBe(false);
  });

  it('lets an explicit allow override waive the confirmation', () => {
    const grant: Grant = { subject: 's', level: 'administer', overrides: { 'shulker.destroy': true } };
    expect(requiresConfirmation(grant, 'shulker.destroy')).toBe(false);
  });
});

describe('action table', () => {
  it('maps every action to a level', () => {
    for (const action of Object.keys(ACTIONS) as ActionId[]) {
      expect(PERMISSION_LEVELS).toContain(requiredLevel(action));
    }
  });

  it('lists the actions a grant may perform', () => {
    const actions = permittedActions(viewer);
    expect(actions).toContain('storage.view');
    expect(actions).not.toContain('items.transfer');
    expect(permittedActions(admin)).toContain('config.administer');
  });
});

describe('normalizeLevel', () => {
  it('accepts a known level', () => {
    expect(normalizeLevel('transfer')).toBe('transfer');
  });

  it('fails closed to view for anything else', () => {
    expect(normalizeLevel('root')).toBe('view');
    expect(normalizeLevel(42)).toBe('view');
    expect(normalizeLevel(undefined)).toBe('view');
  });
});

describe('describeGrant', () => {
  it('renders the level and any overrides', () => {
    expect(describeGrant({ subject: 'bot', level: 'sort' })).toBe('bot: sort');
    expect(describeGrant({ subject: 'bot', level: 'sort', overrides: { 'items.transfer': true } })).toBe('bot: sort (items.transfer=allow)');
  });
});
