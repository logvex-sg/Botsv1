/**
 * Placing a carried shulker box so its contents can be read or changed.
 *
 * A shulker box's contents are only reachable through a container screen, and a carried box does not
 * expose one. The sequence is therefore: equip the box, place it on a solid surface, open the
 * resulting container, do the work, then break the box and wait for it to come back.
 *
 * The `restore` step is guaranteed to run even when the caller throws, because a box left on the
 * ground is an item lost. If the box cannot be recovered, that is reported rather than hidden.
 */

import { BotError, containerError } from '../core/errors';
import type { Logger } from '../core/logger';
import type { Vec3 } from '../core/types';
import type { ContainerAdapter } from './container';
import type { WindowLike } from './inventory';

export interface PlacementBot {
  entity?: { position: { x: number; y: number; z: number }; yaw?: number; pitch?: number };
  blockAt?(position: unknown): { name?: string; position?: { x: number; y: number; z: number }; boundingBox?: string } | null;
  equip?(item: unknown, destination: string): Promise<void>;
  placeBlock?(referenceBlock: unknown, faceVector: unknown): Promise<void>;
  dig?(block: unknown): Promise<void>;
  lookAt?(position: unknown): Promise<void>;
  inventory?: { slots: Array<unknown>; hotbarStart?: number; selectedSlot?: number };
  heldItem?: unknown;
  waitForTicks?(ticks: number): Promise<void>;
  vec?: (x: number, y: number, z: number) => unknown;
}

export interface ShulkerHandle {
  window: WindowLike;
  /** Closes the window, breaks the placed box and waits for it to return. */
  restore: () => Promise<void>;
  position: Vec3;
}

export interface PlacementOptions {
  bot: PlacementBot;
  container: ContainerAdapter;
  logger: Logger;
  vec: (position: Vec3) => unknown;
  /** Milliseconds to wait for a placed block to appear. */
  placeTimeoutMs?: number;
}

const FACE_OFFSETS: Array<{ offset: Vec3; face: { x: number; y: number; z: number }; name: string }> = [
  { offset: { x: 0, y: -1, z: 0 }, face: { x: 0, y: 1, z: 0 }, name: 'below' },
  { offset: { x: 1, y: 0, z: 0 }, face: { x: -1, y: 0, z: 0 }, name: 'east' },
  { offset: { x: -1, y: 0, z: 0 }, face: { x: 1, y: 0, z: 0 }, name: 'west' },
  { offset: { x: 0, y: 0, z: 1 }, face: { x: 0, y: 0, z: -1 }, name: 'south' },
  { offset: { x: 0, y: 0, z: -1 }, face: { x: 0, y: 0, z: 1 }, name: 'north' },
  { offset: { x: 0, y: 1, z: 0 }, face: { x: 0, y: -1, z: 0 }, name: 'above' },
];

function isSolid(block: { name?: string } | null): boolean {
  if (!block || !block.name) return false;
  const name = block.name.toLowerCase();
  return name !== 'air' && name !== 'cave_air' && name !== 'void_air' && !name.includes('water') && !name.includes('lava');
}

export class ShulkerPlacement {
  private readonly bot: PlacementBot;
  private readonly container: ContainerAdapter;
  private readonly logger: Logger;
  private readonly vec: (position: Vec3) => unknown;
  private readonly placeTimeoutMs: number;

  constructor(options: PlacementOptions) {
    this.bot = options.bot;
    this.container = options.container;
    this.logger = options.logger.child('shulker-placement');
    this.vec = options.vec;
    this.placeTimeoutMs = options.placeTimeoutMs ?? 3_000;
  }

  private currentPosition(): Vec3 | null {
    const position = this.bot.entity?.position;
    if (!position) return null;
    return { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
  }

  private blockAt(position: Vec3): { name?: string } | null {
    if (!this.bot.blockAt) return null;
    return this.bot.blockAt(this.vec(position));
  }

  /** Finds an adjacent solid block to place the box against. */
  private findReference(): { block: unknown; face: unknown; target: Vec3 } | null {
    const position = this.currentPosition();
    if (!position) return null;
    for (const candidate of FACE_OFFSETS) {
      const reference: Vec3 = { x: position.x + candidate.offset.x, y: position.y + candidate.offset.y, z: position.z + candidate.offset.z };
      const block = this.blockAt(reference);
      if (!isSolid(block)) continue;
      const target: Vec3 = { x: reference.x + candidate.face.x, y: reference.y + candidate.face.y, z: reference.z + candidate.face.z };
      const targetBlock = this.blockAt(target);
      if (isSolid(targetBlock)) continue;
      return { block, face: this.vec(candidate.face), target };
    }
    return null;
  }

  /** Places a shulker box from an inventory slot and opens it. */
  async place(slot: number): Promise<ShulkerHandle> {
    const reference = this.findReference();
    if (!reference) {
      throw containerError('no solid surface next to the worker to place the shulker box on');
    }
    if (!this.bot.placeBlock) throw containerError('this bot cannot place blocks');

    const window = this.bot.inventory;
    const raw = window?.slots[slot];
    if (!raw) throw containerError(`nothing is carried in slot ${slot}`);
    if (!this.bot.equip) throw containerError('this bot cannot equip items');

    await this.bot.equip(raw, 'hand');
    if (this.bot.waitForTicks) await this.bot.waitForTicks(2);

    try {
      await this.bot.placeBlock(reference.block, reference.face);
    } catch (error) {
      throw new BotError(`placing the shulker box failed: ${String(error)}`, { category: 'container', mutation: 'none', retryable: true });
    }

    // Wait for the placed block to actually appear before opening it.
    const deadline = Date.now() + this.placeTimeoutMs;
    while (Date.now() < deadline) {
      const placed = this.blockAt(reference.target);
      if (placed && placed.name && placed.name.toLowerCase().includes('shulker')) break;
      await new Promise((resolve) => setTimeout(resolve, 75));
    }

    const opened = await this.container.open(reference.target);
    const handle: ShulkerHandle = {
      window: opened,
      position: reference.target,
      restore: async () => {
        await this.container.close(opened);
        await this.breakAndCollect(reference.target);
      },
    };
    return handle;
  }

  /** Breaks the placed box and waits for the item to return to the inventory. */
  private async breakAndCollect(position: Vec3): Promise<void> {
    if (!this.bot.dig) {
      this.logger.warn('cannot break the placed shulker box: this bot has no dig method');
      return;
    }
    const block = this.bot.blockAt?.(this.vec(position));
    if (!block) return;
    try {
      await this.bot.dig(block);
    } catch (error) {
      this.logger.warn('breaking the placed shulker box failed', { error: String(error) });
      return;
    }
    // Give the server a moment to send the pickup.
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const stillThere = this.blockAt(position);
      if (!stillThere || stillThere.name === 'air') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.logger.warn('the placed shulker box may not have been recovered');
  }

  canPlace(): boolean {
    return Boolean(this.bot.placeBlock) && this.findReference() !== null;
  }
}
