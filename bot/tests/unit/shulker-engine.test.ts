import { describe, expect, it } from 'vitest';
import {
  SHULKER_SLOTS,
  assessRemoval,
  assessUnpack,
  capacityOf,
  classifyShulkers,
  dominantCategory,
  emptyShulkers,
  fillOf,
  groupByContent,
  isMixed,
  isShulker,
  packableFor,
  suggestOrganisation,
  surplusEmptyShulkers,
} from '../../src/core/engine/shulker-engine';
import type { ItemCategory, ItemStack, ShulkerRecord } from '../../src/core/types';

const categories: ItemCategory[] = [
  { id: 'ores', name: 'Ores', priority: 80, rules: [{ kind: 'id', value: 'minecraft:diamond' }] },
  { id: 'building', name: 'Building', priority: 40, rules: [{ kind: 'id-contains', value: 'stone' }] },
];

const record = (over: Partial<ShulkerRecord> & { slot: number }): ShulkerRecord => ({
  label: `box-${over.slot}`,
  items: [],
  usedSlots: 0,
  freeSlots: SHULKER_SLOTS,
  mixed: false,
  opaque: false,
  inspectedAt: 0,
  ...over,
});

const diamond = (count: number): ItemStack => ({ id: 'minecraft:diamond', count });
const stone = (count: number): ItemStack => ({ id: 'minecraft:stone', count });

describe('isShulker', () => {
  it('matches shulker boxes only', () => {
    expect(isShulker({ id: 'minecraft:shulker_box', count: 1 })).toBe(true);
    expect(isShulker({ id: 'minecraft:red_shulker_box', count: 1 })).toBe(true);
    expect(isShulker({ id: 'minecraft:chest', count: 1 })).toBe(false);
  });
});

describe('fillOf', () => {
  it('reports unknown for an opaque box regardless of slot counts', () => {
    expect(fillOf({ usedSlots: 5, freeSlots: 22, opaque: true })).toBe('unknown');
  });

  it('reports empty when nothing is used', () => {
    expect(fillOf({ usedSlots: 0, freeSlots: 27, opaque: false })).toBe('empty');
  });

  it('reports full when nothing is free', () => {
    expect(fillOf({ usedSlots: 27, freeSlots: 0, opaque: false })).toBe('full');
  });

  it('reports partial in between', () => {
    expect(fillOf({ usedSlots: 3, freeSlots: 24, opaque: false })).toBe('partial');
  });
});

describe('dominantCategory', () => {
  it('picks the category with the largest total count', () => {
    const box = record({ slot: 0, items: [diamond(1), stone(64)] });
    expect(dominantCategory(box, categories)).toBe('building');
  });

  it('returns null when nothing classifies', () => {
    const box = record({ slot: 0, items: [{ id: 'minecraft:dirt', count: 5 }] });
    expect(dominantCategory(box, categories)).toBeNull();
  });
});

describe('isMixed', () => {
  it('is false for a single-category box', () => {
    expect(isMixed(record({ slot: 0, items: [diamond(1), diamond(1)] }), categories)).toBe(false);
  });

  it('is true when two categories are present', () => {
    expect(isMixed(record({ slot: 0, items: [diamond(1), stone(1)] }), categories)).toBe(true);
  });

  it('counts unsorted items as their own group', () => {
    const box = record({ slot: 0, items: [diamond(1), { id: 'minecraft:dirt', count: 1 }] });
    expect(isMixed(box, categories)).toBe(true);
  });
});

describe('classifyShulkers', () => {
  it('fills in dominantCategory and mixed without mutating the input', () => {
    const box = record({ slot: 0, items: [diamond(2), stone(1)] });
    const classified = classifyShulkers([box], categories);
    expect(classified[0]!.dominantCategory).toBe('ores');
    expect(classified[0]!.mixed).toBe(true);
    expect(box.dominantCategory).toBeUndefined();
  });
});

describe('assessUnpack', () => {
  it('refuses an opaque box as a blind unpack', () => {
    const box = record({ slot: 3, opaque: true, usedSlots: 4, freeSlots: 23 });
    const result = assessUnpack(box, 36);
    expect(result.safe).toBe(false);
    expect(result.fill).toBe('unknown');
    expect(result.reason).toContain('blind unpack');
  });

  it('allows an already-empty box', () => {
    const result = assessUnpack(record({ slot: 1 }), 0);
    expect(result.safe).toBe(true);
    expect(result.reason).toBe('already empty');
    expect(result.itemCount).toBe(0);
  });

  it('refuses when the contents do not fit', () => {
    const box = record({ slot: 2, usedSlots: 3, freeSlots: 24, items: [diamond(64), diamond(64), diamond(64)] });
    const result = assessUnpack(box, 2);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('3 slot(s)');
    expect(result.reason).toContain('only 2 are free');
    expect(result.itemCount).toBe(192);
  });

  it('allows when the contents fit', () => {
    const box = record({ slot: 4, usedSlots: 1, freeSlots: 26, items: [diamond(32)] });
    const result = assessUnpack(box, 10);
    expect(result.safe).toBe(true);
    expect(result.reason).toBe('contents fit in the inventory');
    expect(result.itemCount).toBe(32);
  });
});

