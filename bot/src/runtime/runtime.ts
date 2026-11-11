/**
 * The Mineflayer runtime.
 *
 * This is the top of the bot: it owns the connection, the adapters, the executor, the plugins and
 * the link to the fleet manager, and it is the only object that knows about all of them. Everything
 * below it takes what it needs as an argument, which is what keeps the engines testable without a
 * server and the runtime testable without a game.
 *
 * Lifecycle: `start()` loads configuration and registries, connects, starts plugins and the link;
 * `stop()` reverses that in the opposite order so nothing is left ticking or half-connected.
 */

import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { BotError, asBotError } from '../core/errors';
import { applyRemotePatch, loadConfig, saveConfig, configPath, type BotConfig } from '../core/config';
import { Registries } from '../core/registries';
import { TaskQueue } from '../core/task-queue';
import { OperationLock, RateLimiter } from '../core/reliability';
import { isExclusive, permitsTask } from '../core/task-catalog';
import { Planner } from '../ai/planner';
import { createProvider } from '../ai/factory';
import { Connection, mineflayerFactory, type BotFactory, type MineflayerBot } from '../mc/connection';
import { InventoryAdapter, asBotWithInventory } from '../mc/inventory';
import { ContainerAdapter, type ContainerBot } from '../mc/container';
import { NavigationAdapter, type NavigationBot } from '../mc/navigation';
import { ShulkerAdapter } from '../mc/shulker';
import { ShulkerPlacement, type PlacementBot } from '../mc/shulker-placement';
import { BUILTIN_PLUGINS, PluginRegistry, type PluginContext } from '../plugins';
import { Link, type SocketFactory } from './link';
import { TaskExecutor } from './task-executor';
import { MESSAGE_TYPES, WORKER_PROTOCOL_VERSION, type WorkerEnvelope } from '../core/protocol/messages';
import type { ItemStack, TaskResult, Vec3 } from '../core/types';

export interface RuntimeOptions {
  /** Directory the worker keeps its own state in. */
  baseDir: string;
  logger?: Logger;
  /** Builds the Mineflayer bot. Defaults to the real `mineflayer.createBot`. */
  botFactory?: BotFactory;
  /** Builds the WebSocket. Defaults to the `ws` package. */
  socketFactory?: SocketFactory;
  /** A vector constructor for the bot's block API. Defaults to `vec3`. */
  vec?: (position: Vec3) => unknown;
  /** The pathfinder goals, injected so tests can avoid the dependency. */
  goals?: { GoalBlock: (x: number, y: number, z: number) => unknown; GoalNear: (x: number, y: number, z: number, range: number) => unknown };
  movements?: (bot: unknown) => unknown;
  /** Overrides configuration after loading (used by tests). */
  configOverride?: Partial<BotConfig>;
  /** When true, do not dial the fleet manager. */
  offline?: boolean;
}

export interface RuntimeSnapshot {
  workerId: string;
  username: string;
  runtime: 'mineflayer';
  protocolVersion: number;
  server?: string;
  dimension?: string;
  position?: Vec3;
  health?: number;
  food?: number;
  paused: boolean;
  stopped: boolean;
  connected: boolean;
  linkOpen: boolean;
  plugins: Array<{ id: string; state: string; tickCount: number; errorCount: number }>;
  queue: Record<string, number>;
  tasks: { completed: number; failed: number };
}

/**
 * Owns one Mineflayer worker end to end.
 *
 * The runtime is deliberately the only place that reaches across layers. The executor, plugins and
 * adapters each receive exactly the collaborators they need, which is what makes the pure engines
 * testable in isolation and the runtime testable with a fake bot.
 */
