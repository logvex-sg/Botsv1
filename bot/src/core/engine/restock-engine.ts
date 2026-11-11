/**
 * Restock planning.
 *
 * A restock is always a *withdraw*: the worker tops up its own inventory from a source container.
 * Planning is separated from doing so the delta, the source choice and the refusal reasons are all
 * testable without a server.
 */

import { countIn } from './inventory-engine';
import type { ContainerRecord, ItemStack } from '../types';

export interface RestockRule {
  id: string;
  query: string;
  /** Keep at least this many. */
  minimum: number;
  /** Never exceed this many. */
  maximum: number;
  /** Optional: only draw from these container ids. */
  sources?: string[];
}

export interface RestockNeed {
  ruleId: string;
  query: string;
  have: number;
  minimum: number;
  maximum: number;
  shortfall: number;
}

export function computeDelta(rule: RestockRule, carried: readonly ItemStack[]): RestockNeed {
  const have = countIn(carried, rule.query);
  const shortfall = Math.max(0, rule.minimum - have);
  return {
    ruleId: rule.id,
    query: rule.query,
    have,
    minimum: rule.minimum,
    maximum: rule.maximum,
    shortfall,
  };
}

export function evaluateRules(rules: readonly RestockRule[], carried: readonly ItemStack[]): RestockNeed[] {
  return rules.map((rule) => computeDelta(rule, carried)).filter((need) => need.shortfall > 0);
}

export interface RestockSource {
  containerId: string;
  label: string;
  available: number;
  distance: number;
}

/** Sources that actually hold the item, nearest first, honouring a rule's source restriction. */
export function findSources(
  need: RestockNeed,
  containers: readonly ContainerRecord[],
  contents: ReadonlyMap<string, readonly ItemStack[]>,
  distanceTo: (container: ContainerRecord) => number,
  rule?: RestockRule,
): RestockSource[] {
  const allowed = rule?.sources ? new Set(rule.sources) : null;
  const sources: RestockSource[] = [];
  for (const container of containers) {
    if (allowed && !allowed.has(container.id)) continue;
    const items = contents.get(container.id);
    if (!items) continue;
    const available = countIn(items, need.query);
    if (available <= 0) continue;
    sources.push({ containerId: container.id, label: container.label, available, distance: distanceTo(container) });
  }
  return sources.sort((a, b) => a.distance - b.distance);
}

export interface RestockStep {
  containerId: string;
  label: string;
  query: string;
  amount: number;
  position?: { x: number; y: number; z: number };
}

export interface RestockPlan {
  need: RestockNeed;
  steps: RestockStep[];
  /** Amount the plan will actually recover. */
  planned: number;
  /** Amount that cannot be recovered from any known source. */
  unfulfilled: number;
  reason: string;
}

/**
 * Plans the steps to satisfy one need.
 *
 * The plan never asks for more than a source holds, and it stops at `maximum` so a restock cannot
 * fill the inventory past its configured ceiling.
 */
export function planRestock(
  need: RestockNeed,
  sources: readonly RestockSource[],
  containerById: (id: string) => ContainerRecord | undefined,
): RestockPlan {
  const ceiling = need.maximum > 0 ? Math.max(0, need.maximum - need.have) : need.shortfall;
  let remaining = Math.min(need.shortfall, ceiling);
  const steps: RestockStep[] = [];

  for (const source of sources) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, source.available);
    if (take <= 0) continue;
    const container = containerById(source.containerId);
    steps.push({
      containerId: source.containerId,
      label: source.label,
      query: need.query,
      amount: take,
      position: container?.position,
    });
    remaining -= take;
  }

  const planned = Math.min(need.shortfall, ceiling) - remaining;
  return {
    need,
    steps,
    planned,
    unfulfilled: remaining,
    reason:
      steps.length === 0
        ? 'no known source holds this item'
        : remaining > 0
          ? `planned ${planned} of ${need.shortfall}; ${remaining} could not be sourced`
          : `planned all ${planned}`,
  };
}

export function describePlan(plan: RestockPlan): string {
  if (plan.steps.length === 0) return `nothing to do for ${plan.need.query}`;
  const parts = plan.steps.map((step) => `${step.amount}x ${step.query} from ${step.label}`);
  return `${plan.need.query}: ${parts.join(', ')}`;
}
