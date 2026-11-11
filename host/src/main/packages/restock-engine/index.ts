/**
 * Restock engine: keeping a worker's inventory above a minimum.
 *
 * A restock rule says "keep between `min` and `max` of `query`". This engine compares that rule
 * against a worker's reported inventory and its reported storage, and produces a plan that moves
 * the shortfall from a source container into the worker's own inventory. It never assumes a source
 * exists: a rule with no available stock produces a refusal, not a fake success.
 *
 * Pure: unit-testable.
 */
import type { RestockRule, StorageContainer } from '../../../shared/types';
import type { WorkerItem } from '../../../shared/workers';
import { countIn } from '../inventory-engine';
import { isProtected, reservationFor } from '../storage-engine';
import type { StorageNetwork } from '../../../shared/types';

/** One restock line: a rule, a worker and how many items are missing. */
export interface RestockNeed {
  ruleId: string;
  workerId: string;
  query: string;
  label: string;
  have: number;
  min: number;
  max: number;
  /** How many to move in (positive) or out (negative) to reach the band. */
  delta: number;
  /** The number to move, always non-negative. */
  amount: number;
  /** 'in' when the worker needs stock, 'out' when it has too much, 'ok' when in the band. */
  direction: 'in' | 'out' | 'ok';
}

/** The quantity to move so `have` lands in the [min, max] band, capped at `batch`. */
export function computeDelta(have: number, min: number, max: number, batch: number): { direction: RestockNeed['direction']; amount: number } {
  if (have < min) {
    const shortfall = min - have;
    return { direction: 'in', amount: batch > 0 ? Math.min(shortfall, batch) : shortfall };
  }
  if (have > max) return { direction: 'out', amount: have - max };
  return { direction: 'ok', amount: 0 };
}

/**
 * Evaluates every applicable restock rule against one worker's reported inventory.
 *
 * A rule applies to a worker when its `workerIds` is empty or contains the worker, and its
 * `networkId` is null or matches. Disabled rules are skipped. Reserved quantities in the network
 * raise the effective floor, so a restock never drains a network below its reservation.
 */
export function evaluateRules(
  rules: readonly RestockRule[],
  network: StorageNetwork | null,
  workerId: string,
  carried: readonly WorkerItem[],
): RestockNeed[] {
  const needs: RestockNeed[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.workerIds.length > 0 && !rule.workerIds.includes(workerId)) continue;
    if (rule.networkId && network && rule.networkId !== network.id) continue;
    const have = countIn(carried, rule.query);
    const effectiveMin = Math.max(rule.min, network ? reservationFor(network, { id: rule.query, name: rule.label }) : 0);
    const { direction, amount } = computeDelta(have, effectiveMin, rule.max, rule.batch);
    needs.push({
      ruleId: rule.id,
      workerId,
      query: rule.query,
      label: rule.label || rule.query,
      have,
      min: effectiveMin,
      max: rule.max,
      delta: have < effectiveMin ? effectiveMin - have : have > rule.max ? have - rule.max : 0,
      amount,
      direction,
    });
  }
  return needs;
}

/** Where a shortfall could be sourced from: a container that holds the item. */
export interface RestockSource {
  containerId: string;
  workerId: string;
  label: string;
  available: number;
  /** True when the container is a shulker reserve (prefer not to drain it). */
  reserved: boolean;
}

/**
 * Finds containers that can supply a shortfall.
 *
 * Only containers on the *same* worker are considered, because the worker can only reach a
 * container it can physically open; a container on another worker is reported as unavailable
 * rather than silently counted.
 */
export function findSources(
  query: string,
  workerId: string,
  containers: readonly StorageContainer[],
  network: StorageNetwork | null,
): RestockSource[] {
  const sources: RestockSource[] = [];
  for (const container of containers) {
    if (container.workerId !== workerId) continue;
    if (container.locked) continue;
    if (container.kind === 'disposal') continue;
    if (network && isProtected(network, query)) continue;
    const available = container.items.filter((item) => countIn([item], query) > 0).reduce((sum, item) => sum + item.count, 0);
    if (available <= 0) continue;
    sources.push({
      containerId: container.id,
      workerId: container.workerId,
      label: container.label || container.id,
      available,
      reserved: container.kind === 'shulker_reserve',
    });
  }
  // Prefer the least-protected source: a normal container over a reserved shulker supply.
  return sources.sort((a, b) => Number(a.reserved) - Number(b.reserved) || b.available - a.available);
}

/** One planned restock move. */
export interface RestockStep {
  ruleId: string;
  workerId: string;
  query: string;
  fromContainerId: string;
  count: number;
  detail: string;
}

export interface RestockPlan {
  steps: RestockStep[];
  /** Rules that could not be satisfied, with the reason. */
  unsatisfied: { ruleId: string; workerId: string; query: string; missing: number; reason: string }[];
}

/**
 * Plans restocks for one worker.
 *
 * A need is satisfied only up to what a source actually holds. Anything left over is reported as
 * unsatisfied with the quantity still missing, so the operator sees a real shortfall instead of a
 * silent no-op.
 */
export function planRestock(
  needs: readonly RestockNeed[],
  sourcesByQuery: (query: string, workerId: string) => RestockSource[],
): RestockPlan {
  const steps: RestockStep[] = [];
  const unsatisfied: RestockPlan['unsatisfied'] = [];
  for (const need of needs) {
    if (need.direction !== 'in' || need.amount <= 0) continue;
    const sources = sourcesByQuery(need.query, need.workerId);
    let remaining = need.amount;
    for (const source of sources) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, source.available);
      if (take <= 0) continue;
      steps.push({
        ruleId: need.ruleId,
        workerId: need.workerId,
        query: need.query,
        fromContainerId: source.containerId,
        count: take,
        detail: `restock ${take}x ${need.label} from ${source.label}`,
      });
      remaining -= take;
    }
    if (remaining > 0) {
      unsatisfied.push({
        ruleId: need.ruleId,
        workerId: need.workerId,
        query: need.query,
        missing: remaining,
        reason: sources.length === 0 ? 'no source container holds this item' : 'sources could not cover the shortfall',
      });
    }
  }
  return { steps, unsatisfied };
}

/** A plain-language summary of a restock plan. */
export function describePlan(plan: RestockPlan): string {
  if (plan.steps.length === 0 && plan.unsatisfied.length === 0) return 'every restock rule is satisfied';
  const parts: string[] = [];
  if (plan.steps.length > 0) parts.push(`${plan.steps.length} restock move(s)`);
  if (plan.unsatisfied.length > 0) parts.push(`${plan.unsatisfied.length} unsatisfied rule(s)`);
  return parts.join(', ');
}
