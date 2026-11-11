/**
 * Shulker management.
 *
 * A shulker box's contents can only be read through an interaction the server permits (placing it
 * and opening it, or reading an item that carries its container component). This engine therefore
 * never assumes it can see inside: an uninspectable box is reported as `opaque`, not as empty, and
 * the reserve logic counts opaque boxes separately so an empty box is never thrown away by mistake.
 */

import { classify, identityKey } from './item-classifier';
import type { ItemCategory, ItemStack, ShulkerRecord, ShulkerSlot } from '../types';

export const SHULKER_SLOTS = 27;
export const SHULKER_ITEM_ID = 'minecraft:shulker_box';

export function isShulker(item: ItemStack): boolean {
  return item.id.toLowerCase().includes('shulker_box');
}

export function isShulkerId(id: string): boolean {
  return id.toLowerCase().includes('shulker_box');
}

/** How full a box is, as one of four honest states. */
export function fillOf(record: Pick<ShulkerRecord, 'usedSlots' | 'freeSlots' | 'opaque'>): ShulkerSlot {
  if (record.opaque) return 'unknown';
  if (record.usedSlots <= 0) return 'empty';
  if (record.freeSlots <= 0) return 'full';
  return 'partial';
}

/** The category that most of a box's contents belong to, or null when nothing matched. */
export function dominantCategory(record: Pick<ShulkerRecord, 'items'>, categories: readonly ItemCategory[]): string | null {
  const counts = new Map<string, number>();
  for (const item of record.items) {
    const result = classify(item, categories);
    if (result.categoryId) counts.set(result.categoryId, (counts.get(result.categoryId) ?? 0) + item.count);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function isMixed(record: Pick<ShulkerRecord, 'items'>, categories: readonly ItemCategory[], threshold = 2): boolean {
  const present = new Set<string>();
  for (const item of record.items) {
    const result = classify(item, categories);
    present.add(result.categoryId ?? 'unsorted');
  }
  return present.size >= threshold;
}

export function classifyShulkers(
  records: readonly ShulkerRecord[],
  categories: readonly ItemCategory[],
): ShulkerRecord[] {
  return records.map((record) => ({
    ...record,
    dominantCategory: dominantCategory(record, categories) ?? undefined,
    mixed: isMixed(record, categories),
  }));
}

export interface UnpackAssessment {
  slot: number;
  fill: ShulkerSlot;
  safe: boolean;
  reason: string;
  /** Items that would land in the player's inventory. */
  itemCount: number;
}

/**
 * Whether a box can be safely unpacked.
 *
 * An opaque box is refused: unpacking something you cannot see is exactly the "blind transfer" the
 * reliability rules forbid. A box whose contents would not fit is also refused.
 */
export function assessUnpack(record: ShulkerRecord, playerFreeSlots: number): UnpackAssessment {
  const fill = fillOf(record);
  if (record.opaque) {
    return { slot: record.slot, fill, safe: false, reason: 'contents could not be read; refusing a blind unpack', itemCount: 0 };
  }
  if (fill === 'empty') {
    return { slot: record.slot, fill, safe: true, reason: 'already empty', itemCount: 0 };
  }
  const stacks = record.items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.count / 64)), 0);
  if (stacks > playerFreeSlots) {
    return {
      slot: record.slot,
      fill,
      safe: false,
      reason: `contents need ${stacks} slot(s) but only ${playerFreeSlots} are free`,
      itemCount: record.items.reduce((sum, item) => sum + item.count, 0),
    };
  }
  return {
    slot: record.slot,
    fill,
    safe: true,
    reason: 'contents fit in the inventory',
    itemCount: record.items.reduce((sum, item) => sum + item.count, 0),
  };
}

export interface RemovalAssessment {
  slot: number;
  safe: boolean;
  reason: string;
  /** True when the box held something valuable or unidentified. */
  protected: boolean;
}

/**
 * Whether an empty box may be disposed of.
 *
 * Disposal requires three things at once: the box is empty, it is not opaque, and its contents were
 * never identified as valuable. Anything else is protected.
 */