describe('assessRemoval', () => {
  it('protects an opaque box', () => {
    const result = assessRemoval(record({ slot: 0, opaque: true }));
    expect(result.safe).toBe(false);
    expect(result.protected).toBe(true);
    expect(result.reason).toContain('never disposed of');
  });

  it('protects a non-empty box', () => {
    const result = assessRemoval(record({ slot: 0, usedSlots: 1, freeSlots: 26, items: [diamond(1)] }));
    expect(result.safe).toBe(false);
    expect(result.protected).toBe(true);
    expect(result.reason).toContain('partial');
  });

  it('allows an explicitly-empty, non-opaque box', () => {
    const result = assessRemoval(record({ slot: 0 }));
    expect(result.safe).toBe(true);
    expect(result.protected).toBe(false);
    expect(result.reason).toBe('box is empty');
  });
});

describe('emptyShulkers / surplusEmptyShulkers', () => {
  const empty1 = record({ slot: 0 });
  const empty2 = record({ slot: 1 });
  const opaque = record({ slot: 2, opaque: true, usedSlots: 0, freeSlots: 27 });
  const partial = record({ slot: 3, usedSlots: 1, freeSlots: 26, items: [diamond(1)] });

  it('returns only non-opaque empty boxes', () => {
    const result = emptyShulkers([empty1, opaque, partial, empty2]);
    expect(result.map((entry) => entry.slot)).toEqual([0, 1]);
  });

  it('never counts an opaque box as surplus', () => {
    const surplus = surplusEmptyShulkers([empty1, opaque], 0);
    expect(surplus.map((entry) => entry.slot)).toEqual([0]);
  });

  it('respects the reserve', () => {
    const surplus = surplusEmptyShulkers([empty1, empty2], 1);
    expect(surplus.map((entry) => entry.slot)).toEqual([1]);
  });

  it('returns nothing when the reserve covers every empty box', () => {
    expect(surplusEmptyShulkers([empty1, empty2], 5)).toEqual([]);
  });
});

describe('suggestOrganisation', () => {
  it('prioritises inspect, then consolidate, then unpack, then reserve', () => {
    const opaque = record({ slot: 0, opaque: true, usedSlots: 3, freeSlots: 24 });
    const mixedFull = record({ slot: 1, usedSlots: 27, freeSlots: 0, items: [diamond(1), stone(1)] });
    const partialBox = record({ slot: 2, usedSlots: 1, freeSlots: 26, items: [diamond(1)] });
    const extraEmpty = record({ slot: 3 });
    const suggestions = suggestOrganisation([opaque, mixedFull, partialBox, extraEmpty], categories, 0, 36);
    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(['inspect', 'consolidate', 'unpack', 'reserve']);
    expect(suggestions.map((suggestion) => suggestion.slot)).toEqual([0, 1, 2, 3]);
  });
});

describe('packableFor', () => {
  it('keeps only items of the category, most plentiful first', () => {
    const items = [diamond(1), diamond(5), stone(64), { id: 'minecraft:dirt', count: 9 }];
    const packable = packableFor('ores', items, categories);
    expect(packable).toHaveLength(2);
    expect(packable[0]!.count).toBe(5);
  });
});

describe('capacityOf', () => {
  it('sums used and free slots and counts opaque boxes separately', () => {
    const result = capacityOf([
      record({ slot: 0, usedSlots: 3, freeSlots: 24 }),
      record({ slot: 1, usedSlots: 5, freeSlots: 22 }),
      record({ slot: 2, opaque: true, usedSlots: 0, freeSlots: 27 }),
    ]);
    expect(result.used).toBe(8);
    expect(result.free).toBe(46);
    expect(result.opaque).toBe(1);
  });
});

describe('groupByContent', () => {
  it('buckets by dominant category, unknown for opaque and unsorted otherwise', () => {
    const groups = groupByContent(
      [
        record({ slot: 0, items: [diamond(2)] }),
        record({ slot: 1, items: [{ id: 'minecraft:dirt', count: 2 }] }),
        record({ slot: 2, opaque: true }),
      ],
      categories,
    );
    expect(groups.get('ores')!.map((entry) => entry.slot)).toEqual([0]);
    expect(groups.get('unsorted')!.map((entry) => entry.slot)).toEqual([1]);
    expect(groups.get('unknown')!.map((entry) => entry.slot)).toEqual([2]);
  });
});
