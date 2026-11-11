/**
 * Reading the bot's own inventory.
 *
 * `carried` and `accessible` are deliberately distinct, exactly as on the Fabric side: `carried` is
 * what the player holds, `accessible` is what is visible in an open container screen. Conflating
 * them is how a bot "finds" items it cannot actually reach.
 */

import { connectionError } from '../core/errors';
import type { ItemStack } from '../core/types';
import { toItemStacks, tagLookupFor, type MineflayerItemLike } from './item-metadata';
import type { MineflayerBot } from './connection';

export interface WindowLike {
  type?: string;
  title?: string;
  slots: Array<MineflayerItemLike | null>;
  inventoryStart?: number;
  inventoryEnd?: number;
  hotbarStart?: number;
  containerItems?(): Array<MineflayerItemLike | null>;
}

export interface BotWithInventory extends MineflayerBot {
  inventory?: WindowLike & { items?(): Array<MineflayerItemLike | null> };
  currentWindow?: WindowLike | null;
  entity?: { position: { x: number; y: number; z: number }; equipment?: Array<unknown> } & Record<string, unknown>;
}

export class InventoryAdapter {
  private readonly bot: BotWithInventory;
  private readonly tagLookup?: (id: string) => string[] | undefined;

  constructor(bot: BotWithInventory) {
    this.bot = bot;
    this.tagLookup = tagLookupFor(bot.registry);
  }

  private require(): BotWithInventory {
    if (!this.bot || !this.bot.inventory) throw connectionError('the bot has no inventory yet');
    return this.bot;
  }

  /** The main inventory slots (excludes armour and the open-container region). */
  carried(): ItemStack[] {
    const bot = this.require();
    const items = bot.inventory!.items?.() ?? [];
    return toItemStacks(items, { tagLookup: this.tagLookup });
  }

  /** Items visible in an open container window, if one is open. */
  accessible(): ItemStack[] {
    const bot = this.bot;
    const window = bot.currentWindow;
    if (!window) return [];
    const container = window.containerItems?.() ?? [];
    return toItemStacks(container, { tagLookup: this.tagLookup });
  }

  /** Armour pieces from the player's equipment, or from the inventory window's armour slots. */
  armor(): ItemStack[] {
    const bot = this.bot;
    const equipment = bot.entity?.equipment;
    if (Array.isArray(equipment)) {
      const stacks = toItemStacks(equipment as Array<MineflayerItemLike | null>, { tagLookup: this.tagLookup });
      if (stacks.length > 0) return stacks;
    }
    const window = bot.inventory;
    if (!window) return [];
    // The player inventory window has armour in slots 5..8.
    const slots = window.slots.slice(5, 9);
    return toItemStacks(slots, { tagLookup: this.tagLookup });
  }

  armorPieceCount(): number {
    return this.armor().filter((item) => item.count > 0).length;
  }

  /** Free slots in the main inventory. */
  freeSlots(): number {
    const bot = this.require();
    const window = bot.inventory!;
    const start = window.inventoryStart ?? 9;
    const end = window.hotbarStart ?? window.slots.length;
    let free = 0;
    for (let slot = start; slot < end; slot += 1) {
      const item = window.slots[slot];
      if (!item || !item.name || item.name === 'air') free += 1;
    }
    return free;
  }

  /** The item currently held in the main hand. */
  heldItem(): ItemStack | null {
    const bot = this.bot;
    const window = bot.inventory;
    const held = bot.entity && (bot.entity as { heldItem?: unknown }).heldItem;
    if (held) return toItemStacks([held as MineflayerItemLike], { tagLookup: this.tagLookup })[0] ?? null;
    if (!window) return null;
    const slot = (window as unknown as { selectedSlot?: number }).selectedSlot ?? 0;
    const hotbarStart = window.hotbarStart ?? 36;
    return toItemStacks([window.slots[hotbarStart + slot] ?? null], { tagLookup: this.tagLookup })[0] ?? null;
  }

  /** Everything the worker can currently see: carried plus an open container. */
  all(): ItemStack[] {
    return [...this.carried(), ...this.accessible()];
  }

  hasContainerOpen(): boolean {
    return Boolean(this.bot.currentWindow);
  }

  getCurrentWindow(): WindowLike | null {
    return this.bot.currentWindow ?? null;
  }
}

export function asBotWithInventory(bot: MineflayerBot): BotWithInventory {
  return bot as BotWithInventory;
}
