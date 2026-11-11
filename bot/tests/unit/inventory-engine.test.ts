import { describe, expect, it } from 'vitest';
import {
  STALE_INVENTORY_MS,
  aggregate,
  countFood,
  countIn,
  diff,
  distinctItems,
  find,
  freeSlots,
  isFoodish,
  isStale,
  matchesQuery,
  normalizeQuery,
  toCsv,
  totalItems,
} from '../../src/core/engine/inventory-engine';
import type { ItemStack } from '../../src/core/types';

const diamond = (count: number): ItemStack => ({ id: 'minecraft:diamond', count });
const iron = (count: number): ItemStack => ({ id: 'minecraft:iron_ingot', count });

describe('normalizeQuery', () => {
  it('trims and lower-cases', () => {
    expect(normalizeQuery('  DIAMOND ')).toBe('diamond');
  });

  it('expands known aliases', () => {
    expect(normalizeQuery('totem')).toBe('totem_of_undying');
    expect(normalizeQuery('gapple')).toBe('golden_apple');
    expect(normalizeQuery('gap')).toBe('golden_apple');
    expect(normalizeQuery('pearl')).toBe('ender_pearl');
    expect(normalizeQuery('xp')).toBe('experience_bottle');
    expect(normalizeQuery('firework')).toBe('firework_rocket');
    expect(normalizeQuery('crystal')).toBe('end_crystal');
    expect(normalizeQuery('cobble')).toBe('cobblestone');
    expect(normalizeQuery('shulker')).toBe('shulker_box');
  });

  it('leaves unknown queries alone and applies aliases after lower-casing', () => {
    expect(normalizeQuery('Netherite')).toBe('netherite');
    expect(normalizeQuery('TOTEM')).toBe('totem_of_undying');
  });
});

describe('matchesQuery', () => {
  it('matches an exact namespaced id', () => {
    expect(matchesQuery(diamond(1), 'minecraft:diamond')).toBe(true);
  });

  it('matches the short id without a namespace', () => {
    expect(matchesQuery(diamond(1), 'diamond')).toBe(true);
    expect(matchesQuery(iron(1), 'iron_ingot')).toBe(true);
  });

  it('matches a display-name substring', () => {
    const named: ItemStack = { id: 'minecraft:potion', count: 1, name: 'Healing Draught' };
    expect(matchesQuery(named, 'healing')).toBe(true);
    expect(matchesQuery(named, 'draught')).toBe(true);
  });

  it('matches a custom name reported in metadata', () => {
    const named: ItemStack = { id: 'minecraft:paper', count: 1, meta: { customName: 'Mining Ledger' } };
    expect(matchesQuery(named, 'ledger')).toBe(true);
  });

  it('resolves an alias to a real item', () => {
    const totem: ItemStack = { id: 'minecraft:totem_of_undying', count: 1 };
    expect(matchesQuery(totem, 'totem')).toBe(true);
  });

  it('matches by id substring', () => {
    expect(matchesQuery({ id: 'minecraft:oak_planks', count: 1 }, 'oak')).toBe(true);
  });

  it('returns false for a non-match', () => {
    expect(matchesQuery(diamond(1), 'emerald')).toBe(false);
  });

  it('returns false for an empty query', () => {
    expect(matchesQuery(diamond(1), '')).toBe(false);
    expect(matchesQuery(diamond(1), '   ')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchesQuery(diamond(1), 'DIAMOND')).toBe(true);
  });
});

describe('countIn / find', () => {
  const items = [diamond(5), diamond(3), iron(2)];

  it('counts the total across matching stacks', () => {
    expect(countIn(items, 'diamond')).toBe(8);
    expect(countIn(items, 'iron')).toBe(2);
    expect(countIn(items, 'emerald')).toBe(0);
  });

  it('finds matching stacks', () => {
    expect(find(items, 'diamond')).toHaveLength(2);
    expect(find(items, 'emerald')).toHaveLength(0);
  });
});

describe('aggregate', () => {
  it('sums counts by identity', () => {
    const totals = aggregate([diamond(5), diamond(3)]);
    expect(totals).toHaveLength(1);
    expect(totals[0]!.count).toBe(8);
    expect(totals[0]!.id).toBe('minecraft:diamond');
  });

  it('groups by identity, not by id: different enchantments stay separate', () => {
    const plain: ItemStack = { id: 'minecraft:diamond_sword', count: 1 };
    const sharp: ItemStack = {
      id: 'minecraft:diamond_sword',
      count: 1,
      meta: { enchantments: [{ id: 'minecraft:sharpness', level: 5 }] },
    };
    const totals = aggregate([plain, sharp]);
    expect(totals).toHaveLength(2);
    expect(totals.map((entry) => entry.id)).toEqual(['minecraft:diamond_sword', 'minecraft:diamond_sword']);
    expect(new Set(totals.map((entry) => entry.key)).size).toBe(2);
  });

  it('sorts totals by descending count', () => {
    const totals = aggregate([iron(2), diamond(9)]);
    expect(totals[0]!.id).toBe('minecraft:diamond');
    expect(totals[1]!.id).toBe('minecraft:iron_ingot');
  });

  it('returns an empty list for no items', () => {
    expect(aggregate([])).toEqual([]);
  });
});

