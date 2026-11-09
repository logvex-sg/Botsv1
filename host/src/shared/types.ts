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

/** A single line a worker forwarded about itself. */
export interface WorkerConsoleLine {
  at: number;
  message: string;
}
