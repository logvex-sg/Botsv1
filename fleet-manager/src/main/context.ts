/**
 * Application context.
 *
 * Wires the database, repositories, vault and services together into a single object that the IPC
 * layer and the HTTP API both consume. Constructing it is pure with respect to Electron, so tests
 * can build a fully working context over an in-memory database.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FleetDatabase } from './db/database';
import {
  AccountRepository,
  ConfigVersionRepository,
  DeploymentRepository,
  EquipmentRepository,
  EventRepository,
  GroupRepository,
  InstanceRepository,
  NotificationRepository,
  QueueRepository,
  ServerProfileRepository,
  SettingsRepository,
  StasisRepository,
  TargetRepository,
  WorkerRepository,
  WorkerGroupRepository,
  WorkerTaskRepository,
  WorkerCommandRepository,
  RegearPresetRepository,
  WorkerInventoryRepository,
} from './db/repositories';
import { EventBus } from './services/events/event-bus';
import { RoleCoordinator } from './services/roles/coordinator';
import { AccountManager } from './services/accounts/account-manager';
import { GroupManager } from './services/groups/group-manager';
import { InstanceManager } from './services/instances/instance-manager';
import { DeploymentEngine } from './services/deployment/deployment-engine';
import { HunterClient } from './services/hunter/hunter-client';
import { TargetSync } from './services/hunter/target-sync';
import { StasisManager } from './services/stasis/stasis-manager';
import { EquipmentManager } from './services/equipment/equipment-manager';
import { WorkerSupervisor } from './mineflayer/worker-supervisor';
import { WorkerService } from './workers/worker-service';
import { createCredentialVault, type CredentialVault } from './security/credential-vault';
import { ROLE_DEFINITIONS, roleDefinition } from './services/roles/roles';
import { buildSetupReport, type SetupSnapshot } from './services/setup/setup-advisor';
import { join as joinPath } from 'node:path';
import { BOT_ROLES, DEFAULT_SETTINGS, type Account, type AppSettings, type BotRole, type DeploymentConfig, type Group, type HealthReport, type QuickDeployInput, type QuickSetupInput, type ServerProfile, type SetupReport, type TargetEntry } from '../shared/types';

export interface AppContextOptions {
  databasePath?: string;
  userDataDir?: string;
  vault?: CredentialVault;
  /** Overrides used by tests to avoid spawning real workers. */
  supervisor?: WorkerSupervisor;
  waitForRunning?: (instanceId: string, timeoutMs: number) => Promise<boolean>;
  /** When false the worker WebSocket server is not started (used by tests). */
  startWorkerServer?: boolean;
  /** A fixed worker token, so a test can connect without reading the generated one. */
  workerToken?: string;
  /** Overrides the configured worker port; 0 binds an ephemeral port (used by tests). */
  workerServerPort?: number;
}

export class AppContext {
  readonly db: FleetDatabase;
  readonly groups: GroupRepository;
  readonly servers: ServerProfileRepository;
  readonly accountRepo: AccountRepository;
  readonly instanceRepo: InstanceRepository;
  readonly targets: TargetRepository;
  readonly stasis: StasisRepository;
  readonly equipment: EquipmentRepository;
  readonly events: EventRepository;
  readonly notifications: NotificationRepository;
  readonly deployments: DeploymentRepository;
  readonly queues: QueueRepository;
  readonly settingsRepo: SettingsRepository;
  readonly configVersions: ConfigVersionRepository;

  readonly workerRepo: WorkerRepository;
  readonly workerGroups: WorkerGroupRepository;
  readonly workerTasks: WorkerTaskRepository;
  readonly workerCommands: WorkerCommandRepository;
  readonly regearPresets: RegearPresetRepository;
  readonly workerInventory: WorkerInventoryRepository;

  readonly bus: EventBus;
  readonly coordinator: RoleCoordinator;
  readonly vault: CredentialVault;
  readonly accounts: AccountManager;
  readonly groupManager: GroupManager;
  readonly supervisor: WorkerSupervisor;
  readonly instances: InstanceManager;
  readonly engine: DeploymentEngine;
  readonly hunter: HunterClient;
  readonly targetSync: TargetSync;
  readonly stasisManager: StasisManager;
  readonly equipmentManager: EquipmentManager;
  readonly workers: WorkerService;

