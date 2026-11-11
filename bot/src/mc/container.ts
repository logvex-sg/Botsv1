/**
 * Container interaction, with verification after every mutation.
 *
 * This is the only place that opens a container or moves an item, and every mutating method ends by
 * re-reading the world and comparing against what it intended. A move that reports "3 moved" but
 * where only 1 actually moved is reported as unverified, and the error carries `mutation: partial`
 * so the retry layer will refuse to repeat it.
 */

import { BotError, containerError, navigationError, timeoutError } from '../core/errors';
import type { Logger } from '../core/logger';
import { countIn, matchesQuery } from '../core/engine/inventory-engine';
import { verifyCountChange } from '../core/engine/verification';
import type { ContainerContents, ItemStack, Vec3, VerificationOutcome } from '../core/types';
import { toItemStacks, type MineflayerItemLike } from './item-metadata';
import type { BotWithInventory, WindowLike } from './inventory';

export interface BlockLike {
  name?: string;
  position?: { x: number; y: number; z: number };
  type?: number;
}

export interface ContainerBot extends BotWithInventory {
  blockAt?(position: unknown): BlockLike | null;
  openContainer?(block: unknown): Promise<WindowLike>;
  closeWindow?(window: WindowLike): Promise<void>;
  moveSlotItem?(sourceSlot: number, destinationSlot: number): Promise<void>;
  clickWindow?(slot: number, mouseButton: number, mode: number): Promise<void>;
  equip?(item: unknown, destination: string): Promise<void>;
}

export interface ContainerAdapterOptions {
  bot: ContainerBot;
  logger: Logger;
  /** Milliseconds to wait for a container screen to open. */
  openTimeoutMs: number;
  /** Milliseconds to wait for a click to be acknowledged. */
  clickTimeoutMs?: number;
  /** Builds a position object the bot's `blockAt` understands. */
  vec: (position: Vec3) => unknown;
  /** Optional tag lookup, shared with the inventory adapter. */
  tagLookup?: (id: string) => string[] | undefined;
}

export interface MoveResult {
  requested: number;
  moved: number;
  verification: VerificationOutcome;
}

/** Whether a block name is a container the worker may open. */
const CONTAINER_HINTS = [
  'chest', 'barrel', 'shulker_box', 'hopper', 'dispenser', 'dropper', 'furnace', 'smoker',
  'blast_furnace', 'brewing_stand', 'campfire', 'lectern', 'crafter', 'ender_chest', 'trapped_chest',
];

export function isLikelyContainer(name: string | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return CONTAINER_HINTS.some((hint) => lower.includes(hint));
}

export class ContainerAdapter {
  private readonly bot: ContainerBot;
  private readonly logger: Logger;
  private readonly openTimeoutMs: number;
  private readonly clickTimeoutMs: number;
  private readonly vec: (position: Vec3) => unknown;
  private readonly tagLookupFn?: (id: string) => string[] | undefined;

  constructor(options: ContainerAdapterOptions) {
    this.bot = options.bot;
    this.logger = options.logger.child('container');
    this.openTimeoutMs = options.openTimeoutMs;
    this.clickTimeoutMs = options.clickTimeoutMs ?? 2_000;
    this.vec = options.vec;
    this.tagLookupFn = options.tagLookup;
  }

  private tagLookup(): ((id: string) => string[] | undefined) | undefined {
    return this.tagLookupFn;
  }

  blockAt(position: Vec3): BlockLike | null {
    if (!this.bot.blockAt) return null;
    return this.bot.blockAt(this.vec(position));
  }

  /** The carried inventory as plain stacks, used for before/after verification. */
  carried(): ItemStack[] {
    const window = this.bot.inventory;
    if (!window) return [];
    return toItemStacks(window.items?.() ?? [], { tagLookup: this.tagLookup() });
  }

