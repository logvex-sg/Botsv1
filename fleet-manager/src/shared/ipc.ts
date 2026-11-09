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
} from './types';
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
} as const;
