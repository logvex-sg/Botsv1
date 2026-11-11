/**
 * Storage engine tests: categorisation, routing, consolidation and container health.
 *
 * The engine is the brain of the storage subsystem, so its decisions are tested directly: which
 * category an item belongs to, where it should go, what can be consolidated, and which containers
 * are full or unreachable. Every function is pure, so the tests need no game or database.
 */
import { describe, expect, it } from 'vitest';
import {
  bottlenecks,
  canAccept,
  categoryFor,
  categoriesToClassifier,
  chooseDestination,
  classifierFor,
  consolidationGroups,
  isFull,
  isEmpty,
  isProtected,
  reservationFor,
  rulesFor,
  reportNetwork,
  unsortableItems,
  unusedContainers,
} from '../../src/main/packages/storage-engine';
import { ItemClassifier, type ClassifierCategory } from '../../src/main/packages/item-classifier';
import type { StorageCategory, StorageContainer, StorageNetwork } from '../../src/shared/types';
import type { WorkerItem } from '../../src/shared/workers';

function item(id: string, name: string, count: number): WorkerItem {
  return { id, name, count, slot: 0, damage: 0, maxDamage: 0, damageable: false };
}

function category(id: string, name: string, matches: string[], priority = 0): StorageCategory {
  return { id, name, itemMatches: matches, priority, color: '#000', protected: false, createdAt: 0, updatedAt: 0 };
}

function container(id: string, overrides: Partial<StorageContainer> = {}): StorageContainer {
  return {
    id, networkId: 'n1', workerId: 'w1', label: id, kind: 'general', x: 0, y: 0, z: 0, dimension: 'overworld',
    categoryId: null, locked: false, permanent: false, capacity: 27, freeSlots: 10, full: false, items: [],
    inspectedAt: Date.now(), createdAt: 0, updatedAt: 0, ...overrides,
  };
}

const CATEGORIES = [category('build', 'Building', ['stone', 'cobble']), category('ore', 'Ores', ['iron_ingot'], 3)];

describe('categoryFor', () => {
  it('matches by item id substring', () => {
    expect(categoryFor(item('minecraft:cobblestone', 'Cobblestone', 1), CATEGORIES)?.id).toBe('build');
  });

  it('returns null when nothing matches', () => {
    expect(categoryFor(item('minecraft:stick', 'Stick', 1), CATEGORIES)).toBeNull();
  });

  it('prefers the more specific match', () => {
    const broad = category('broad', 'Broad', ['stone']);
    const narrow = category('narrow', 'Narrow', ['cobblestone']);
    expect(categoryFor(item('minecraft:cobblestone', 'Cobblestone', 1), [broad, narrow])?.id).toBe('narrow');
  });
});

describe('isFull / isEmpty', () => {
  it('treats zero free slots as full', () => {
    expect(isFull(container('c', { freeSlots: 0 }))).toBe(true);
    expect(isFull(container('c', { freeSlots: 3 }))).toBe(false);
  });

  it('treats a container with no items as empty', () => {
    expect(isEmpty(container('c'))).toBe(true);
    expect(isEmpty(container('c', { items: [item('minecraft:stone', 'Stone', 1)] }))).toBe(false);
  });
});

describe('canAccept', () => {
  it('refuses a locked or full container', () => {
    expect(canAccept(container('c', { locked: true }), null)).toBe(false);
    expect(canAccept(container('c', { freeSlots: 0 }), null)).toBe(false);
  });

  it('accepts anything into a general container and only the right category into a dedicated one', () => {
    expect(canAccept(container('c'), 'build')).toBe(true);
    expect(canAccept(container('c', { categoryId: 'build' }), 'build')).toBe(true);
    expect(canAccept(container('c', { categoryId: 'build' }), 'ore')).toBe(false);
  });
});

