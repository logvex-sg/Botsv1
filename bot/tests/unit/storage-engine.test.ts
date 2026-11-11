import { describe, expect, it } from 'vitest';
import {
  bottlenecks,
  chooseDestination,
  consolidationGroups,
  containerFreeSlots,
  planPlacement,
  reportNetwork,
  unsortableItems,
} from '../../src/core/engine/storage-engine';
import type { ContainerRecord, ItemCategory, ItemStack, StorageNetwork } from '../../src/core/types';

const categories: ItemCategory[] = [
  { id: 'ores', name: 'Ores', priority: 80, rules: [{ kind: 'id', value: 'minecraft:diamond' }] },
];

const container = (over: Partial<ContainerRecord> & { id: string }): ContainerRecord => ({
  networkId: 'net',
  label: over.id,
  position: { x: 0, y: 0, z: 0 },
  dimension: 'overworld',
  categories: [],
  protected: false,
  registeredAt: 0,
  ...over,
});

const diamond = (count: number): ItemStack => ({ id: 'minecraft:diamond', count });
const dirt = (count: number): ItemStack => ({ id: 'minecraft:dirt', count });

describe('chooseDestination', () => {
  it('prefers a container that explicitly lists the category', () => {
    const listed = container({ id: 'ore-chest', label: 'Ore Chest', categories: ['ores'] });
    const any = container({ id: 'any', label: 'Any' });
    const choice = chooseDestination(diamond(1), [any, listed], categories);
    expect(choice.containerId).toBe('ore-chest');
    expect(choice.categoryId).toBe('ores');
    expect(choice.reason).toContain('lists category');
  });

  it('falls back to an unrestricted container', () => {
    const any = container({ id: 'any', label: 'Any' });
    const choice = chooseDestination(diamond(1), [any], categories);
    expect(choice.containerId).toBe('any');
    expect(choice.reason).toContain('unrestricted');
  });

  it('skips a reserved container and records why', () => {
    const listed = container({ id: 'ore-chest', categories: ['ores'] });
    const any = container({ id: 'any' });
    const choice = chooseDestination(diamond(1), [listed, any], categories, {
      reserved: new Set(['ore-chest']),
    });
    expect(choice.containerId).toBe('any');
    expect(choice.rejected).toContainEqual({ containerId: 'ore-chest', reason: 'reserved by another operation' });
  });

  it('skips a full container and records why', () => {
    const listed = container({ id: 'ore-chest', categories: ['ores'] });
    const any = container({ id: 'any' });
    const choice = chooseDestination(diamond(1), [listed, any], categories, {
      capacity: new Map([['ore-chest', 0]]),
    });
    expect(choice.containerId).toBe('any');
    expect(choice.rejected).toContainEqual({ containerId: 'ore-chest', reason: 'no free space' });
  });

  it('deprioritises a protected container when an unprotected one will do', () => {
    const guarded = container({ id: 'guarded', protected: true });
    const plain = container({ id: 'plain' });
    const choice = chooseDestination(diamond(1), [guarded, plain], categories);
    expect(choice.containerId).toBe('plain');
  });

  it('still uses a protected container when it is the only option', () => {
    const guarded = container({ id: 'guarded', protected: true });
    const choice = chooseDestination(diamond(1), [guarded], categories);
    expect(choice.containerId).toBe('guarded');
  });

  it('prefers the roomiest of several listed containers', () => {
    const small = container({ id: 'small', categories: ['ores'] });
    const big = container({ id: 'big', categories: ['ores'] });
    const choice = chooseDestination(diamond(1), [small, big], categories, {
      capacity: new Map([
        ['small', 1],
        ['big', 9],
      ]),
    });
    expect(choice.containerId).toBe('big');
  });

  it('returns null with a category reason when nothing accepts the category', () => {
    const any = container({ id: 'restricted', categories: ['food'] });
    const choice = chooseDestination(diamond(1), [any], categories);
    expect(choice.containerId).toBeNull();
    expect(choice.categoryId).toBe('ores');
    expect(choice.reason).toContain('no container accepts category "ores"');
    expect(choice.rejected).toContainEqual({ containerId: 'restricted', reason: 'category not accepted here' });
  });

  it('returns null when the item matches no category and no container is unrestricted', () => {
    const restricted = container({ id: 'restricted', categories: ['ores'] });
    const choice = chooseDestination(dirt(1), [restricted], categories);
    expect(choice.containerId).toBeNull();
    expect(choice.categoryId).toBeNull();
    expect(choice.reason).toBe('item matched no category and no container is unrestricted');
  });

  it('returns null when there are no containers at all', () => {
    const choice = chooseDestination(diamond(1), [], categories);
    expect(choice.containerId).toBeNull();
    expect(choice.reason).toContain('no container accepts category "ores"');
  });
});

