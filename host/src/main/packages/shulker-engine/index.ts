/**
 * Shulker engine: identifying, classifying and planning shulker-box operations.
 *
 * A shulker box is a container item whose contents the Host only knows once a worker has read them.
 * This engine is pure: it classifies a *reported* shulker (empty, partial, full, mixed) and plans
 * unpacking, organisation and removal. The safety rules are enforced here, in one place, so no
 * caller can accidentally destroy a filled shulker or discard unknown contents.
 *
 * Pure: unit-testable.
 */
import type { ShulkerRecord, StorageCategory, StorageContainer } from '../../../shared/types';
import { categoryFor, isFull } from '../storage-engine';

/** How full a shulker is, from its reported contents. */
export type ShulkerFill = 'empty' | 'partial' | 'full';

/** The 27 slots a normal shulker box provides. */
export const SHULKER_SLOTS = 27;

/** Classifies a shulker by its reported item count. */
export function fillOf(shulker: ShulkerRecord): ShulkerFill {
  if (shulker.itemCount <= 0) return 'empty';
  const free = shulker.freeSlots ?? Math.max(0, SHULKER_SLOTS - shulker.items.length);
  return free <= 0 ? 'full' : 'partial';
}

/** The dominant category of a shulker's contents, or null when it holds nothing recognisable. */
export function dominantCategory(
  shulker: ShulkerRecord,
  categories: readonly StorageCategory[],
): StorageCategory | null {
  const tally = new Map<string, { category: StorageCategory; count: number }>();
  for (const item of shulker.items) {
    const category = categoryFor(item, categories);
    if (!category) continue;
    const existing = tally.get(category.id);
    if (existing) existing.count += item.count;
    else tally.set(category.id, { category, count: item.count });
  }
  let best: { category: StorageCategory; count: number } | null = null;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.category ?? null;
}

/** Whether a shulker holds items from more than one category. */
export function isMixed(shulker: ShulkerRecord, categories: readonly StorageCategory[]): boolean {
  const seen = new Set<string>();
  for (const item of shulker.items) {
    const category = categoryFor(item, categories);
    if (category) seen.add(category.id);
    else seen.add('__unsorted__');
  }
  return seen.size > 1;
}

/** Recomputes the derived fields of a shulker from its reported contents and category set. */
export function classify(shulker: ShulkerRecord, categories: readonly StorageCategory[]): ShulkerRecord {
  const itemCount = shulker.items.reduce((sum, item) => sum + item.count, 0);
  const freeSlots = Math.max(0, SHULKER_SLOTS - shulker.items.filter((item) => item.count > 0).length);
  const empty = itemCount <= 0;
  const mixed = !empty && isMixed(shulker, categories);
  const dominant = empty ? null : dominantCategory(shulker, categories);
  return {
    ...shulker,
    itemCount,
    freeSlots,
    empty,
    mixed,
    categoryId: mixed ? null : dominant?.id ?? null,
  };
}

/** Why a shulker may not be unpacked automatically. */
export interface UnpackAssessment {
  shulkerId: string;
  /** True when the contents are fully known and every item has a destination. */
  unpackable: boolean;
  /** True when the shulker is empty and needs no unpacking. */
  empty: boolean;
  /** Total items to move. */
  itemCount: number;
  /** Reasons it cannot be unpacked (empty list when it can). */
  reasons: string[];
}

/**
 * Assesses whether a shulker can be unpacked.
 *
 * Unpacking requires the contents to be known (a shulker whose contents were never read must not be
 * touched) and every item to have a destination. Protected items are still allowed to move between
 * containers; they are only refused disposal, not relocation.
 */
export function assessUnpack(
  shulker: ShulkerRecord,
  categories: readonly StorageCategory[],
  containers: readonly StorageContainer[],
): UnpackAssessment {
  const reasons: string[] = [];
  const empty = shulker.itemCount <= 0;
  if (empty) return { shulkerId: shulker.id, unpackable: false, empty: true, itemCount: 0, reasons: ['shulker is already empty'] };
  if (shulker.inspectedAt <= 0) reasons.push('contents have never been read');
  const blocked: string[] = [];
  for (const item of shulker.items) {
    const category = categoryFor(item, categories);
    const destination = containers.find((container) => {
      if (container.locked || isFull(container)) return false;
      if (container.workerId !== shulker.workerId) return false;
      if (container.categoryId === null) return true;
      return container.categoryId === category?.id;
    });
    if (!destination) blocked.push(item.name || item.id);
  }
  if (blocked.length > 0) reasons.push(`no destination for ${[...new Set(blocked)].join(', ')}`);
  return {
    shulkerId: shulker.id,
    unpackable: reasons.length === 0,
    empty: false,
    itemCount: shulker.itemCount,
    reasons,
  };
}