  /** Opens a container at a position, verifying a window actually opened. */
  async open(position: Vec3): Promise<WindowLike> {
    if (!this.bot.openContainer) throw containerError('this bot cannot open containers');
    const block = this.blockAt(position);
    if (!block) {
      throw navigationError(`no block is loaded at ${position.x},${position.y},${position.z}`, {
        position,
      });
    }
    if (!isLikelyContainer(block.name)) {
      throw containerError(`the block at ${position.x},${position.y},${position.z} is a ${block.name ?? 'unknown block'}, not a container`);
    }

    const opened = await Promise.race([
      this.bot.openContainer(block),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(timeoutError(`the container at ${position.x},${position.y},${position.z} did not open within ${this.openTimeoutMs}ms`)), this.openTimeoutMs),
      ),
    ]);

    const window = (opened ?? this.bot.currentWindow) as WindowLike | undefined;
    if (!window) throw containerError('the container screen did not open');

    // Wait until the window's slot array is populated: the server sends contents just after the open.
    const populated = await this.waitForWindow(window, (candidate) => Array.isArray(candidate.slots) && candidate.slots.length > 0);
    if (!populated) {
      await this.close(window);
      throw containerError('the container screen opened but never reported its contents');
    }
    return window;
  }

  private async waitForWindow(window: WindowLike, predicate: (window: WindowLike) => boolean, timeoutMs = 3_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(window)) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return predicate(window);
  }

  async close(window?: WindowLike | null): Promise<void> {
    const target = window ?? this.bot.currentWindow;
    if (!target || !this.bot.closeWindow) return;
    try {
      await this.bot.closeWindow(target);
    } catch (error) {
      this.logger.debug('closing the window failed', { error: String(error) });
    }
  }

  /** Reads a container's contents, opening and closing it if it is not already open. */
  async read(position: Vec3): Promise<ContainerContents> {
    const alreadyOpen = this.bot.currentWindow;
    const window = alreadyOpen ?? (await this.open(position));
    try {
      return this.contentsOf(window);
    } finally {
      if (!alreadyOpen) await this.close(window);
    }
  }

  contentsOf(window: WindowLike): ContainerContents {
    const container = window.containerItems?.() ?? [];
    const items = toItemStacks(container, { tagLookup: this.tagLookup() });
    // The container region is everything before the player inventory; when the window does not
    // report its own split, the protocol's usual 27-slot container is assumed.
    const total = window.inventoryStart ?? 27;
    const used = items.reduce((sum, item) => sum + Math.max(1, Math.ceil(item.count / 64)), 0);
    return { items, capacity: total, freeSlots: Math.max(0, total - used) };
  }

  /** Reads a container that is already open, without opening or closing anything. */
  readOpen(): ContainerContents | null {
    const window = this.bot.currentWindow;
    if (!window) return null;
    return this.contentsOf(window);
  }

  /**
   * Moves matching items into the open container (deposit) or out of it (withdraw).
   *
   * The move is verified: after clicking, the worker re-reads both sides and reports how many items
   * actually crossed. A shortfall is a `partial` failure, never a silent success.
   */
  async moveOpen(
    direction: 'withdraw' | 'deposit',
    query: string,
    limit: number,
  ): Promise<MoveResult> {
    const window = this.bot.currentWindow;
    if (!window) throw containerError('no container is open');

    const inventoryStart = window.inventoryStart ?? 27;
    const inventoryEnd = window.inventoryEnd ?? window.slots.length;
    const containerEnd = inventoryStart;

    const before = this.carried();
    const beforeContainer = this.contentsOf(window).items;
    const beforeCount = countIn(direction === 'withdraw' ? beforeContainer : before, query);
    if (beforeCount <= 0) {
      return {
        requested: limit,
        moved: 0,
        verification: {
          verified: true,
          before: 0,
          after: 0,
          expected: 0,
          note: `nothing matching "${query}" to move`,
        },
      };
    }

    const intended = Math.min(limit, beforeCount);
    let moved = 0;
    const attempts = Math.min(3, intended);

    for (let attempt = 0; attempt < attempts && moved < intended; attempt += 1) {
      const source = direction === 'withdraw' ? this.firstMatchingSlot(window, query, 0, containerEnd) : this.firstMatchingSlot(window, query, inventoryStart, inventoryEnd);
      const destination = direction === 'withdraw' ? this.firstFreeSlot(window, inventoryStart, inventoryEnd) : this.firstFreeSlot(window, 0, containerEnd);
      if (source < 0 || destination < 0) break;

      await this.transfer(source, destination);
      moved += 1;
    }

    const after = this.carried();
    const verification = verifyCountChange(before, after, query, moved, direction === 'withdraw' ? 'increase' : 'decrease');

    if (!verification.verified) {
      throw new BotError(
        `a ${direction} of "${query}" was not confirmed: ${verification.note}`,
        { category: 'container', mutation: 'partial', retryable: false, detail: { requested: intended, moved, verification } },
      );
    }

    return { requested: intended, moved, verification };
  }

  private firstMatchingSlot(window: WindowLike, query: string, start: number, end: number): number {
    for (let slot = start; slot < end; slot += 1) {
      const item = window.slots[slot];
      if (!item || !item.name) continue;
      const stack = toItemStacks([item], { tagLookup: this.tagLookup() })[0];
      if (stack && matchesQuery(stack, query)) return slot;
    }
    return -1;
  }

  private firstFreeSlot(window: WindowLike, start: number, end: number): number {
    for (let slot = start; slot < end; slot += 1) {
      const item = window.slots[slot];
      if (!item || !item.name || item.name === 'air') return slot;
    }
    return -1;
  }

  private async click(slot: number, mouseButton: number): Promise<void> {
    if (this.bot.clickWindow) {
      await this.bot.clickWindow(slot, mouseButton, 0);
    } else if (this.bot.moveSlotItem) {
      // Fall back to a direct slot move when the window API is not exposed.
      await this.bot.moveSlotItem(slot, slot);
      return;
    } else {
      throw containerError('this bot cannot click in a container window');
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  /**
   * Moves a whole stack from one window slot to another.
   *
   * Mineflayer's `moveSlotItem(source, destination)` is the API that actually moves a stack; the
   * raw click pair is only a fallback for a bot that exposes clicks but not slot moves. Getting this
   * order wrong is the difference between "the container works" and "the click did nothing".
   */
  private async transfer(source: number, destination: number): Promise<void> {
    if (this.bot.moveSlotItem) {
      await this.bot.moveSlotItem(source, destination);
      await new Promise((resolve) => setTimeout(resolve, 75));
      return;
    }
    await this.click(source, 0);
    await this.click(destination, 0);
  }

  /** Quick-moves a whole stack between the container and the inventory. */
  async quickMove(slot: number): Promise<void> {
    if (!this.bot.clickWindow) throw containerError('this bot cannot click in a container window');
    // Mouse button 0 with mode 1 is a shift-click ("quick move") in the protocol.
    await this.bot.clickWindow(slot, 0, 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /** Equips an armour item from the inventory, verifying the equipment actually changed. */
  async equipArmor(item: ItemStack): Promise<boolean> {
    if (!this.bot.equip || typeof item.slot !== 'number') return false;
    const window = this.bot.inventory;
    const raw = window?.slots[item.slot];
    if (!raw) return false;
    const before = this.armorIds();
    try {
      const destination = destinationForArmor(item.id);
      await this.bot.equip(raw, destination);
    } catch (error) {
      this.logger.debug('equipping armour failed', { id: item.id, error: String(error) });
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = this.armorIds();
    return after.length > before.length || after.join(',') !== before.join(',');
  }

  private armorIds(): string[] {
    const bot = this.bot;
    const window = bot.inventory;
    if (!window) return [];
    return toItemStacks(window.slots.slice(5, 9), { tagLookup: this.tagLookup() }).map((item) => item.id);
  }
}

function destinationForArmor(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes('helmet') || lower.includes('head')) return 'head';
  if (lower.includes('chestplate') || lower.includes('elytra')) return 'torso';
  if (lower.includes('leggings')) return 'legs';
  if (lower.includes('boots')) return 'feet';
  return 'head';
}

export type { MineflayerItemLike };