describe('freeSlots', () => {
  it('subtracts slots used from capacity', () => {
    expect(freeSlots([diamond(64)], 36)).toBe(35);
  });

  it('counts partial stacks as a used slot', () => {
    expect(freeSlots([diamond(1)], 36)).toBe(35);
    expect(freeSlots([diamond(65)], 36)).toBe(34);
  });

  it('never goes below zero', () => {
    const items = Array.from({ length: 40 }, () => diamond(64));
    expect(freeSlots(items, 36)).toBe(0);
  });

  it('defaults to a 36-slot inventory', () => {
    expect(freeSlots([])).toBe(36);
  });
});

describe('diff', () => {
  it('reports an entirely new item as added', () => {
    const result = diff([], [diamond(5)]);
    expect(result.added.map((entry) => entry.id)).toEqual(['minecraft:diamond']);
    expect(result.added[0]!.count).toBe(5);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('reports an item only present before as removed', () => {
    const result = diff([diamond(5)], []);
    expect(result.removed.map((entry) => entry.id)).toEqual(['minecraft:diamond']);
    expect(result.removed[0]!.count).toBe(5);
    expect(result.added).toEqual([]);
  });

  it('reports a count increase as an added delta', () => {
    const result = diff([diamond(3)], [diamond(10)]);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.count).toBe(7);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it('reports a count decrease as a removed delta', () => {
    const result = diff([diamond(10)], [diamond(4)]);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.count).toBe(6);
    expect(result.added).toEqual([]);
  });

  it('reports an unchanged item when counts are equal', () => {
    const result = diff([diamond(5)], [diamond(5)]);
    expect(result.unchanged).toHaveLength(1);
    expect(result.unchanged[0]!.count).toBe(5);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('distinguishes metadata changes from identical stacks', () => {
    const plain: ItemStack = { id: 'minecraft:book', count: 1 };
    const enchanted: ItemStack = {
      id: 'minecraft:book',
      count: 1,
      meta: { enchantments: [{ id: 'minecraft:mending', level: 1 }] },
    };
    const result = diff([plain], [enchanted]);
    // The plain book vanished and an enchanted one appeared: they are different identities.
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });
});

describe('isStale', () => {
  it('treats an undefined timestamp as stale', () => {
    expect(isStale(undefined, 1_000)).toBe(true);
  });

  it('is fresh within the threshold', () => {
    expect(isStale(1_000, 1_000 + STALE_INVENTORY_MS)).toBe(false);
  });

  it('is stale beyond the threshold', () => {
    expect(isStale(1_000, 1_000 + STALE_INVENTORY_MS + 1)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isStale(0, 100, 50)).toBe(true);
    expect(isStale(0, 40, 50)).toBe(false);
  });
});

describe('isFoodish / countFood', () => {
  it('recognises common foods', () => {
    expect(isFoodish({ id: 'minecraft:bread', count: 1 })).toBe(true);
    expect(isFoodish({ id: 'minecraft:golden_apple', count: 1 })).toBe(true);
    expect(isFoodish({ id: 'minecraft:cooked_beef', count: 1 })).toBe(true);
    expect(isFoodish({ id: 'minecraft:carrot', count: 1 })).toBe(true);
  });

  it('does not treat non-food as food', () => {
    expect(isFoodish({ id: 'minecraft:diamond', count: 1 })).toBe(false);
    expect(isFoodish({ id: 'minecraft:cobblestone', count: 1 })).toBe(false);
  });

  it('counts food items', () => {
    const items = [
      { id: 'minecraft:bread', count: 3 },
      { id: 'minecraft:cooked_beef', count: 2 },
      { id: 'minecraft:diamond', count: 64 },
    ];
    expect(countFood(items)).toBe(5);
  });
});

describe('toCsv / totalItems / distinctItems', () => {
  it('renders a header and one line per total', () => {
    const csv = toCsv(aggregate([diamond(2), iron(3)]));
    expect(csv.split('\n')[0]).toBe('id,count');
    expect(csv).toContain('minecraft:iron_ingot,3');
    expect(csv).toContain('minecraft:diamond,2');
  });

  it('emits only the header for no totals', () => {
    expect(toCsv([])).toBe('id,count');
  });

  it('sums every count', () => {
    expect(totalItems([diamond(2), iron(3)])).toBe(5);
    expect(totalItems([])).toBe(0);
  });

  it('counts distinct identities, not ids', () => {
    const plain: ItemStack = { id: 'minecraft:sword', count: 1 };
    const sharp: ItemStack = {
      id: 'minecraft:sword',
      count: 1,
      meta: { enchantments: [{ id: 'minecraft:sharpness', level: 1 }] },
    };
    expect(distinctItems([plain, sharp, { ...plain, count: 4 }])).toBe(2);
  });
});