/** Why a shulker may not be removed (destroyed) automatically. */
export interface RemovalAssessment {
  shulkerId: string;
  /** True when the shulker is safe to remove under the current rules. */
  removable: boolean;
  /** Reasons removal is refused. */
  reasons: string[];
  /** True when the shulker holds items and must be unpacked first. */
  needsUnpack: boolean;
}

/**
 * Assesses whether an empty shulker may be removed.
 *
 * The safety rules are absolute and checked here, so a caller cannot bypass them:
 *  - a filled shulker is never removable — it must be unpacked first;
 *  - a shulker with unknown contents is never removable;
 *  - a reserved shulker is never removable;
 *  - a shulker on a protected-item list is never removable.
 */
export function assessRemoval(
  shulker: ShulkerRecord,
  options: { allowDestruction: boolean; reserved?: boolean; protected?: boolean },
): RemovalAssessment {
  const reasons: string[] = [];
  const empty = shulker.itemCount <= 0;
  if (!empty) reasons.push('shulker still holds items; unpack it first');
  if (shulker.inspectedAt <= 0) reasons.push('contents are unknown; never remove an unverified shulker');
  if (options.reserved) reasons.push('shulker is a reserved empty-shulker supply');
  if (options.protected) reasons.push('shulker is on the protected-item list');
  if (!options.allowDestruction) reasons.push('destruction is not enabled for this network');
  return {
    shulkerId: shulker.id,
    removable: reasons.length === 0,
    reasons,
    needsUnpack: !empty,
  };
}

/** Shulkers that hold nothing and could be pooled as an empty-shulker reserve. */
export function emptyShulkers(shulkers: readonly ShulkerRecord[]): ShulkerRecord[] {
  return shulkers.filter((shulker) => shulker.itemCount <= 0);
}

/** Shulkers whose contents span more than one category, for the "needs reorganising" list. */
export function mixedShulkers(shulkers: readonly ShulkerRecord[]): ShulkerRecord[] {
  return shulkers.filter((shulker) => shulker.mixed);
}

/** Duplicate empty shulkers beyond the reserve the operator wants to keep. */
export function surplusEmptyShulkers(shulkers: readonly ShulkerRecord[], keep: number): ShulkerRecord[] {
  const empties = emptyShulkers(shulkers).sort((a, b) => a.createdAt - b.createdAt);
  return empties.slice(Math.max(0, keep));
}

/** A suggested organisation: which shulker should hold which category. */
export interface ShulkerSuggestion {
  shulkerId: string;
  label: string;
  suggestion: string;
  categoryId: string | null;
}

/** Produces human-readable organisation suggestions for a set of shulkers. */
export function suggestOrganisation(
  shulkers: readonly ShulkerRecord[],
  categories: readonly StorageCategory[],
): ShulkerSuggestion[] {
  const suggestions: ShulkerSuggestion[] = [];
  for (const shulker of shulkers) {
    if (shulker.empty) {
      suggestions.push({
        shulkerId: shulker.id,
        label: shulker.label || shulker.id,
        suggestion: 'empty — keep as reserve or assign to a category',
        categoryId: null,
      });
      continue;
    }
    if (shulker.mixed) {
      suggestions.push({
        shulkerId: shulker.id,
        label: shulker.label || shulker.id,
        suggestion: 'mixed contents — split into single-category shulkers',
        categoryId: null,
      });
      continue;
    }
    const category = categories.find((c) => c.id === shulker.categoryId);
    suggestions.push({
      shulkerId: shulker.id,
      label: shulker.label || shulker.id,
      suggestion: category ? `already organised as ${category.name}` : 'organised, category unknown',
      categoryId: shulker.categoryId,
    });
  }
  return suggestions;
}
