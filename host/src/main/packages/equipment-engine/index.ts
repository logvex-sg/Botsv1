/**
 * Equipment engine: comparing a worker's reported gear against a desired loadout.
 *
 * This computes the *difference* between what a worker last reported and what a preset requires:
 * missing items, insufficient quantities, low durability, missing armor pieces and missing food.
 * It is a pure function over an already-reported snapshot — the Host never claims a loadout is
 * ready based on anything but the worker's own report.
 *
 * Pure: unit-testable.
 */
import type { WorkerItem } from '../../../shared/workers';
import { countIn, isFoodish } from '../inventory-engine';

export interface LoadoutLine {
  query: string;
  count: number;
  label: string;
}

export interface Loadout {
  name: string;
  items: LoadoutLine[];
  minArmorPieces: number;
  minFood: number;
  lowDurabilityPercent: number;
}

export interface LoadoutGap {
  query: string;
  label: string;
  required: number;
  found: number;
  missing: number;
}

export interface LoadoutReport {
  presetName: string;
  ready: boolean;
  gaps: LoadoutGap[];
  armorPieces: number;
  minArmorPieces: number;
  food: number;
  minFood: number;
  /** Armor pieces below the preset's durability floor, labelled with their remaining percent. */
  damaged: string[];
  /** Human-readable reasons the loadout is not ready, empty when it is. */
  reasons: string[];
}

/** The remaining durability of a stack as a whole percent, or null when it is not damageable. */
export function durabilityPercent(item: WorkerItem): number | null {
  if (!item.damageable || !item.maxDamage || item.maxDamage <= 0) return null;
  return Math.round(((item.maxDamage - item.damage) * 100) / item.maxDamage);
}

/**
 * Compares a loadout against a reported inventory.
 *
 * Every field of the report is derived from `carried` and `armor`; nothing is assumed. A worker
 * with no report at all yields a report that is not ready, with a reason saying so.
 */
export function compare(
  loadout: Loadout,
  carried: readonly WorkerItem[],
  armor: readonly WorkerItem[],
): LoadoutReport {
  const gaps: LoadoutGap[] = loadout.items.map((line) => {
    const found = countIn(carried, line.query);
    return {
      query: line.query,
      label: line.label || line.query,
      required: line.count,
      found,
      missing: Math.max(0, line.count - found),
    };
  });

  const armorPieces = armor.filter((piece) => piece.count > 0).length;
  const food = carried.reduce((sum, item) => sum + (isFoodish(item) ? item.count : 0), 0);
  const damaged = armor
    .map((piece) => ({ piece, percent: durabilityPercent(piece) }))
    .filter((entry): entry is { piece: WorkerItem; percent: number } =>
      entry.percent !== null && entry.percent <= loadout.lowDurabilityPercent)
    .map((entry) => `${entry.piece.name} (${entry.percent}%)`);

  const reasons: string[] = [];
  const missingItems = gaps.filter((gap) => gap.missing > 0);
  if (missingItems.length > 0) {
    reasons.push(`missing ${missingItems.map((gap) => `${gap.missing}x ${gap.label}`).join(', ')}`);
  }
  if (armorPieces < loadout.minArmorPieces) {
    reasons.push(`wearing ${armorPieces}/${loadout.minArmorPieces} armor pieces`);
  }
  if (food < loadout.minFood) {
    reasons.push(`carrying ${food}/${loadout.minFood} food`);
  }

  return {
    presetName: loadout.name,
    ready: reasons.length === 0,
    gaps,
    armorPieces,
    minArmorPieces: loadout.minArmorPieces,
    food,
    minFood: loadout.minFood,
    damaged,
    reasons,
  };
}
