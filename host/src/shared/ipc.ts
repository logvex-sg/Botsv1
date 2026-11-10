/**
 * The IPC surface exposed to the renderer through the preload bridge.
 *
 * Defining the channel names and their payload types in one place keeps the renderer, the preload
 * script and the main-process handlers in sync, and lets the renderer be type-checked against the
 * real API. Every entry here maps to a real host capability; there are no placeholders.
 */
import type {
  WorkerClientStatus,
  WorkerModePatch,
  WorkerModeSettings,
  WorkerProvisionResult,
  AppSettings,
  AuditEntry,
  AutomationRule,
  ContainerRecord,
  FleetEvent,
  GroupTemplate,
  HealthReport,
  ItemCountReport,
  NotificationItem,
  PairingCode,
  RegearComparison,
  RegearPreset,
  RuleCondition,
  ScheduleRecord,
  ServerProfile,
  ServerProfileView,
  TaskPreset,
  WorkerCommandRecord,
  WorkerConsoleLine,
  WorkerGroup,
  WorkerInventorySnapshot,
  WorkerOverview,
  WorkerTaskRecord,
  WorkerView,
} from './types';
import type { ControlAction, TaskKind, WorkerTaskResult } from './workers';
import type { StatisticsReport } from '../main/packages/statistics';

export interface WorkerServerStatus {
  enabled: boolean;
  host: string;
  port: number;
  bound: boolean;
  /** The shared token; shown only on the Settings page. */
  token: string;
}

/** A schedule as the UI sees it: the stored row plus how many runs were missed while offline. */
export type ScheduleView = ScheduleRecord & { missed: number };

/** The honest result of a bulk run, mirroring the group engine's summary. */
export interface BulkResult {
  ok: boolean;
  total: number;
  completed: number;
  failed: number;
  disconnected: number;
  skipped: number;
  message: string;
  outcomes: { workerId: string; label: string; ok: boolean; outcome: string; detail: string }[];
}

/** The editable fields of a server profile, as sent from the create form. */
export interface ServerProfileInput {
  name: string;
  host?: string;
  port?: number;
  version?: string;
  environment?: ServerProfile['environment'];
  notes?: string;
  tags?: string[];
}

export interface FleetApi {
  // system
  getHealth(): Promise<HealthReport>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getApiToken(): Promise<string>;
  regenerateApiToken(): Promise<string>;
  exportConfig(): Promise<{ path: string } | null>;
  importConfig(): Promise<{ imported: number } | null>;

  // host pairing
  getPairingCode(): Promise<PairingCode | null>;
  createPairingCode(): Promise<PairingCode>;
  clearPairingCode(): Promise<boolean>;

  // worker server
  getWorkerServer(): Promise<WorkerServerStatus>;
  regenerateWorkerToken(): Promise<string>;

  // workers
  listWorkers(): Promise<WorkerView[]>;
  getWorker(workerId: string): Promise<WorkerView | undefined>;
  getWorkerOverview(): Promise<WorkerOverview>;
  setWorkerLabel(workerId: string, label: string): Promise<boolean>;
  setWorkerNotes(workerId: string, notes: string): Promise<boolean>;
  forgetWorker(workerId: string): Promise<boolean>;
  pingWorker(workerId: string): Promise<boolean>;
  kickWorker(workerId: string, reason: string): Promise<boolean>;
  controlWorker(workerId: string, action: ControlAction): Promise<boolean>;
  connectWorker(workerId: string): Promise<boolean>;
  disconnectWorker(workerId: string): Promise<boolean>;
  restartWorker(workerId: string): Promise<boolean>;
  pauseWorker(workerId: string): Promise<boolean>;
  resumeWorker(workerId: string): Promise<boolean>;

