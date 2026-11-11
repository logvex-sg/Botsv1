/**
 * Disposal engine: deciding what may be thrown away.
 *
 * Disposal is the one operation that can destroy an item, so it is the most conservative. A rule
 * only ever *moves* an item to a disposal container; destruction is a separate, explicit flag. The
 * engine refuses to touch an item unless a rule matches it, it is not protected, it is not valuable
 * and it is not reserved. Unknown items are never disposed of.
 *
 * Pure: unit-testable.
 */
import type { DisposalRule, StorageContainer, StorageNetwork } from '../../../shared/types';
import type { WorkerItem } from '../../../shared/workers';
import { matchesQuery } from '../inventory-engine';
import { isProtected, reservationFor } from '../storage-engine';

/** Item id substrings that mark an item as valuable; such items are never disposed of. */
export const VALUABLE_MARKERS = [
  'diamond', 'emerald', 'netherite', 'nether_star', 'beacon', 'elytra', 'shulker_box',
  'totem_of_undying', 'end_crystal', 'enchanted_', 'golden_apple', 'ancient_debris',
  'heart_of_the_sea', 'conduit', 'trident', 'dragon_', 'wither_', 'enchanted_book',
];

/** Whether an item looks valuable by its id, independent of any rule. */
export function isValuable(item: WorkerItem | { id: string; name: string }): boolean {
  const id = (item.id ?? '').toLowerCase();
  return VALUABLE_MARKERS.some((marker) => id.includes(marker));
}

/** The default rules a new disposal configuration starts with, all disabled until enabled. */
export const DEFAULT_DISPOSAL_RULES: { name: string; query: string; label: string }[] = [
  { name: 'Cobblestone', query: 'cobblestone', label: 'Cobblestone' },
  { name: 'Netherrack', query: 'netherrack', label: 'Netherrack' },
  { name: 'Dirt', query: 'dirt', label: 'Dirt' },
  { name: 'Gravel', query: 'gravel', label: 'Gravel' },
  { name: 'Excess common drops', query: 'rotten_flesh', label: 'Rotten flesh' },
  { name: 'Unwanted equipment', query: 'leather_', label: 'Leather gear' },
  { name: 'Duplicate low-value items', query: 'stick', label: 'Sticks' },
];

/** Why an item may not be disposed of. */
export interface DisposalDecision {
  item: WorkerItem;
  rule: DisposalRule | null;
  allowed: boolean;
  reasons: string[];
}

/**
 * Decides whether a single item may be disposed of.
 *
 * An item is only ever allowed when a *matching, enabled* rule exists and none of the protection
 * rules apply. This is deliberately a whitelist: an item with no matching rule is refused, however
 * worthless it looks, because "looks worthless" is not a decision the Host is allowed to make.
 */
export function decide(
  item: WorkerItem,
  rules: readonly DisposalRule[],
  network: StorageNetwork | null,
  options: { reserved?: number } = {},
): DisposalDecision {
  const reasons: string[] = [];
  const rule = rules.find((candidate) => candidate.enabled && matchesQuery(item, candidate.query)) ?? null;
  if (!rule) reasons.push('no enabled disposal rule matches this item');
  if (isValuable(item)) reasons.push('item is valuable');
  if (network && isProtected(network, item.id, { id: item.id, name: item.name })) reasons.push('item is on the protected list');
  if (options.reserved !== undefined && options.reserved > 0) {
    reasons.push(`network reserves ${options.reserved} of this item`);
  }
  if (network && reservationFor(network, { id: item.id, name: item.name }) > 0) {
    const floor = reservationFor(network, { id: item.id, name: item.name });
    reasons.push(`network reserves ${floor} of this item`);
  }
  return { item, rule, allowed: reasons.length === 0, reasons };
}

/** A single planned disposal move. */
export interface DisposalStep {
  ruleId: string;
  workerId: string;
  query: string;
  itemId: string;
  itemName: string;
  count: number;
  toContainerId: string;
  detail: string;
}

export interface DisposalPlan {
  steps: DisposalStep[];
  /** Items that were considered but refused, with the reasons. */
  refused: { itemId: string; itemName: string; count: number; reasons: string[] }[];
}

/**
 * Plans disposal moves for one worker's carried items.
 *
 * The destination must be an unlocked disposal container on the same worker. When there is no such
 * container, every candidate is refused with "no disposal container" rather than being dropped.
 */
export function planDisposal(
  carried: readonly WorkerItem[],
  rules: readonly DisposalRule[],
  network: StorageNetwork | null,
  containers: readonly StorageContainer[],
  workerId: string,
): DisposalPlan {
  const steps: DisposalStep[] = [];
  const refused: DisposalPlan['refused'] = [];
  const destination = containers.find((container) => container.workerId === workerId && container.kind === 'disposal' && !container.locked) ?? null;

  for (const item of carried) {
    if (item.count <= 0) continue;
    const decision = decide(item, rules, network);
    if (!decision.allowed) {
      // Only report refusals for items a rule *would* have matched, so the list stays relevant.
      if (decision.rule) refused.push({ itemId: item.id, itemName: item.name, count: item.count, reasons: decision.reasons });
      continue;
    }
    if (!destination) {
      refused.push({ itemId: item.id, itemName: item.name, count: item.count, reasons: ['no unlocked disposal container on this worker'] });
      continue;
    }
    steps.push({
      ruleId: decision.rule!.id,
      workerId,
      query: decision.rule!.query,
      itemId: item.id,
      itemName: item.name,
      count: item.count,
      toContainerId: destination.id,
      detail: `move ${item.count}x ${item.name} to disposal container ${destination.label || destination.id}`,
    });
  }
  return { steps, refused };
}

/** A preview for the UI: which items would be moved and which refused, without doing anything. */
export function preview(
  carried: readonly WorkerItem[],
  rules: readonly DisposalRule[],
  network: StorageNetwork | null,
): { wouldDispose: { itemId: string; itemName: string; count: number }[]; refused: { itemId: string; itemName: string; reasons: string[] }[] } {
  const wouldDispose: { itemId: string; itemName: string; count: number }[] = [];
  const refused: { itemId: string; itemName: string; reasons: string[] }[] = [];
  for (const item of carried) {
    if (item.count <= 0) continue;
    const decision = decide(item, rules, network);
    if (decision.allowed) wouldDispose.push({ itemId: item.id, itemName: item.name, count: item.count });
    else if (decision.rule) refused.push({ itemId: item.id, itemName: item.name, reasons: decision.reasons });
  }
  return { wouldDispose, refused };
}
