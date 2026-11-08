import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { EquipmentRepository } from '../../src/main/db/repositories';
import { EquipmentManager } from '../../src/main/services/equipment/equipment-manager';

let db: FleetDatabase;
let manager: EquipmentManager;
beforeEach(() => {
  db = new FleetDatabase(':memory:');
  manager = new EquipmentManager(new EquipmentRepository(db));
});
afterEach(() => db.close());

function profile(over: Record<string, unknown> = {}) {
  return manager.create({
    name: 'P', serverProfileId: null, weapons: ['netherite_sword'], minArmorPieces: 4, minTotems: 1,
    minFood: 4, lowDurabilityPercent: 15, sortOrder: [], warningThresholds: {}, ...over,
  } as never);
}

describe('EquipmentManager.evaluate', () => {
  it('reports ready for a complete loadout', () => {
    const result = manager.evaluate(profile(), {
      items: [{ name: 'netherite_sword', count: 1 }, { name: 'totem_of_undying', count: 2 }, { name: 'cooked_beef', count: 8 }],
      armor: ['a', 'b', 'c', 'd'],
      mainHand: 'netherite_sword',
    });
    expect(result.ready).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('flags missing armour, weapon, totems and food', () => {
    const result = manager.evaluate(profile(), { items: [], armor: [] });
    expect(result.ready).toBe(false);
    expect(result.warnings.filter((w) => w.severity === 'critical').length).toBeGreaterThanOrEqual(2);
  });

  it('flags low durability', () => {
    const result = manager.evaluate(profile({ minArmorPieces: 0, minTotems: 0, minFood: 0 }), {
      items: [{ name: 'netherite_sword', count: 1, durabilityUsed: 2000, maxDurability: 2031 }],
      armor: ['a', 'b', 'c', 'd'],
      mainHand: 'netherite_sword',
    });
    expect(result.warnings.some((w) => w.message.includes('durability low'))).toBe(true);
  });
});

describe('EquipmentManager.compare', () => {
  it('reports differing fields', () => {
    const a = profile({ minTotems: 1 });
    const b = profile({ minTotems: 5, minFood: 20 });
    const diffs = manager.compare(a, b);
    expect(diffs.some((d) => d.includes('minTotems'))).toBe(true);
    expect(diffs.some((d) => d.includes('minFood'))).toBe(true);
  });
});
