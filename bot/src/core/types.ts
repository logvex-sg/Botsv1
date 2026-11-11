/**
 * Shared domain types for the bot runtime.
 *
 * These are Minecraft-free. Anything that needs a live world or entity lives under `mc/`; anything
 * here can be unit-tested without a server.
 */

export type RuntimeKind = 'mineflayer' | 'fabric';

/** A 3D block position. Always integers — containers and structures are block-aligned. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A 3D position that may be fractional, used for entity positions and navigation targets. */
export interface Position {
  x: number;
  y: number;
  z: number;
}

export type Dimension = 'overworld' | 'nether' | 'end' | string;

export interface BlockRef {
  position: Vec3;
  dimension: Dimension;
}

/** An inclusive axis-aligned box. Both corners are inside the region. */
export interface Region {
  min: Vec3;
  max: Vec3;
  dimension: Dimension;
}

/**
 * Item metadata as the server actually reported it.
 *
 * Every field is optional and its absence means *unknown*, never *absent*. That distinction is the
 * whole point: a worker that could not read enchantments must not be treated as "has none".
 */
export interface ItemMeta {
  tags?: string[];
  enchantments?: Array<{ id: string; level: number }>;
  components?: string[];
  customName?: string;
}

/** One stack, flattened for transport and comparison. */
export interface ItemStack {
  /** Namespaced id, e.g. `minecraft:diamond_pickaxe`. */
  id: string;
  /** Display name if the server reported one. */
  name?: string;
  count: number;
  slot?: number;
  damage?: number;
  maxDamage?: number;
  durability?: number;
  meta?: ItemMeta;
}

export interface ContainerContents {
  items: ItemStack[];
  capacity: number;
  freeSlots: number;
}

export interface ContainerRecord {
  id: string;
  networkId: string;
  label: string;
  position: Vec3;
  dimension: Dimension;
  /** Category ids this container is allowed to hold. Empty means "anything". */
  categories: string[];
  protected: boolean;
  registeredAt: number;
  lastSeenAt?: number;
  lastCapacity?: number;
}

export interface StorageNetwork {
  id: string;
  name: string;
  dimension: Dimension;
  /** Ids of containers in this network. */
  containers: string[];
  paused: boolean;
  createdAt: number;
}

/** A rule that decides whether an item belongs in a category. */
export interface ClassifierRule {
  kind: 'tag' | 'enchantment' | 'component' | 'namespace' | 'id' | 'id-contains' | 'name-contains' | 'durability-below' | 'count-at-least';
  value: string | number;
  /** For enchantment rules: minimum level. */
  level?: number;
}

export interface ItemCategory {
  id: string;
  name: string;
  rules: ClassifierRule[];
  /** Priority for tie-breaking; higher wins. */
  priority: number;
  /** When true, an item may be in several categories. */
  multi?: boolean;
}

export type ShulkerSlot = 'empty' | 'partial' | 'full' | 'unknown';

export interface ShulkerRecord {
  /** Inventory slot index the shulker box occupies. */
  slot: number;
  /** Namespaced id of the box item. */
  id?: string;
  label: string;
  items: ItemStack[];
  usedSlots: number;
  freeSlots: number;
  dominantCategory?: string;
  mixed?: boolean;
  customName?: string;
  /** True when contents could not be read (server did not permit it). */
  opaque: boolean;
  inspectedAt?: number;
}

export interface PortalRecord {
  id: string;
  label: string;
  position: Vec3;
  dimension: Dimension;
  /** Where the portal leads, if known. */
  target?: Vec3;
  targetDimension?: Dimension;
  registeredAt: number;
  lastSeenAt?: number;
  confirmed: boolean;
}

export type StructureKind = 'storage' | 'farm' | 'workshop' | 'processing' | 'temporary' | 'other';

export type MaintenanceState = 'ok' | 'due' | 'overdue' | 'unknown';

export interface RegisteredStructure {
  id: string;
  name: string;
  kind: StructureKind;
  region: Region;
  owner?: string;
  protected: boolean;
  maintenance: MaintenanceState;
  /** When maintenance was last confirmed. */
  lastMaintainedAt?: number;
  /** Days between maintenance runs. */
  maintenanceIntervalDays?: number;
  notes?: string;
  createdAt: number;
}

export interface WorkerSnapshot {
  workerId: string;
  username: string;
  runtime: RuntimeKind;
  server?: string;
  dimension?: Dimension;
  gamemode?: string;
  position?: Position;
  health?: number;
  maxHealth?: number;
  food?: number;
  saturation?: number;
  armorPieces?: number;
  totems?: number;
  foodItems?: number;
  heldItem?: string;
  offhandItem?: string;
  currentTask?: string;
  lastActivity?: string;
  lastActivityAt?: number;
  lastError?: string;
  paused: boolean;
  stopped: boolean;
  pluginCount?: number;
  activePlugin?: string;
  connectedAt?: number;
}

export interface TaskResult {
  ok: boolean;
  taskId: string;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  /** Structured failure detail when ok is false. */
  error?: { category: string; retryable: boolean; mutation: string; detail?: Record<string, unknown> };
}

/** A short-lived piece of evidence that a mutation actually landed. */
export interface VerificationOutcome {
  verified: boolean;
  before: number;
  after: number;
  expected: number;
  note: string;
}
