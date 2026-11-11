/**
 * The plugin contract.
 *
 * A plugin is a self-contained unit of automation with a declared id, its dependencies, and a tick
 * that runs on the client tick. The registry starts a plugin only when every plugin it depends on is
 * enabled, so a half-enabled set degrades to "this plugin is off" rather than a crash.
 *
 * Plugins are pure orchestration over the engines and adapters: they decide *when* to act. The
 * executor decides *how*; the engines decide *whether it is allowed*.
 */

import type { BotConfig } from '../core/config';
import type { Logger } from '../core/logger';
import type { Registries } from '../core/registries';
import type { InventoryAdapter } from '../mc/inventory';
import type { ContainerAdapter } from '../mc/container';
import type { NavigationAdapter } from '../mc/navigation';
import type { ShulkerAdapter } from '../mc/shulker';

export interface PluginContext {
  workerId: string;
  config: BotConfig;
  logger: Logger;
  registries: Registries;
  inventory: InventoryAdapter;
  container: ContainerAdapter;
  navigation: NavigationAdapter;
  shulkers: ShulkerAdapter;
  /** Emits an event for the host and the local log. */
  emit: (type: string, payload?: Record<string, unknown>) => void;
  /** Whether the worker is paused (mutating work stops while paused). */
  isPaused: () => boolean;
  /** A snapshot of the connection. */
  isSpawned: () => boolean;
  position: () => { x: number; y: number; z: number } | null;
  dimension: () => string;
  /**
   * Runs a task through the worker's own executor.
   *
   * Plugins schedule; the executor acts. Routing plugin work through one executor is what keeps the
   * permission gate, verification and error translation in exactly one place.
   */
  executeTask: (kind: string, payload: Record<string, unknown>) => Promise<{ ok: boolean; message: string; data?: Record<string, unknown> }>;
  now: () => number;
}

export interface Plugin {
  /** Stable id, matching the key in the configuration's plugin toggles. */
  readonly id: string;
  /** Human name for the dashboard. */
  readonly name: string;
  /** One-line description of what the plugin does. */
  readonly description: string;
  /** Plugin ids that must be enabled for this one to run. */
  readonly dependsOn: readonly string[];
  /** Whether the plugin mutates the world. Mutating plugins never run while paused. */
  readonly mutating: boolean;
  /** Milliseconds between ticks. A plugin that does nothing most of the time sets this high. */
  readonly intervalMs: number;
  /** Called once when the plugin starts. */
  start?(context: PluginContext): Promise<void> | void;
  /** Called on each tick while active. Must not block. */
  tick(context: PluginContext): Promise<void> | void;
  /** Called when the plugin stops. */
  stop?(context: PluginContext): Promise<void> | void;
  /** A short status line for the dashboard. */
  status?(): string;
}

export type PluginState = 'stopped' | 'running' | 'blocked' | 'disabled' | 'error';

export interface PluginRuntimeState {
  id: string;
  state: PluginState;
  detail?: string;
  lastTickAt?: number;
  tickCount: number;
  errorCount: number;
  /** Why the plugin is blocked, when it is. */
  blockedBy?: string[];
}

