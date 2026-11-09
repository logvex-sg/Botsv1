/**
 * The IPC surface exposed to the renderer through the preload bridge.
 *
 * Defining the channel names and their payload types in one place keeps the renderer, the preload
 * script and the main-process handlers in sync, and lets the renderer be type-checked against the
 * real API.
 */
import type {
  Account,
  AppSettings,
  DeploymentConfig,
  DeploymentQueueItem,
  EquipmentProfileRecord,
  FleetEvent,
  Group,
  HealthReport,
  InstanceRecord,
  NotificationItem,
  QuickDeployInput,
  QuickSetupInput,
  ServerProfile,
  SetupReport,
  StasisLocation,
  TargetEntry,
  ValidationReport,
  ItemCountReport,
  RegearComparison,
  RegearPreset,
  WorkerCommandRecord,
  WorkerGroup,
  WorkerInventorySnapshot,
  WorkerOverview,
  WorkerTaskRecord,
  WorkerView,
} from './types';
import type { TaskKind, WorkerTaskResult } from './workers';
import type { AccountView } from '../main/services/accounts/account-manager';
import type { RuntimeInstance } from '../main/services/instances/instance-manager';
import type { StasisChange } from '../main/services/stasis/stasis-manager';
import type { EquipmentEvaluation, InventorySnapshot } from '../main/services/equipment/equipment-manager';
import type { CoordinatorResult } from '../main/services/roles/coordinator';
import type { RoleDefinition } from '../main/services/roles/roles';
import type { DiagnosticsReport } from '../main/services/network/network-diagnostics';
import type { SyncResult } from '../main/services/hunter/target-sync';

export interface DeploymentPreview {
  totalAccounts: number;
  byRole: Record<string, number>;
  serverName: string | null;
  order: { instanceName: string; role: string; account: string; delayMs: number }[];
  maxConcurrent: number;
  estimatedMemoryMb: number;
  report: ValidationReport;
}

export interface DeploymentMonitor {
  state: string;
  deployment: DeploymentConfig | null;
  items: DeploymentQueueItem[];
}

export interface FleetApi {
  // system
  getHealth(): Promise<HealthReport>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  getApiToken(): Promise<string>;
  regenerateApiToken(): Promise<string>;
  getDiagnostics(serverProfileId: string): Promise<DiagnosticsReport>;
  exportConfig(): Promise<{ path: string }>;
  importConfig(): Promise<{ imported: number } | null>;
  backupDatabase(): Promise<{ path: string } | null>;

  // guided setup (beginner onboarding)
  getSetupReport(): Promise<SetupReport>;
  quickSetup(input: QuickSetupInput): Promise<{ serverProfileId: string; accountId: string; created: { server: boolean; account: boolean } }>;
  quickDeploy(input: QuickDeployInput): Promise<{ ok: boolean; report: ValidationReport; deploymentId?: string }>;

  // accounts
  listAccounts(): Promise<AccountView[]>;
  createAccount(input: Partial<Account>): Promise<AccountView>;
  updateAccount(id: string, patch: Partial<Account>): Promise<AccountView | undefined>;
  deleteAccount(id: string): Promise<boolean>;
  setCredential(id: string, secret: string): Promise<{ ok: boolean }>;
  clearCredential(id: string): Promise<{ ok: boolean }>;
  loginAccount(id: string): Promise<{ ok: boolean; error?: string }>;

  // servers
  listServers(): Promise<ServerProfile[]>;
  createServer(input: Partial<ServerProfile>): Promise<ServerProfile>;
  updateServer(id: string, patch: Partial<ServerProfile>): Promise<ServerProfile | undefined>;
  deleteServer(id: string): Promise<boolean>;
  testServer(id: string): Promise<DiagnosticsReport>;

  // groups
  listGroups(): Promise<Group[]>;
  createGroup(name: string, description?: string, color?: string): Promise<Group>;
  updateGroup(id: string, patch: { name?: string; description?: string; color?: string }): Promise<boolean>;
  deleteGroup(id: string): Promise<boolean>;
  assignInstanceGroup(instanceId: string, groupId: string | null): Promise<boolean>;
  assignAccountGroup(accountId: string, groupId: string | null): Promise<boolean>;