  private readonly startedAt = Date.now();
  private settings: AppSettings;
  private healthTimer: NodeJS.Timeout | null = null;
  private readonly startWorkerServer: boolean;

  private constructor(options: AppContextOptions, vault: CredentialVault) {
    const databasePath = options.databasePath ?? ':memory:';
    this.db = new FleetDatabase(databasePath);
    this.vault = vault;

    this.groups = new GroupRepository(this.db);
    this.servers = new ServerProfileRepository(this.db);
    this.accountRepo = new AccountRepository(this.db);
    this.instanceRepo = new InstanceRepository(this.db);
    this.targets = new TargetRepository(this.db);
    this.stasis = new StasisRepository(this.db);
    this.equipment = new EquipmentRepository(this.db);
    this.events = new EventRepository(this.db);
    this.notifications = new NotificationRepository(this.db);
    this.deployments = new DeploymentRepository(this.db);
    this.queues = new QueueRepository(this.db);
    this.settingsRepo = new SettingsRepository(this.db);
    this.configVersions = new ConfigVersionRepository(this.db);

    this.workerRepo = new WorkerRepository(this.db);
    this.workerGroups = new WorkerGroupRepository(this.db);
    this.workerTasks = new WorkerTaskRepository(this.db);
    this.workerCommands = new WorkerCommandRepository(this.db);
    this.regearPresets = new RegearPresetRepository(this.db);
    this.workerInventory = new WorkerInventoryRepository(this.db);

    this.bus = new EventBus(this.events, this.notifications);
    this.coordinator = new RoleCoordinator(this.bus);
    this.accounts = new AccountManager(this.accountRepo, vault);
    this.groupManager = new GroupManager(this.groups, this.instanceRepo, this.accountRepo);
    this.supervisor = options.supervisor ?? new WorkerSupervisor();
    this.instances = new InstanceManager(
      this.instanceRepo,
      this.supervisor,
      (id) => this.accountRepo.get(id),
      (id) => (id ? this.servers.get(id) : undefined),
    );
    this.engine = new DeploymentEngine({
      accounts: this.accountRepo,
      servers: this.servers,
      queues: this.queues,
      instances: this.instances,
      accountManager: this.accounts,
      emitEvent: (type, message, payload) => this.emitEvent(type, message, payload),
      waitForRunning: options.waitForRunning ?? ((instanceId, timeoutMs) => this.waitForRunning(instanceId, timeoutMs)),
    });

    this.settings = this.loadSettings();
    this.hunter = new HunterClient({
      baseUrl: this.settings.hunterAddonUrl,
      token: this.settings.hunterAddonToken,
    });
    this.targetSync = new TargetSync(this.targets, this.hunter, (type, message, payload) =>
      this.emitEvent(type, message, payload));
    this.stasisManager = new StasisManager(this.stasis);
    this.equipmentManager = new EquipmentManager(this.equipment);

    // A test-supplied token must be in place before the service reads it, so it is written first.
    if (options.workerToken) this.settingsRepo.set('workerToken', options.workerToken);

    this.workers = new WorkerService(
      {
        workers: this.workerRepo,
        groups: this.workerGroups,
        tasks: this.workerTasks,
        commands: this.workerCommands,
        presets: this.regearPresets,
        inventory: this.workerInventory,
        events: this.events,
        emit: (type, message, payload) => this.emitEvent(type, message, payload),
      },
      {
        host: this.settings.workerServerHost,
        port: options.workerServerPort ?? this.settings.workerServerPort,
        token: this.getWorkerToken(),
      },
    );
    this.startWorkerServer = options.startWorkerServer !== false;

    this.instances.load();
  }

  static async create(options: AppContextOptions = {}): Promise<AppContext> {
    const dir = options.userDataDir ?? join(process.cwd(), '.logvex');
    const vault = options.vault ?? (await createCredentialVault(dir));
    return new AppContext(options, vault);
  }

