/**
 * Logistics engine: routing items between containers.
 *
 * A route says "items matching `query` go from a source container to a destination container, with
 * a priority and a fallback". This engine plans a transfer and verifies it. It never moves anything
 * itself: it produces {@link TransferStep}s that the storage service turns into worker tasks and
 * confirms against the worker's own report.
 *
 * Pure: unit-testable.
 */
import type { StorageContainer, StorageNetwork } from '../../../shared/types';
import { matchesQuery } from '../inventory-engine';
import { canAccept, categoryFor, isFull } from '../storage-engine';
import type { StorageCategory } from '../../../shared/types';

/** One configured route: where a class of item should end up. */
export interface LogisticsRoute {
  id: string;
  name: string;
  /** The item query this route carries. */
  query: string;
  /** Source container ids; empty means "any container in the network". */
  sourceContainerIds: string[];
  /** The preferred destination container id. */
  destinationContainerId: string;
  /** Ordered fallbacks when the preferred destination is full. */
  fallbackContainerIds: string[];
  priority: number;
  enabled: boolean;
}

/** A single planned transfer. */
export interface TransferStep {
  routeId: string | null;
  query: string;
  fromContainerId: string;
  toContainerId: string;
  workerId: string;
  /** How many items the step would move. */
  count: number;
  /** A human-readable line. */
  detail: string;
}

/** Why a transfer could not be planned. */
export interface TransferRefusal {
  query: string;
  fromContainerId: string | null;
  reason: string;
}

export interface TransferPlan {
  steps: TransferStep[];
  refusals: TransferRefusal[];
}

/**
 * Plans the transfers a route implies.
 *
 * The count moved is bounded by what the source actually holds and by the destination's free slot
 * capacity (one stack per free slot, using 64 as the stack size). A route whose destination and all
 * fallbacks are full yields a refusal rather than a step, so the UI can show the bottleneck.
 */
export function planRoute(
  route: LogisticsRoute,
  containers: readonly StorageContainer[],
  categories: readonly StorageCategory[],
): TransferPlan {
  const steps: TransferStep[] = [];
  const refusals: TransferRefusal[] = [];
  if (!route.enabled) return { steps, refusals };

  const byId = new Map(containers.map((container) => [container.id, container]));
  const sources = route.sourceContainerIds.length > 0
    ? route.sourceContainerIds.map((id) => byId.get(id)).filter((c): c is StorageContainer => Boolean(c))
    : containers;

  // The destination chain: preferred first, then fallbacks that still accept the item.
  const destinationIds = [route.destinationContainerId, ...route.fallbackContainerIds];
  const destinations = destinationIds
    .map((id) => byId.get(id))
    .filter((c): c is StorageContainer => Boolean(c) && !c!.locked);

  for (const source of sources) {
    if (source.locked) continue;
    if (destinationIds.includes(source.id)) continue;
    const matching = source.items.filter((item) => item.count > 0 && matchesQuery(item, route.query));
    if (matching.length === 0) continue;
    const total = matching.reduce((sum, item) => sum + item.count, 0);

    // Choose the first destination with room, preferring a category match.
    let chosen: StorageContainer | null = null;
    for (const destination of destinations) {
      if (destination.id === source.id) continue;
      const category = matching[0] ? categoryFor(matching[0], categories) : null;
      if (canAccept(destination, category?.id ?? null)) { chosen = destination; break; }
    }
    if (!chosen) {
      refusals.push({
        query: route.query,
        fromContainerId: source.id,
        reason: `every destination for this route is full or locked`,
      });
      continue;
    }
    const capacity = (chosen.freeSlots ?? 0) * 64;
    const count = Math.max(0, Math.min(total, capacity));
    if (count <= 0) {
      refusals.push({ query: route.query, fromContainerId: source.id, reason: 'destination has no free capacity' });
      continue;
    }
    steps.push({
      routeId: route.id,
      query: route.query,
      fromContainerId: source.id,
      toContainerId: chosen.id,
      workerId: source.workerId,
      count,
      detail: `move ${count}x ${route.query} from ${source.label || source.id} to ${chosen.label || chosen.id}`,
    });
  }
  return { steps, refusals };
}

/**
 * Whether a transfer may proceed without a container reservation conflict.
 *
 * Two workers must never modify the same container at once. This checks a proposed step against the
 * reservations already held; the storage service calls it before dispatching so a conflicting step
 * is refused rather than corrupting an inventory.
 */
export function reservationConflict(
  step: { fromContainerId: string; toContainerId: string },
  reservations: readonly { containerId: string; workerId: string }[],
): boolean {
  const held = new Set(reservations.map((reservation) => reservation.containerId));
  return held.has(step.fromContainerId) || held.has(step.toContainerId);
}

/** The set of containers a network's routes read from or write to, for the map view. */
export function routeEndpoints(routes: readonly LogisticsRoute[]): Set<string> {
  const ids = new Set<string>();
  for (const route of routes) {
    ids.add(route.destinationContainerId);
    for (const id of route.fallbackContainerIds) ids.add(id);
    for (const id of route.sourceContainerIds) ids.add(id);
  }
  return ids;
}

/** A network's routes that read from containers no longer in the network, for a validation list. */
export function danglingRoutes(
  routes: readonly LogisticsRoute[],
  containers: readonly StorageContainer[],
): { routeId: string; missing: string[] }[] {
  const known = new Set(containers.map((container) => container.id));
  const out: { routeId: string; missing: string[] }[] = [];
  for (const route of routes) {
    const missing = [
      route.destinationContainerId,
      ...route.fallbackContainerIds,
      ...route.sourceContainerIds,
    ].filter((id) => id && !known.has(id));
    if (missing.length > 0) out.push({ routeId: route.id, missing });
  }
  return out;
}

/** A container's role in a network, derived from the routes that reference it. */
export function containerRole(
  containerId: string,
  routes: readonly LogisticsRoute[],
): 'source' | 'destination' | 'both' | 'unused' {
  let source = false;
  let destination = false;
  for (const route of routes) {
    if (route.sourceContainerIds.includes(containerId) || (route.sourceContainerIds.length === 0 && route.enabled)) source = true;
    if (route.destinationContainerId === containerId || route.fallbackContainerIds.includes(containerId)) destination = true;
  }
  if (source && destination) return 'both';
  if (source) return 'source';
  if (destination) return 'destination';
  return 'unused';
}

/** A rough "is this network healthy" line, for the dashboard. */
export function networkSummary(network: StorageNetwork, containers: readonly StorageContainer[]): string {
  const full = containers.filter(isFull).length;
  return `${containers.length} container(s), ${full} full`;
}
