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
  EventRepository,
  NotificationRepository,
  RegearPresetRepository,
  SettingsRepository,
  WorkerCommandRepository,
  WorkerGroupRepository,
  WorkerInventoryRepository,
  WorkerRepository,
  WorkerTaskRepository,
} from './db/repositories';
import { EventBus } from './services/events/event-bus';
import { WorkerService } from './workers/worker-service';
import { DEFAULT_SETTINGS, type AppSettings, type HealthReport, type PairingCode } from '../shared/types';

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
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

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

  readonly bus: EventBus;
  readonly workers: WorkerService;

  private readonly startedAt = Date.now();
  private settings: AppSettings;
  private readonly startWorkerServer: boolean;
  /** The active pairing code, if any. Single-use and time-limited. */
  private pairing: PairingCode | null = null;

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

    this.bus = new EventBus(this.events, this.notifications);
    this.settings = this.loadSettings();

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
        verifyPairingCode: (code) => this.consumePairingCode(code),
      },
    );
    this.startWorkerServer = options.startWorkerServer !== false;
  }

  static async create(options: AppContextOptions = {}): Promise<AppContext> {
    return new AppContext(options);
  }

  /** Starts the worker server. Safe to call once. */
  start(): void {
    if (this.startWorkerServer) void this.startWorkerServerNow();
  }

  async shutdown(): Promise<void> {
    await this.workers.server.stop();
    this.db.close();
  }

  emitEvent(type: string, message: string, payload?: Record<string, unknown>): void {
    this.bus.publish({ type, source: 'host', message, payload, severity: severityFor(type) });
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
  currentPairingCode(): PairingCode | null {
    if (this.pairing && this.pairing.expiresAt <= Date.now()) this.pairing = null;
    return this.pairing;
  }

  /** Creates a fresh, single-use pairing code that a worker can present on its first join. */
  createPairingCode(): PairingCode {
    const ttl = Math.max(30, this.settings.pairingCodeTtlSeconds) * 1000;
    const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[Math.floor(Math.random() * PAIRING_ALPHABET.length)]).join('');
    this.pairing = { code, createdAt: Date.now(), expiresAt: Date.now() + ttl };
    return this.pairing;
  }

  /** Invalidates the current pairing code without creating a new one. */
  clearPairingCode(): void {
    this.pairing = null;
  }

  /**
   * Validates a pairing code presented by a worker.
   *
   * A successful match is consumed immediately, so one code admits exactly one worker. Returns the
   * shared token to grant on success, or null when the code is unknown or expired.
   */
  private consumePairingCode(code: string): string | null {
    const active = this.currentPairingCode();
    if (!active) return null;
    if (active.code !== code.trim().toUpperCase()) return null;
    this.pairing = null;
    return this.getWorkerToken();
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