describe('planPlacement', () => {
  const any = container({ id: 'a', lastCapacity: 2 });

  it('places everything when there is room and reports no overflow', () => {
    const result = planPlacement([diamond(64)], [any], categories, new Map([['a', 2]]));
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]!.item.count).toBe(64);
    expect(result.overflow).toEqual([]);
    expect(result.reason).toBe('all items placed');
  });

  it('respects capacity and reports the overflow', () => {
    const result = planPlacement([diamond(128)], [any], categories, new Map([['a', 1]]));
    expect(result.placements[0]!.item.count).toBe(64);
    expect(result.overflow).toHaveLength(1);
    expect(result.overflow[0]!.count).toBe(64);
    expect(result.reason).toContain('did not fit');
  });

  it('partially places across containers', () => {
    const a = container({ id: 'a' });
    const b = container({ id: 'b' });
    const result = planPlacement([diamond(64), diamond(64)], [a, b], categories, new Map([
      ['a', 1],
      ['b', 1],
    ]));
    expect(result.placements.map((placement) => placement.containerId)).toEqual(['a', 'b']);
    expect(result.placements.reduce((sum, placement) => sum + placement.item.count, 0)).toBe(128);
    expect(result.overflow).toEqual([]);
  });

  it('overflows everything when no container will take the item', () => {
    const restricted = container({ id: 'r', categories: ['ores'] });
    const result = planPlacement([dirt(3)], [restricted], categories, new Map([['r', 5]]));
    expect(result.placements).toEqual([]);
    expect(result.overflow).toHaveLength(1);
  });

  it('does not mutate the caller-supplied capacity map', () => {
    const capacity = new Map([['a', 2]]);
    planPlacement([diamond(64)], [any], categories, capacity);
    expect(capacity.get('a')).toBe(2);
  });
});

describe('consolidationGroups', () => {
  it('merges truly identical stacks scattered across containers', () => {
    const contents = new Map<string, readonly ItemStack[]>([
      ['a', [diamond(32)]],
      ['b', [diamond(32)]],
    ]);
    const groups = consolidationGroups(contents);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.total).toBe(64);
    expect(groups[0]!.recoverableSlots).toBe(1);
    expect(groups[0]!.locations).toHaveLength(2);
  });

  it('never merges same-id stacks with different metadata', () => {
    const plain: ItemStack = { id: 'minecraft:iron_sword', count: 16 };
    const sharp: ItemStack = {
      id: 'minecraft:iron_sword',
      count: 16,
      meta: { enchantments: [{ id: 'minecraft:sharpness', level: 5 }] },
    };
    const contents = new Map<string, readonly ItemStack[]>([
      ['a', [plain]],
      ['b', [sharp]],
    ]);
    expect(consolidationGroups(contents)).toEqual([]);
  });

  it('ignores a spread that frees no slot', () => {
    const contents = new Map<string, readonly ItemStack[]>([
      ['a', [diamond(64)]],
      ['b', [diamond(64)]],
    ]);
    expect(consolidationGroups(contents)).toEqual([]);
  });

  it('counts recoverable slots across three containers', () => {
    const contents = new Map<string, readonly ItemStack[]>([
      ['a', [diamond(10)]],
      ['b', [diamond(20)]],
      ['c', [diamond(30)]],
    ]);
    const groups = consolidationGroups(contents);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.recoverableSlots).toBe(2);
  });
});

describe('bottlenecks', () => {
  it('classifies severity as ok, tight and full', () => {
    const containers = [
      container({ id: 'roomy', lastCapacity: 27 }),
      container({ id: 'tight', lastCapacity: 27 }),
      container({ id: 'full', lastCapacity: 27 }),
    ];
    const result = bottlenecks(containers, new Map([
      ['roomy', 27],
      ['tight', 2],
      ['full', 0],
    ]));
    const byId = new Map(result.map((entry) => [entry.containerId, entry]));
    expect(byId.get('roomy')!.severity).toBe('ok');
    expect(byId.get('tight')!.severity).toBe('tight');
    expect(byId.get('full')!.severity).toBe('full');
  });

  it('sorts tightest first and computes fill percent', () => {
    const containers = [
      container({ id: 'roomy', lastCapacity: 10 }),
      container({ id: 'tight', lastCapacity: 10 }),
    ];
    const result = bottlenecks(containers, new Map([
      ['roomy', 10],
      ['tight', 1],
    ]));
    expect(result[0]!.containerId).toBe('tight');
    expect(result[0]!.fillPercent).toBeCloseTo(90);
  });
});

describe('unsortableItems', () => {
  it('returns only items no category claims', () => {
    const items = [diamond(1), dirt(1)];
    expect(unsortableItems(items, categories).map((item) => item.id)).toEqual(['minecraft:dirt']);
  });
});

describe('reportNetwork', () => {
  it('summarises a network over its members only', () => {
    const network: StorageNetwork = {
      id: 'net',
      name: 'Main',
      dimension: 'overworld',
      containers: ['a', 'b'],
      paused: false,
      createdAt: 0,
    };
    const a = container({ id: 'a', lastCapacity: 27 });
    const b = container({ id: 'b', lastCapacity: 27 });
    const outsider = container({ id: 'c', lastCapacity: 27 });
    const report = reportNetwork(
      network,
      [a, b, outsider],
      new Map([
        ['a', 27],
        ['b', 0],
        ['c', 27],
      ]),
      new Map([['a', [diamond(32)]], ['b', [diamond(32)]]]),
    );
    expect(report.containerCount).toBe(2);
    expect(report.totalCapacity).toBe(54);
    expect(report.freeCapacity).toBe(27);
    expect(report.fillPercent).toBeCloseTo(50);
    expect(report.bottlenecks.map((entry) => entry.containerId)).toEqual(['b', 'a']);
    expect(report.consolidations).toHaveLength(1);
  });
});

describe('containerFreeSlots', () => {
  it('computes free slots from last-read contents', () => {
    expect(containerFreeSlots([diamond(64), diamond(1)], 27)).toBe(25);
  });
});
