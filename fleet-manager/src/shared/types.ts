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
  theme: 'dark';
  autosave: boolean;
  backupIntervalMinutes: number;
  maxMemoryMb: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  notify: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiPort: 8787,
  apiHost: '127.0.0.1',
  apiEnabled: true,
  hunterAddonUrl: 'http://127.0.0.1:8080',
  hunterAddonToken: '',
  theme: 'dark',
  autosave: true,
  backupIntervalMinutes: 30,
  maxMemoryMb: 4096,
  logLevel: 'info',
  notify: true,
};

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
