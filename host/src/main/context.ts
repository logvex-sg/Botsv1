/**
 * Application context.
 *
 * Wires the database, repositories and the worker server into a single object that the IPC layer
 * and the HTTP API both consume. Constructing it is pure with respect to Electron, so tests can
 * build a fully working context over an in-memory database.
 *
 * The host is the only mode this context serves: it accepts workers that dial in and controls
 * them. It never launches a Minecraft client itself.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FleetDatabase } from './db/database';
import {
  AuditRepository,
  AutomationRuleRepository,
  ContainerRepository,
  EventRepository,
  GroupTemplateRepository,
  InventoryHistoryRepository,
  NotificationRepository,
  RegearPresetRepository,
  ScheduleRepository,
  ServerProfileRepository,
  SettingsRepository,
  TaskPresetRepository,
  WorkerCommandRepository,
  WorkerGroupRepository,
  WorkerInventoryRepository,
  WorkerRepository,
  WorkerTaskRepository,
  WorkerTokenRepository,
} from './db/repositories';
import { EventBus } from './services/events/event-bus';
import { WorkerService } from './workers/worker-service';
import { WorkerModeService } from './worker-mode/worker-mode-service';
import { MultiverseService } from './services/multiverse/multiverse-service';
import { StorageService } from './services/storage/storage-service';
import {
  DisposalRuleRepository,
  PortalRepository,
  RestockRuleRepository,
  ShulkerRepository,
  StorageActivityRepository,
  StorageCategoryRepository,
  StorageContainerRepository,
  StorageNetworkRepository,
  StoragePlanRepository,
  StorageProfileRepository,
  StructureRepository,
  WorkflowRepository,
} from './db/storage-repositories';
import { PairingService, type PairingCodeView, type PairingStatus } from './pairing/pairing-service';
import { aggregate } from './packages/inventory-engine';
import { DEFAULT_SETTINGS, type AppSettings, type HealthReport } from '../shared/types';

export interface AppContextOptions {
  databasePath?: string;
  userDataDir?: string;
  /** When false the worker WebSocket server is not started (used by tests). */
  startWorkerServer?: boolean;
  /** A fixed worker token, so a test can connect without reading the generated one. */
  workerToken?: string;
  /** Overrides the configured worker port; 0 binds an ephemeral port (used by tests). */
  workerServerPort?: number;
}

/** Characters for a pairing code: no 0/O/1/I/L so a code is easy to read out and type. */
export class AppContext {
  readonly db: FleetDatabase;
  readonly settingsRepo: SettingsRepository;
  readonly events: EventRepository;
  readonly notifications: NotificationRepository;

  readonly workerRepo: WorkerRepository;
  readonly workerGroups: WorkerGroupRepository;
  readonly workerTasks: WorkerTaskRepository;
  readonly workerCommands: WorkerCommandRepository;
  readonly regearPresets: RegearPresetRepository;
  readonly workerInventory: WorkerInventoryRepository;

  // Multiverse layer
  readonly servers: ServerProfileRepository;
  readonly groupTemplates: GroupTemplateRepository;
  readonly taskPresets: TaskPresetRepository;
  readonly schedules: ScheduleRepository;
  readonly rules: AutomationRuleRepository;
  readonly containers: ContainerRepository;
  readonly inventoryHistory: InventoryHistoryRepository;
  readonly audit: AuditRepository;
  readonly workerTokens: WorkerTokenRepository;

  // Autonomous storage & maintenance layer
  readonly storageNetworks: StorageNetworkRepository;
  readonly storageCategories: StorageCategoryRepository;
  readonly storageContainers: StorageContainerRepository;
  readonly restockRules: RestockRuleRepository;
  readonly disposalRules: DisposalRuleRepository;
  readonly portals: PortalRepository;
  readonly shulkers: ShulkerRepository;
  readonly structures: StructureRepository;
  readonly workflows: WorkflowRepository;
  readonly storagePlans: StoragePlanRepository;
  readonly storageActivity: StorageActivityRepository;
  readonly storageProfiles: StorageProfileRepository;