/**
 * Runs a set of plugins on a fixed cadence.
 *
 * The registry is deliberately simple: it ticks each enabled plugin no more often than its interval,
 * isolates failures so one bad plugin cannot stop the others, and records per-plugin counters for
 * the dashboard. A plugin that throws repeatedly is stopped rather than left to spam the log.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();
  private readonly pluginStates = new Map<string, PluginRuntimeState>();
  private context: PluginContext | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly logger: Logger;
  private readonly maxConsecutiveErrors = 5;

  constructor(logger: Logger) {
    this.logger = logger.child('plugins');
  }

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
    this.pluginStates.set(plugin.id, { id: plugin.id, state: 'stopped', tickCount: 0, errorCount: 0 });
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  stateOf(id: string): PluginRuntimeState | undefined {
    return this.pluginStates.get(id);
  }

  states(): PluginRuntimeState[] {
    return [...this.pluginStates.values()];
  }

  /** Whether a plugin's dependencies are all enabled and running. */
  private missingDependencies(plugin: Plugin, enabled: Record<string, boolean>): string[] {
    return plugin.dependsOn.filter((dependency) => enabled[dependency] !== true || !this.plugins.has(dependency));
  }

  /** Starts the plugins the configuration enables and whose dependencies are met. */
  async start(context: PluginContext): Promise<void> {
    this.context = context;
    for (const plugin of this.plugins.values()) {
      const enabled = context.config.plugins[plugin.id] !== false;
      const state = this.pluginStates.get(plugin.id)!;
      if (!enabled) {
        state.state = 'disabled';
        continue;
      }
      const missing = this.missingDependencies(plugin, context.config.plugins);
      if (missing.length > 0) {
        state.state = 'blocked';
        state.blockedBy = missing;
        continue;
      }
      await this.startPlugin(plugin, context);
    }
  }

  private async startPlugin(plugin: Plugin, context: PluginContext): Promise<void> {
    const state = this.pluginStates.get(plugin.id)!;
    try {
      await plugin.start?.(context);
      state.state = 'running';
      state.detail = undefined;
      this.logger.debug('plugin started', { id: plugin.id });
    } catch (error) {
      state.state = 'error';
      state.detail = String(error);
      state.errorCount += 1;
      this.logger.warn('plugin failed to start', { id: plugin.id, error: String(error) });
    }
  }

  /** Re-evaluates enabled/blocked state against the current configuration. */
  async applyConfig(context: PluginContext): Promise<void> {
    this.context = context;
    for (const plugin of this.plugins.values()) {
      const state = this.pluginStates.get(plugin.id)!;
      const enabled = context.config.plugins[plugin.id] !== false;
      const missing = this.missingDependencies(plugin, context.config.plugins);
      if (!enabled) {
        if (state.state === 'running') await this.stopPlugin(plugin, context);
        state.state = 'disabled';
        state.blockedBy = undefined;
        continue;
      }
      if (missing.length > 0) {
        if (state.state === 'running') await this.stopPlugin(plugin, context);
        state.state = 'blocked';
        state.blockedBy = missing;
        continue;
      }
      if (state.state !== 'running') {
        await this.startPlugin(plugin, context);
      }
    }
  }

  private async stopPlugin(plugin: Plugin, context: PluginContext): Promise<void> {
    const state = this.pluginStates.get(plugin.id)!;
    try {
      await plugin.stop?.(context);
    } catch (error) {
      this.logger.debug('plugin stop threw', { id: plugin.id, error: String(error) });
    }
    state.state = 'stopped';
  }

  /** Starts ticking. Each plugin is ticked no more often than its own interval. */
  beginTicking(): void {
    if (this.timer) return;
    const tickMs = 250;
    this.timer = setInterval(() => {
      void this.tickAll();
    }, tickMs);
    this.timer.unref?.();
  }

  private async tickAll(): Promise<void> {
    const context = this.context;
    if (!context) return;
    const now = Date.now();
    for (const plugin of this.plugins.values()) {
      const state = this.pluginStates.get(plugin.id)!;
      if (state.state !== 'running') continue;
      if (plugin.mutating && context.isPaused()) continue;
      if (!context.isSpawned()) continue;
      if (state.lastTickAt && now - state.lastTickAt < plugin.intervalMs) continue;
      state.lastTickAt = now;
      state.tickCount += 1;
      try {
        await plugin.tick(context);
      } catch (error) {
        state.errorCount += 1;
        this.logger.debug('plugin tick threw', { id: plugin.id, error: String(error) });
        if (state.errorCount >= this.maxConsecutiveErrors && state.errorCount % this.maxConsecutiveErrors === 0) {
          state.state = 'error';
          state.detail = `stopped after ${state.errorCount} errors`;
          this.logger.warn('plugin stopped after repeated errors', { id: plugin.id });
        }
      }
    }
  }

  /** Stops ticking and stops every plugin. */
  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const context = this.context;
    if (!context) return;
    for (const plugin of this.plugins.values()) {
      const state = this.pluginStates.get(plugin.id)!;
      if (state.state === 'running') await this.stopPlugin(plugin, context);
    }
  }

  /** Enables or disables a single plugin at runtime. */
  async setEnabled(pluginId: string, enabled: boolean, context: PluginContext): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    context.config.plugins[pluginId] = enabled;
    await this.applyConfig(context);
  }
}
