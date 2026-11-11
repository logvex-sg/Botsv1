/**
 * Reading item metadata off a Mineflayer item.
 *
 * Mineflayer exposes enchantments, components and custom names on the item object. Which of them
 * are present depends on the server and the version, so every field is read defensively and an
 * unreadable field is left *absent* — never filled with an empty list, which would claim the item
 * has none.
 */

import type { ItemMeta, ItemStack } from '../core/types';

export interface MineflayerItemLike {
  name?: string;
  displayName?: string;
  count?: number;
  slot?: number;
  type?: number;
  metadata?: number;
  maxDurability?: number;
  durabilityUsed?: number;
  nbt?: unknown;
  enchants?: Array<{ name?: string; lvl?: number; level?: number }>;
  customName?: string | null;
  components?: Array<{ name?: string } | string>;
  itemComponents?: unknown;
}

function itemId(item: MineflayerItemLike): string {
  const name = item.name ?? '';
  if (name.includes(':')) return name;
  return name.length > 0 ? `minecraft:${name}` : 'minecraft:air';
}

/** Tags are only available when the server sent a tag registry; Mineflayer does not always have it. */
function readTags(item: MineflayerItemLike, tagLookup?: (id: string) => string[] | undefined): string[] | undefined {
  if (!tagLookup) return undefined;
  const tags = tagLookup(itemId(item));
  return tags && tags.length > 0 ? tags : undefined;
}

function readEnchantments(item: MineflayerItemLike): Array<{ id: string; level: number }> | undefined {
  const enchants = item.enchants;
  if (!Array.isArray(enchants) || enchants.length === 0) return undefined;
  const mapped: Array<{ id: string; level: number }> = [];
  for (const entry of enchants) {
    if (!entry) continue;
    const rawName = entry.name ?? '';
    if (rawName.length === 0) continue;
    const id = rawName.includes(':') ? rawName : `minecraft:${rawName}`;
    const level = entry.lvl ?? entry.level ?? 1;
    mapped.push({ id, level: typeof level === 'number' && level > 0 ? level : 1 });
  }
  return mapped.length > 0 ? mapped : undefined;
}

function readComponents(item: MineflayerItemLike): string[] | undefined {
  const components = item.components;
  if (!Array.isArray(components) || components.length === 0) return undefined;
  const mapped: string[] = [];
  for (const entry of components) {
    if (typeof entry === 'string' && entry.length > 0) mapped.push(entry.includes(':') ? entry : `minecraft:${entry}`);
    else if (entry && typeof entry === 'object' && typeof entry.name === 'string' && entry.name.length > 0) {
      mapped.push(entry.name.includes(':') ? entry.name : `minecraft:${entry.name}`);
    }
  }
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Builds an ItemStack from a Mineflayer item.
 *
 * `tags` are only reported when a tag lookup is supplied, because a tag list the worker cannot
 * verify is worse than no tag list at all.
 */
export function toItemStack(
  item: MineflayerItemLike | null | undefined,
  options: { tagLookup?: (id: string) => string[] | undefined } = {},
): ItemStack | null {
  if (!item || !item.name || item.name === 'air') return null;
  const count = typeof item.count === 'number' && item.count > 0 ? item.count : 1;
  const meta: ItemMeta = {};

  const tags = readTags(item, options.tagLookup);
  if (tags) meta.tags = tags;
  const enchantments = readEnchantments(item);
  if (enchantments) meta.enchantments = enchantments;
  const components = readComponents(item);
  if (components) meta.components = components;
  if (typeof item.customName === 'string' && item.customName.length > 0) meta.customName = item.customName;

  const stack: ItemStack = { id: itemId(item), count };
  if (typeof item.displayName === 'string' && item.displayName.length > 0) stack.name = item.displayName;
  if (typeof item.slot === 'number') stack.slot = item.slot;
  if (typeof item.metadata === 'number' && item.metadata > 0) stack.damage = item.metadata;
  if (typeof item.maxDurability === 'number' && item.maxDurability > 0) {
    stack.maxDamage = item.maxDurability;
    const used = typeof item.durabilityUsed === 'number' ? item.durabilityUsed : (item.metadata ?? 0);
    stack.damage = used;
    stack.durability = Math.max(0, Math.min(100, ((item.maxDurability - used) / item.maxDurability) * 100));
  }
  if (Object.keys(meta).length > 0) stack.meta = meta;

  return stack;
}

export function toItemStacks(
  items: ReadonlyArray<MineflayerItemLike | null | undefined>,
  options: { tagLookup?: (id: string) => string[] | undefined } = {},
): ItemStack[] {
  const result: ItemStack[] = [];
  for (const item of items) {
    const stack = toItemStack(item, options);
    if (stack) result.push(stack);
  }
  return result;
}

/**
 * Builds a tag lookup from a Mineflayer registry.
 *
 * `prismarine-registry` only exposes tag data for versions whose data is loaded, so this returns
 * `undefined` when the registry has none — which correctly leaves tags unreported rather than
 * falsely empty.
 */
export function tagLookupFor(registry: unknown): ((id: string) => string[] | undefined) | undefined {
  const registryRecord = registry as { tags?: Record<string, unknown>; itemTags?: Record<string, unknown> } | null;
  const table = registryRecord?.tags ?? registryRecord?.itemTags;
  if (!table || typeof table !== 'object') return undefined;
  return (id: string) => {
    const short = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
    const entry = (table as Record<string, unknown>)[id] ?? (table as Record<string, unknown>)[short];
    if (Array.isArray(entry)) return entry.filter((value): value is string => typeof value === 'string');
    return undefined;
  };
}
