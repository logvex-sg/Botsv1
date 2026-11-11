/**
 * Storage category persistence tests.
 *
 * A category's real-signal rules must survive a database round-trip, and a category written before
 * rules existed must still load as a plain substring category (rules absent, not empty) so the
 * classifier falls back to its substrings rather than matching nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { StorageCategoryRepository } from '../../src/main/db/storage-repositories';

let db: FleetDatabase;
let categories: StorageCategoryRepository;

beforeEach(() => {
  db = new FleetDatabase(':memory:');
  categories = new StorageCategoryRepository(db);
});

afterEach(() => db.close());

describe('StorageCategoryRepository rules', () => {
  it('round-trips classifier rules through the database', () => {
    const created = categories.create({
      name: 'Enchanted gear',
      itemMatches: [],
      rules: [{ kind: 'enchantment', id: 'minecraft:efficiency', minLevel: 3 }, { kind: 'tag', tag: 'minecraft:pickaxes' }],
      priority: 5,
      color: '#ff00ff',
      protected: true,
    });
    const loaded = categories.get(created.id)!;
    expect(loaded.rules).toEqual([
      { kind: 'enchantment', id: 'minecraft:efficiency', minLevel: 3 },
      { kind: 'tag', tag: 'minecraft:pickaxes' },
    ]);
    expect(loaded.priority).toBe(5);
    expect(loaded.protected).toBe(true);
  });

  it('omits the rules field entirely for a category with none', () => {
    const created = categories.create({ name: 'Plain', itemMatches: ['stone'], priority: 0, color: '#000', protected: false });
    const loaded = categories.get(created.id)!;
    // Absent, not empty: the classifier reads absence as "fall back to substrings".
    expect(loaded.rules).toBeUndefined();
    expect(loaded.itemMatches).toEqual(['stone']);
  });

  it('replaces rules on update', () => {
    const created = categories.create({ name: 'C', itemMatches: [], rules: [{ kind: 'id-contains', contains: 'x' }], priority: 0, color: '#000', protected: false });
    categories.update(created.id, { rules: [{ kind: 'namespace', namespace: 'create' }] });
    expect(categories.get(created.id)!.rules).toEqual([{ kind: 'namespace', namespace: 'create' }]);
  });

  it('clears rules when updated to an empty list', () => {
    const created = categories.create({ name: 'C', itemMatches: ['y'], rules: [{ kind: 'id-contains', contains: 'x' }], priority: 0, color: '#000', protected: false });
    categories.update(created.id, { rules: [] });
    expect(categories.get(created.id)!.rules).toBeUndefined();
  });

  it('keeps existing rules when the patch omits them', () => {
    const created = categories.create({ name: 'C', itemMatches: [], rules: [{ kind: 'tag', tag: 'c:gems' }], priority: 0, color: '#000', protected: false });
    categories.update(created.id, { name: 'Renamed' });
    const loaded = categories.get(created.id)!;
    expect(loaded.name).toBe('Renamed');
    expect(loaded.rules).toEqual([{ kind: 'tag', tag: 'c:gems' }]);
  });
});
