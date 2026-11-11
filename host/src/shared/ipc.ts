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
  PairingStatus,
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
  AutomationMode,
  AutomationPlan,
  ContainerKind,
  DisposalRule,
  MaintenanceAnswer,
  PlanExecutionResult,
  PortalRecord,
  RestockRule,
  ShulkerRecord,
  StorageActivityEntry,
  StorageCategory,
  StorageContainer,
  StorageNetwork,
  StorageNetworkReport,
  StorageOverview,
  StorageProfile,
  StructureRecord,
  WorkflowRecord,
} from './types';
import type { ControlAction, TaskKind, WorkerTaskResult } from './workers';
import type { StatisticsReport } from '../main/packages/statistics';

/** A normalised structure region, as the preview and create dialogs pass it. */
export interface StructureRegion {
  dimension: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** One flagged structure, as the dashboard shows it. */
export interface StructureIssueView {
  structureId: string;
  name: string;
  reason: string;
  detail: string;
}

/** What a proposed change would touch, as the dashboard shows it. */
export interface StructureChangeView {
  structureId: string;
  name: string;
  kind: string;
  actionable: boolean;
  reasons: string[];
  estimatedBlocks: number;
}

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
  getPairingStatus(): Promise<PairingStatus>;
  createPairingCode(): Promise<PairingCode>;
  clearPairingCode(): Promise<boolean>;
  revokePairedWorker(workerId: string): Promise<boolean>;
  allowPairedWorker(workerId: string): Promise<boolean>;

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

  // autonomous storage & world maintenance
  storageOverview(): Promise<StorageOverview>;
  storageMaintenanceReport(): Promise<{
    generatedAt: number;
    networks: StorageNetworkReport[];
    bottlenecks: StorageNetworkReport['bottlenecks'];
    emptyShulkers: number;
    mixedShulkers: number;
    obsoletePortals: number;
    unsortable: { id: string; name: string; count: number }[];
    activity: StorageActivityEntry[];
  }>;

  listStorageNetworks(): Promise<StorageNetwork[]>;
  createStorageNetwork(input: {
    name: string; description?: string; mode?: AutomationMode; workerIds?: string[];
    protectedItems?: string[]; reservations?: { query: string; count: number }[]; exclusionAreas?: string[];
  }): Promise<StorageNetwork>;
  updateStorageNetwork(id: string, patch: Partial<StorageNetwork>): Promise<StorageNetwork | undefined>;
  deleteStorageNetwork(id: string): Promise<boolean>;
  pauseStorageNetwork(id: string, paused: boolean): Promise<StorageNetwork | undefined>;

  listStorageCategories(): Promise<StorageCategory[]>;
  createStorageCategory(input: Omit<StorageCategory, 'id' | 'createdAt' | 'updatedAt'>): Promise<StorageCategory>;
  updateStorageCategory(id: string, patch: Partial<StorageCategory>): Promise<StorageCategory | undefined>;
  deleteStorageCategory(id: string): Promise<boolean>;

  listStorageContainers(networkId?: string): Promise<StorageContainer[]>;
  createStorageContainer(input: {
    networkId: string; workerId: string; label?: string; kind?: ContainerKind;
    x?: number; y?: number; z?: number; dimension?: string; categoryId?: string | null;
    locked?: boolean; permanent?: boolean;
  }): Promise<StorageContainer>;
  updateStorageContainer(id: string, patch: Partial<StorageContainer>): Promise<StorageContainer | undefined>;
  deleteStorageContainer(id: string): Promise<boolean>;