  // instances
  listInstances(): Promise<RuntimeInstance[]>;
  createInstance(input: Partial<InstanceRecord>): Promise<RuntimeInstance>;
  updateInstance(id: string, patch: Partial<InstanceRecord>): Promise<RuntimeInstance | undefined>;
  deleteInstance(id: string): Promise<boolean>;
  startInstance(id: string): Promise<RuntimeInstance | undefined>;
  stopInstance(id: string): Promise<RuntimeInstance | undefined>;
  restartInstance(id: string): Promise<RuntimeInstance | undefined>;
  sendInstanceCommand(id: string, command: string): Promise<boolean>;
  getInstanceLogs(id: string): Promise<string[]>;

  // roles
  getRoleCatalog(): Promise<RoleDefinition[]>;
  validateRoleConfig(role: string, config: Record<string, unknown>): Promise<{ field: string; message: string }[]>;

  // deployment
  listDeployments(): Promise<DeploymentConfig[]>;
  getDeployment(id: string): Promise<DeploymentConfig | undefined>;
  createDeployment(input: Partial<DeploymentConfig>): Promise<DeploymentConfig>;
  updateDeployment(id: string, patch: Partial<DeploymentConfig>): Promise<DeploymentConfig | undefined>;
  deleteDeployment(id: string): Promise<boolean>;
  validateDeployment(id: string): Promise<ValidationReport>;
  previewDeployment(id: string): Promise<DeploymentPreview>;
  startDeployment(id: string): Promise<{ ok: boolean; report: ValidationReport }>;
  pauseDeployment(): Promise<boolean>;
  resumeDeployment(): Promise<boolean>;
  cancelDeployment(): Promise<boolean>;
  approveDeployment(): Promise<boolean>;
  retryDeploymentItem(itemId: string): Promise<boolean>;
  getDeploymentMonitor(): Promise<DeploymentMonitor>;
  exportPreset(id: string): Promise<{ path: string } | null>;
  importPreset(): Promise<DeploymentConfig | null>;
  duplicateDeployment(id: string): Promise<DeploymentConfig | undefined>;

  // targets
  listTargets(): Promise<TargetEntry[]>;
  upsertTarget(input: Partial<TargetEntry>): Promise<TargetEntry>;
  updateTarget(id: string, patch: Partial<TargetEntry>): Promise<TargetEntry | undefined>;
  deleteTarget(id: string): Promise<boolean>;
  syncTargets(): Promise<SyncResult>;
  hunterStatus(): Promise<{ connected: boolean; url: string; lastSync: number | null }>;

  // stasis
  listStasis(): Promise<StasisLocation[]>;
  createStasis(input: Partial<StasisLocation>): Promise<StasisLocation>;
  updateStasis(id: string, patch: Partial<StasisLocation>): Promise<StasisLocation | undefined>;
  deleteStasis(id: string): Promise<boolean>;
  getStasisHistory(id: string): Promise<StasisChange[]>;
  setStasisState(id: string, state: string, reason: string): Promise<StasisChange | null>;

  // equipment
  listEquipment(): Promise<EquipmentProfileRecord[]>;
  createEquipment(input: Partial<EquipmentProfileRecord>): Promise<EquipmentProfileRecord>;
  updateEquipment(id: string, patch: Partial<EquipmentProfileRecord>): Promise<EquipmentProfileRecord | undefined>;
  deleteEquipment(id: string): Promise<boolean>;
  evaluateEquipment(id: string, snapshot: InventorySnapshot): Promise<EquipmentEvaluation>;

  // events / notifications
  listEvents(limit?: number): Promise<FleetEvent[]>;
  submitEvent(input: { type: string; role: string; instanceId?: string | null; targetUuid?: string | null; payload?: Record<string, unknown> }): Promise<CoordinatorResult>;
  listNotifications(): Promise<NotificationItem[]>;
  markNotificationRead(id: string): Promise<boolean>;
  markAllNotificationsRead(): Promise<boolean>;

  // workers (real Minecraft clients running the logvex-worker mod)
  listWorkers(): Promise<WorkerView[]>;
  getWorker(workerId: string): Promise<WorkerView | undefined>;
  getWorkerOverview(): Promise<WorkerOverview>;
  resolveWorkers(selector: string): Promise<WorkerView[]>;
  setWorkerLabel(workerId: string, label: string): Promise<boolean>;
  setWorkerNotes(workerId: string, notes: string): Promise<boolean>;
  forgetWorker(workerId: string): Promise<boolean>;
  pingWorker(workerId: string): Promise<boolean>;
  kickWorker(workerId: string, reason: string): Promise<boolean>;
  getWorkerServer(): Promise<{ enabled: boolean; host: string; port: number; bound: boolean; token: string }>;
  regenerateWorkerToken(): Promise<string>;