  // Worker Mode: this machine acting as a worker.
  getWorkerModeSettings(): Promise<WorkerModeSettings>;
  saveWorkerModeSettings(patch: WorkerModePatch): Promise<WorkerModeSettings>;
  getWorkerModeStatus(): Promise<WorkerClientStatus>;
  getWorkerModeLogs(): Promise<{ at: number; message: string }[]>;
  connectWorkerMode(): Promise<WorkerClientStatus>;
  disconnectWorkerMode(): Promise<WorkerClientStatus>;
  testWorkerModeConnection(overrides?: WorkerModePatch): Promise<WorkerClientStatus>;
  provisionWorkerConfig(directory: string): Promise<WorkerProvisionResult>;

  // worker groups
  listWorkerGroups(): Promise<WorkerGroup[]>;
  createWorkerGroup(name: string, description?: string, color?: string): Promise<WorkerGroup>;
  updateWorkerGroup(id: string, patch: { name?: string; description?: string; color?: string }): Promise<WorkerGroup | undefined>;
  deleteWorkerGroup(id: string): Promise<boolean>;
  assignWorkerGroup(workerId: string, groupId: string | null): Promise<boolean>;
  assignWorkerGroupBulk(workerIds: string[], groupId: string | null): Promise<number>;

  // tasks
  runWorkerTask(workerId: string, kind: TaskKind, params?: Record<string, unknown>): Promise<WorkerTaskResult>;
  runWorkerTaskMany(workerIds: string[], kind: TaskKind, params?: Record<string, unknown>): Promise<{ workerId: string; ok: boolean; result?: WorkerTaskResult; error?: string }[]>;
  listWorkerTasks(limit?: number, workerId?: string): Promise<WorkerTaskRecord[]>;
  getWorkerTaskKinds(): Promise<string[]>;

  // console
  getWorkerConsole(workerId: string): Promise<WorkerConsoleLine[]>;
  clearWorkerConsole(workerId: string): Promise<void>;
  getWorkerCapabilities(workerId: string): Promise<string[]>;

  // commands / chat
  sendWorkerLine(workerId: string, kind: 'command' | 'chat', line: string): Promise<WorkerCommandRecord>;
  sendWorkerLineMany(workerIds: string[], kind: 'command' | 'chat', line: string): Promise<{ workerId: string; ok: boolean; response: string }[]>;
  listWorkerCommands(limit?: number, workerId?: string): Promise<WorkerCommandRecord[]>;

  // inventory
  getWorkerInventory(workerId: string): Promise<WorkerInventorySnapshot | undefined>;
  countWorkerItem(query: string, workerIds?: string[]): Promise<ItemCountReport>;
  getCombinedTotals(workerIds?: string[]): Promise<{ id: string; name: string; count: number }[]>;
  exportWorkerReport(format: 'json' | 'csv'): Promise<{ path: string } | null>;