describe('chooseDestination', () => {
  it('prefers a dedicated category match', () => {
    const general = container('g', { freeSlots: 20 });
    const dedicated = container('d', { categoryId: 'build', freeSlots: 2 });
    const chosen = chooseDestination(item('minecraft:stone', 'Stone', 1), [general, dedicated], CATEGORIES);
    expect(chosen?.id).toBe('d');
  });

  it('returns null when there is nowhere to put the item', () => {
    expect(chooseDestination(item('minecraft:stone', 'Stone', 1), [container('c', { freeSlots: 0 })], CATEGORIES)).toBeNull();
  });

  it('honours the same-worker restriction', () => {
    const other = container('other', { workerId: 'w2', freeSlots: 20 });
    expect(chooseDestination(item('minecraft:stone', 'Stone', 1), [other], CATEGORIES, { sameWorkerOnly: 'w1' })).toBeNull();
  });
});

describe('consolidationGroups', () => {
  it('groups an item spread across two containers', () => {
    const a = container('a', { items: [item('minecraft:stone', 'Stone', 30)] });
    const b = container('b', { items: [item('minecraft:stone', 'Stone', 20)] });
    const groups = consolidationGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(50);
    expect(groups[0].containerIds[0]).toBe('a');
  });

  it('ignores an item held in a single container', () => {
    expect(consolidationGroups([container('a', { items: [item('minecraft:stone', 'Stone', 30)] })])).toHaveLength(0);
  });

  it('skips locked containers', () => {
    const a = container('a', { locked: true, items: [item('minecraft:stone', 'Stone', 30)] });
    const b = container('b', { items: [item('minecraft:stone', 'Stone', 20)] });
    expect(consolidationGroups([a, b])).toHaveLength(0);
  });
});

describe('unsortableItems and unusedContainers', () => {
  it('lists items that match no category', () => {
    const c = container('c', { items: [item('minecraft:stick', 'Stick', 5), item('minecraft:stone', 'Stone', 3)] });
    const unsortable = unsortableItems([c], CATEGORIES);
    expect(unsortable.map((i) => i.id)).toEqual(['minecraft:stick']);
  });

  it('lists empty non-permanent containers as reclaimable', () => {
    const empty = container('e');
    const permanent = container('p', { permanent: true });
    expect(unusedContainers([empty, permanent]).map((c) => c.id)).toEqual(['e']);
  });
});

describe('bottlenecks and reportNetwork', () => {
  const network: StorageNetwork = {
    id: 'n1', name: 'Main', description: '', mode: 'supervised', paused: false, workerIds: [],
    protectedItems: ['shulker_box'], reservations: [{ query: 'iron_ingot', count: 64 }], exclusionAreas: [],
    createdAt: 0, updatedAt: 0,
  };

  it('flags a full container and an offline worker', () => {
    const full = container('full', { freeSlots: 0 });
    const offline = container('offline', { workerId: 'w9' });
    const found = bottlenecks(network, [full, offline], (id) => id === 'w1');
    expect(found.some((b) => b.reason === 'full')).toBe(true);
    expect(found.some((b) => b.reason === 'unreachable')).toBe(true);
  });

  it('flags a container on a worker outside the network set', () => {
    const scoped: StorageNetwork = { ...network, workerIds: ['w1'] };
    const stray = container('stray', { workerId: 'w2' });
    expect(bottlenecks(scoped, [stray], () => true).some((b) => b.reason === 'misplaced')).toBe(true);
  });

  it('summarises totals and unassigned categories', () => {
    const report = reportNetwork(
      network,
      [container('a', { categoryId: 'build', items: [item('minecraft:stone', 'Stone', 10)] })],
      CATEGORIES,
      () => true,
    );
    expect(report.containers).toBe(1);
    expect(report.totalItems).toBe(10);
    expect(report.unassignedCategories).toContain('Ores');
  });
});

describe('isProtected and reservationFor', () => {
  const network: StorageNetwork = {
    id: 'n1', name: 'Main', description: '', mode: 'supervised', paused: false, workerIds: [],
    protectedItems: ['shulker_box'], reservations: [{ query: 'iron', count: 64 }], exclusionAreas: [],
    createdAt: 0, updatedAt: 0,
  };

  it('detects a protected item', () => {
    expect(isProtected(network, 'minecraft:shulker_box', { id: 'minecraft:shulker_box', name: 'Shulker Box' })).toBe(true);
    expect(isProtected(network, 'minecraft:stone', { id: 'minecraft:stone', name: 'Stone' })).toBe(false);
  });

  it('returns the reservation floor for a matching item', () => {
    expect(reservationFor(network, { id: 'minecraft:iron_ingot', name: 'Iron Ingot' })).toBe(64);
    expect(reservationFor(network, { id: 'minecraft:stone', name: 'Stone' })).toBe(0);
  });
});

