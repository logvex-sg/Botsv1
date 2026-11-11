/**
 * Storage engine: choosing where an item goes, and what to do when nowhere can take it.
 *
 * The chooser is metadata-aware end to end. It builds one classifier from the categories and runs
 * every stack through it; it never falls back to "same id, close enough".
 */

import { classify, identityKey } from './item-classifier';
import { aggregate, freeSlots } from './inventory-engine';
import type { ContainerRecord, ItemCategory, ItemStack, StorageNetwork } from '../types';

export interface DestinationChoice {
  containerId: string | null;
  categoryId: string | null;
  reason: string;
  /** Containers that were considered but rejected, with why. */
  rejected: Array<{ containerId: string; reason: string }>;
}

export interface ChooseOptions {
  /** Container ids that are reserved by another operation and must be skipped. */
  reserved?: ReadonlySet<string>;
  /** Remaining capacity per container, keyed by container id. */
  capacity?: ReadonlyMap<string, number>;
}

function acceptsCategory(container: ContainerRecord, categoryId: string | null): boolean {
  if (container.categories.length === 0) return true;
  if (categoryId === null) return false;
  return container.categories.includes(categoryId);
}

/**
 * Chooses the best container for an item.
 *
 * Order of preference: a container that explicitly lists the item's category, then an unrestricted
 * container. A protected container is only used when nothing else will take the item, and never
 * when `options.reserved` marks it busy.
 */
export function chooseDestination(
  item: ItemStack,
  containers: readonly ContainerRecord[],
  categories: readonly ItemCategory[],
  options: ChooseOptions = {},
): DestinationChoice {
  const classification = classify(item, categories);
  const categoryId = classification.categoryId;
  const rejected: Array<{ containerId: string; reason: string }> = [];

  const available: ContainerRecord[] = [];
  for (const container of containers) {
    if (options.reserved?.has(container.id)) {
      rejected.push({ containerId: container.id, reason: 'reserved by another operation' });
      continue;
    }
    const capacity = options.capacity?.get(container.id);
    if (typeof capacity === 'number' && capacity <= 0) {
      rejected.push({ containerId: container.id, reason: 'no free space' });
      continue;
    }
    if (!acceptsCategory(container, categoryId)) {
      rejected.push({ containerId: container.id, reason: 'category not accepted here' });
      continue;
    }
    available.push(container);
  }

  if (available.length === 0) {
    return {
      containerId: null,
      categoryId,
      reason: categoryId
        ? `no container accepts category "${categoryId}"`
        : 'item matched no category and no container is unrestricted',
      rejected,
    };
  }

  const listed = available.filter((container) => categoryId !== null && container.categories.includes(categoryId));
  const pool = listed.length > 0 ? listed : available.filter((container) => !container.protected);
  const finalPool = pool.length > 0 ? pool : available;

  // Prefer the roomiest container so consolidation happens naturally.
  finalPool.sort((a, b) => {
    const capacityA = options.capacity?.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const capacityB = options.capacity?.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (capacityA !== capacityB) return capacityB - capacityA;
    return a.id.localeCompare(b.id);
  });

  const chosen = finalPool[0]!;
  return {
    containerId: chosen.id,
    categoryId,
    reason: listed.length > 0
      ? `container lists category "${categoryId}"`
      : `container "${chosen.label}" is unrestricted`,
    rejected,
  };
}

export interface OverflowDecision {
  /** Items that fit, with the container they should go to. */
  placements: Array<{ containerId: string; item: ItemStack }>;
  /** Items that could not be placed. */
  overflow: ItemStack[];
  reason: string;
}

/**
 * Plans placement for a whole inventory, respecting capacity.
 *
 * Overflow is reported, never silently dropped, so the caller can choose to hold it, reserve it, or
 * tell the operator.
 */
export function planPlacement(
  items: readonly ItemStack[],
  containers: readonly ContainerRecord[],
  categories: readonly ItemCategory[],
  capacity: ReadonlyMap<string, number>,
  options: ChooseOptions = {},
): OverflowDecision {
  const remaining = new Map(capacity);
  const placements: Array<{ containerId: string; item: ItemStack }> = [];
  const overflow: ItemStack[] = [];

  for (const item of items) {
    const choice = chooseDestination(item, containers, categories, {
      ...options,
      capacity: remaining,
    });
    if (!choice.containerId) {
      overflow.push(item);
      continue;
    }
    const free = remaining.get(choice.containerId) ?? Number.MAX_SAFE_INTEGER;
    if (free <= 0) {
      overflow.push(item);
      continue;
    }
    const stacksNeeded = Math.ceil(item.count / 64);
    const take = Math.min(stacksNeeded, free);
    const placedCount = Math.min(item.count, take * 64);
    placements.push({ containerId: choice.containerId, item: { ...item, count: placedCount } });
    remaining.set(choice.containerId, free - take);
    if (placedCount < item.count) overflow.push({ ...item, count: item.count - placedCount });
  }

  return {
    placements,
    overflow,
    reason: overflow.length === 0 ? 'all items placed' : `${overflow.length} stack(s) did not fit`,
  };
}

