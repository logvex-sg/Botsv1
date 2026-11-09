/**
 * Inventory engine tests: matching, counting, aggregation, diffing and export.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregate,
  countIn,
  diff,
  freeSlots,
  isFoodish,
  isStale,
  matchesQuery,
  toCsv,
} from '../../src/main/packages/inventory-engine';
import type { WorkerItem } from '../../src/shared/workers';

function item(partial: Partial<WorkerItem> & { id: string; count: number }): WorkerItem {
  return {
    name: partial.name ?? partial.id,
    slot: partial.slot ?? 0,
    damage: partial.damage ?? 0,
    maxDamage: partial.maxDamage ?? 0,
    damageable: partial.damageable ?? false,
    ...partial,
  };
}

describe('matchesQuery', () => {
  it('matches an exact id and a bare path', () => {
    const totem = item({ id: 'minecraft:totem_of_undying', count: 1 });
    expect(matchesQuery(totem, 'minecraft:totem_of_undying')).toBe(true);
    expect(matchesQuery(totem, 'totem_of_undying')).toBe(true);
  });

  it('matches a substring of the path or the display name', () => {
    expect(matchesQuery(item({ id: 'minecraft:diamond_sword', count: 1 }), 'sword')).toBe(true);
  });

  it('resolves an alias', () => {
    expect(matchesQuery(item({ id: 'minecraft:totem_of_undying', count: 1 }), 'totem')).toBe(true);
    expect(matchesQuery(item({ id: 'minecraft:ender_pearl', count: 1 }), 'pearl')).toBe(true);
  });

  it('does not match an empty query', () => {
    expect(matchesQuery(item({ id: 'minecraft:stone', count: 1 }), '  ')).toBe(false);
  });
});

describe('countIn', () => {
  it('sums every matching stack', () => {
    const items = [
      item({ id: 'minecraft:diamond', count: 64, slot: 0 }),
      item({ id: 'minecraft:diamond', count: 32, slot: 1 }),
      item({ id: 'minecraft:stone', count: 10, slot: 2 }),
    ];
    expect(countIn(items, 'diamond')).toBe(96);
  });

  it('returns zero for a missing item rather than guessing', () => {
    expect(countIn([item({ id: 'minecraft:stone', count: 10 })], 'netherite')).toBe(0);
  });
});

describe('aggregate', () => {
  it('combines several snapshots into per-item totals, largest first', () => {
    const a = [item({ id: 'minecraft:diamond', count: 10 }), item({ id: 'minecraft:iron_ingot', count: 5 })];
    const b = [item({ id: 'minecraft:diamond', count: 40 })];
    const totals = aggregate([a, b]);
    expect(totals[0]).toEqual({ id: 'minecraft:diamond', name: 'minecraft:diamond', count: 50 });
    expect(totals[1].id).toBe('minecraft:iron_ingot');
  });
});

describe('diff', () => {
  it('reports gained and lost items between two snapshots', () => {
    const before = [item({ id: 'minecraft:diamond', count: 10 }), item({ id: 'minecraft:stone', count: 30 })];
    const after = [item({ id: 'minecraft:diamond', count: 25 }), item({ id: 'minecraft:stone', count: 5 })];
    const result = diff(before, after);
    expect(result.gained).toEqual([{ id: 'minecraft:diamond', name: 'minecraft:diamond', count: 15 }]);
    expect(result.lost).toEqual([{ id: 'minecraft:stone', name: 'minecraft:stone', count: 25 }]);
    expect(result.unchanged).toBe(false);
  });

  it('flags an unchanged inventory', () => {
    const same = [item({ id: 'minecraft:diamond', count: 10 })];
    expect(diff(same, same).unchanged).toBe(true);
  });
});

describe('freeSlots', () => {
  it('counts slots with no reported stack', () => {
    const items = [item({ id: 'minecraft:diamond', count: 1, slot: 0 }), item({ id: 'minecraft:stone', count: 1, slot: 5 })];
    expect(freeSlots(items, 36)).toBe(34);
  });
});

describe('isFoodish', () => {
  it('recognises common food ids', () => {
    expect(isFoodish(item({ id: 'minecraft:golden_apple', count: 1 }))).toBe(true);
    expect(isFoodish(item({ id: 'minecraft:cooked_beef', count: 1 }))).toBe(true);
    expect(isFoodish(item({ id: 'minecraft:diamond_sword', count: 1 }))).toBe(false);
  });
});

describe('isStale', () => {
  it('treats a missing capture as stale', () => {
    expect(isStale(null)).toBe(true);
  });
  it('flags an old capture and accepts a fresh one', () => {
    expect(isStale(1_000, 100_000, 60_000)).toBe(true);
    expect(isStale(99_000, 100_000, 60_000)).toBe(false);
  });
});

describe('toCsv', () => {
  it('emits a header and one row per item, quoting where needed', () => {
    const csv = toCsv([{ id: 'minecraft:diamond', name: 'Diamond, shiny', count: 3 }]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('item,display_name,count');
    expect(lines[1]).toBe('minecraft:diamond,"Diamond, shiny",3');
  });
});
