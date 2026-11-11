/**
 * The Fleet Manager side of the worker protocol.
 *
 * This mirrors `src/main/java/com/logvex/worker/core/Protocol.java`. The two are kept in
 * sync by hand because one is TypeScript and one is Java; `tests/unit/worker-protocol-drift.test.ts`
 * reads the Java source and asserts this file matches it, so a drift between them fails the build
 * rather than failing in production. The contract is documented in `docs/PROTOCOL.md`.
 *
 * Security note: this is a closed set. The host may only ever send one of these task kinds, and the
 * worker refuses anything else, so neither side can be talked into executing arbitrary code.
 */

/** Bumped whenever an envelope or payload changes shape. Mismatches are refused, not coerced. */
/**
 * The modules a worker can run, mirrored from the mod's module registry.
 *
 * Shared so the Worker Mode screen and the service that writes `logvex-worker.json` list the same
 * set; a module missing here would be invisible to the operator and silently always-on.
 */
export const WORKER_MODULES = [
  'StatusReporter',
  'InventoryReporter',
  'RegearTask',
  'CommandTask',
  'ChatTask',
  'PositionTask',
  'EflyTask',
  'CountTask',
  'SearchTask',
  'StorageTask',
  'ShulkerTask',
  'PortalTask',
] as const;

export const WORKER_PROTOCOL_VERSION = 4;

/** The WebSocket path workers dial. */
export const WORKER_PATH = '/worker';

/** worker -> host message types. */
export const WorkerInbound = {
  HELLO: 'hello',
  REGISTER: 'register',
  STATUS: 'status',
  INVENTORY: 'inventory',
  EQUIPMENT: 'equipment',
  RESULT: 'result',
  PROGRESS: 'progress',
  PONG: 'pong',
  ERROR: 'error',
  LOG: 'log',
} as const;

/** host -> worker message types. */
export const WorkerOutbound = {
  HELLO_ACK: 'hello-ack',
  COMMAND: 'command',
  TASK: 'task',
  PING: 'ping',
  KICK: 'kick',
  CONTROL: 'control',
  CONFIG: 'config',
} as const;

/**
 * Control actions the host may ask a worker to perform on its own link.
 *
 * This is what makes "Connect", "Disconnect" and "Restart" real buttons in the host rather than
 * labels: the worker owns its connection, so only it can drop it or dial it again. `connect` starts
 * the link if it was stopped, `disconnect` stops it until a later `connect`, `restart` cycles it,
 * and `pause`/`resume` gate whether the worker will accept mutating tasks.
 */
export const CONTROL_ACTIONS = ['connect', 'disconnect', 'restart', 'pause', 'resume'] as const;

export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export function isControlAction(value: string): value is ControlAction {
  return (CONTROL_ACTIONS as readonly string[]).includes(value);
}

/** The task kinds a worker will execute. The host UI offers only these. */
export const TASK_KINDS = [
  'status',
  'inventory',
  'count',
  'search',
  'equipment',
  'regear',
  'command',
  'chat',
  'position',
  'efly',
  'container-read',
  'container-move',
  'shulker-read',
  'shulker-pack',
  'shulker-unpack',
  'restock',
  'portal-scan',
  'nl-task',
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export function isTaskKind(value: string): value is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(value);
}

/**
 * Task kinds that change state and may only run one at a time per worker.
 *
 * Mirrors the worker's `TaskCatalog.isMutating`: these move the client, talk to the server or move
 * items, so the server refuses a second conflicting one rather than letting them interleave. The
 * storage kinds (`container-move`, `shulker-pack`, `shulker-unpack`, `restock`) are exclusive
 * because two at once could fight over the same container.
 */
export const EXCLUSIVE_TASK_KINDS: readonly TaskKind[] = [
  'regear', 'command', 'chat', 'efly', 'container-move', 'shulker-pack', 'shulker-unpack', 'restock',
];

export function isExclusiveKind(value: string): boolean {
  return (EXCLUSIVE_TASK_KINDS as readonly string[]).includes(value);
}