export class MineflayerRuntime {
  private readonly logger: Logger;
  private readonly bus: EventBus;
  private readonly options: RuntimeOptions;
  private config!: BotConfig;
  private registries!: Registries;
  private queue!: TaskQueue;
  private locks!: OperationLock;
  private limiter!: RateLimiter;
  private connection!: Connection;
  private inventory!: InventoryAdapter;
  private container!: ContainerAdapter;
  private navigation!: NavigationAdapter;
  private shulkers!: ShulkerAdapter;
  private placement!: ShulkerPlacement;
  private executor!: TaskExecutor;
  private plugins!: PluginRegistry;
  private link: Link | null = null;
  private planner: Planner | null = null;
  private paused = false;
  private stopped = false;
  private started = false;
  private completed = 0;
  private failed = 0;
  private currentTask: string | null = null;

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.logger = options.logger ?? new Logger({ level: 'info', scope: 'runtime' });
    this.bus = new EventBus({ logger: this.logger });
  }

  /** Loads configuration and registries. Safe to call before `start()`. */
  async init(): Promise<BotConfig> {
    const loaded = await loadConfig(configPath(this.options.baseDir));
    this.config = { ...loaded.config, ...(this.options.configOverride ?? {}) };
    this.config.stateDir = loaded.config.stateDir;
    if (loaded.created) this.logger.info('wrote a default configuration');
    if (loaded.recovered) this.logger.warn('the configuration file was corrupt and has been moved aside; defaults were written');

    this.registries = new Registries(this.config.stateDir);
    await this.registries.load();
    this.queue = new TaskQueue({ stateDir: this.config.stateDir });
    await this.queue.load();
    this.locks = new OperationLock();
    this.limiter = new RateLimiter(this.config.mutationRateLimitPerMinute);
    this.planner = this.buildPlanner();
    return this.config;
  }

  private buildPlanner(): Planner | null {
    const provider = createProvider({
      provider: this.config.ai.provider,
      baseUrl: this.config.ai.baseUrl,
      model: this.config.ai.model,
      apiKey: this.config.ai.apiKey,
      timeoutMs: this.config.ai.timeoutMs,
    });
    // The deterministic interpreter is always available, so a planner is always constructed.
    return new Planner({
      provider: provider ?? undefined,
      logger: this.logger,
      fallbackToDeterministic: this.config.ai.fallbackToDeterministic,
      minimumConfidence: 0.5,
    });
  }

  /** Builds the adapters around a live (or fake) bot. */
  private wire(bot: MineflayerBot): void {
    const inventoryBot = asBotWithInventory(bot);
    this.inventory = new InventoryAdapter(inventoryBot);
    const containerBot = bot as ContainerBot;
    const tagLookup = (id: string): string[] | undefined => undefined;
    this.container = new ContainerAdapter({
      bot: containerBot,
      logger: this.logger,
      openTimeoutMs: this.config.containerTimeoutMs,
      vec: this.options.vec ?? ((position) => position),
      tagLookup,
    });
    const navigationBot = bot as NavigationBot;
    this.navigation = new NavigationAdapter({
      bot: navigationBot,
      logger: this.logger,
      goals: this.options.goals ?? fallbackGoals,
      movements: this.options.movements,
      limits: this.config.navigation,
      vec: this.options.vec ?? ((position) => position),
    });
    this.shulkers = new ShulkerAdapter(inventoryBot, tagLookup);
    this.placement = new ShulkerPlacement({
      bot: bot as unknown as PlacementBot,
      container: this.container,
      logger: this.logger,
      vec: this.options.vec ?? ((position) => position),
    });
  }

  private executionContext() {
    return {
      workerId: this.config.workerId,
      config: this.config,
      logger: this.logger,
      registries: this.registries,
      inventory: this.inventory,
      container: this.container,
      navigation: this.navigation,
      shulkers: this.shulkers,
      planner: this.planner,
      snapshot: () => this.snapshot() as unknown as Record<string, unknown>,
      position: () => this.position(),
      dimension: () => this.dimension(),
      sendChat: (message: string) => this.connection.chat(message),
      openPlacedShulker: this.placement
        ? async (slot: number) => {
            const handle = await this.placement!.place(slot);
            return { window: handle.window, restore: handle.restore };
          }
        : undefined,
    };
  }

  private pluginContext(): PluginContext {
    return {
      workerId: this.config.workerId,
      config: this.config,
      logger: this.logger,
      registries: this.registries,
      inventory: this.inventory,
      container: this.container,
      navigation: this.navigation,
      shulkers: this.shulkers,
      emit: (type, payload) => this.emit(type, payload),
      isPaused: () => this.paused,
      isSpawned: () => this.connection.isSpawned(),
      position: () => this.position(),
      dimension: () => this.dimension(),
      executeTask: async (kind, payload) => {
        const result = await this.runTask({ kind, payload });
        return { ok: result.ok, message: result.message, data: result.data };
      },
      now: () => Date.now(),
    };
  }

  /** Connects, starts plugins and opens the link. */
  async start(): Promise<void> {
    if (this.started) return;
    if (!this.config) await this.init();
    this.stopped = false;

    const factory = this.options.botFactory ?? (await this.defaultBotFactory());
    this.connection = new Connection({
      config: this.config,
      logger: this.logger,
      factory,
      events: {
        onState: (state, detail) => this.emit('connection.state', { state, detail }),
        onSpawn: () => {
          this.emit('connection.spawned', { username: this.config.account.username });
          void this.onSpawn();
        },
        onDisconnect: (reason) => this.emit('connection.disconnected', { reason }),
        onKick: (reason) => this.emit('connection.kicked', { reason }),
        onError: (error) => this.emit('connection.error', { message: error.message }),
      },
    });

    // A bot must exist before the adapters can be built, so connect and then wire on spawn.
    this.connection.getBot();
    await this.connection.start();

    this.plugins = new PluginRegistry(this.logger);
    for (const plugin of BUILTIN_PLUGINS) this.plugins.register(plugin);

    if (!this.options.offline) this.startLink();
    this.started = true;
  }

  private async onSpawn(): Promise<void> {
    const bot = this.connection.getBot();
    if (!bot) return;
    this.wire(bot);
    this.executor = new TaskExecutor(this.executionContext());
    await this.plugins.start(this.pluginContext());
    this.plugins.beginTicking();
    this.emit('runtime.ready', { workerId: this.config.workerId });
  }

  private async defaultBotFactory(): Promise<BotFactory> {
    const mineflayer = (await import('mineflayer')) as unknown as {
      createBot?: (options: Record<string, unknown>) => unknown;
      default?: { createBot: (options: Record<string, unknown>) => unknown };
    };
    const create = mineflayer.createBot ?? mineflayer.default?.createBot;
    if (!create) throw new BotError('the mineflayer package did not export createBot', { category: 'internal' });
    return mineflayerFactory(create);
  }

  private async defaultSocketFactory(): Promise<SocketFactory> {
    const ws = await import('ws');
    const WebSocket = (ws as unknown as { default?: new (url: string) => unknown }).default ?? (ws as unknown as new (url: string) => unknown);
    return (url: string) => new (WebSocket as new (url: string) => never)(url);
  }

  private startLink(): void {
    void this.defaultSocketFactory().then((socketFactory) => {
      if (this.stopped) return;
      const scheme = this.config.host.secure ? 'wss' : 'ws';
      const url = `${scheme}://${this.config.host.address}:${this.config.host.port}${this.config.host.path}`;
      this.link = new Link({
        url,
        workerId: this.config.workerId,
        username: this.config.account.username,
        runtime: 'mineflayer',
        token: this.config.host.token,
        pairingCode: this.config.host.pairingCode,
        logger: this.logger,
        socketFactory,
        heartbeatSeconds: this.config.heartbeatSeconds,
        reconnectSeconds: this.config.reconnectSeconds,
        maxReconnectSeconds: this.config.maxReconnectSeconds,
        onFrame: (frame) => void this.handleFrame(frame),
        onOpen: () => this.sendStatus(),
      });
      this.link.on('negotiated', () => this.emit('link.negotiated', { version: WORKER_PROTOCOL_VERSION }));
      this.link.start();
    });
  }

  private async handleFrame(frame: WorkerEnvelope): Promise<void> {
    switch (frame.type) {
      case MESSAGE_TYPES.TASK: {
        const kind = String(frame.payload?.kind ?? '');
        const payload = (frame.payload?.payload as Record<string, unknown>) ?? {};
        const result = await this.runTask({ kind, payload, id: frame.id });
        this.link?.sendResult(frame.id, result as unknown as Record<string, unknown>);
        return;
      }
      case MESSAGE_TYPES.COMMAND: {
        const command = String(frame.payload?.command ?? frame.payload?.action ?? '');
        const result = await this.runTask({ kind: command, payload: frame.payload ?? {}, id: frame.id });
        this.link?.sendResult(frame.id, result as unknown as Record<string, unknown>);
        return;
      }
      case MESSAGE_TYPES.CONTROL: {
        await this.handleControl(String(frame.payload?.action ?? ''), frame.id);
        return;
      }
      case MESSAGE_TYPES.CONFIG: {
        const patch = (frame.payload?.config as Record<string, unknown>) ?? frame.payload ?? {};
        await this.applyConfigPatch(patch);
        this.link?.sendResult(frame.id, { ok: true, message: 'configuration applied' });
        return;
      }
      case MESSAGE_TYPES.KICK: {
        this.logger.warn('the fleet manager kicked this worker', { reason: String(frame.payload?.reason ?? '') });
        await this.stop('kicked by the fleet manager');
        return;
      }
      default:
        this.logger.debug('ignoring an unknown frame', { type: frame.type });
    }
  }

  private async handleControl(action: string, id?: string): Promise<void> {
    switch (action) {
      case 'pause':
        this.paused = true;
        this.emit('runtime.paused', {});
        this.link?.sendResult(id, { ok: true, message: 'paused' });
        return;
      case 'resume':
        this.paused = false;
        this.emit('runtime.resumed', {});
        this.link?.sendResult(id, { ok: true, message: 'resumed' });
        return;
      case 'disconnect':
        await this.connection.stop('disconnect requested by the fleet manager');
        this.link?.sendResult(id, { ok: true, message: 'disconnected from the game server' });
        return;
      case 'connect':
        await this.connection.start();
        this.link?.sendResult(id, { ok: true, message: 'connecting' });
        return;
      case 'restart':
        await this.connection.stop('restart requested');
        await this.connection.start();
        this.link?.sendResult(id, { ok: true, message: 'restarting' });
        return;
      default:
        this.link?.sendError(id, `unknown control action: ${action}`);
    }
  }

  /** Applies a configuration patch from the host, narrowing permissions only. */
  async applyConfigPatch(patch: Record<string, unknown>): Promise<BotConfig> {
    this.config = applyRemotePatch(this.config, patch);
    await saveConfig(configPath(this.options.baseDir), this.config);
    this.navigation.setLimits(this.config.navigation);
    if (this.plugins) await this.plugins.applyConfig(this.pluginContext());
    this.emit('runtime.config-applied', {});
    return this.config;
  }

  /**
   * Runs one task, taking the operation lock for exclusive kinds and rate-limiting mutations.
   *
   * The lock is per worker and keyed by kind, so two container moves cannot interleave while a read
   * still can. This is the mechanism behind "no two conflicting operations".
   */
  async runTask(request: { kind: string; payload: Record<string, unknown>; id?: string }): Promise<TaskResult> {
    if (this.stopped) {
      return { ok: false, taskId: request.id ?? 'stopped', kind: request.kind, message: 'the worker is stopped', error: { category: 'connection', retryable: false, mutation: 'none' } };
    }
    const gate = permitsTask(request.kind, this.config.permissions);
    if (!gate.allowed) {
      return { ok: false, taskId: request.id ?? 'denied', kind: request.kind, message: gate.reason ?? 'not permitted', error: { category: 'permission', retryable: false, mutation: 'none' } };
    }
    const mutating = isExclusive(request.kind);
    if (mutating && this.paused) {
      return { ok: false, taskId: request.id ?? 'paused', kind: request.kind, message: 'the worker is paused', error: { category: 'internal', retryable: true, mutation: 'none' } };
    }
    if (mutating && !this.limiter.tryTake()) {
      return { ok: false, taskId: request.id ?? 'ratelimited', kind: request.kind, message: 'the mutation rate limit was reached', error: { category: 'internal', retryable: true, mutation: 'none' } };
    }

    const owner = `${request.id ?? 'task'}-${Date.now()}`;
    if (mutating && !this.locks.tryAcquire('operation', owner)) {
      return { ok: false, taskId: request.id ?? 'busy', kind: request.kind, message: 'another exclusive operation is in progress', error: { category: 'internal', retryable: true, mutation: 'none' } };
    }

    this.currentTask = request.kind;
    try {
      const result = await this.executor.execute(request);
      if (result.ok) this.completed += 1;
      else this.failed += 1;
      this.emit('task.finished', { kind: request.kind, ok: result.ok, message: result.message });
      this.sendStatus();
      return result;
    } catch (error) {
      const bot = asBotError(error);
      this.failed += 1;
      this.emit('task.failed', { kind: request.kind, message: bot.message });
      return { ok: false, taskId: request.id ?? 'error', kind: request.kind, message: bot.message, error: { category: bot.category, retryable: bot.retryable, mutation: bot.mutation } };
    } finally {
      this.currentTask = null;
      if (mutating) this.locks.release('operation', owner);
    }
  }

  /** Stops plugins, the link and the connection, in that order. */
  async stop(reason = 'shutdown'): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.emit('runtime.stopping', { reason });
    if (this.plugins) await this.plugins.shutdown();
    this.link?.stop(reason);
    this.link = null;
    if (this.connection) await this.connection.stop(reason);
    if (this.queue) await this.queue.flush();
    if (this.registries) await this.registries.flush();
    this.emit('runtime.stopped', { reason });
  }

  // ---- helpers -------------------------------------------------------------------------------

  position(): Vec3 | null {
    const position = this.connection?.getBot()?.entity?.position;
    if (!position) return null;
    return { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
  }

  dimension(): string {
    return this.connection?.getBot()?.game?.dimension ?? 'overworld';
  }

  private emit(type: string, payload?: Record<string, unknown>): void {
    this.bus.publish(type, payload, this.config?.workerId);
    if (this.link?.isOpen()) this.link.sendLog('info', type, payload);
  }

  private sendStatus(): void {
    if (!this.link?.isOpen()) return;
    this.link.sendStatus(this.snapshot() as unknown as Record<string, unknown>);
  }

  /** A full status snapshot, safe to serialise. */
  snapshot(): RuntimeSnapshot {
    const bot = this.connection?.getBot();
    const entity = bot?.entity as { health?: number; food?: number } | undefined;
    return {
      workerId: this.config?.workerId ?? '',
      username: this.config?.account.username ?? '',
      runtime: 'mineflayer',
      protocolVersion: WORKER_PROTOCOL_VERSION,
      server: this.config ? `${this.config.server.host}:${this.config.server.port}` : undefined,
      dimension: bot?.game?.dimension,
      position: this.position() ?? undefined,
      health: entity?.health ?? bot?.health,
      food: entity?.food ?? bot?.food,
      paused: this.paused,
      stopped: this.stopped,
      connected: this.connection?.isSpawned() ?? false,
      linkOpen: this.link?.isOpen() ?? false,
      plugins: this.plugins ? this.plugins.states().map((state) => ({ id: state.id, state: state.state, tickCount: state.tickCount, errorCount: state.errorCount })) : [],
      queue: this.queue ? this.queue.stats() : {},
      tasks: { completed: this.completed, failed: this.failed },
    };
  }

  getConfig(): BotConfig {
    return this.config;
  }

  getRegistries(): Registries {
    return this.registries;
  }

  getPlugins(): PluginRegistry | null {
    return this.plugins ?? null;
  }

  getBus(): EventBus {
    return this.bus;
  }

  getInventory(): InventoryAdapter | null {
    return this.inventory ?? null;
  }

  getShulkers(): ShulkerAdapter | null {
    return this.shulkers ?? null;
  }

  getContainer(): ContainerAdapter | null {
    return this.container ?? null;
  }

  getNavigation(): NavigationAdapter | null {
    return this.navigation ?? null;
  }

  getPlanner(): Planner | null {
    return this.planner;
  }

  getQueue(): TaskQueue | null {
    return this.queue ?? null;
  }

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isStopped(): boolean {
    return this.stopped;
  }

  getCurrentTask(): string | null {
    return this.currentTask;
  }

  /** Reads the inventory through the adapter, or an empty list before spawn. */
  carried(): ItemStack[] {
    return this.inventory ? this.inventory.carried() : [];
  }
}

/**
 * Goals used when the pathfinder dependency is unavailable.
 *
 * These produce plain objects that the real pathfinder would not accept, but they let the runtime be
 * exercised without the plugin; a real run always supplies the pathfinder's own goals.
 */
const fallbackGoals = {
  GoalBlock: (x: number, y: number, z: number) => ({ x, y, z, kind: 'block' }),
  GoalNear: (x: number, y: number, z: number, range: number) => ({ x, y, z, range, kind: 'near' }),
};
