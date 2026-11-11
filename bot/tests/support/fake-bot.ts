/**
 * A controllable fake Mineflayer bot.
 *
 * The fake implements the same shape as the real bot — an EventEmitter with `inventory`,
 * `currentWindow`, `blockAt`, `openContainer`, `moveSlotItem` and `pathfinder` — so the adapters can
 * be tested without a socket. It is a *hand-written* fake, not a mock library: it holds real state
 * (slots, a current window) and mutates it the way a server would, which is what lets a test assert
 * that a move actually changed the inventory.
 */

import { EventEmitter } from 'node:events';

export interface FakeItem {
  name: string;
  displayName?: string;
  count: number;
  slot?: number;
  type?: number;
  metadata?: number;
  maxDurability?: number;
  enchants?: Array<{ name: string; lvl: number }>;
  customName?: string | null;
  components?: Array<{ name: string }>;
  nbt?: unknown;
  itemComponents?: unknown;
}

export interface FakeWindow {
  type: string;
  title: string;
  slots: Array<FakeItem | null>;
  inventoryStart: number;
  inventoryEnd: number;
  hotbarStart: number;
  items(): Array<FakeItem | null>;
  containerItems(): Array<FakeItem | null>;
}

export interface FakeBlock {
  name: string;
  position: { x: number; y: number; z: number };
  type?: number;
}

export interface FakeBotOptions {
  /** Slot count of the player inventory region. */
  inventorySize?: number;
  /** Starting position. */
  position?: { x: number; y: number; z: number };
  /** Blocks keyed by `x,y,z`, returned by `blockAt`. */
  blocks?: Map<string, FakeBlock>;
  /** Whether `moveSlotItem` should actually move items. Defaults to true. */
  movesWork?: boolean;
}

const AIR: FakeItem | null = null;

export class FakeBot extends EventEmitter {
  inventory: FakeWindow;
  currentWindow: FakeWindow | null = null;
  entity: { position: { x: number; y: number; z: number }; equipment?: Array<FakeItem | null>; heldItem?: FakeItem | null };
  game = { dimension: 'overworld', gameMode: 'creative' };
  health = 20;
  food = 20;
  registry = { blocksByName: { chest: { id: 54 }, shulker_box: { id: 500 } } };
  pathfinder?: {
    setGoal: (goal: unknown) => void;
    goto: (goal: unknown) => Promise<void>;
    setMovements: (movements: unknown) => void;
    stop: () => void;
    isMoving: () => boolean;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };
  readonly blocks: Map<string, FakeBlock>;
  private readonly movesWork: boolean;
  /** Number of times each mutating method was called. */
  readonly calls: Record<string, number> = {};

  constructor(options: FakeBotOptions = {}) {
    super();
    const inventorySize = options.inventorySize ?? 36;
    // A player inventory window: 9 crafting slots, then the inventory, then the hotbar.
    const slots: Array<FakeItem | null> = new Array(9 + inventorySize + 9).fill(AIR);
    this.inventory = {
      type: 'minecraft:inventory',
      title: 'Inventory',
      slots,
      inventoryStart: 9,
      inventoryEnd: 9 + inventorySize,
      hotbarStart: 9 + inventorySize,
      items: () => slots.slice(9, 9 + inventorySize).filter((item): item is FakeItem => Boolean(item)),
      containerItems: () => [],
    };
    this.entity = { position: options.position ?? { x: 0, y: 64, z: 0 }, equipment: [AIR, AIR, AIR, AIR], heldItem: null };
    this.blocks = options.blocks ?? new Map();
    this.movesWork = options.movesWork ?? true;
    this.installPathfinder();
  }

  private installPathfinder(): void {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    this.pathfinder = {
      setGoal: () => undefined,
      setMovements: () => undefined,
      stop: () => undefined,
      isMoving: () => false,
      on: (event, listener) => {
        const bucket = listeners.get(event) ?? [];
        bucket.push(listener);
        listeners.set(event, bucket);
      },
      goto: async () => {
        // A walk that immediately succeeds: the goal is "reached" as soon as it is requested.
        for (const listener of listeners.get('goal_reached') ?? []) listener();
      },
    };
  }

  private blockKey(position: { x: number; y: number; z: number }): string {
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
  }

  blockAt(position: { x: number; y: number; z: number }): FakeBlock | null {
    this.calls.blockAt = (this.calls.blockAt ?? 0) + 1;
    return this.blocks.get(this.blockKey(position)) ?? null;
  }

  setBlock(name: string, position: { x: number; y: number; z: number }): void {
    this.blocks.set(this.blockKey(position), { name, position, type: name === 'chest' ? 54 : 0 });
  }

  /** Puts an item into a player-inventory slot. */
  setInventory(slot: number, item: FakeItem | null): void {
    this.inventory.slots[slot] = item ? { ...item, slot } : null;
  }

  setEquipment(index: number, item: FakeItem | null): void {
    this.entity.equipment![index] = item;
  }

  async openContainer(block: FakeBlock): Promise<FakeWindow> {
    this.calls.openContainer = (this.calls.openContainer ?? 0) + 1;
    const containerSlots = new Array<FakeItem | null>(27).fill(AIR);
    const window: FakeWindow = {
      type: 'minecraft:generic_9x3',
      title: 'Chest',
      slots: [...containerSlots, ...this.inventory.slots],
      inventoryStart: 27,
      inventoryEnd: 27 + (this.inventory.inventoryEnd - this.inventory.inventoryStart),
      hotbarStart: 27 + (this.inventory.hotbarStart - this.inventory.inventoryStart),
      items: () => window.slots.slice(0, 27).filter((item): item is FakeItem => Boolean(item)),
      containerItems: () => window.slots.slice(0, 27),
    };
    this.currentWindow = window;
    this.blockAt(block.position);
    return window;
  }

  async closeWindow(): Promise<void> {
    this.calls.closeWindow = (this.calls.closeWindow ?? 0) + 1;
    // Fold any container contents back so a subsequent read reflects reality.
    this.currentWindow = null;
  }

  async moveSlotItem(sourceSlot: number, destinationSlot: number): Promise<void> {
    this.calls.moveSlotItem = (this.calls.moveSlotItem ?? 0) + 1;
    if (!this.movesWork) return;
    const window = this.currentWindow ?? this.inventory;
    const source = window.slots[sourceSlot];
    if (!source) return;
    const destination = window.slots[destinationSlot];
    if (destination) return;
    window.slots[destinationSlot] = { ...source, slot: destinationSlot };
    window.slots[sourceSlot] = null;
    // Mirror the change into the player inventory when the window is the player's own.
    if (window === this.inventory) return;
    if (destinationSlot >= (window.inventoryStart ?? 27)) {
      const playerSlot = destinationSlot - (window.inventoryStart ?? 27) + this.inventory.inventoryStart;
      this.inventory.slots[playerSlot] = { ...source, slot: playerSlot };
      this.inventory.slots[sourceSlot] = null;
    }
  }

  async clickWindow(slot: number, mouseButton: number, mode: number): Promise<void> {
    this.calls.clickWindow = (this.calls.clickWindow ?? 0) + 1;
    void mouseButton;
    void mode;
    void slot;
  }

  async equip(item: FakeItem, destination: string): Promise<void> {
    this.calls.equip = (this.calls.equip ?? 0) + 1;
    if (destination === 'hand') this.entity.heldItem = item;
  }

  async waitForTicks(): Promise<void> {
    return undefined;
  }

  chat(message: string): void {
    this.calls.chat = (this.calls.chat ?? 0) + 1;
    this.emit('chat', message);
  }

  quit(): void {
    this.emit('end', 'quit');
  }
}
