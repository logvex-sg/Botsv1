/**
 * Shared domain types used by both the Electron main process and the React renderer.
 *
 * The Host controls *workers*: real Minecraft clients running the Logvex Worker mod. A worker
 * dials out to the host over a WebSocket, so the host never launches a bot itself and never needs
 * an inbound port on a client. Everything here is plain data so it can be serialised over IPC,
 * persisted in SQLite and sent over the WebSocket API without special handling.
 */

export type ThemeName = 'dark' | 'light';
export type UiMode = 'beginner' | 'advanced';

/** The two configuration modes the app can run in. Kept strictly apart. */
export type AppMode = 'host' | 'worker';

export interface AppSettings {
  /** Which mode the app was last configured for. */
  mode: AppMode;
  /** False until the operator has chosen Host or Worker on the first screen. */
  onboarded: boolean;
  apiPort: number;
  apiHost: string;
  apiEnabled: boolean;
  theme: ThemeName;
  /** 'beginner' hides advanced controls and uses simpler language. */
  uiMode: UiMode;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  notify: boolean;
  /** Whether the host accepts worker connections. */
  workerServerEnabled: boolean;
  /** Port the worker WebSocket server listens on. */
  workerServerPort: number;
  /** Address the worker server binds to. Loopback by default; a LAN address to reach other PCs. */
  workerServerHost: string;
  /** How long a pairing code stays valid, in seconds. */
  pairingCodeTtlSeconds: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'host',
  onboarded: false,
  apiPort: 8787,
  apiHost: '127.0.0.1',
  apiEnabled: true,
  theme: 'dark',
  uiMode: 'beginner',
  logLevel: 'info',
  notify: true,
  workerServerEnabled: true,
  workerServerPort: 8721,
  workerServerHost: '127.0.0.1',
  pairingCodeTtlSeconds: 600,
};

export interface HealthReport {
  ok: boolean;
  version: string;
  uptimeMs: number;
  database: { ok: boolean; path: string };
  workerServer: { enabled: boolean; running: boolean; host: string; port: number };
  workers: { total: number; online: number };
}

export type EventSeverity = 'info' | 'warning' | 'error' | 'success';

export interface FleetEvent {
  id: string;
  type: string;
  source: string;
  severity: EventSeverity;
  workerId: string | null;
  message: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface NotificationItem {
  id: string;
  eventId: string;
  type: string;
  severity: EventSeverity;
  title: string;
  body: string;
  read: boolean;
  timestamp: number;
}

// ---------------------------------------------------------------- workers
//
// A "worker" is a Minecraft client running the logvex-worker mod, which dials the host over a
// WebSocket. Its live connection state is held in memory by the worker server; these types are
// the durable record and the joined view the UI renders.

/**
 * The host's view of a worker's state.
 *
 * - `ONLINE`        connected and answering, nothing running
 * - `BUSY`          connected, a task is in flight
 * - `UNRESPONSIVE`  connected but the heartbeat is overdue (network stall, or the client froze)
 * - `DEGRADED`      connected but its service is paused or stopped by the operator
 * - `OFFLINE`       not connected at all
 */
export type WorkerStatus = 'ONLINE' | 'BUSY' | 'UNRESPONSIVE' | 'DEGRADED' | 'OFFLINE';

export interface WorkerGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: number;
  /** Task preset ids this group runs by default. */
  defaultTaskPresetIds: string[];
  /** Equipment preset ids this group uses by default. */
  defaultEquipmentPresetIds: string[];
  /** Permission keys granted to the group. */
  permissions: string[];
  archived: boolean;
}

/** A reusable set of group defaults. Applying one never touches existing workers. */
export interface GroupTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  defaultTaskPresetIds: string[];
  defaultEquipmentPresetIds: string[];
  permissions: string[];
  createdAt: number;
}

/**
 * A server profile: an *organisational record*, not proof the server is reachable.
 *
 * It groups workers by the environment they are meant to run in. Actual connection state always
 * comes from what a worker reports, never from this row.
 */
export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  /** The Minecraft version this profile targets, for the compatibility matrix. */
  version: string;
  environment: 'production' | 'testing' | 'staging' | 'development';
  notes: string;
  tags: string[];
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A server profile plus the live counts the UI shows beside it. */
export interface ServerProfileView extends ServerProfile {
  workers: number;
  online: number;
  /** How many assigned workers report this address as the server they are on. */
  connectedToIt: number;
}

