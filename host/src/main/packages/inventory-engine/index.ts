/**
 * Inventory engine: counting, matching and aggregating what workers actually reported.
 *
 * Everything here is a pure function over a snapshot a worker already sent. It never asks a worker
 * anything and never invents data: a count of zero means "the last report had none", which the UI
 * labels with the snapshot time. Kept in one module so the Host's counts agree with the worker's
 * own for the same query.
 *
 * Pure: unit-testable.
 */
import type { WorkerItem } from '../../../shared/workers';

/** How old a reported inventory may be before the UI flags it as stale. */
export const STALE_INVENTORY_MS = 60_000;

/** Item-name aliases so an operator can type "totem" and match `minecraft:totem_of_undying`. */
const ALIASES: Record<string, string> = {
  totem: 'totem_of_undying',
  totems: 'totem_of_undying',
  gapple: 'golden_apple',
  gapples: 'golden_apple',
  pearl: 'ender_pearl',
  pearls: 'ender_pearl',
  iron: 'iron_ingot',
  gold: 'gold_ingot',
  xp: 'experience_bottle',
};

const FOOD_WORDS = [
  'apple', 'bread', 'cooked_', 'beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon',
  'potato', 'carrot', 'melon', 'stew', 'cookie', 'cake', 'pie', 'golden_apple', 'golden_carrot', 'berry',
];

/** Whether one reported stack matches an operator query, with the same forgiveness the worker uses. */
export function matchesQuery(item: WorkerItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const id = (item.id ?? '').toLowerCase();
  const name = (item.name ?? '').toLowerCase();
  const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  if (id === needle || path === needle) return true;
  if (path.includes(needle) || name.includes(needle)) return true;
  const alias = ALIASES[needle];
  if (alias) return path === alias || path.endsWith(`_${alias}`) || path.includes(alias);
  return false;
}

/** Total quantity of a matching item in a stack list. */
export function countIn(items: readonly WorkerItem[], query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  return items.filter((item) => matchesQuery(item, needle)).reduce((sum, item) => sum + item.count, 0);
}

/** Best-effort food detection from an item id, since the Host only sees the id and the name. */
export function isFoodish(item: WorkerItem): boolean {
  const id = (item.id ?? '').toLowerCase();
  return FOOD_WORDS.some((word) => id.includes(word));
}

export interface ItemTotal {
  id: string;
  name: string;
  count: number;
}

/** Aggregates stack lists into per-item totals, largest first. */
export function aggregate(snapshots: readonly (readonly WorkerItem[])[]): ItemTotal[] {
  const totals = new Map<string, ItemTotal>();
  for (const items of snapshots) {
    for (const item of items) {
      const existing = totals.get(item.id);
      if (existing) existing.count += item.count;
      else totals.set(item.id, { id: item.id, name: item.name, count: item.count });
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/** How many slots in the reported inventory hold nothing. */
export function freeSlots(items: readonly WorkerItem[], inventorySize = 36): number {
  const used = new Set(items.filter((item) => item.count > 0).map((item) => item.slot));
  let free = 0;
  for (let slot = 0; slot < inventorySize; slot++) if (!used.has(slot)) free++;
  return free;
}

export interface InventoryDiff {
  /** Items present now but not before, or present in a larger quantity. */
  gained: ItemTotal[];
  /** Items present before but not now, or present in a smaller quantity. */
  lost: ItemTotal[];
  /** True when nothing changed between the two snapshots. */
  unchanged: boolean;
}

/** Compares two reported inventories by item id, for history and change alerts. */
export function diff(before: readonly WorkerItem[], after: readonly WorkerItem[]): InventoryDiff {
  const a = new Map<string, number>();
  const b = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of before) { a.set(item.id, (a.get(item.id) ?? 0) + item.count); names.set(item.id, item.name); }
  for (const item of after) { b.set(item.id, (b.get(item.id) ?? 0) + item.count); names.set(item.id, item.name); }

  const gained: ItemTotal[] = [];
  const lost: ItemTotal[] = [];
  for (const [id, count] of b) {
    const delta = count - (a.get(id) ?? 0);
    if (delta > 0) gained.push({ id, name: names.get(id) ?? id, count: delta });
  }
  for (const [id, count] of a) {
    const delta = (b.get(id) ?? 0) - count;
    if (delta < 0) lost.push({ id, name: names.get(id) ?? id, count: -delta });
  }
  gained.sort((x, y) => y.count - x.count);
  lost.sort((x, y) => y.count - x.count);
  return { gained, lost, unchanged: gained.length === 0 && lost.length === 0 };
}

/** True when the newest capture is older than the freshness window. */
export function isStale(capturedAt: number | null, now = Date.now(), windowMs = STALE_INVENTORY_MS): boolean {
  return capturedAt === null || now - capturedAt > windowMs;
}

/** Serialises item totals as CSV, for the export action. */
export function toCsv(rows: readonly ItemTotal[]): string {
  const header = 'item,display_name,count';
  const lines = rows.map((row) => `${csvField(row.id)},${csvField(row.name)},${row.count}`);
  return [header, ...lines].join('\n');
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