/** A worker->host or host->worker envelope. */
export interface WorkerEnvelope {
  v: number;
  type: string;
  id?: string | null;
  payload?: Record<string, unknown>;
}

/** The status snapshot a worker sends on registration and on every heartbeat. */
export interface WorkerSnapshot {
  workerId: string;
  label: string;
  username: string;
  minecraftVersion: string;
  serverAddress: string;
  dimension: string;
  gameMode: string;
  inWorld: boolean;
  x: number;
  y: number;
  z: number;
  health: number;
  maxHealth: number;
  food: number;
  saturation: number;
  armorPieces: number;
  totems: number;
  foodItems: number;
  heldItem: string;
  offhandItem: string;
  currentTask: string;
  lastActivity: string;
  lastActivityAt: number;
  lastError: string;
  eflyActive: boolean;
  eflyTarget: string;
  taskProgress: string;
  /** True while the host has paused mutating tasks on this worker (Start/Stop). */
  paused: boolean;
  /** True while the host has disconnected the worker's service (it stays reachable for control). */
  stopped: boolean;
  totalItems: number;
  distinctItems: number;
  freeSlots: number;
  capabilities: string[];
  /** The Fabric Loader version the worker reported, for the compatibility matrix. */
  fabricVersion: string;
  /** The Meteor version the worker reported, when the integration is present. */
  meteorVersion: string;
  /** The mod version the worker reported. */
  modVersion: string;
}

/** One reported item stack. */
export interface WorkerItem {
  id: string;
  name: string;
  count: number;
  slot: number;
  damage: number;
  maxDamage: number;
  damageable: boolean;
  /**
   * Item tags the stack carries, e.g. `minecraft:logs`. Optional: a worker that predates metadata
   * reporting omits it, and a rule that needs a tag then simply does not match — absence is not
   * evidence of presence. See `packages/item-classifier`.
   */
  tags?: string[];
  /** Enchantments on the stack, by id and level. */
  enchantments?: { id: string; level: number }[];
  /** Data component ids present on the stack, e.g. `minecraft:container`. */
  components?: string[];
  /** The stack's custom name when it has one, else null. */
  customName?: string | null;
}

/** A task result as reported by a worker. */
export interface WorkerTaskResult {
  ok: boolean;
  taskId: string;
  kind: string;
  message: string;
  data: Record<string, unknown>;
}

export function emptySnapshot(workerId: string): WorkerSnapshot {
  return {
    workerId,
    label: '',
    username: '',
    minecraftVersion: '',
    serverAddress: '',
    dimension: 'unknown',
    gameMode: 'unknown',
    inWorld: false,
    x: 0,
    y: 0,
    z: 0,
    health: 0,
    maxHealth: 0,
    food: 0,
    saturation: 0,
    armorPieces: 0,
    totems: 0,
    foodItems: 0,
    heldItem: '',
    offhandItem: '',
    currentTask: '',
    lastActivity: '',
    lastActivityAt: 0,
    lastError: '',
    eflyActive: false,
    eflyTarget: '',
    taskProgress: '',
    paused: false,
    stopped: false,
    totalItems: 0,
    distinctItems: 0,
    freeSlots: 0,
    capabilities: [],
    fabricVersion: '',
    meteorVersion: '',
    modVersion: '',
  };
}

/**
 * Defensive parse of an inbound frame.
 *
 * A worker is a remote process the host does not fully trust, so nothing is assumed: a frame that
 * is not an object with a string `type` is dropped, and unknown types are ignored rather than
 * treated as errors (which keeps an older host compatible with a newer worker).
 */
export function decodeEnvelope(raw: string): WorkerEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== 'string' || record.type.length === 0) return null;
  const payload = typeof record.payload === 'object' && record.payload !== null && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : {};
  return {
    v: typeof record.v === 'number' ? record.v : WORKER_PROTOCOL_VERSION,
    type: record.type,
    id: typeof record.id === 'string' ? record.id : null,
    payload,
  };
}

export function encodeEnvelope(envelope: WorkerEnvelope): string {
  return JSON.stringify(envelope);
}
