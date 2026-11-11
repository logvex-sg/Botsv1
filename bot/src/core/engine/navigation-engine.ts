/**
 * Navigation planning.
 *
 * The planner decides whether a destination is worth attempting and how far the worker may roam. It
 * never performs movement — the Mineflayer adapter does that. Keeping the decision pure means the
 * limits, timeouts and "unreachable" classification are all testable without a server.
 */

import type { Position, Vec3 } from '../types';

export interface NavigationLimitsView {
  maxDistance: number;
  timeoutMs: number;
  allowDigging: boolean;
  allowPlacing: boolean;
}

export interface NavigationPlan {
  from: Position;
  to: Vec3;
  /** Straight-line distance, rounded. */
  distance: number;
  /** Whether the plan may be attempted. */
  allowed: boolean;
  reason: string;
  /** Milliseconds before the attempt is abandoned. */
  timeoutMs: number;
  /** Whether the worker may dig/place to get there. */
  allowDigging: boolean;
  allowPlacing: boolean;
  /** True when the destination is close enough that a path is barely needed. */
  trivial: boolean;
}

export function distanceBetween(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distance3D(a: Vec3, b: Vec3): number {
  return distanceBetween(a, b);
}

export function horizontalDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Plans a walk to a destination.
 *
 * A destination beyond `maxDistance` is refused with a reason rather than attempted and timed out —
 * that is the difference between "unreachable" and "not allowed to try".
 */
export function planNavigation(
  from: Position,
  to: Vec3,
  limits: NavigationLimitsView,
  options: { range?: number; timeoutMs?: number } = {},
): NavigationPlan {
  const range = options.range ?? 1;
  const distance = distanceBetween(from, to);
  const timeoutMs = Math.min(
    options.timeoutMs ?? limits.timeoutMs,
    limits.timeoutMs > 0 ? limits.timeoutMs : Number.MAX_SAFE_INTEGER,
  );

  const base: Omit<NavigationPlan, 'allowed' | 'reason'> = {
    from,
    to,
    distance: Math.round(distance * 100) / 100,
    timeoutMs,
    allowDigging: limits.allowDigging,
    allowPlacing: limits.allowPlacing,
    trivial: distance <= range,
  };

  if (base.trivial) {
    return { ...base, allowed: true, reason: 'already within range' };
  }
  if (limits.maxDistance > 0 && distance > limits.maxDistance) {
    return {
      ...base,
      allowed: false,
      reason: `destination is ${Math.round(distance)} blocks away, beyond the ${limits.maxDistance}-block limit`,
    };
  }
  return { ...base, allowed: true, reason: `path of ${Math.round(distance)} blocks` };
}

export type NavigationFailure = 'unreachable' | 'timeout' | 'stuck' | 'cancelled' | 'interrupted' | 'unknown';

export interface RecoveryStep {
  action: 'retry' | 'jump' | 'repath' | 'give-up';
  reason: string;
  /** Milliseconds to wait before the step. */
  delayMs: number;
}

/**
 * Decides how to recover from a failed walk.
 *
 * A worker that has been stuck twice is not retried a third time in the same place: it is told to
 * give up, and the failure is reported, because a bot that oscillates forever is worse than one
 * that admits it cannot get there.
 */
export function planRecovery(failure: NavigationFailure, attempt: number): RecoveryStep {
  if (failure === 'cancelled') return { action: 'give-up', reason: 'cancelled by the operator', delayMs: 0 };
  if (attempt >= 3) return { action: 'give-up', reason: `gave up after ${attempt} attempts`, delayMs: 0 };

  switch (failure) {
    case 'timeout':
      return { action: attempt === 1 ? 'repath' : 'retry', reason: 'the path timed out', delayMs: 500 * attempt };
    case 'stuck':
      return { action: attempt === 1 ? 'jump' : 'repath', reason: 'the worker stopped making progress', delayMs: 300 * attempt };
    case 'unreachable':
      return attempt === 1
        ? { action: 'repath', reason: 'the destination was not reachable on the first try', delayMs: 500 }
        : { action: 'give-up', reason: 'the destination is not reachable', delayMs: 0 };
    case 'interrupted':
      return { action: 'retry', reason: 'the walk was interrupted', delayMs: 750 * attempt };
    default:
      return { action: 'retry', reason: 'an unknown navigation failure', delayMs: 500 * attempt };
  }
}

export interface Waypoint {
  position: Vec3;
  label: string;
}

/** Sorts waypoints into a nearest-first visiting order from a starting position. */
export function orderWaypoints(from: Position, waypoints: readonly Waypoint[]): Waypoint[] {
  const remaining = [...waypoints];
  const ordered: Waypoint[] = [];
  let current: Position = from;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const distance = distanceBetween(current, remaining[i]!.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    ordered.push(next);
    current = next.position;
  }
  return ordered;
}

export function sameBlock(a: Vec3, b: Vec3): boolean {
  return Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y) && Math.floor(a.z) === Math.floor(b.z);
}

export function blockKey(position: Vec3): string {
  return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}
