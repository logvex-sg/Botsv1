/**
 * Reading shulker boxes carried in the inventory.
 *
 * A shulker box's contents live in the item's own data (`BlockEntityTag` on older versions, a
 * `minecraft:container` component on 1.20.5+). When that data is absent the box is reported as
 * `opaque` — the worker never assumes an unreadable box is empty, because that is how a full box
 * gets thrown away.
 */

import type { ItemStack, ShulkerRecord, ShulkerSlot } from '../core/types';
import { toItemStack, toItemStacks, type MineflayerItemLike } from './item-metadata';
import type { BotWithInventory, WindowLike } from './inventory';

interface NbtItem {
  Slot?: number;
  Count?: number;
  id?: string;
  tag?: unknown;
}

interface NbtLike {
  BlockEntityTag?: { Items?: NbtItem[] };
  Items?: NbtItem[];
  components?: unknown;
}

export function isShulkerName(name: string | undefined): boolean {
  return typeof name === 'string' && name.toLowerCase().includes('shulker_box');
}

/** Extracts the inner item list from either the legacy NBT tag or the modern container component. */
function readInnerItems(item: MineflayerItemLike): ItemStack[] | null {
  const nbt = item.nbt as NbtLike | undefined;
  const rawList: Array<{ id?: string; count?: number; slot?: number }> = [];

  const legacy = nbt?.BlockEntityTag?.Items ?? nbt?.Items;
  if (Array.isArray(legacy)) {
    for (const entry of legacy) {
      if (!entry || typeof entry.id !== 'string') continue;
      rawList.push({ id: entry.id, count: entry.Count ?? 1, slot: entry.Slot });
    }
    return toItemStacks(rawList as MineflayerItemLike[]);
  }

  const components = item.itemComponents as { container?: unknown } | undefined;
  const container = components?.container ?? (nbt as { components?: { 'minecraft:container'?: unknown } } | undefined)?.components?.['minecraft:container'];
  if (Array.isArray(container)) {
    for (const entry of container as Array<{ item?: { id?: string; count?: number }; slot?: number }>) {
      if (!entry?.item?.id) continue;
      rawList.push({ id: entry.item.id, count: entry.item.count ?? 1, slot: entry.slot });
    }
    return toItemStacks(rawList as MineflayerItemLike[]);
  }

  return null;
}

/**
 * Builds a ShulkerRecord for one carried box.
 *
 * `opaque` is true whenever the contents could not be read, and the record then carries no items at
 * all rather than an empty list.
 */
export function toShulkerRecord(item: MineflayerItemLike, slot: number, tagLookup?: (id: string) => string[] | undefined): ShulkerRecord | null {
  if (!isShulkerName(item.name)) return null;
  const inner = readInnerItems(item);
  const opaque = inner === null;
  const items = inner ?? [];
  const usedSlots = items.reduce((sum, entry) => sum + Math.max(1, Math.ceil(entry.count / 64)), 0);
  const freeSlots = opaque ? 0 : Math.max(0, 27 - usedSlots);

  const id = item.name && item.name.includes(':') ? item.name : `minecraft:${item.name ?? 'shulker_box'}`;
  const record: ShulkerRecord = {
    slot,
    id,
    label: typeof item.displayName === 'string' && item.displayName.length > 0 ? item.displayName : (item.name ?? 'shulker_box'),
    items,
    usedSlots,
    freeSlots,
    opaque,
    customName: typeof item.customName === 'string' ? item.customName : undefined,
  };
  return record;
}

export class ShulkerAdapter {
  private readonly bot: BotWithInventory;
  private readonly tagLookup?: (id: string) => string[] | undefined;

  constructor(bot: BotWithInventory, tagLookup?: (id: string) => string[] | undefined) {
    this.bot = bot;
    this.tagLookup = tagLookup;
  }

  private window(): WindowLike | null {
    return this.bot.inventory ?? null;
  }

  /** Every shulker box carried in the main inventory, with its contents (or marked opaque). */
  carried(): ShulkerRecord[] {
    const window = this.window();
    if (!window) return [];
    const start = window.inventoryStart ?? 9;
    const end = window.hotbarStart ?? window.slots.length;
    const records: ShulkerRecord[] = [];
    for (let slot = start; slot < end; slot += 1) {
      const raw = window.slots[slot];
      if (!raw) continue;
      const record = toShulkerRecord(raw, slot, this.tagLookup);
      if (record) records.push(record);
    }
    return records;
  }

  /** Shulker boxes that have just been read; identical to `carried()` but named for intent. */
  inspect(): ShulkerRecord[] {
    return this.carried();
  }

  count(): number {
    return this.carried().length;
  }

  emptyCount(): number {
    return this.carried().filter((record) => !record.opaque && record.usedSlots === 0).length;
  }

  /** The first carried box matching a slot, or null. */
  bySlot(slot: number): ShulkerRecord | null {
    const window = this.window();
    if (!window) return null;
    const raw = window.slots[slot];
    if (!raw) return null;
    return toShulkerRecord(raw, slot, this.tagLookup);
  }
}

export function fillOf(record: ShulkerRecord): ShulkerSlot {
  if (record.opaque) return 'unknown';
  if (record.usedSlots <= 0) return 'empty';
  if (record.freeSlots <= 0) return 'full';
  return 'partial';
}

export { toItemStack };