  /** Starts the worker server and periodic health sampling. Safe to call once. */
  start(): void {
    if (this.startWorkerServer) void this.startWorkerServerNow();
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      for (const instance of this.instances.list()) {
        if (instance.state === 'RUNNING') {
          this.bus.publish({
            type: 'INSTANCE_HEALTH',
            source: 'fleet',
            severity: 'info',
            instanceId: instance.id,
            message: `${instance.name} health ${instance.health}%`,
            payload: { health: instance.health, uptimeMs: instance.uptimeMs },
            persist: false,
          });
        }
      }
    }, 10_000);
    this.healthTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    await this.workers.server.stop();
    this.engine.cancel();
    this.instances.stopAll();
    this.supervisor.stopAll();
    this.db.close();
  }

  emitEvent(type: string, message: string, payload?: Record<string, unknown>): void {
    this.bus.publish({ type, source: 'fleet', message, payload, severity: severityFor(type) });
  }

  private loadSettings(): AppSettings {
    const raw = this.settingsRepo.get('app');
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    } catch {
      // Corrupt settings fall back to defaults rather than crashing.
      return { ...DEFAULT_SETTINGS };
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  saveSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...patch };
    this.settingsRepo.set('app', JSON.stringify(this.settings));
    this.hunter.configure({
      baseUrl: this.settings.hunterAddonUrl,
      token: this.settings.hunterAddonToken,
    });
    // A bind-address change needs the listener restarted; the port and token are picked up on
    // restart too. This is intentionally not awaited so the settings save stays synchronous.
    void this.reconfigureWorkerServer();
    return this.getSettings();
  }

  roleCatalog(): { role: BotRole; title: string; color: string; description: string; fields: unknown; permissions: unknown }[] {
    return BOT_ROLES.map((role) => {
      const def = roleDefinition(role);
      return { role, title: def.title, color: def.color, description: def.description, fields: def.fields, permissions: def.permissions };
    });
  }

  async healthReport(): Promise<HealthReport> {
    const health = await this.hunter.health();
    return {
      ok: true,
      version: '1.0.0',
      uptimeMs: Date.now() - this.startedAt,
      instances: {
        total: this.instances.list().length,
        running: this.instances.runningCount(),
        failed: this.instances.failedCount(),
      },
      database: { ok: true, path: this.db.path },
      hunter: { connected: health.ok, url: this.hunter.baseUrl, lastSync: this.hunter.lastSyncAt() },
    };
  }

  /** Builds the guided first-run checklist from the current fleet state. */
  async setupReport(): Promise<SetupReport> {
    const health = await this.hunter.health().catch(() => ({ ok: false }));
    const accounts = await this.accounts.listWithStatus();
    const snapshot: SetupSnapshot = {
      servers: this.servers.list().length,
      accounts: accounts.length,
      deployableAccounts: accounts.filter((a) => a.deployable).length,
      instances: this.instances.list().length,
      runningInstances: this.instances.runningCount(),
      hunterConnected: health.ok,
    };
    return buildSetupReport(snapshot);
  }

  /**
   * One-click setup: creates the server profile and account (if missing) so a brand-new user can
   * go from an empty app to a deployable account in a single step. Existing records are reused
   * rather than duplicated.
   */
  async quickSetup(input: QuickSetupInput): Promise<{ serverProfileId: string; accountId: string; created: { server: boolean; account: boolean } }> {
    const username = input.username.trim();
    const host = input.host.trim();
    if (!username) throw new Error('Enter a username for the account.');
    if (!host) throw new Error('Enter the server address your bots should join.');

    let server = this.servers.list().find((s) => s.host === host);
    let createdServer = false;
    if (!server) {
      server = this.servers.create({
        name: host,
        host,
        port: input.port ?? 25565,
        version: input.version ?? '',
        authMode: 'offline',
        connectionTimeoutMs: 15000,
        options: {},
      });
      createdServer = true;
    }

    let account = this.accountRepo.findByUsername(username);
    let createdAccount = false;
    if (!account) {
      account = await this.accounts.create({
        username,
        displayName: username,
        authMode: 'offline',
        role: input.role ?? 'HUNTER',
        serverProfileId: server.id,
      } as never);
      createdAccount = true;
    }

    this.emitEvent('SYSTEM', `Quick setup prepared ${username} on ${host}`);
    return { serverProfileId: server.id, accountId: account.id, created: { server: createdServer, account: createdAccount } };
  }

  /**
   * One-click deploy: creates a deployment for the given accounts (using each account's own server
   * profile unless one is given) and starts it immediately. This is the "just make my bots run"
   * path for beginners — no queue building required.
   */
  async quickDeploy(input: QuickDeployInput): Promise<{ ok: boolean; report: import('../shared/types').ValidationReport; deploymentId?: string }> {
    const ids = [...new Set(input.accountIds.filter(Boolean))];
    if (ids.length === 0) {
      return { ok: false, report: { ok: false, issues: [{ level: 'error', code: 'empty', message: 'Select at least one account to start.' }] } };
    }

    const accounts = ids.map((id) => this.accountRepo.get(id)).filter((a): a is Account => Boolean(a));
    if (accounts.length === 0) {
      return { ok: false, report: { ok: false, issues: [{ level: 'error', code: 'account-missing', message: 'None of the selected accounts could be found.' }] } };
    }

    const serverProfileId = input.serverProfileId
      ?? accounts.find((a) => a.serverProfileId)?.serverProfileId
      ?? this.servers.list()[0]?.id
      ?? null;

    if (!serverProfileId) {
      return { ok: false, report: { ok: false, issues: [{ level: 'error', code: 'server', message: 'Add a server first so the bots know where to connect.' }] } };
    }

    const entries = accounts.map((account, index) => {
      const role = input.role ?? account.role;
      const roleConfig: Record<string, unknown> = {};
      if (role === 'HUNTER') {
        // Combat stays off unless the caller explicitly authorises it.
        roleConfig.authorizedCombat = input.authorizeCombat === true;
        if (input.allowlist && input.allowlist.length > 0) roleConfig.allowlist = input.allowlist;
      }
      return {
        accountId: account.id,
        role,
        instanceName: `${account.username}`.slice(0, 24) || `bot-${index + 1}`,
        delayMs: index * 2000,
        roleConfig,
      };
    });

    const config = this.deployments.create({
      name: input.name ?? `Quick start (${accounts.length} bot${accounts.length === 1 ? '' : 's'})`,
      description: 'Created from the dashboard one-click start.',
      serverProfileId,
      entries,
      maxConcurrent: input.maxConcurrent ?? 1,
      connectionTimeoutMs: 15000,
      retryAttempts: 2,
      retryDelayMs: 5000,
      manualApproval: false,
      pauseBetweenMs: 4000,
      resourceLimitMb: 4096,
      notifyOnEvent: true,
    });

    const result = await this.engine.start(config);
    if (!result.ok) {
      // Keep the config so the user can fix and retry, but report why it did not start.
      return { ok: false, report: result.report, deploymentId: config.id };
    }
    return { ok: true, report: result.report, deploymentId: config.id };
  }

  /** Polls an instance until it is RUNNING or the timeout elapses. */
  private waitForRunning(instanceId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        const instance = this.instances.get(instanceId);
        if (!instance) {
          clearInterval(timer);
          resolve(false);
          return;
        }
        if (instance.state === 'RUNNING') {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (instance.state === 'FAILED' || Date.now() > deadline) {
          clearInterval(timer);
          resolve(false);
        }
      }, 250);
      timer.unref?.();
    });
  }

  newId(): string {
    return randomUUID();
  }

  /** Starts (or restarts) the worker server so a settings change takes effect without a restart. */
  async startWorkerServerNow(): Promise<number> {
    try {
      return await this.workers.server.start();
    } catch (error) {
      this.emitEvent('WORKER_ERROR', `Worker server could not start: ${(error as Error).message}`);
      return 0;
    }
  }

  /** Applies worker server settings, restarting the listener when the bind address changed. */
  async reconfigureWorkerServer(): Promise<void> {
    await this.workers.server.stop();
    this.workers.server.setToken(this.getWorkerToken());
    if (this.settings.workerServerEnabled) await this.startWorkerServerNow();
  }

  /** The shared token a worker must present. Stored like the API token: generated once, never logged. */
  getWorkerToken(): string {
    const stored = this.settingsRepo.get('workerToken');
    if (stored && stored.length > 0) return stored;
    const token = randomUUID().replace(/-/g, '');
    this.settingsRepo.set('workerToken', token);
    return token;
  }

  regenerateWorkerToken(): string {
    const token = randomUUID().replace(/-/g, '');
    this.settingsRepo.set('workerToken', token);
    this.workers.server.setToken(token);
    this.emitEvent('WORKER_ERROR', 'Worker token regenerated; connected workers must be updated.');
    return token;
  }

  // ------------------------------------------------------------ api token
  private apiToken: string | null = null;

  getApiToken(): string {
    if (!this.apiToken) {
      const stored = this.settingsRepo.get('apiToken');
      this.apiToken = stored && stored.length > 0 ? stored : randomUUID().replace(/-/g, '');
      this.settingsRepo.set('apiToken', this.apiToken);
    }
    return this.apiToken;
  }

  regenerateApiToken(): string {
    this.apiToken = randomUUID().replace(/-/g, '');
    this.settingsRepo.set('apiToken', this.apiToken);
    return this.apiToken;
  }

  // --------------------------------------------------------- config bundle
  exportBundlePath(): string {
    return joinPath(process.cwd(), `logvex-config-${Date.now()}.json`);
  }

  /** Full configuration export. Credentials are never included. */
  exportBundle(): Record<string, unknown> {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      groups: this.groups.list(),
      servers: this.servers.list(),
      accounts: this.accountRepo.list().map((a) => ({ ...a, hasCredential: undefined })),
      instances: this.instanceRepo.list(),
      deployments: this.deployments.list(),
      targets: this.targets.list(),
      stasis: this.stasis.list(),
      equipment: this.equipment.list(),
      workerGroups: this.workerGroups.list(),
      regearPresets: this.regearPresets.list(),
    };
  }

  /** Imports a configuration bundle, creating missing records and skipping duplicates. */
  importBundle(bundle: Record<string, unknown>): number {
    let imported = 0;
    const servers = (bundle.servers as ServerProfile[] | undefined) ?? [];
    const serverIdMap = new Map<string, string>();
    for (const server of servers) {
      const existing = this.servers.list().find((s) => s.name === server.name && s.host === server.host);
      if (existing) { serverIdMap.set(server.id, existing.id); continue; }
      const created = this.servers.create({
        name: server.name, host: server.host, port: server.port, version: server.version,
        authMode: server.authMode, connectionTimeoutMs: server.connectionTimeoutMs, options: server.options ?? {},
      });
      serverIdMap.set(server.id, created.id);
      imported++;
    }
    const groups = (bundle.groups as Group[] | undefined) ?? [];
    const groupIdMap = new Map<string, string>();
    for (const group of groups) {
      const existing = this.groups.list().find((g) => g.name === group.name);
      if (existing) { groupIdMap.set(group.id, existing.id); continue; }
      const created = this.groups.create(group.name, group.description, group.color);
      groupIdMap.set(group.id, created.id);
      imported++;
    }
    const accounts = (bundle.accounts as Account[] | undefined) ?? [];
    for (const account of accounts) {
      if (this.accountRepo.findByUsername(account.username)) continue;
      this.accountRepo.create({
        username: account.username, displayName: account.displayName, authMode: account.authMode,
        role: account.role, groupId: account.groupId ? groupIdMap.get(account.groupId) ?? null : null,
        lastLogin: account.lastLogin, lastLoginOk: account.lastLoginOk,
        serverProfileId: account.serverProfileId ? serverIdMap.get(account.serverProfileId) ?? null : null,
        notes: account.notes,
      });
      imported++;
    }
    const deployments = (bundle.deployments as DeploymentConfig[] | undefined) ?? [];
    for (const deployment of deployments) {
      if (this.deployments.list().some((d) => d.name === deployment.name)) continue;
      this.deployments.create({ ...deployment, serverProfileId: deployment.serverProfileId ? serverIdMap.get(deployment.serverProfileId) ?? null : null });
      imported++;
    }
    const targets = (bundle.targets as TargetEntry[] | undefined) ?? [];
    for (const target of targets) {
      if (this.targets.findByIdentity(target.uuid ?? null, target.username)) continue;
      this.targets.upsert(target);
      imported++;
    }
    return imported;
  }
}

function severityFor(type: string): 'info' | 'warning' | 'error' | 'success' {
  if (type.includes('ERROR') || type.includes('FAILED') || type.includes('UNAVAILABLE')) return 'error';
  if (type.includes('WARNING') || type.includes('DANGER')) return 'warning';
  if (type.includes('READY') || type.includes('CONNECTED') || type.includes('FINISHED')) return 'success';
  return 'info';
}

export { ROLE_DEFINITIONS };
