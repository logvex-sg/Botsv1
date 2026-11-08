import { describe, it, expect } from 'vitest';
import { evaluateEquipment, evaluateStasis, observeTargets } from '../../src/main/mineflayer/role-tasks';

const ARMOR_SLOTS: Record<string, number> = { helmet: 0, chestplate: 1, leggings: 2, boots: 3 };

function botWith(items: { name: string; count: number }[], armor: string[], players: Record<string, unknown> = {}) {
  const slots: Record<number, { name: string }> = {};
  armor.forEach((name, index) => { slots[index] = { name }; });
  return {
    username: 'me',
    entity: { position: { x: 0, y: 64, z: 0 } },
    game: { dimension: 'minecraft:overworld' },
    players,
    inventory: { items: () => items.map((i, idx) => ({ ...i, slot: idx })), slots },
    getEquipmentDestSlot: (slot: string) => ARMOR_SLOTS[slot] ?? -1,
  };
}

describe('evaluateEquipment (GEARER)', () => {
  it('reports ready when all requirements are met', () => {
    const bot = botWith(
      [{ name: 'netherite_sword', count: 1 }, { name: 'totem_of_undying', count: 2 }, { name: 'cooked_beef', count: 16 }],
      ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'],
    );
    const result = evaluateEquipment(bot, { minArmorPieces: 4, minTotems: 1, minFood: 4 });
    expect(result.ready).toBe(true);
    expect(result.payload.warningCount).toBe(0);
  });

  it('reports warnings when armour and weapons are missing', () => {
    const bot = botWith([], []);
    const result = evaluateEquipment(bot, { minArmorPieces: 4, minTotems: 1, minFood: 4 });
    expect(result.ready).toBe(false);
    expect(result.payload.warnings as string[]).toEqual(expect.arrayContaining(['Armour 0/4', 'No weapon']));
  });
});

describe('evaluateStasis (STASIS)', () => {
  it('reports ready when connected and components are present', () => {
    const bot = botWith([{ name: 'obsidian', count: 10 }], []);
    const result = evaluateStasis(bot, { requiredItems: ['obsidian'] });
    expect(result.type).toBe('STASIS_READY');
  });

  it('reports unavailable when a component is missing', () => {
    const bot = botWith([], []);
    const result = evaluateStasis(bot, { requiredItems: ['obsidian'] });
    expect(result.type).toBe('STASIS_UNAVAILABLE');
    expect((result.payload.missing as string[])).toContain('obsidian');
  });

  it('reports unavailable when not connected', () => {
    const result = evaluateStasis({}, { requiredItems: [] });
    expect(result.type).toBe('STASIS_UNAVAILABLE');
  });
});

describe('observeTargets (HUNTER)', () => {
  it('emits nothing without an allow-list', () => {
    const bot = botWith([], [], { p: { username: 'Steve', uuid: '1' } });
    expect(observeTargets(bot, {})).toEqual([]);
  });

  it('detects an allow-listed target once and then reports disappearance', () => {
    const config: Record<string, unknown> = { allowlist: ['Steve'] };
    const present = botWith([], [], { p: { username: 'Steve', uuid: '1' } });
    const first = observeTargets(present, config);
    expect(first.map((e) => e.type)).toEqual(['TARGET_DETECTED']);

    const second = observeTargets(present, config);
    expect(second).toEqual([]);

    const gone = botWith([], [], {});
    const third = observeTargets(gone, config);
    expect(third.map((e) => e.type)).toEqual(['TARGET_DISAPPEARED']);
  });


  it('ignores targets outside the allow-list', () => {
    const bot = botWith([], [], { p: { username: 'Random', uuid: '9' } });
    expect(observeTargets(bot, { allowlist: ['Steve'] })).toEqual([]);
  });
});