export interface ConsolidationGroup {
  key: string;
  id: string;
  total: number;
  locations: Array<{ containerId: string; count: number }>;
  /** Stacks that would be freed by merging. */
  recoverableSlots: number;
}

/**
 * Finds identical stacks scattered across containers that could be merged.
 *
 * Only truly identical stacks (same identity key) are grouped — this is the metadata-aware part of
 * "stack consolidation".
 */
export function consolidationGroups(
  contents: ReadonlyMap<string, readonly ItemStack[]>,
): ConsolidationGroup[] {
  const groups = new Map<string, ConsolidationGroup>();

  for (const [containerId, items] of contents) {
    for (const item of aggregate(items)) {
      const group = groups.get(item.key) ?? {
        key: item.key,
        id: item.id,
        total: 0,
        locations: [],
        recoverableSlots: 0,
      };
      group.total += item.count;
      group.locations.push({ containerId, count: item.count });
      groups.set(item.key, group);
    }
  }

  for (const group of groups.values()) {
    const spread = group.locations.length;
    const ideal = Math.ceil(group.total / 64);
    const actual = group.locations.reduce((sum, location) => sum + Math.ceil(location.count / 64), 0);
    group.recoverableSlots = Math.max(0, actual - ideal);
    if (spread < 2) group.recoverableSlots = 0;
  }

  return [...groups.values()]
    .filter((group) => group.locations.length > 1 && group.recoverableSlots > 0)
    .sort((a, b) => b.recoverableSlots - a.recoverableSlots);
}

export interface Bottleneck {
  containerId: string;
  label: string;
  freeSlots: number;
  totalSlots: number;
  fillPercent: number;
  severity: 'ok' | 'tight' | 'full';
}

export function bottlenecks(containers: readonly ContainerRecord[], capacity: ReadonlyMap<string, number>): Bottleneck[] {
  const result: Bottleneck[] = [];
  for (const container of containers) {
    const total = container.lastCapacity ?? 27;
    const free = capacity.get(container.id) ?? total;
    const fillPercent = total > 0 ? ((total - free) / total) * 100 : 0;
    const severity: Bottleneck['severity'] = free <= 0 ? 'full' : fillPercent >= 85 ? 'tight' : 'ok';
    result.push({ containerId: container.id, label: container.label, freeSlots: free, totalSlots: total, fillPercent, severity });
  }
  return result.sort((a, b) => a.freeSlots - b.freeSlots);
}

export function unsortableItems(items: readonly ItemStack[], categories: readonly ItemCategory[]): ItemStack[] {
  return items.filter((item) => classify(item, categories).categoryId === null);
}

export interface NetworkReport {
  networkId: string;
  containerCount: number;
  totalCapacity: number;
  freeCapacity: number;
  fillPercent: number;
  bottlenecks: Bottleneck[];
  consolidations: ConsolidationGroup[];
}

export function reportNetwork(
  network: StorageNetwork,
  containers: readonly ContainerRecord[],
  capacity: ReadonlyMap<string, number>,
  contents: ReadonlyMap<string, readonly ItemStack[]>,
): NetworkReport {
  const members = containers.filter((container) => network.containers.includes(container.id));
  const totalCapacity = members.reduce((sum, container) => sum + (container.lastCapacity ?? 27), 0);
  const freeCapacity = members.reduce((sum, container) => sum + (capacity.get(container.id) ?? 0), 0);
  return {
    networkId: network.id,
    containerCount: members.length,
    totalCapacity,
    freeCapacity,
    fillPercent: totalCapacity > 0 ? ((totalCapacity - freeCapacity) / totalCapacity) * 100 : 0,
    bottlenecks: bottlenecks(members, capacity),
    consolidations: consolidationGroups(contents),
  };
}

/** Free slots for a container given what was last read from it. */
export function containerFreeSlots(contents: readonly ItemStack[], totalSlots: number): number {
  return freeSlots(contents, totalSlots);
}

export function isProtected(container: ContainerRecord): boolean {
  return container.protected;
}

export function identityKeys(items: readonly ItemStack[]): string[] {
  return items.map(identityKey);
}