describe('chooseDestination with a classifier', () => {
  const buildBucket: ClassifierCategory = {
    id: 'build', name: 'Building', priority: 0, color: '#000', exclusive: false,
    rules: [{ kind: 'tag', tag: 'minecraft:stone_bricks' }, { kind: 'id-contains', contains: 'stone' }],
  };
  const gems: ClassifierCategory = {
    id: 'gems', name: 'Gems', priority: 0, color: '#000', exclusive: false,
    rules: [{ kind: 'tag', tag: 'c:gems' }],
  };
  const classifier = new ItemClassifier([buildBucket, gems]);

  it('files an item into the container dedicated to its classified category', () => {
    const dedicated = container('gems', { categoryId: 'gems' });
    const general = container('general', { categoryId: null });
    const deepslate = { ...item('minecraft:deepslate', 'Deepslate', 1), tags: ['c:gems'] };
    const chosen = chooseDestination(deepslate, [general, dedicated], [], { classifier });
    expect(chosen?.id).toBe('gems');
  });

  it('skips a container dedicated to another category even when the item is uncategorised', () => {
    const otherBucket = container('build', { categoryId: 'build' });
    const mystery = { ...item('example:mystery', 'Mystery', 1), tags: ['c:gems'] };
    // The item classifies as gems, so a build bucket must not take it, but a general container may.
    const general = container('general', { categoryId: null });
    expect(chooseDestination(mystery, [otherBucket], [], { classifier })).toBeNull();
    expect(chooseDestination(mystery, [otherBucket, general], [], { classifier })?.id).toBe('general');
  });

  it('prefers the least-full dedicated container', () => {
    const fullish = container('a', { categoryId: 'build', freeSlots: 2 });
    const roomy = container('b', { categoryId: 'build', freeSlots: 20 });
    const brick = { ...item('minecraft:stone_bricks', 'Stone Bricks', 1), tags: ['minecraft:stone_bricks'] };
    expect(chooseDestination(brick, [fullish, roomy], [], { classifier })?.id).toBe('b');
  });

  it('ignores locked and full containers', () => {
    const locked = container('locked', { categoryId: 'build', locked: true });
    const full = container('full', { categoryId: 'build', full: true });
    const brick = { ...item('minecraft:stone_bricks', 'Stone Bricks', 1), tags: ['minecraft:stone_bricks'] };
    expect(chooseDestination(brick, [locked, full], [], { classifier })).toBeNull();
  });

  it('honours the same-worker constraint', () => {
    const other = container('other', { categoryId: 'build', workerId: 'w2' });
    const brick = { ...item('minecraft:stone_bricks', 'Stone Bricks', 1), tags: ['minecraft:stone_bricks'] };
    expect(chooseDestination(brick, [other], [], { classifier, sameWorkerOnly: 'w1' })).toBeNull();
  });
});