  readonly bus: EventBus;
  readonly workers: WorkerService;
  readonly workerMode: WorkerModeService;
  readonly multiverse: MultiverseService;
  readonly storage: StorageService;
  /** Owns the pairing code and the per-worker tokens; the worker server asks it to authenticate. */
  readonly pairing: PairingService;

  private readonly startedAt = Date.now();
  private settings: AppSettings;
  private readonly startWorkerServer: boolean;

  private constructor(options: AppContextOptions) {
    const databasePath = options.databasePath ?? ':memory:';
    this.db = new FleetDatabase(databasePath);

    this.settingsRepo = new SettingsRepository(this.db);
    this.events = new EventRepository(this.db);
    this.notifications = new NotificationRepository(this.db);

    this.workerRepo = new WorkerRepository(this.db);
    this.workerGroups = new WorkerGroupRepository(this.db);
    this.workerTasks = new WorkerTaskRepository(this.db);
    this.workerCommands = new WorkerCommandRepository(this.db);
    this.regearPresets = new RegearPresetRepository(this.db);
    this.workerInventory = new WorkerInventoryRepository(this.db);

    this.servers = new ServerProfileRepository(this.db);
    this.groupTemplates = new GroupTemplateRepository(this.db);
    this.taskPresets = new TaskPresetRepository(this.db);
    this.schedules = new ScheduleRepository(this.db);
    this.rules = new AutomationRuleRepository(this.db);
    this.containers = new ContainerRepository(this.db);
    this.inventoryHistory = new InventoryHistoryRepository(this.db);
    this.audit = new AuditRepository(this.db);
    this.workerTokens = new WorkerTokenRepository(this.db);

    this.storageNetworks = new StorageNetworkRepository(this.db);
    this.storageCategories = new StorageCategoryRepository(this.db);
    this.storageContainers = new StorageContainerRepository(this.db);
    this.restockRules = new RestockRuleRepository(this.db);
    this.disposalRules = new DisposalRuleRepository(this.db);
    this.portals = new PortalRepository(this.db);
    this.shulkers = new ShulkerRepository(this.db);
    this.structures = new StructureRepository(this.db);
    this.workflows = new WorkflowRepository(this.db);
    this.storagePlans = new StoragePlanRepository(this.db);
    this.storageActivity = new StorageActivityRepository(this.db);
    this.storageProfiles = new StorageProfileRepository(this.db);

    this.bus = new EventBus(this.events, this.notifications);
    this.settings = this.loadSettings();

    // A test-supplied token must be in place before the service reads it, so it is written first.
    if (options.workerToken) this.settingsRepo.set('workerToken', options.workerToken);

    this.pairing = new PairingService({
      tokens: this.workerTokens,
      emit: (type, message, payload) => this.emitEvent(type, message, payload),
      ttlSeconds: () => this.settings.pairingCodeTtlSeconds,
      sharedToken: () => this.getWorkerToken(),
      newWorkerId: () => `worker-${randomUUID().slice(0, 8)}`,
    });

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
        // Recording history here means every reported inventory becomes a trend point, whether it
        // arrived from a hand-run task or a schedule.
        onInventory: (workerId, snapshot) => {
          this.inventoryHistory.record(workerId, snapshot.capturedAt, aggregate([snapshot.carried]));
          this.inventoryHistory.prune(200);
        },
        // The last capabilities a worker advertised, so a dispatch is refused when the worker
        // cannot run the kind. Read from the roster the server keeps, not a second copy.
        capabilitiesFor: (workerId) => this.workerRepo.get(workerId)?.capabilities,
      },
      {
        host: this.settings.workerServerHost,
        port: options.workerServerPort ?? this.settings.workerServerPort,
        token: this.getWorkerToken(),
        authorizer: this.pairing,
      },
    );
    this.startWorkerServer = options.startWorkerServer !== false;

    // The Multiverse layer reads the same worker rows and dispatches through the same task path as
    // the UI, so a scheduled run and a hand-clicked run are the same operation.
    this.multiverse = new MultiverseService({
      servers: this.servers,
      groupTemplates: this.groupTemplates,
      groups: this.workerGroups,
      taskPresets: this.taskPresets,
      schedules: this.schedules,
      rules: this.rules,
      containers: this.containers,
      history: this.inventoryHistory,
      audit: this.audit,
      workers: this.workerRepo,
      emit: (type, message, payload) => this.emitEvent(type, message, payload),
      runTask: async (workerId, kind, params) => {
        try {
          const result = await this.workers.runTask(workerId, kind as never, params);
          return { ok: result.ok, error: result.ok ? undefined : result.message };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
      isOnline: (workerId) => this.workers.server.isOnline(workerId),
    });

    // The storage layer reuses the same worker task path and the same inventory snapshots as the
    // rest of the host, so a planned move and a hand-run task are the same operation. It holds its
    // own container reservations to keep two operations off the same container at once.
    this.storage = new StorageService({
      networks: this.storageNetworks,
      categories: this.storageCategories,
      containers: this.storageContainers,
      restockRules: this.restockRules,
      disposalRules: this.disposalRules,
      portals: this.portals,
      shulkers: this.shulkers,
      structures: this.structures,
      workflows: this.workflows,
      plans: this.storagePlans,
      activity: this.storageActivity,
      profiles: this.storageProfiles,
      emit: (type, message, payload) => this.emitEvent(type, message, payload),
      runTask: async (workerId, kind, params) => {
        try {
          const result = await this.workers.runTask(workerId, kind as never, params);
          return { ok: result.ok, error: result.ok ? undefined : result.message, data: result.data };
        } catch (error) {
          return { ok: false, error: (error as Error).message };
        }
      },
      isOnline: (workerId) => this.workers.server.isOnline(workerId),
      carriedFor: (workerId) => this.workerInventory.get(workerId)?.carried ?? [],
      workerIds: () => this.workerRepo.list().map((worker) => worker.id),
    });

    // Every worker event is offered to the rule engine exactly once, here, so a rule fires from the
    // same event stream the Activity view shows.
    this.bus.subscribe((event) => {
      void this.multiverse
        .onEvent({ type: event.type, workerId: event.workerId, payload: event.payload })
        .catch((error) => this.emitEvent('SYSTEM', `Automation rule failed: ${(error as Error).message}`));
    });

    // Worker Mode keeps its own settings key and its own connection; it never reads the host's
    // `app` settings, so the two modes cannot blend.
    this.workerMode = new WorkerModeService({
      settings: this.settingsRepo,
      emit: (type, message, payload) => this.emitEvent(type, message, payload),
    });
  }

  static async create(options: AppContextOptions = {}): Promise<AppContext> {
    return new AppContext(options);
  }

  /** Starts the worker server, and a Worker Mode connection when the operator asked for one. */
  start(): void {
    // Seed the storage defaults once, best-effort: a fresh install then has categories to route by
    // and the built-in workflows to run, without the operator having to create them by hand.
    try {
      this.storage.ensureDefaultCategories();
      this.storage.ensureBuiltinWorkflows();
    } catch (error) {
      this.emitEvent('SYSTEM', `Could not seed storage defaults: ${(error as Error).message}`);
    }
    if (this.startWorkerServer) void this.startWorkerServerNow();
    if (this.workerMode.getSettings().autoConnect) {
      void this.workerMode.connect().catch(() => {
        // A failed auto-connect is reported through Worker Mode's own status, not thrown.
      });
    }
  }

  async shutdown(): Promise<void> {
    this.workerMode.disconnect();
    await this.workers.server.stop();
    this.db.close();
  }

  emitEvent(type: string, message: string, payload?: Record<string, unknown>): void {
    this.bus.publish({ type, source: 'host', message, payload, severity: severityFor(type) });
  }

  /**
   * Runs due schedules once. Called on an interval from the main process.
   *
   * This is deliberately a no-op when nothing is due, so an idle Host with many schedules costs a
   * few timestamp comparisons per tick and nothing else.
   */
  async tickSchedules(now = Date.now()): Promise<void> {
    try {
      await this.multiverse.tick(now);
    } catch (error) {
      this.emitEvent('SYSTEM', `Schedule tick failed: ${(error as Error).message}`);
    }
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
    // A bind-address or token change needs the listener restarted. Intentionally not awaited so a
    // settings save stays synchronous from the UI's point of view.
    void this.reconfigureWorkerServer();
    return this.getSettings();
  }

  async healthReport(): Promise<HealthReport> {
    const roster = this.workers.list();
    return {
      ok: true,
      version: '2.0.0',
      uptimeMs: Date.now() - this.startedAt,
      database: { ok: true, path: this.db.path },
      workerServer: {
        enabled: this.settings.workerServerEnabled,
        running: this.workers.server.running,
        host: this.settings.workerServerHost,
        port: this.workers.server.port || this.settings.workerServerPort,
      },
      workers: { total: roster.length, online: roster.filter((w) => w.online).length },
    };
  }

  newId(): string {
    return randomUUID();
  }

  // ----------------------------------------------------------- worker server

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
    this.emitEvent('SYSTEM', 'Worker token regenerated; connected workers must be re-paired.');
    return token;
  }

  // ------------------------------------------------------------- pairing code

  /** The current pairing code and when it expires, or null when none is active. */
  currentPairingCode(): PairingCodeView | null {
    return this.pairing.currentCode();
  }

  /** Creates a fresh, single-use pairing code that a worker can present on its first join. */
  createPairingCode(): PairingCodeView {
    return this.pairing.createCode();
  }

  /** Invalidates the current pairing code without creating a new one. */
  clearPairingCode(): void {
    this.pairing.clearCode();
  }

  /** The pairing panel's whole state: the active code, its lifetime, and every paired worker. */
  pairingStatus(): PairingStatus {
    return this.pairing.status();
  }

  /** Revokes one worker's credential so it must be paired again. */
  revokeWorker(workerId: string): boolean {
    return this.pairing.revoke(workerId);
  }

  /** Lifts a worker's revocation without issuing a new token. */
  allowWorker(workerId: string): boolean {
    return this.pairing.allow(workerId);
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
    return join(process.cwd(), `logvex-config-${Date.now()}.json`);
  }

  /** Full configuration export. The worker token is never included. */
  exportBundle(): Record<string, unknown> {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: { ...this.getSettings() },
      workerGroups: this.workerGroups.list(),
      regearPresets: this.regearPresets.list(),
    };
  }

  /** Imports a configuration bundle, creating missing records and skipping duplicates. */
  importBundle(bundle: Record<string, unknown>): number {
    let imported = 0;
    const workerGroups = (bundle.workerGroups as { name: string; description?: string; color?: string }[] | undefined) ?? [];
    for (const group of workerGroups) {
      if (this.workerGroups.findByName(group.name)) continue;
      this.workerGroups.create(group.name, group.description ?? '', group.color ?? '#6d5efc');
      imported++;
    }
    const presets = (bundle.regearPresets as import('../shared/types').RegearPreset[] | undefined) ?? [];
    for (const preset of presets) {
      if (this.regearPresets.findByName(preset.name)) continue;
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = preset;
      this.regearPresets.create(rest);
      imported++;
    }
    return imported;
  }
}

function severityFor(type: string): 'info' | 'warning' | 'error' | 'success' {
  if (type.includes('ERROR') || type.includes('FAILED')) return 'error';
  if (type.includes('PAIRED') || type.includes('REGISTERED') || type.includes('FINISHED')) return 'success';
  return 'info';
}