export function assessRemoval(record: ShulkerRecord): RemovalAssessment {
  if (record.opaque) {
    return { slot: record.slot, safe: false, reason: 'contents unknown; a box that cannot be read is never disposed of', protected: true };
  }
  const fill = fillOf(record);
  if (fill !== 'empty') {
    return { slot: record.slot, safe: false, reason: `box is ${fill}; only an explicitly approved empty box may be removed`, protected: true };
  }
  return { slot: record.slot, safe: true, reason: 'box is empty', protected: false };
}

export function emptyShulkers(records: readonly ShulkerRecord[]): ShulkerRecord[] {
  return records.filter((record) => !record.opaque && fillOf(record) === 'empty');
}

export function mixedShulkers(records: readonly ShulkerRecord[], categories: readonly ItemCategory[]): ShulkerRecord[] {
  return records.filter((record) => !record.opaque && isMixed(record, categories));
}

/**
 * The number of empty boxes beyond the reserve the worker wants to keep.
 *
 * Opaque boxes are never counted as surplus — the worker cannot know they are empty.
 */
export function surplusEmptyShulkers(records: readonly ShulkerRecord[], reserve: number): ShulkerRecord[] {
  const empty = emptyShulkers(records);
  return empty.slice(Math.max(0, reserve));
}

export interface ShulkerSuggestion {
  kind: 'consolidate' | 'unpack' | 'reserve' | 'inspect';
  slot: number;
  reason: string;
}

/** Suggests organisation work, in priority order: inspect, then unpack, then consolidate. */
export function suggestOrganisation(
  records: readonly ShulkerRecord[],
  categories: readonly ItemCategory[],
  reserve: number,
  playerFreeSlots: number,
): ShulkerSuggestion[] {
  const suggestions: ShulkerSuggestion[] = [];

  for (const record of records) {
    if (record.opaque) suggestions.push({ kind: 'inspect', slot: record.slot, reason: 'contents could not be read' });
  }
  for (const record of records) {
    if (!record.opaque && isMixed(record, categories) && fillOf(record) !== 'empty') {
      suggestions.push({ kind: 'consolidate', slot: record.slot, reason: 'box holds more than one category' });
    }
  }
  for (const record of records) {
    const assessment = assessUnpack(record, playerFreeSlots);
    if (assessment.safe && fillOf(record) === 'partial') {
      suggestions.push({ kind: 'unpack', slot: record.slot, reason: 'partial box can be emptied into the inventory' });
    }
  }
  for (const record of surplusEmptyShulkers(records, reserve)) {
    suggestions.push({ kind: 'reserve', slot: record.slot, reason: 'empty box beyond the configured reserve' });
  }

  return suggestions;
}

/** Items that belong in a box for a given category, best-first. */
export function packableFor(
  categoryId: string,
  items: readonly ItemStack[],
  categories: readonly ItemCategory[],
): ItemStack[] {
  return items
    .filter((item) => classify(item, categories).categoryId === categoryId)
    .sort((a, b) => b.count - a.count);
}

export function capacityOf(records: readonly ShulkerRecord[]): { used: number; free: number; opaque: number } {
  let used = 0;
  let free = 0;
  let opaque = 0;
  for (const record of records) {
    if (record.opaque) {
      opaque += 1;
      continue;
    }
    used += record.usedSlots;
    free += record.freeSlots;
  }
  return { used, free, opaque };
}

export function groupByContent(
  records: readonly ShulkerRecord[],
  categories: readonly ItemCategory[],
): Map<string, ShulkerRecord[]> {
  const groups = new Map<string, ShulkerRecord[]>();
  for (const record of records) {
    const key = record.opaque ? 'unknown' : dominantCategory(record, categories) ?? 'unsorted';
    const bucket = groups.get(key) ?? [];
    bucket.push(record);
    groups.set(key, bucket);
  }
  return groups;
}

export function distinctContents(record: ShulkerRecord): number {
  return new Set(record.items.map(identityKey)).size;
}