  // regear
  listRegearPresets(): Promise<RegearPreset[]>;
  createRegearPreset(input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<RegearPreset>;
  updateRegearPreset(id: string, patch: Partial<Omit<RegearPreset, 'id' | 'createdAt'>>): Promise<RegearPreset | undefined>;
  deleteRegearPreset(id: string): Promise<boolean>;
  compareRegearPreset(workerId: string, presetId: string): Promise<RegearComparison>;
  regearWorker(workerId: string, presetId: string, allowMoves?: boolean): Promise<WorkerTaskResult>;
  regearWorkers(workerIds: string[], presetId: string, allowMoves?: boolean): Promise<{ workerId: string; ok: boolean; message: string }[]>;

  // events / notifications
  listEvents(limit?: number): Promise<FleetEvent[]>;
  listNotifications(): Promise<NotificationItem[]>;
  markNotificationRead(id: string): Promise<boolean>;
  markAllNotificationsRead(): Promise<boolean>;

  // multiverse: server profiles
  listServers(includeArchived?: boolean): Promise<ServerProfileView[]>;
  getServer(id: string): Promise<ServerProfileView | undefined>;
  createServer(input: ServerProfileInput): Promise<ServerProfile>;
  updateServer(id: string, patch: Partial<ServerProfile>): Promise<ServerProfile | undefined>;
  deleteServer(id: string): Promise<boolean>;
  assignServer(workerIds: string[], profileId: string | null): Promise<number>;

  // multiverse: group templates
  listGroupTemplates(): Promise<GroupTemplate[]>;
  createGroupTemplate(input: Omit<GroupTemplate, 'id' | 'createdAt'>): Promise<GroupTemplate>;
  deleteGroupTemplate(id: string): Promise<boolean>;
  applyGroupTemplate(templateId: string, groupName: string): Promise<WorkerGroup>;

  // multiverse: task presets
  listTaskPresets(): Promise<TaskPreset[]>;
  createTaskPreset(input: Omit<TaskPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskPreset>;
  updateTaskPreset(id: string, patch: Partial<TaskPreset>): Promise<TaskPreset | undefined>;
  deleteTaskPreset(id: string): Promise<boolean>;
  runTaskPreset(id: string): Promise<BulkResult>;

  // multiverse: schedules
  listSchedules(): Promise<ScheduleView[]>;
  createSchedule(input: {
    name: string; presetId?: string | null; kind: string; params?: Record<string, unknown>;
    targetWorkerIds?: string[]; targetGroupIds?: string[];
    scheduleKind: ScheduleRecord['scheduleKind']; startAt?: number;
    intervalMs?: number | null; timeOfDay?: string | null; stopAt?: number | null; enabled?: boolean;
  }): Promise<ScheduleRecord>;
  updateSchedule(id: string, patch: Partial<ScheduleRecord>): Promise<ScheduleRecord | undefined>;
  deleteSchedule(id: string): Promise<boolean>;
  tickSchedules(): Promise<{ scheduleId: string; summary: BulkResult }[]>;

  // multiverse: automation rules
  listRules(): Promise<AutomationRule[]>;
  createRule(input: {
    name: string; event: string; conditions?: RuleCondition[]; action: string;
    cooldownMs?: number; maxRuns?: number | null; enabled?: boolean;
  }): Promise<AutomationRule>;
  updateRule(id: string, patch: Partial<AutomationRule>): Promise<AutomationRule | undefined>;
  deleteRule(id: string): Promise<boolean>;

  // multiverse: containers, history, tags, audit
  listContainers(workerId?: string): Promise<ContainerRecord[]>;
  deleteContainer(id: string): Promise<boolean>;
  inventoryTrend(workerId: string, itemId: string, limit?: number): Promise<{ at: number; count: number }[]>;
  inventoryCaptures(workerId: string, limit?: number): Promise<number[]>;
  addWorkerTag(workerId: string, tag: string): Promise<boolean>;
  removeWorkerTag(workerId: string, tag: string): Promise<boolean>;
  setWorkerTags(workerId: string, tags: string[]): Promise<boolean>;
  listAllTags(): Promise<string[]>;
  listAudit(limit?: number): Promise<AuditEntry[]>;

  // statistics
  getStatistics(): Promise<StatisticsReport>;
  exportStatistics(format: 'json' | 'csv'): Promise<{ path: string } | null>;

  // live events
  onEvent(callback: (event: FleetEvent) => void): () => void;
}

export const IPC = {
  getHealth: 'system:health',
  getSettings: 'system:settings:get',
  saveSettings: 'system:settings:save',
  getApiToken: 'system:api-token',
  regenerateApiToken: 'system:api-token:regenerate',
  exportConfig: 'system:export',
  importConfig: 'system:import',

  getPairingCode: 'host:pairing:get',
  createPairingCode: 'host:pairing:create',
  clearPairingCode: 'host:pairing:clear',

  getWorkerServer: 'workers:server:get',
  regenerateWorkerToken: 'workers:server:token',

  listWorkers: 'workers:list',
  getWorker: 'workers:get',
  getWorkerOverview: 'workers:overview',
  setWorkerLabel: 'workers:label',
  setWorkerNotes: 'workers:notes',
  forgetWorker: 'workers:forget',
  pingWorker: 'workers:ping',
  kickWorker: 'workers:kick',
  controlWorker: 'workers:control',
  connectWorker: 'workers:connect',
  disconnectWorker: 'workers:disconnect',
  restartWorker: 'workers:restart',
  pauseWorker: 'workers:pause',
  resumeWorker: 'workers:resume',
  workerModeSettings: 'worker-mode:settings',
  workerModeSave: 'worker-mode:save',
  workerModeStatus: 'worker-mode:status',
  workerModeLogs: 'worker-mode:logs',
  workerModeConnect: 'worker-mode:connect',
  workerModeDisconnect: 'worker-mode:disconnect',
  workerModeTest: 'worker-mode:test',
  workerModeProvision: 'worker-mode:provision',

  listWorkerGroups: 'worker-groups:list',
  createWorkerGroup: 'worker-groups:create',
  updateWorkerGroup: 'worker-groups:update',
  deleteWorkerGroup: 'worker-groups:delete',
  assignWorkerGroup: 'worker-groups:assign',
  assignWorkerGroupBulk: 'worker-groups:assign-bulk',

  runWorkerTask: 'worker-tasks:run',
  runWorkerTaskMany: 'worker-tasks:run-many',
  listWorkerTasks: 'worker-tasks:list',
  getWorkerTaskKinds: 'worker-tasks:kinds',

  getWorkerConsole: 'worker-console:get',
  clearWorkerConsole: 'worker-console:clear',
  getWorkerCapabilities: 'worker-console:capabilities',

  sendWorkerLine: 'worker-commands:send',
  sendWorkerLineMany: 'worker-commands:send-many',
  listWorkerCommands: 'worker-commands:list',

  getWorkerInventory: 'worker-inventory:get',
  countWorkerItem: 'worker-inventory:count',
  getCombinedTotals: 'worker-inventory:totals',
  exportWorkerReport: 'worker-inventory:export',

  listRegearPresets: 'regear:list',
  createRegearPreset: 'regear:create',
  updateRegearPreset: 'regear:update',
  deleteRegearPreset: 'regear:delete',
  compareRegearPreset: 'regear:compare',
  regearWorker: 'regear:run',
  regearWorkers: 'regear:run-many',

  listEvents: 'events:list',
  listNotifications: 'notifications:list',
  markNotificationRead: 'notifications:read',
  markAllNotificationsRead: 'notifications:read-all',

  // multiverse
  listServers: 'mv:servers:list',
  getServer: 'mv:servers:get',
  createServer: 'mv:servers:create',
  updateServer: 'mv:servers:update',
  deleteServer: 'mv:servers:delete',
  assignServer: 'mv:servers:assign',

  listGroupTemplates: 'mv:templates:list',
  createGroupTemplate: 'mv:templates:create',
  deleteGroupTemplate: 'mv:templates:delete',
  applyGroupTemplate: 'mv:templates:apply',

  listTaskPresets: 'mv:presets:list',
  createTaskPreset: 'mv:presets:create',
  updateTaskPreset: 'mv:presets:update',
  deleteTaskPreset: 'mv:presets:delete',
  runTaskPreset: 'mv:presets:run',

  listSchedules: 'mv:schedules:list',
  createSchedule: 'mv:schedules:create',
  updateSchedule: 'mv:schedules:update',
  deleteSchedule: 'mv:schedules:delete',
  tickSchedules: 'mv:schedules:tick',

  listRules: 'mv:rules:list',
  createRule: 'mv:rules:create',
  updateRule: 'mv:rules:update',
  deleteRule: 'mv:rules:delete',

  listContainers: 'mv:containers:list',
  deleteContainer: 'mv:containers:delete',
  inventoryTrend: 'mv:history:trend',
  inventoryCaptures: 'mv:history:captures',

  addWorkerTag: 'mv:tags:add',
  removeWorkerTag: 'mv:tags:remove',
  setWorkerTags: 'mv:tags:set',
  listAllTags: 'mv:tags:all',

  listAudit: 'mv:audit:list',

  getStatistics: 'stats:get',
  exportStatistics: 'stats:export',
} as const;
