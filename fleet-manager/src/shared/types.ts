/**
 * Shared domain types used by both the Electron main process and the React renderer.
 *
 * Everything here is plain data so it can be serialised over IPC, persisted in SQLite and
 * sent over the WebSocket API without special handling.
 */

export type BotRole = 'GEARER' | 'STASIS' | 'HUNTER';

export const BOT_ROLES: BotRole[] = ['GEARER', 'STASIS', 'HUNTER'];

export type InstanceState =
  | 'STOPPED'
  | 'WAITING'
  | 'VALIDATING'
  | 'AUTHENTICATING'
  | 'CONNECTING'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'PAUSED'
  | 'FAILED'
  | 'STOPPING';

export type ConnectionState = 'OFFLINE' | 'CONNECTING' | 'ONLINE' | 'RECONNECTING' | 'ERROR';

export type AuthMode = 'offline' | 'microsoft' | 'mojang';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  authMode: AuthMode;
  role: BotRole;
  groupId: string | null;
  /** Whether a credential is stored in the OS credential vault for this account. */
  hasCredential: boolean;
  lastLogin: number | null;
  lastLoginOk: boolean;
  serverProfileId: string | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  version: string;
  authMode: AuthMode;
  connectionTimeoutMs: number;
  /** Extra connect options passed to mineflayer (never contains secrets). */
  options: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface InstanceRecord {
  id: string;
  name: string;
  accountId: string;
  role: BotRole;
  groupId: string | null;
  serverProfileId: string | null;
  /** Role-specific configuration, validated against the role's schema. */
  config: Record<string, unknown>;
  priority: number;
  state: InstanceState;
  connection: ConnectionState;
  startedAt: number | null;
  stoppedAt: number | null;
  uptimeMs: number;
  health: number;
  lastError: string | null;
  lastEvent: string | null;
  /** Runtime-only metrics, refreshed by the monitor. */
  metrics: InstanceMetrics;
}

export interface InstanceMetrics {
  memoryBytes: number;
  cpuPercent: number;
  ping: number;
  position?: { x: number; y: number; z: number };
  dimension?: string;
  health?: number;
  food?: number;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: number;
}

