/**
 * Equipment engine tests: loadout comparison and the reasons a loadout is not ready.
 */
import { describe, expect, it } from 'vitest';
import { compare, durabilityPercent, type Loadout } from '../../src/main/packages/equipment-engine';
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

const loadout: Loadout = {
  name: 'Standard',
  items: [
    { query: 'diamond', count: 64, label: 'Diamonds' },
    { query: 'totem', count: 2, label: 'Totems' },
  ],
  minArmorPieces: 4,
  minFood: 8,
  lowDurabilityPercent: 10,
};

describe('durabilityPercent', () => {
  it('computes remaining durability for a damageable stack', () => {
    expect(durabilityPercent(item({ id: 'minecraft:diamond_helmet', count: 1, damageable: true, damage: 40, maxDamage: 400 }))).toBe(90);
  });

  it('returns null for a non-damageable item', () => {
    expect(durabilityPercent(item({ id: 'minecraft:diamond', count: 64 }))).toBeNull();
  });
});

describe('compare', () => {
  it('reports ready when every requirement is met', () => {
    const carried = [
      item({ id: 'minecraft:diamond', count: 64 }),
      item({ id: 'minecraft:totem_of_undying', count: 2 }),
      item({ id: 'minecraft:cooked_beef', count: 16 }),
    ];
    const armor = [
      item({ id: 'minecraft:diamond_helmet', count: 1 }), item({ id: 'minecraft:diamond_chestplate', count: 1 }),
      item({ id: 'minecraft:diamond_leggings', count: 1 }), item({ id: 'minecraft:diamond_boots', count: 1 }),
    ];
    const report = compare(loadout, carried, armor);
    expect(report.ready).toBe(true);
    expect(report.reasons).toEqual([]);
    expect(report.armorPieces).toBe(4);
  });

  it('lists each missing item with the shortfall', () => {
    const report = compare(loadout, [item({ id: 'minecraft:diamond', count: 30 })], []);
    expect(report.ready).toBe(false);
    const diamond = report.gaps.find((gap) => gap.query === 'diamond')!;
    expect(diamond.missing).toBe(34);
    expect(report.reasons.join(' ')).toContain('Diamonds');
  });

  it('flags low armor and low food separately', () => {
    const report = compare(loadout, [], [item({ id: 'minecraft:diamond_helmet', count: 1 })]);
    expect(report.reasons.join(' ')).toContain('1/4 armor');
    expect(report.reasons.join(' ')).toContain('0/8 food');
  });

  it('lists damaged armor below the durability floor', () => {
    const armor = [item({ id: 'minecraft:diamond_helmet', count: 1, damageable: true, damage: 380, maxDamage: 400, name: 'Diamond Helmet' })];
    const report = compare(loadout, [], armor);
    expect(report.damaged.join(' ')).toContain('Diamond Helmet (5%)');
  });

  it('never claims readiness without a report', () => {
    expect(compare(loadout, [], []).ready).toBe(false);
  });
});