  listRestockRules(networkId?: string): Promise<RestockRule[]>;
  createRestockRule(input: Omit<RestockRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<RestockRule>;
  updateRestockRule(id: string, patch: Partial<RestockRule>): Promise<RestockRule | undefined>;
  deleteRestockRule(id: string): Promise<boolean>;

  listDisposalRules(): Promise<DisposalRule[]>;
  createDisposalRule(input: Omit<DisposalRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<DisposalRule>;
  updateDisposalRule(id: string, patch: Partial<DisposalRule>): Promise<DisposalRule | undefined>;
  deleteDisposalRule(id: string): Promise<boolean>;

  listPortals(): Promise<PortalRecord[]>;
  portalGroups(): Promise<{ key: string; dimension: string; portals: PortalRecord[]; x: number; y: number; z: number }[]>;
  flaggedPortals(): Promise<{ portalId: string; name: string; reason: string; detail: string }[]>;
  previewPortalRemoval(portalIds: string[]): Promise<{ portalId: string; name: string; dimension: string; x: number; y: number; z: number; authorised: boolean; reasons: string[]; estimatedBlocks: number }[]>;
  createPortal(input: Omit<PortalRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PortalRecord>;
  updatePortal(id: string, patch: Partial<PortalRecord>): Promise<PortalRecord | undefined>;
  deletePortal(id: string): Promise<boolean>;

  listStructures(): Promise<StructureRecord[]>;
  structureIssues(): Promise<StructureIssueView[]>;
  structureCounts(): Promise<Record<string, number>>;
  previewStructureChange(region: StructureRegion, options?: { allowProtected?: boolean }): Promise<StructureChangeView[]>;
  createStructure(input: Omit<StructureRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<StructureRecord>;
  updateStructure(id: string, patch: Partial<StructureRecord>): Promise<StructureRecord | undefined>;
  deleteStructure(id: string): Promise<boolean>;

  listShulkers(workerId?: string): Promise<ShulkerRecord[]>;
  shulkerSuggestions(): Promise<{ shulkerId: string; label: string; suggestion: string; categoryId: string | null }[]>;
  updateShulker(id: string, patch: Partial<ShulkerRecord>): Promise<ShulkerRecord | undefined>;

  listWorkflows(): Promise<WorkflowRecord[]>;
  storageOperations(): Promise<{ id: string; label: string; description: string; mutating: boolean; autoSafe: boolean }[]>;
  createWorkflow(input: Omit<WorkflowRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<WorkflowRecord>;
  updateWorkflow(id: string, patch: Partial<WorkflowRecord>): Promise<WorkflowRecord | undefined>;
  deleteWorkflow(id: string): Promise<boolean>;

  planStorageOperation(operation: string, networkId?: string | null, options?: { workerId?: string; portalIds?: string[] }): Promise<AutomationPlan>;
  listStoragePlans(): Promise<(AutomationPlan & { approved: boolean; executed: boolean })[]>;
  approveStoragePlan(id: string): Promise<boolean>;
  executeStoragePlan(id: string): Promise<PlanExecutionResult>;
  discardStoragePlan(id: string): Promise<boolean>;

  restockNeeds(workerId: string, networkId?: string | null): Promise<{ ruleId: string; workerId: string; query: string; label: string; have: number; min: number; max: number; amount: number; direction: string }[]>;
  restockPlan(workerId: string, networkId?: string | null): Promise<{ steps: { ruleId: string; workerId: string; query: string; fromContainerId: string; count: number; detail: string }[]; unsatisfied: { ruleId: string; workerId: string; query: string; missing: number; reason: string }[] }>;
  disposalPreview(workerId: string, networkId?: string | null): Promise<{ wouldDispose: { itemId: string; itemName: string; count: number }[]; refused: { itemId: string; itemName: string; reasons: string[] }[] }>;

  storageActivity(limit?: number, workerId?: string): Promise<StorageActivityEntry[]>;
  storageAsk(request: string): Promise<MaintenanceAnswer>;

  listStorageProfiles(): Promise<StorageProfile[]>;
  saveStorageProfile(name: string, description?: string): Promise<StorageProfile>;
  deleteStorageProfile(id: string): Promise<boolean>;

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
  getPairingStatus: 'host:pairing:status',
  createPairingCode: 'host:pairing:create',
  clearPairingCode: 'host:pairing:clear',
  revokePairedWorker: 'host:pairing:revoke',
  allowPairedWorker: 'host:pairing:allow',

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

  storageOverview: 'storage:overview',
  storageMaintenanceReport: 'storage:report',
  listStorageNetworks: 'storage:networks:list',
  createStorageNetwork: 'storage:networks:create',
  updateStorageNetwork: 'storage:networks:update',
  deleteStorageNetwork: 'storage:networks:delete',
  pauseStorageNetwork: 'storage:networks:pause',
  listStorageCategories: 'storage:categories:list',
  createStorageCategory: 'storage:categories:create',
  updateStorageCategory: 'storage:categories:update',
  deleteStorageCategory: 'storage:categories:delete',
  listStorageContainers: 'storage:containers:list',
  createStorageContainer: 'storage:containers:create',
  updateStorageContainer: 'storage:containers:update',
  deleteStorageContainer: 'storage:containers:delete',
  listRestockRules: 'storage:restock:list',
  createRestockRule: 'storage:restock:create',
  updateRestockRule: 'storage:restock:update',
  deleteRestockRule: 'storage:restock:delete',
  listDisposalRules: 'storage:disposal:list',
  createDisposalRule: 'storage:disposal:create',
  updateDisposalRule: 'storage:disposal:update',
  deleteDisposalRule: 'storage:disposal:delete',
  listPortals: 'storage:portals:list',
  portalGroups: 'storage:portals:groups',
  flaggedPortals: 'storage:portals:flagged',
  previewPortalRemoval: 'storage:portals:preview-removal',
  createPortal: 'storage:portals:create',
  updatePortal: 'storage:portals:update',
  deletePortal: 'storage:portals:delete',
  listStructures: 'storage:structures:list',
  structureIssues: 'storage:structures:issues',
  structureCounts: 'storage:structures:counts',
  previewStructureChange: 'storage:structures:preview-change',
  createStructure: 'storage:structures:create',
  updateStructure: 'storage:structures:update',
  deleteStructure: 'storage:structures:delete',
  listShulkers: 'storage:shulkers:list',
  shulkerSuggestions: 'storage:shulkers:suggestions',
  updateShulker: 'storage:shulkers:update',
  listWorkflows: 'storage:workflows:list',
  storageOperations: 'storage:workflows:operations',
  createWorkflow: 'storage:workflows:create',
  updateWorkflow: 'storage:workflows:update',
  deleteWorkflow: 'storage:workflows:delete',
  planStorageOperation: 'storage:plan',
  listStoragePlans: 'storage:plans:list',
  approveStoragePlan: 'storage:plans:approve',
  executeStoragePlan: 'storage:plans:execute',
  discardStoragePlan: 'storage:plans:discard',
  restockNeeds: 'storage:restock:needs',
  restockPlan: 'storage:restock:plan',
  disposalPreview: 'storage:disposal:preview',
  storageActivity: 'storage:activity',
  storageAsk: 'storage:ask',
  listStorageProfiles: 'storage:profiles:list',
  saveStorageProfile: 'storage:profiles:save',
  deleteStorageProfile: 'storage:profiles:delete',
} as const;
