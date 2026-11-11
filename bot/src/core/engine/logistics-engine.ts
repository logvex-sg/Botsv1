/**
 * Logistics: moving items between registered containers.
 *
 * A route has two endpoints and a direction. Planning a transfer produces explicit steps; a step
 * whose endpoint is unreachable or reserved is refused with a reason rather than attempted.
 */

import type { ContainerRecord, ItemStack, Vec3 } from '../types';

export interface LogisticsRoute {
  id: string;
  fromContainerId: string;
  toContainerId: string;
  query: string;
  /** How many items to move per run. */
  batchSize: number;
  enabled: boolean;
}

export interface TransferStep {
  index: number;
  containerId: string;
  label: string;
  direction: 'withdraw' | 'deposit';
  query: string;
  amount: number;
  position: Vec3;
}

export interface TransferRefusal {
  reason: string;
  containerId?: string;
}

export interface TransferPlan {
  routeId: string;
  steps: TransferStep[];
  /** Amount that can be moved now. */
  movable: number;
  refusals: TransferRefusal[];
  reason: string;
}

export interface RouteContext {
  containerById: (id: string) => ContainerRecord | undefined;
  contentsOf: (id: string) => readonly ItemStack[] | undefined;
  freeSlotsOf: (id: string) => number;
  reserved: ReadonlySet<string>;
  /** Whether the worker may use a protected container. */
  allowProtected: boolean;
}

/**
 * Plans a route run.
 *
 * Refuses when an endpoint is missing, reserved, protected (unless allowed), or when the source
 * does not hold the item. It never plans a transfer out of a container whose contents it has not
 * read.
 */
export function planRoute(route: LogisticsRoute, context: RouteContext): TransferPlan {
  const refusals: TransferRefusal[] = [];
  const from = context.containerById(route.fromContainerId);
  const to = context.containerById(route.toContainerId);

  if (!from) refusals.push({ reason: `source container ${route.fromContainerId} is not registered`, containerId: route.fromContainerId });
  if (!to) refusals.push({ reason: `destination container ${route.toContainerId} is not registered`, containerId: route.toContainerId });
  if (!route.enabled) refusals.push({ reason: 'route is disabled', containerId: route.id });
  if (from && context.reserved.has(from.id)) refusals.push({ reason: 'source is reserved by another operation', containerId: from.id });
  if (to && context.reserved.has(to.id)) refusals.push({ reason: 'destination is reserved by another operation', containerId: to.id });
  if (from && from.protected && !context.allowProtected) {
    refusals.push({ reason: 'source is protected', containerId: from.id });
  }
  if (to && to.protected && !context.allowProtected) {
    refusals.push({ reason: 'destination is protected', containerId: to.id });
  }

  if (refusals.length > 0 || !from || !to) {
    return { routeId: route.id, steps: [], movable: 0, refusals, reason: refusals[0]?.reason ?? 'route cannot be planned' };
  }

  const contents = context.contentsOf(from.id);
  if (!contents) {
    return {
      routeId: route.id,
      steps: [],
      movable: 0,
      refusals: [{ reason: 'source contents have not been read', containerId: from.id }],
      reason: 'source contents have not been read',
    };
  }

  let available = 0;
  for (const item of contents) {
    if (item.id.toLowerCase().includes(route.query.toLowerCase())) available += item.count;
  }

  if (available <= 0) {
    return {
      routeId: route.id,
      steps: [],
      movable: 0,
      refusals: [{ reason: `source holds no "${route.query}"`, containerId: from.id }],
      reason: `source holds no "${route.query}"`,
    };
  }

  const free = context.freeSlotsOf(to.id);
  const capacityItems = free * 64;
  const amount = Math.min(available, route.batchSize, capacityItems);

  if (amount <= 0) {
    return {
      routeId: route.id,
      steps: [],
      movable: 0,
      refusals: [{ reason: 'destination has no free space', containerId: to.id }],
      reason: 'destination has no free space',
    };
  }

  return {
    routeId: route.id,
    steps: [
      {
        index: 0,
        containerId: from.id,
        label: from.label,
        direction: 'withdraw',
        query: route.query,
        amount,
        position: from.position,
      },
      {
        index: 1,
        containerId: to.id,
        label: to.label,
        direction: 'deposit',
        query: route.query,
        amount,
        position: to.position,
      },
    ],
    movable: amount,
    refusals: [],
    reason: `move ${amount}x ${route.query} from ${from.label} to ${to.label}`,
  };
}

export function reservationConflict(reserved: ReadonlySet<string>, containerIds: readonly string[]): string | null {
  for (const id of containerIds) if (reserved.has(id)) return id;
  return null;
}

export function routeEndpoints(route: LogisticsRoute): [string, string] {
  return [route.fromContainerId, route.toContainerId];
}

/** Routes that reference a container that is no longer registered. */
export function danglingRoutes(routes: readonly LogisticsRoute[], known: ReadonlySet<string>): LogisticsRoute[] {
  return routes.filter((route) => !known.has(route.fromContainerId) || !known.has(route.toContainerId));
}

export type ContainerRole = 'source' | 'destination' | 'both' | 'isolated';

export function containerRole(containerId: string, routes: readonly LogisticsRoute[]): ContainerRole {
  let isSource = false;
  let isDestination = false;
  for (const route of routes) {
    if (route.fromContainerId === containerId) isSource = true;
    if (route.toContainerId === containerId) isDestination = true;
  }
  if (isSource && isDestination) return 'both';
  if (isSource) return 'source';
  if (isDestination) return 'destination';
  return 'isolated';
}

export interface NetworkSummary {
  containerCount: number;
  routeCount: number;
  enabledRoutes: number;
  dangling: number;
  roles: Record<ContainerRole, number>;
}

export function networkSummary(routes: readonly LogisticsRoute[], containerIds: readonly string[]): NetworkSummary {
  const known = new Set(containerIds);
  const roles: Record<ContainerRole, number> = { source: 0, destination: 0, both: 0, isolated: 0 };
  for (const id of containerIds) roles[containerRole(id, routes)] += 1;
  return {
    containerCount: containerIds.length,
    routeCount: routes.length,
    enabledRoutes: routes.filter((route) => route.enabled).length,
    dangling: danglingRoutes(routes, known).length,
    roles,
  };
}