export interface DeploymentConfig {
  id: string;
  name: string;
  description: string;
  serverProfileId: string | null;
  /** Ordered list of queue entries. */
  entries: DeploymentEntry[];
  maxConcurrent: number;
  connectionTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  manualApproval: boolean;
  pauseBetweenMs: number;
  resourceLimitMb: number;
  notifyOnEvent: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DeploymentEntry {
  accountId: string;
  role: BotRole;
  instanceName: string;
  /** Delay before this entry starts, in milliseconds. */
  delayMs: number;
  roleConfig: Record<string, unknown>;
}

export type DeploymentStage =
  | 'WAITING'
  | 'VALIDATING'
  | 'AUTHENTICATING'
  | 'CONNECTING'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'FAILED'
  | 'STOPPED'
  | 'SKIPPED';

export interface DeploymentQueueItem {
  id: string;
  deploymentId: string;
  accountId: string;
  instanceName: string;
  role: BotRole;
  roleConfig: Record<string, unknown>;
  position: number;
  stage: DeploymentStage;
  attempts: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TargetEntry {
  id: string;
  uuid: string | null;
  username: string;
  displayName: string;
  category: string;
  priority: number;
  notes: string;
  tags: string[];
  source: string;
  lastSeen: number | null;
  encounters: number;
  kills: number;
  deaths: number;
  lastPosition: { x: number; y: number; z: number } | null;
  dimension: string;
  updatedAt: number;
}

export type StasisState = 'READY' | 'UNAVAILABLE' | 'ACTIVE' | 'UNKNOWN' | 'ERROR';

export interface StasisLocation {
  id: string;
  name: string;
  instanceId: string | null;
  serverProfileId: string | null;
  dimension: string;
  x: number;
  y: number;
  z: number;
  state: StasisState;
  lastActivity: number | null;
  lastVerified: number | null;
  lastError: string | null;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface EquipmentProfileRecord {
  id: string;
  name: string;
  serverProfileId: string | null;
  weapons: string[];
  minArmorPieces: number;
  minTotems: number;
  minFood: number;
  lowDurabilityPercent: number;
  sortOrder: string[];
  warningThresholds: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export type EventSeverity = 'info' | 'warning' | 'error' | 'success';

export interface FleetEvent {
  id: string;
  type: string;
  source: string;
  severity: EventSeverity;
  instanceId: string | null;
  accountId: string | null;
  targetUuid: string | null;
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

export interface AppSettings {
  apiPort: number;
  apiHost: string;
  apiEnabled: boolean;
  hunterAddonUrl: string;
  hunterAddonToken: string;
  theme: ThemeName;
  /** 'beginner' hides advanced controls and uses simpler language. */
  uiMode: UiMode;
  autosave: boolean;
  backupIntervalMinutes: number;
  maxMemoryMb: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  notify: boolean;
  /** Whether the host accepts worker connections. */
  workerServerEnabled: boolean;
  /** Port the worker WebSocket server listens on. */
  workerServerPort: number;
  /** Address the worker server binds to. Loopback by default; a LAN address to reach other PCs. */
  workerServerHost: string;
}

export type ThemeName = 'dark' | 'light';
export type UiMode = 'beginner' | 'advanced';

export const DEFAULT_SETTINGS: AppSettings = {
  apiPort: 8787,
  apiHost: '127.0.0.1',
  apiEnabled: true,
  hunterAddonUrl: 'http://127.0.0.1:8720',
  hunterAddonToken: '',
  theme: 'dark',
  uiMode: 'beginner',
  autosave: true,
  backupIntervalMinutes: 30,
  maxMemoryMb: 4096,
  logLevel: 'info',
  notify: true,
  workerServerEnabled: true,
  workerServerPort: 8721,
  workerServerHost: '127.0.0.1',
};

/** One step of the guided first-run checklist shown on the dashboard. */
export interface SetupStep {
  id: string;
  title: string;
  description: string;
  status: 'done' | 'todo' | 'blocked';
  /** Page id the user should visit to complete this step. */
  page: string;
  actionLabel: string;
  /** Optional steps never block the fleet from being ready. */
  optional: boolean;
}

export interface SetupReport {
  ready: boolean;
  /** Fraction (0..1) of required steps that are complete. */
  completion: number;
  steps: SetupStep[];
  nextStepId: string | null;
  /** Human sentence describing what to do next. */
  nextHint: string;
}

export interface QuickSetupInput {
  username: string;
  host: string;
  port?: number;
  version?: string;
  role?: BotRole;
}

export interface QuickDeployInput {
  accountIds: string[];
  serverProfileId?: string | null;
  role?: BotRole;
  maxConcurrent?: number;
  name?: string;
  /** Explicitly authorise combat testing for HUNTER accounts (never implied). */
  authorizeCombat?: boolean;
  /** Optional target allow-list applied to HUNTER accounts. */
  allowlist?: string[];
}

export interface HealthReport {
  ok: boolean;
  version: string;
  uptimeMs: number;
  instances: { total: number; running: number; failed: number };
  database: { ok: boolean; path: string };
  hunter: { connected: boolean; url: string; lastSync: number | null };
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  subject?: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------- workers
//
// A "worker" is a Minecraft client running the logvex-worker mod, which dials the host over a
// WebSocket. This is a different thing from an "instance"/"bot": a bot is an account the host
// launches with mineflayer, a worker is a real client the operator runs and the host controls.

export type WorkerStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

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

export interface WorkerOverview {
  total: number;
  online: number;
  offline: number;
  degraded: number;
  activeTasks: number;
  trackedItems: number;
  groups: { group: WorkerGroup; workers: number; online: number }[];
  recent: FleetEvent[];
}