  listWorkerGroups(): Promise<WorkerGroup[]>;
  createWorkerGroup(name: string, description?: string, color?: string): Promise<WorkerGroup>;
  updateWorkerGroup(id: string, patch: { name?: string; description?: string; color?: string }): Promise<WorkerGroup | undefined>;
  deleteWorkerGroup(id: string): Promise<boolean>;
  assignWorkerGroup(workerId: string, groupId: string | null): Promise<boolean>;
  assignWorkerGroupBulk(workerIds: string[], groupId: string | null): Promise<number>;

  runWorkerTask(workerId: string, kind: TaskKind, params?: Record<string, unknown>): Promise<WorkerTaskResult>;
  runWorkerTaskMany(workerIds: string[], kind: TaskKind, params?: Record<string, unknown>): Promise<{ workerId: string; ok: boolean; result?: WorkerTaskResult; error?: string }[]>;
  listWorkerTasks(limit?: number, workerId?: string): Promise<WorkerTaskRecord[]>;
  getWorkerTaskKinds(): Promise<string[]>;

  getWorkerConsole(workerId: string): Promise<{ at: number; message: string }[]>;
  clearWorkerConsole(workerId: string): Promise<void>;
  getWorkerCapabilities(workerId: string): Promise<string[]>;

  sendWorkerLine(workerId: string, kind: 'command' | 'chat', line: string): Promise<WorkerCommandRecord>;
  sendWorkerLineMany(workerIds: string[], kind: 'command' | 'chat', line: string): Promise<{ workerId: string; ok: boolean; response: string }[]>;
  listWorkerCommands(limit?: number, workerId?: string): Promise<WorkerCommandRecord[]>;

  getWorkerInventory(workerId: string): Promise<WorkerInventorySnapshot | undefined>;
  countWorkerItem(query: string, workerIds?: string[]): Promise<ItemCountReport>;
  getCombinedTotals(workerIds?: string[]): Promise<{ id: string; name: string; count: number }[]>;
  exportWorkerReport(format: 'json' | 'csv'): Promise<{ path: string } | null>;

  listRegearPresets(): Promise<RegearPreset[]>;
  createRegearPreset(input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<RegearPreset>;
  updateRegearPreset(id: string, patch: Partial<Omit<RegearPreset, 'id' | 'createdAt'>>): Promise<RegearPreset | undefined>;
  deleteRegearPreset(id: string): Promise<boolean>;
  compareRegearPreset(workerId: string, presetId: string): Promise<RegearComparison>;
  regearWorker(workerId: string, presetId: string, allowMoves?: boolean): Promise<WorkerTaskResult>;
  regearWorkers(workerIds: string[], presetId: string, allowMoves?: boolean): Promise<{ workerId: string; ok: boolean; message: string }[]>;

  // emergency
  emergencyStop(): Promise<boolean>;
  clearEmergencyStop(): Promise<boolean>;

  // live events
  onEvent(callback: (event: FleetEvent) => void): () => void;
}

export const IPC = {
  getHealth: 'system:health',
  getSettings: 'system:settings:get',
  saveSettings: 'system:settings:save',
  getApiToken: 'system:api-token',
  regenerateApiToken: 'system:api-token:regenerate',
  getDiagnostics: 'system:diagnostics',
  exportConfig: 'system:export',
  importConfig: 'system:import',
  backupDatabase: 'system:backup',

  // workers
  listWorkers: 'workers:list',
  getWorker: 'workers:get',
  getWorkerOverview: 'workers:overview',
  resolveWorkers: 'workers:resolve',
  setWorkerLabel: 'workers:label',
  setWorkerNotes: 'workers:notes',
  forgetWorker: 'workers:forget',
  pingWorker: 'workers:ping',
  kickWorker: 'workers:kick',
  getWorkerServer: 'workers:server:get',
  regenerateWorkerToken: 'workers:server:token',

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
} as const;