/** A reusable task configuration. */
export interface TaskPreset {
  id: string;
  name: string;
  description: string;
  kind: string;
  params: Record<string, unknown>;
  targetWorkerIds: string[];
  targetGroupIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** A scheduled task. `lastFiredAt`/`fireCount` give duplicate-run protection across restarts. */
export interface ScheduleRecord {
  id: string;
  name: string;
  presetId: string | null;
  kind: string;
  params: Record<string, unknown>;
  targetWorkerIds: string[];
  targetGroupIds: string[];
  scheduleKind: 'once' | 'interval' | 'daily';
  startAt: number;
  intervalMs: number | null;
  timeOfDay: string | null;
  stopAt: number | null;
  enabled: boolean;
  lastFiredAt: number | null;
  fireCount: number;
  createdAt: number;
  updatedAt: number;
}

/** One WHEN/AND/THEN automation rule. */
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** The event that triggers the rule, e.g. `WORKER_REGISTERED`. */
  event: string;
  conditions: RuleCondition[];
  /** The task kind the rule dispatches. */
  action: string;
  cooldownMs: number;
  maxRuns: number | null;
  runCount: number;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A simple, inspectable condition. No scripting language; a fixed set of comparisons. */
export interface RuleCondition {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
  value: string;
}

/** A container a worker reported, tracked separately from player inventories. */
export interface ContainerRecord {
  id: string;
  workerId: string;
  label: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  items: import('./workers').WorkerItem[];
  inspectedAt: number;
}

/** One audit-trail entry: an action the Host took. */
export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface WorkerRecord {
  id: string;
  label: string;
  username: string;
  minecraftVersion: string;
  serverAddress: string;
  protocolVersion: number;
  modVersion: string;
  groupId: string | null;
  notes: string;
  firstSeen: number;
  lastSeen: number;
  lastAddress: string;
  status: WorkerStatus;
  /** Additional labels beyond the primary group. */
  tags: string[];
  /** The server profile this worker is assigned to, if any. */
  serverProfileId: string | null;
  fabricVersion: string;
  meteorVersion: string;
  /** Capability names the worker last advertised. */
  capabilities: string[];
  archived: boolean;
}

/** The durable row plus the live connection state, which is what the UI actually renders. */
export interface WorkerView extends WorkerRecord {
  online: boolean;
  /** Seconds since the last heartbeat, or null when offline. */
  lastHeartbeatAgeSeconds: number | null;
  connectedAt: number | null;
  snapshot: import('./workers').WorkerSnapshot;
  currentTask: string;
  capabilities: string[];
  /** True while a task is in flight on this worker. */
  busy: boolean;
  /** True while the operator has paused mutating tasks on this worker. */
  paused: boolean;
  /** True while the operator has disconnected this worker's service. */
  stopped: boolean;
}

export type WorkerTaskStatus = 'PENDING' | 'DISPATCHED' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'REFUSED';

export interface WorkerTaskRecord {
  id: string;
  workerId: string;
  kind: string;
  status: WorkerTaskStatus;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  dispatchedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  actor: string;
}

export interface WorkerCommandRecord {
  id: string;
  workerId: string;
  kind: 'command' | 'chat';
  line: string;
  ok: boolean;
  response: string;
  createdAt: number;
}

/** A single loadout line: hold at least `count` of `query`. */
export interface RegearItem {
  query: string;
  count: number;
  label: string;
}

export interface RegearPreset {
  id: string;
  name: string;
  description: string;
  items: RegearItem[];
  minArmorPieces: number;
  minFood: number;
  lowDurabilityPercent: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkerInventorySnapshot {
  workerId: string;
  capturedAt: number;
  carried: import('./workers').WorkerItem[];
  accessible: import('./workers').WorkerItem[];
  armor: import('./workers').WorkerItem[];
  containerOpen: boolean;
}

/** A missing-item line in a regear comparison. */
export interface RegearGap {
  query: string;
  label: string;
  required: number;
  found: number;
  missing: number;
}

export interface RegearComparison {
  workerId: string;
  presetId: string;
  presetName: string;
  ready: boolean;
  gaps: RegearGap[];
  armorPieces: number;
  minArmorPieces: number;
  food: number;
  minFood: number;
  damaged: string[];
  /** When this comparison was computed from the last reported inventory. */
  capturedAt: number;
}

/** A per-worker item count, with the timestamp of the inventory it came from. */
export interface ItemCountRow {
  workerId: string;
  label: string;
  username: string;
  online: boolean;
  count: number;
  capturedAt: number;
}

export interface ItemCountReport {
  query: string;
  total: number;
  rows: ItemCountRow[];
  /** True when at least one worker's snapshot is stale enough to be worth re-requesting. */
  stale: boolean;
  /** Workers whose reported inventory is older than the freshness window, in ms. */
  oldestCapture: number | null;
}

/**
 * Worker Mode settings.
 *
 * Kept entirely apart from the host's {@link AppSettings}: a machine is a host or a worker, and the
 * two configurations must never blend. These are also exactly the values the Fabric mod needs, so
 * provisioning a bot is a straight copy of this object.
 */
export interface WorkerModeSettings {
  hostAddress: string;
  hostPort: number;
  /** The shared token, or blank to pair with a one-time code instead. */
  token: string;
  pairingCode: string;
  /** A stable id, so the host keeps this worker's label, group and history across restarts. */
  workerId: string;
  workerName: string;
  groupName: string;
  autoConnect: boolean;
  heartbeatSeconds: number;
  /** Per-module on/off toggles, keyed by module name. */
  modules: Record<string, boolean>;
  /** Which mutating task categories this worker will accept. */
  permissions: { regear: boolean; command: boolean; chat: boolean; efly: boolean };
}

export type WorkerClientState = 'idle' | 'connecting' | 'handshaking' | 'registered' | 'refused' | 'disconnected';

/** The live state of this machine's Worker Mode connection to a host. */
export interface WorkerClientStatus {
  state: WorkerClientState;
  connected: boolean;
  registered: boolean;
  workerId: string;
  username: string;
  protocolVersion: number;
  /** The token the host granted on a successful pairing, if any. */
  grantedToken: string;
  lastError: string;
  paused: boolean;
  stopped: boolean;
  /** A short, human-readable line for the Worker Mode panel. */
  detail: string;
}

/**
 * A partial Worker Mode update.
 *
 * `modules` and `permissions` are themselves partial, so a caller can flip a single toggle without
 * having to resend the whole map.
 */
export type WorkerModePatch = Partial<Omit<WorkerModeSettings, 'modules' | 'permissions'>> & {
  modules?: Record<string, boolean>;
  permissions?: Partial<WorkerModeSettings['permissions']>;
};

export interface WorkerProvisionResult {
  ok: boolean;
  path: string;
  workerId: string;
  error?: string;
}

export interface WorkerOverview {
  total: number;
  online: number;
  offline: number;
  busy: number;
  unresponsive: number;
  degraded: number;
  activeTasks: number;
  trackedItems: number;
  groups: { group: WorkerGroup; workers: number; online: number }[];
  recent: FleetEvent[];
}

/** A short-lived pairing code a worker presents to join the host. */
export interface PairingCode {
  code: string;
  createdAt: number;
  expiresAt: number;
}

/** One worker's durable credential, as shown in the Dashboard. The token itself is never sent. */
export interface PairedWorkerView {
  workerId: string;
  installationId: string;
  label: string;
  username: string;
  createdAt: number;
  lastPairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

/** The whole pairing panel state: the active code, its remaining life and every paired worker. */
export interface PairingStatus {
  code: PairingCode | null;
  secondsRemaining: number;
  workers: PairedWorkerView[];
}

/** A single line a worker forwarded about itself. */
export interface WorkerConsoleLine {
  at: number;
  message: string;
}

// ------------------------------------------------- autonomous storage & maintenance
//
// The storage subsystem is a layer on top of the existing worker/inventory system: it never
// invents inventory state. A "storage network" is a named set of registered containers that live
// on one or more workers; every container row is a *reported* observation (when it was inspected
// and what it held), never a live claim. Automation only ever asks a worker to perform supported
// inventory interactions and then records what the worker reported back.

/**
 * How much automation a subsystem is allowed to perform without asking.
 *
 * - `manual`     only act on an explicit operator request
 * - `supervised` generate a plan and require approval before every execution
 * - `automatic`  execute approved operations without asking again (still subject to safety rules)
 */
export type AutomationMode = 'manual' | 'supervised' | 'automatic';

/** What kind of storage a registered container is. */
export type ContainerKind = 'input' | 'output' | 'intermediate' | 'disposal' | 'shulker_reserve' | 'general';

/**
 * One rule a storage category matches items by.
 *
 * These are the real signals the game exposes — item tags, enchantments, data components, the mod
 * namespace, durability — not just a substring of the display name. A category made of rules is
 * therefore able to tell two items apart that merely look alike, which is the whole point of the
 * classifier. `id-contains` and `id-equals` remain for the simple cases and for categories that
 * predate rules.
 *
 * Defined in `shared` so the persisted category and the classifier that reads it cannot drift: there
 * is one rule language, and `packages/item-classifier` is its only interpreter.
 */
export type ClassifierRule =
  | { kind: 'id-equals'; id: string }
  | { kind: 'id-contains'; contains: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'namespace'; namespace: string }
  | { kind: 'enchantment'; id: string; minLevel?: number }
  | { kind: 'component'; id: string }
  | { kind: 'custom-name'; contains: string }
  | { kind: 'durability'; minPercent?: number; maxPercent?: number }
  | { kind: 'stackable'; stackable: boolean };

/** A category an item or container can belong to, used for routing and organisation. */
export interface StorageCategory {
  id: string;
  name: string;
  /**
   * Substrings that match an item id or display name (e.g. "cobblestone").
   *
   * Kept as the simple, always-available form and the fallback: a category with no rules classifies
   * purely on these, so an existing category keeps working unchanged.
   */
  itemMatches: string[];
  /**
   * The real-signal rules this category matches by, if any.
   *
   * When present they take precedence over {@link itemMatches}: a category is classified by its
   * rules, and only falls back to the substrings when it has none. Absent (rather than empty) on a
   * category created before rules existed, which is read as "no rules".
   */
  rules?: ClassifierRule[];
  /** Priority for routing, higher wins when several categories match. */
  priority: number;
  color: string;
  protected: boolean;
  createdAt: number;
  updatedAt: number;
}

/** One registered container in a storage network. */
export interface StorageContainer {
  id: string;
  networkId: string;
  /** The worker that reported this container; a container is only reachable from its own worker. */
  workerId: string;
  label: string;
  kind: ContainerKind;
  x: number;
  y: number;
  z: number;
  dimension: string;
  /** Category id this container is dedicated to, or null for a general container. */
  categoryId: string | null;
  /** When true the container is never modified by automation. */
  locked: boolean;
  /** When true this container is a permanent storage section, never suggested for removal. */
  permanent: boolean;
  /** Capacity in slots as last reported, or null when unknown. */
  capacity: number | null;
  /** Free slots as last reported, or null when unknown. */
  freeSlots: number | null;
  /** True when the last inspection found the container full. */
  full: boolean;
  /** The items it held at the last inspection. */
  items: import('./workers').WorkerItem[];
  inspectedAt: number;
  createdAt: number;
  updatedAt: number;
}

/** A named set of containers that automation treats as one storage unit. */
export interface StorageNetwork {
  id: string;
  name: string;
  description: string;
  mode: AutomationMode;
  /** True while the network's automation is paused (global pause is separate). */
  paused: boolean;
  /** Worker ids that may service this network. Empty means "any online worker". */
  workerIds: string[];
  /** Item queries that are never moved or disposed from this network. */
  protectedItems: string[];
  /** Reserved quantities: never drop below this many of the query. */
  reservations: { query: string; count: number }[];
  /** Areas automation may act in, as "dimension x1 y1 z1 x2 y2 z2"; empty means "anywhere registered". */
  exclusionAreas: string[];
  createdAt: number;
  updatedAt: number;
}

/** A reusable restock rule: keep at least `min` and at most `max` of `query` on a worker. */
export interface RestockRule {
  id: string;
  networkId: string | null;
  name: string;
  query: string;
  label: string;
  min: number;
  max: number;
  /** How many to move in one restock when below the minimum. */
  batch: number;
  /** Worker ids this rule applies to; empty means "every worker in the network". */
  workerIds: string[];
  enabled: boolean;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

/** A disposal rule: items matching `query` may be moved to a disposal container when authorised. */
export interface DisposalRule {
  id: string;
  name: string;
  query: string;
  label: string;
  /** The container kind to move them to; always a `disposal` container in practice. */
  targetContainerId: string | null;
  /** True when this rule may run without an explicit per-run request. */
  enabled: boolean;
  /** Never dispose of an item on the protected list, whatever this rule says. */
  createdAt: number;
  updatedAt: number;
}

/** A registered portal (an organisational record; its blocks are only removed on request). */
export interface PortalRecord {
  id: string;
  name: string;
  /** A free-form category ("nether", "end", "farm", ...). */
  category: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** 'permanent' portals are never suggested for cleanup. */
  permanent: boolean;
  /** 'temporary' portals are candidates for cleanup when obsolete. */
  temporary: boolean;
  /** True when the operator marked it as needing maintenance. */
  needsMaintenance: boolean;
  /** True while tracking is enabled for this portal. */
  tracking: boolean;
  /** The worker that last reported seeing it, or null. */
  lastSeenBy: string | null;
  lastSeenAt: number | null;
  /** Set when the portal is believed obsolete (temporary and not recently seen). */
  obsolete: boolean;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A registered structure (spec §9). Portals are one kind; storage rooms, farms, workshops,
 * processing areas and temporary builds are the others. The region is an inclusive box in one
 * dimension; the structure registry engine validates it, tests containment, and previews what a
 * change would touch. A protected structure is never modified by automation.
 */
export interface StructureRecord {
  id: string;
  name: string;
  kind: StructureKind;
  dimension: string;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  /** A free-form note on who owns or authorises changes to this structure. */
  ownership: string;
  /** When true the structure is never modified by automation. */
  protected: boolean;
  maintenance: MaintenanceState;
  lastSeenBy: string | null;
  lastSeenAt: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export type StructureKind =
  | 'storage_room'
  | 'farm'
  | 'workshop'
  | 'processing'
  | 'portal'
  | 'temporary'
  | 'other';

export type MaintenanceState = 'ok' | 'due' | 'overdue' | 'disabled';

export const STRUCTURE_KINDS: readonly StructureKind[] = [
  'storage_room', 'farm', 'workshop', 'processing', 'portal', 'temporary', 'other',
];

export const MAINTENANCE_STATES: readonly MaintenanceState[] = ['ok', 'due', 'overdue', 'disabled'];

/** One shulker box a worker reported, with its decoded contents when known. */
export interface ShulkerRecord {
  id: string;
  workerId: string;
  /** The slot the shulker occupies in the reporting worker's inventory, when it is carried. */
  slot: number;
  label: string;
  /** The dominant category id of its contents, or null when mixed/unknown. */
  categoryId: string | null;
  /** True when more than one category is present. */
  mixed: boolean;
  empty: boolean;
  /** The items it held at the last inspection. */
  items: import('./workers').WorkerItem[];
  /** Total item count inside. */
  itemCount: number;
  /** Free slots inside the shulker (27 for a normal shulker box). */
  freeSlots: number | null;
  /** True when the shulker is one of the network's reserved empty-shulker supply. */
  reserved: boolean;
  /** True when the operator marked it for removal. */
  markedForRemoval: boolean;
  inspectedAt: number;
  createdAt: number;
  updatedAt: number;
}

/** A single step in an automation plan, produced by an engine and either shown or executed. */
export interface AutomationStep {
  id: string;
  /** The action verb, e.g. `move`, `consolidate`, `unpack-shulker`, `restock`, `dispose`. */
  action: string;
  /** A human-readable description of what will happen. */
  detail: string;
  /** The worker that would perform it. */
  workerId: string;
  /** The container it reads from, if any. */
  sourceContainerId: string | null;
  /** The container it writes to, if any. */
  targetContainerId: string | null;
  /** Item query the step acts on, if any. */
  query: string;
  /** How many items the step moves. */
  count: number;
  /** The inventory slot the step acts on (a shulker box, for example), when it targets one. */
  slot: number | null;
  /** Whether the step is allowed to run automatically or needs approval. */
  requiresApproval: boolean;
  /** Set when a safety rule blocked the step; the step must not be executed. */
  blocked: boolean;
  /** Why the step was blocked, when it was. */
  blockedReason: string;
}

/** The result of planning an operation: what would happen, and what could not be done. */
export interface AutomationPlan {
  id: string;
  /** What produced it, e.g. `consolidate`, `restock`, `shulker-unpack`, `workflow:empty-shulker-cleanup`. */
  operation: string;
  networkId: string | null;
  createdAt: number;
  steps: AutomationStep[];
  /** Steps that were skipped with a reason (e.g. no destination, protected item). */
  notes: string[];
  /** True when the plan has at least one executable step. */
  actionable: boolean;
}

/** A stored, reusable workflow definition (a named sequence of operations). */
export interface WorkflowRecord {
  id: string;
  name: string;
  description: string;
  /** The operation ids to run in order. */
  operations: string[];
  /** The network the workflow applies to, or null for the whole fleet. */
  networkId: string | null;
  mode: AutomationMode;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** One recorded automation action: what happened, to what, by which worker and when. */
export interface StorageActivityEntry {
  id: string;
  at: number;
  /** The operation, e.g. `move`, `restock`, `dispose`, `shulker-unpack`, `portal-remove`. */
  operation: string;
  workerId: string;
  /** A free-form target: a container id, a portal id, a worker id. */
  target: string;
  /** Item query, when the entry concerns a specific item. */
  query: string;
  count: number;
  ok: boolean;
  detail: string;
  /** A short before/after summary where it is meaningful (e.g. "12 -> 4 free slots"). */
  beforeAfter: string;
  /** The plan or workflow that produced it, when any. */
  source: string;
}

/** A container that automation could not act on, with the reason. */
export interface StorageBottleneck {
  containerId: string;
  label: string;
  workerId: string;
  kind: ContainerKind;
  /** 'full' | 'missing' | 'unreachable' | 'misplaced' | 'unsorted'. */
  reason: string;
  detail: string;
  at: number;
}

/** The aggregated health of a network, computed from reported container rows only. */
export interface StorageNetworkReport {
  networkId: string;
  name: string;
  containers: number;
  workers: number;
  fullContainers: number;
  missingContainers: number;
  unusedContainers: number;
  totalItems: number;
  distinctItems: number;
  bottlenecks: StorageBottleneck[];
  /** Categories that have no container assigned. */
  unassignedCategories: string[];
  /** Items that match no category. */
  unsortable: { id: string; name: string; count: number }[];
  generatedAt: number;
}

/** The whole storage subsystem's headline state, for the dashboard. */
export interface StorageOverview {
  networks: number;
  containers: number;
  shulkers: number;
  portals: number;
  fullContainers: number;
  bottlenecks: number;
  pendingPlans: number;
  pendingSteps: number;
  globalPaused: boolean;
  lastActivityAt: number | null;
  recent: StorageActivityEntry[];
}

/** The result of an AI/command request: the plan it produced, or a plain answer. */
export interface MaintenanceAnswer {
  request: string;
  /** The operation the request mapped to, or null when it was only a question. */
  operation: string | null;
  answer: string;
  plan: AutomationPlan | null;
  /**
   * The AI planner's checked plan for the same request, or null when nothing matched.
   *
   * This is the spec's planning pipeline surfaced to the operator: a recognised intent, ordered
   * steps, and whether each step is authorised and destructive. It is deterministic — the same
   * request always yields the same plan — and it never executes anything.
   */
  ai: AiPlanView | null;
}

/** One step of an AI plan, as shown to the operator. */
export interface AiPlanStepView {
  id: string;
  system: string;
  summary: string;
  authorised: boolean;
  blockedReason: string;
  destructive: boolean;
}

/** The AI planner's plan, reduced to what the assistant view renders. */
export interface AiPlanView {
  intent: string | null;
  confidence: number;
  executable: boolean;
  needsConfirmation: boolean;
  note: string;
  steps: AiPlanStepView[];
}

/** The execution outcome of running a plan. */
export interface PlanExecutionResult {
  planId: string;
  operation: string;
  ok: boolean;
  executed: number;
  failed: number;
  skipped: number;
  message: string;
  outcomes: { stepId: string; workerId: string; ok: boolean; detail: string }[];
}

/** A stored configuration profile for the storage subsystem. */
export interface StorageProfile {
  id: string;
  name: string;
  description: string;
  /** A serialised snapshot of the subsystem configuration (networks, rules, categories). */
  data: Record<string, unknown>;
  createdAt: number;
}