describe('rulesFor and metadata-driven routing', () => {
  it('routes two stacks with the same id but different metadata to different buckets', () => {
    // The whole point: a plain diamond pickaxe and an enchanted one are not interchangeable, so a
    // category made of real rules must send them to different containers.
    const plain: StorageCategory = category('plain', 'Plain tools', [], 1);
    plain.rules = [{ kind: 'durability', minPercent: 0 }];
    const enchanted: StorageCategory = category('enchanted', 'Enchanted', [], 2);
    enchanted.rules = [{ kind: 'enchantment', id: 'minecraft:efficiency', minLevel: 1 }];
    const categories = [plain, enchanted];

    const pickaxe = { ...item('minecraft:diamond_pickaxe', 'Diamond Pickaxe', 1), damageable: true, maxDamage: 1561 };
    const plainStack = { ...pickaxe, damage: 100 };
    const enchantedStack = { ...pickaxe, damage: 100, enchantments: [{ id: 'minecraft:efficiency', level: 5 }] };

    const plainBox = container('plainbox', { categoryId: 'plain' });
    const enchBox = container('enchbox', { categoryId: 'enchanted' });
    const classifier = classifierFor(categories);

    expect(classifier.classify(plainStack)?.id).toBe('plain');
    expect(classifier.classify(enchantedStack)?.id).toBe('enchanted');
    expect(chooseDestination(plainStack, [plainBox, enchBox], [], { classifier })?.id).toBe('plainbox');
    expect(chooseDestination(enchantedStack, [plainBox, enchBox], [], { classifier })?.id).toBe('enchbox');
  });

  it('routes by tag when the id alone is ambiguous', () => {
    const logs: StorageCategory = category('logs', 'Logs', [], 1);
    logs.rules = [{ kind: 'tag', tag: 'minecraft:logs' }];
    const building: StorageCategory = category('build', 'Building', ['plank'], 0);
    const classifier = classifierFor([logs, building]);
    const oakLog = { ...item('minecraft:oak_log', 'Oak Log', 1), tags: ['minecraft:logs'] };
    expect(classifier.classify(oakLog)?.id).toBe('logs');
  });

  it('falls back to the substrings for a category with no rules', () => {
    const classifier = classifierFor([category('build', 'Building', ['cobblestone'])]);
    expect(classifier.classify(item('minecraft:cobblestone', 'Cobblestone', 1))?.id).toBe('build');
  });

  it('does not match a tag rule against an item that reported no tags', () => {
    const logs: StorageCategory = category('logs', 'Logs', [], 1);
    logs.rules = [{ kind: 'tag', tag: 'minecraft:logs' }];
    // No tags reported: absence is not evidence, so nothing matches and the item is uncategorised.
    expect(classifierFor([logs]).classify(item('minecraft:oak_log', 'Oak Log', 1))).toBeNull();
  });
});

describe('categoriesToClassifier and rulesFor', () => {
  it('translates a substring category into equivalent id-contains rules', () => {
    const translated = categoriesToClassifier(CATEGORIES);
    expect(translated).toHaveLength(2);
    const build = translated.find((c) => c.id === 'build')!;
    expect(build.name).toBe('Building');
    expect(build.rules).toEqual([
      { kind: 'id-contains', contains: 'stone' },
      { kind: 'id-contains', contains: 'cobble' },
    ]);
  });

  it('carries the priority through so category ordering is preserved', () => {
    const translated = categoriesToClassifier(CATEGORIES);
    expect(translated.find((c) => c.id === 'ore')!.priority).toBe(3);
  });

  it('prefers a category’s own rules over its substrings', () => {
    const withRules = category('ench', 'Enchanted', ['pickaxe']);
    withRules.rules = [{ kind: 'enchantment', id: 'minecraft:efficiency', minLevel: 3 }];
    expect(rulesFor(withRules)).toEqual([{ kind: 'enchantment', id: 'minecraft:efficiency', minLevel: 3 }]);
  });

  it('routes a metadata-carrying item through the translated classifier', () => {
    const classifier = classifierFor(CATEGORIES);
    const oreBox = container('orebox', { categoryId: 'ore' });
    const buildBox = container('buildbox', { categoryId: 'build' });
    const ingot = { ...item('minecraft:iron_ingot', 'Iron Ingot', 1), tags: ['c:ingots'] };
    // The storage category "ore" matches iron_ingot, so the classifier routes it to the ore box.
    expect(classifier.classify(ingot)?.id).toBe('ore');
    expect(chooseDestination(ingot, [buildBox, oreBox], [], { classifier })?.id).toBe('orebox');
  });

  it('keeps a protected storage category exclusive when translated', () => {
    const guarded = category('guarded', 'Guarded', ['nether_star']);
    guarded.protected = true;
    expect(categoriesToClassifier([guarded])[0].exclusive).toBe(true);
  });
});
