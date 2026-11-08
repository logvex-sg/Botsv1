/**
 * Equipment manager (Gearer support).
 *
 * Stores equipment profiles and evaluates a live inventory against them, producing warnings. It is
 * observe-and-warn only: nothing is dropped or moved without an explicit configuration flag, and
 * the destructive `allowDiscard` flag defaults to false.
 */
import type { EquipmentRepository } from '../../db/repositories';
import type { EquipmentProfileRecord } from '../../../shared/types';

export interface InventoryItem {
  name: string;
  count: number;
  durabilityUsed?: number;
  maxDurability?: number;
}

export interface InventorySnapshot {
  items: InventoryItem[];
  armor: string[];
  mainHand?: string;
}

export interface EquipmentWarning {
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface EquipmentEvaluation {
  ready: boolean;
  warnings: EquipmentWarning[];
  armorPieces: number;
  weapons: string[];
  totems: number;
  food: number;
}

const DEFAULT_WEAPONS = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_sword', 'wooden_sword',
];

const FOOD_PATTERN = /apple|bread|cooked|carrot|beef|pork|chicken|mutton|potato|stew|melon/;

export class EquipmentManager {
  constructor(private readonly repo: EquipmentRepository) {}

  list(): EquipmentProfileRecord[] {
    return this.repo.list();
  }

  get(id: string): EquipmentProfileRecord | undefined {
    return this.repo.get(id);
  }

  create(input: Omit<EquipmentProfileRecord, 'id' | 'createdAt' | 'updatedAt'>): EquipmentProfileRecord {
    return this.repo.create(input);
  }

  update(id: string, patch: Partial<EquipmentProfileRecord>): EquipmentProfileRecord | undefined {
    return this.repo.update(id, patch);
  }

  remove(id: string): boolean {
    return this.repo.remove(id);
  }

  /** Evaluates a live inventory snapshot against a profile. */
  evaluate(profile: EquipmentProfileRecord, snapshot: InventorySnapshot): EquipmentEvaluation {
    const warnings: EquipmentWarning[] = [];
    const names = new Set(snapshot.items.map((i) => i.name));

    const armorPieces = snapshot.armor.filter(Boolean).length;
    if (armorPieces < profile.minArmorPieces) {
      warnings.push({
        severity: armorPieces === 0 ? 'critical' : 'warning',
        message: `Armour incomplete: ${armorPieces}/${profile.minArmorPieces} pieces`,
      });
    }

    const weapons = profile.weapons.length > 0 ? profile.weapons.filter((w) => names.has(w)) : [...DEFAULT_WEAPONS.filter((w) => names.has(w))];
    const mainHand = snapshot.mainHand ?? '';
    if (weapons.length === 0 && !DEFAULT_WEAPONS.includes(mainHand)) {
      warnings.push({ severity: 'critical', message: 'No weapon available' });
    }

    const totems = snapshot.items.filter((i) => i.name === 'totem_of_undying').reduce((sum, i) => sum + i.count, 0);
    if (totems < profile.minTotems) {
      warnings.push({ severity: totems === 0 ? 'critical' : 'warning', message: `Totems low: ${totems}/${profile.minTotems}` });
    }

    const food = snapshot.items.filter((i) => FOOD_PATTERN.test(i.name)).reduce((sum, i) => sum + i.count, 0);
    if (food < profile.minFood) {
      warnings.push({ severity: 'warning', message: `Food low: ${food}/${profile.minFood}` });
    }

    for (const item of snapshot.items) {
      if (typeof item.maxDurability !== 'number' || typeof item.durabilityUsed !== 'number' || item.maxDurability <= 0) continue;
      const remainingPercent = Math.round(((item.maxDurability - item.durabilityUsed) / item.maxDurability) * 100);
      if (remainingPercent <= profile.lowDurabilityPercent) {
        warnings.push({
          severity: remainingPercent <= 5 ? 'critical' : 'warning',
          message: `${item.name} durability low: ${remainingPercent}%`,
        });
      }
    }

    // Duplicate detection: more than a stack of the same item is reported as an info note.
    const counts = new Map<string, number>();
    for (const item of snapshot.items) counts.set(item.name, (counts.get(item.name) ?? 0) + item.count);
    for (const [name, count] of counts) {
      if (count > 64) warnings.push({ severity: 'info', message: `Duplicate stacks of ${name} (${count})` });
    }

    return {
      ready: warnings.every((w) => w.severity === 'info'),
      warnings,
      armorPieces,
      weapons,
      totems,
      food,
    };
  }

  /** Compares two profiles and reports which fields differ. */
  compare(a: EquipmentProfileRecord, b: EquipmentProfileRecord): string[] {
    const diffs: string[] = [];
    if (a.minArmorPieces !== b.minArmorPieces) diffs.push(`minArmorPieces: ${a.minArmorPieces} -> ${b.minArmorPieces}`);
    if (a.minTotems !== b.minTotems) diffs.push(`minTotems: ${a.minTotems} -> ${b.minTotems}`);
    if (a.minFood !== b.minFood) diffs.push(`minFood: ${a.minFood} -> ${b.minFood}`);
    if (a.lowDurabilityPercent !== b.lowDurabilityPercent) diffs.push(`lowDurabilityPercent: ${a.lowDurabilityPercent} -> ${b.lowDurabilityPercent}`);
    if (JSON.stringify(a.weapons) !== JSON.stringify(b.weapons)) diffs.push(`weapons differ`);
    return diffs;
  }
}
