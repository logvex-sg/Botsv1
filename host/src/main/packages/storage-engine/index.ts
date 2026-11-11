/**
 * Storage engine: categorisation, sorting, consolidation and container-health analysis.
 *
 * This is the pure brain of the storage subsystem. It is a set of functions over *already-reported*
 * container rows: it never talks to a worker and never invents inventory. Every decision it makes —
 * which category an item belongs to, where an item should go, which containers are full, which
 * items are unsortable — is derived from the reported state, so the Host's plan and the worker's
 * action agree.
 *
 * Pure: unit-testable.
 */
import type {
  ClassifierRule,
  ContainerKind,
  StorageBottleneck,
  StorageCategory,
  StorageContainer,
  StorageNetwork,
} from '../../../shared/types';
import type { WorkerItem } from '../../../shared/workers';
import { matchesQuery } from '../inventory-engine';
import { ItemClassifier, classify, type ClassifierCategory } from '../item-classifier';

/** The 27 slots a normal shulker box provides. */
export const SHULKER_SLOTS = 27;

/**
 * The rules a storage category matches by: its own rules when it has any, else its substrings.
 *
 * This is what lets the two category systems be one. A category the operator authored with rules is
 * interpreted as rules; a plain substring category is interpreted as `id-contains` rules. Either way
 * it goes through the same classifier, so a rule-driven category can tell two similar items apart
 * and a substring category keeps working exactly as before.
 */
export function rulesFor(category: StorageCategory): ClassifierRule[] {
  if (category.rules && category.rules.length > 0) return category.rules;
  return category.itemMatches
    .filter((match) => match.length > 0)
    .map((contains) => ({ kind: 'id-contains' as const, contains }));
}

/**
 * Projects storage categories onto classifier categories.
 *
 * This is the single bridge between "what the operator configured" and "what the classifier reads",
 * so routing is classification, not a parallel substring match that could disagree with it.
 */
export function categoriesToClassifier(categories: readonly StorageCategory[]): ClassifierCategory[] {
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    priority: category.priority,
    color: category.color,
    exclusive: category.protected,
    rules: rulesFor(category),
  }));
}

/** Builds a classifier over the given categories. Convenience over {@link categoriesToClassifier}. */
export function classifierFor(categories: readonly StorageCategory[]): ItemClassifier {
  return new ItemClassifier(categoriesToClassifier(categories));
}

/**
 * The category an item belongs to, or null when none matches.
 *
 * Classification runs through the real classifier: an item's tags, enchantments, data components and
 * namespace are read when the worker reported them, and a category's own rules decide. A category
 * with no rules is matched by its substrings, so an item whose metadata was never reported still
 * classifies by id, which is the honest fallback rather than a wrong guess.
 */
export function categoryFor(
  item: WorkerItem | { id: string; name: string },
  categories: readonly StorageCategory[],
): StorageCategory | null {
  const match = classify(item as WorkerItem, undefined, categoriesToClassifier(categories));
  if (!match) return null;
  return categories.find((category) => category.id === match.id) ?? null;
}

