/**
 * Inventory arithmetic and querying.
 *
 * Everything here is pure. It never touches a live bot; the adapters hand it a plain list of stacks.
 */

import { identityKey, metaOf } from './item-classifier';
import type { ItemStack } from '../types';

export const STALE_INVENTORY_MS = 60_000;

/** Forgiving item matcher: namespaced id, short id, display name, or an alias. */
const ALIASES: Record<string, string> = {
  totem: 'totem_of_undying',
  gapple: 'golden_apple',
  gap: 'golden_apple',
  pearl: 'ender_pearl',
  xp: 'experience_bottle',
  firework: 'firework_rocket',
  crystal: 'end_crystal',
  cobble: 'cobblestone',
  sword: 'sword',
  pick: 'pickaxe',
  axe: 'axe',
  shovel: 'shovel',
  elytra: 'elytra',
  shulker: 'shulker_box',
};

export function normalizeQuery(query: string): string {
  const trimmed = query.trim().toLowerCase();
  return ALIASES[trimmed] ?? trimmed;
}

export function matchesQuery(item: ItemStack, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return false;
  const id = item.id.toLowerCase();
  if (id === needle) return true;
  const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  if (path === needle) return true;
  if (id.includes(needle)) return true;
  const name = (metaOf(item).customName ?? item.name ?? '').toLowerCase();
  if (name.length > 0 && name.includes(needle)) return true;
  return false;
}

export function countIn(items: readonly ItemStack[], query: string): number {
  let total = 0;
  for (const item of items) if (matchesQuery(item, query)) total += item.count;
  return total;
}

export function find(items: readonly ItemStack[], query: string): ItemStack[] {
  return items.filter((item) => matchesQuery(item, query));
}

export interface ItemTotal {
  key: string;
  id: string;
  count: number;
  sample: ItemStack;
}

/**
 * Aggregates stacks into totals.
 *
 * Grouping is by `identityKey`, not by id: two stacks of the same id with different enchantments or
 * custom names are reported separately, because they are not the same thing.
 */
export function aggregate(items: readonly ItemStack[]): ItemTotal[] {
  const totals = new Map<string, ItemTotal>();
  for (const item of items) {
    const key = identityKey(item);
    const existing = totals.get(key);
    if (existing) existing.count += item.count;
    else totals.set(key, { key, id: item.id, count: item.count, sample: item });
  }
  return [...totals.values()].sort((a, b) => b.count - a.count);
}

export function freeSlots(items: readonly ItemStack[], capacity = 36): number {
  const used = items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.count / 64)), 0);
  return Math.max(0, capacity - used);
}

export interface InventoryDiff {
  added: ItemTotal[];
  removed: ItemTotal[];
  unchanged: ItemTotal[];
}

/** A diff keyed by identity, so a transfer that changed metadata is visible as a change. */
export function diff(before: readonly ItemStack[], after: readonly ItemStack[]): InventoryDiff {
  const beforeMap = new Map(aggregate(before).map((entry) => [entry.key, entry]));
  const afterMap = new Map(aggregate(after).map((entry) => [entry.key, entry]));

  const added: ItemTotal[] = [];
  const removed: ItemTotal[] = [];
  const unchanged: ItemTotal[] = [];

  for (const [key, entry] of afterMap) {
    const prior = beforeMap.get(key);
    if (!prior) added.push(entry);
    else if (entry.count > prior.count) added.push({ ...entry, count: entry.count - prior.count });
    else if (entry.count < prior.count) removed.push({ ...entry, count: prior.count - entry.count });
    else unchanged.push(entry);
  }
  for (const [key, entry] of beforeMap) {
    if (!afterMap.has(key)) removed.push(entry);
  }

  return { added, removed, unchanged };
}

export function isStale(recordedAt: number | undefined, now: number, threshold = STALE_INVENTORY_MS): boolean {
  if (typeof recordedAt !== 'number') return true;
  return now - recordedAt > threshold;
}

export function isFoodish(item: ItemStack): boolean {
  const id = item.id.toLowerCase();
  return (
    id.includes('bread') ||
    id.includes('apple') ||
    id.includes('carrot') ||
    id.includes('potato') ||
    id.includes('beetroot') ||
    id.includes('cooked_') ||
    id.includes('stew') ||
    id.includes('soup') ||
    id.includes('cookie') ||
    id.includes('melon_slice') ||
    id.includes('beef') ||
    id.includes('porkchop') ||
    id.includes('chicken') ||
    id.includes('mutton') ||
    id.includes('cod') ||
    id.includes('salmon') ||
    id.includes('_fish') ||
    id.includes('rabbit')
  );
}

export function countFood(items: readonly ItemStack[]): number {
  let total = 0;
  for (const item of items) if (isFoodish(item)) total += item.count;
  return total;
}

export function toCsv(totals: readonly ItemTotal[]): string {
  const lines = ['id,count'];
  for (const total of totals) lines.push(`${total.id},${total.count}`);
  return lines.join('\n');
}

export function totalItems(items: readonly ItemStack[]): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

export function distinctItems(items: readonly ItemStack[]): number {
  return new Set(items.map(identityKey)).size;
}