/** Items in a reported container that match no category. */
export function unsortableItems(
  containers: readonly StorageContainer[],
  categories: readonly StorageCategory[],
): { id: string; name: string; count: number }[] {
  const totals = new Map<string, { id: string; name: string; count: number }>();
  for (const container of containers) {
    for (const item of container.items) {
      if (categoryFor(item, categories)) continue;
      const existing = totals.get(item.id);
      if (existing) existing.count += item.count;
      else totals.set(item.id, { id: item.id, name: item.name, count: item.count });
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** Whether a container is full, from its reported free slots. */
export function isFull(container: StorageContainer): boolean {
  if (container.full) return true;
  return container.freeSlots !== null && container.freeSlots <= 0;
}

/** Whether a container holds nothing at all (a candidate for re-use, not removal). */
export function isEmpty(container: StorageContainer): boolean {
  return container.items.every((item) => item.count <= 0);
}

/**
 * Whether a container can accept an item of `categoryId`.
 *
 * A locked container never accepts anything. A container dedicated to another category does not
 * accept this item; a general container accepts anything.
 */
export function canAccept(container: StorageContainer, categoryId: string | null): boolean {
  if (container.locked) return false;
  if (isFull(container)) return false;
  if (container.categoryId === null) return true;
  return container.categoryId === categoryId;
}

/**
 * Chooses the best destination container for an item, classifying it from its reported metadata.
 *
 * Preference order: a container dedicated to the category the item classifies into, then the
 * least-full general container. Locked, full and wrong-category containers are skipped. A container
 * dedicated to *another* category is never chosen, so a niche item is not filed into a bucket that
 * means something else. Returns null when there is nowhere to put it, which the caller reports rather
 * than silently dropping the item.
 *
 * This is the one routing chooser: it takes an optional classifier and, when none is given, builds
 * one from the categories. Passing a prebuilt classifier lets a plan classify a whole container
 * without rebuilding it per item.
 */
export function chooseDestination(
  item: WorkerItem | { id: string; name: string },
  containers: readonly StorageContainer[],
  categories: readonly StorageCategory[],
  options: { sameWorkerOnly?: string; classifier?: ItemClassifier } = {},
): StorageContainer | null {
  const classifier = options.classifier ?? classifierFor(categories);
  const categoryId = classifier.classify(item as WorkerItem)?.id ?? null;
  const candidates = containers.filter((container) => {
    if (options.sameWorkerOnly && container.workerId !== options.sameWorkerOnly) return false;
    if (container.locked || isFull(container)) return false;
    if (container.categoryId === null) return true;
    return container.categoryId === categoryId;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const aDedicated = a.categoryId !== null && a.categoryId === categoryId ? 1 : 0;
    const bDedicated = b.categoryId !== null && b.categoryId === categoryId ? 1 : 0;
    if (aDedicated !== bDedicated) return bDedicated - aDedicated;
    return (b.freeSlots ?? 0) - (a.freeSlots ?? 0);
  });
  return candidates[0] ?? null;
}

/** Items that appear in more than one container and could be consolidated together. */
export interface ConsolidationGroup {
  query: string;
  itemId: string;
  itemName: string;
  totalCount: number;
  /** Container ids holding this item, largest first. */
  containerIds: string[];
  /** How many items could be freed by merging partial stacks (a rough, reported estimate). */
  movable: number;
}

/**
 * Finds items spread across several containers that could be consolidated.
 *
 * A group is only reported when the item appears in two or more containers: a single container is
 * already as consolidated as the Host can make it.
 */
export function consolidationGroups(
  containers: readonly StorageContainer[],
  options: { stackSize?: number } = {},
): ConsolidationGroup[] {
  const stackSize = options.stackSize ?? 64;
  const byItem = new Map<string, { name: string; per: Map<string, number> }>();
  for (const container of containers) {
    if (container.locked) continue;
    for (const item of container.items) {
      if (item.count <= 0) continue;
      const entry = byItem.get(item.id) ?? { name: item.name, per: new Map<string, number>() };
      entry.per.set(container.id, (entry.per.get(container.id) ?? 0) + item.count);
      byItem.set(item.id, entry);
    }
  }
  const groups: ConsolidationGroup[] = [];
  for (const [itemId, entry] of byItem) {
    if (entry.per.size < 2) continue;
    const totalCount = [...entry.per.values()].reduce((sum, n) => sum + n, 0);
    const containerIds = [...entry.per.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    // Partial stacks left over after filling whole stacks are the consolidatable remainder.
    const remainder = totalCount % stackSize;
    const movable = remainder === 0 ? totalCount : remainder;
    groups.push({ query: itemId, itemId, itemName: entry.name, totalCount, containerIds, movable });
  }
  return groups.sort((a, b) => b.totalCount - a.totalCount || a.itemId.localeCompare(b.itemId));
}

/** Containers that hold nothing and are not permanent: unused capacity the operator could reclaim. */
export function unusedContainers(containers: readonly StorageContainer[]): StorageContainer[] {
  return containers.filter((container) => !container.permanent && isEmpty(container));
}

/**
 * Detects storage problems from reported rows.
 *
 * A container is "missing" when its row exists but the reporting worker has gone away (offline) and
 * the row is stale; "unreachable" when it is on a worker that is not in the network's worker set;
 * "full" when it has no free slots. Nothing here is a live probe: it is a summary of what the last
 * reports said, which the UI labels with the inspection time.
 */
export function bottlenecks(
  network: StorageNetwork,
  containers: readonly StorageContainer[],
  isWorkerOnline: (workerId: string) => boolean,
  now = Date.now(),
): StorageBottleneck[] {
  const out: StorageBottleneck[] = [];
  const staleMs = 5 * 60_000;
  for (const container of containers) {
    if (isFull(container)) {
      out.push({
        containerId: container.id,
        label: container.label,
        workerId: container.workerId,
        kind: container.kind,
        reason: 'full',
        detail: `no free slots reported at last inspection`,
        at: now,
      });
    }
    if (!isWorkerOnline(container.workerId)) {
      out.push({
        containerId: container.id,
        label: container.label,
        workerId: container.workerId,
        kind: container.kind,
        reason: 'unreachable',
        detail: `worker ${container.workerId} is offline`,
        at: now,
      });
    } else if (now - container.inspectedAt > staleMs) {
      out.push({
        containerId: container.id,
        label: container.label,
        workerId: container.workerId,
        kind: container.kind,
        reason: 'missing',
        detail: `last inspected ${Math.round((now - container.inspectedAt) / 1000)}s ago`,
        at: now,
      });
    }
    if (network.workerIds.length > 0 && !network.workerIds.includes(container.workerId)) {
      out.push({
        containerId: container.id,
        label: container.label,
        workerId: container.workerId,
        kind: container.kind,
        reason: 'misplaced',
        detail: `worker ${container.workerId} is not in this network's worker set`,
        at: now,
      });
    }
  }
  return out;
}

/** A one-line health report for a network, computed only from reported container rows. */
export function reportNetwork(
  network: StorageNetwork,
  containers: readonly StorageContainer[],
  categories: readonly StorageCategory[],
  isWorkerOnline: (workerId: string) => boolean,
  now = Date.now(),
): import('../../../shared/types').StorageNetworkReport {
  const totals = new Map<string, { id: string; name: string; count: number }>();
  for (const container of containers) {
    for (const item of container.items) {
      const existing = totals.get(item.id);
      if (existing) existing.count += item.count;
      else totals.set(item.id, { id: item.id, name: item.name, count: item.count });
    }
  }
  const assignedCategories = new Set(containers.map((c) => c.categoryId).filter((id): id is string => Boolean(id)));
  return {
    networkId: network.id,
    name: network.name,
    containers: containers.length,
    workers: new Set(containers.map((c) => c.workerId)).size,
    fullContainers: containers.filter(isFull).length,
    missingContainers: containers.filter((c) => !isWorkerOnline(c.workerId)).length,
    unusedContainers: unusedContainers(containers).length,
    totalItems: [...totals.values()].reduce((sum, item) => sum + item.count, 0),
    distinctItems: totals.size,
    bottlenecks: bottlenecks(network, containers, isWorkerOnline, now),
    unassignedCategories: categories.filter((c) => !assignedCategories.has(c.id)).map((c) => c.name),
    unsortable: unsortableItems(containers, categories),
    generatedAt: now,
  };
}

/** True when automation may act on this network right now (global pause is checked by the caller). */
export function networkAllows(network: StorageNetwork, mode: 'manual' | 'supervised' | 'automatic'): boolean {
  if (network.paused) return false;
  if (mode === 'manual') return network.mode === 'manual';
  if (mode === 'supervised') return network.mode !== 'manual';
  return network.mode === 'automatic';
}

/** Whether a query is on the network's protected-item list. */
export function isProtected(network: StorageNetwork, query: string, item?: { id: string; name: string }): boolean {
  if (network.protectedItems.length === 0) return false;
  if (item) {
    return network.protectedItems.some((needle) => matchesQuery({ id: item.id, name: item.name, count: 0, slot: 0, damage: 0, maxDamage: 0, damageable: false }, needle));
  }
  return network.protectedItems.some((needle) => needle.toLowerCase() === query.toLowerCase());
}

/** The reserved floor for an item, or 0 when it has no reservation. */
export function reservationFor(network: StorageNetwork, item: { id: string; name: string }): number {
  let floor = 0;
  for (const reservation of network.reservations) {
    const probe: WorkerItem = { id: item.id, name: item.name, count: 0, slot: 0, damage: 0, maxDamage: 0, damageable: false };
    if (matchesQuery(probe, reservation.query)) floor = Math.max(floor, reservation.count);
  }
  return floor;
}

/** A short label for a container kind, for the UI. */
export function kindLabel(kind: ContainerKind): string {
  switch (kind) {
    case 'input': return 'Input';
    case 'output': return 'Output';
    case 'intermediate': return 'Intermediate';
    case 'disposal': return 'Disposal';
    case 'shulker_reserve': return 'Shulker reserve';
    default: return 'General';
  }
}
