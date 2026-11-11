/**
 * The bot package's public surface.
 *
 * The host imports this to run a worker in-process (the "embedded" mode) or to reuse the engines and
 * the AI planner. Nothing in `./ai` or `./core` reaches Mineflayer, so the host can pull in the
 * planner without the Minecraft protocol stack.
 */

export { MineflayerRuntime, type RuntimeOptions, type RuntimeSnapshot } from './runtime/runtime';
export { TaskExecutor, type ExecutionContext, type TaskRequest, mapOperationToTask } from './runtime/task-executor';
export { Link, type LinkOptions, type SocketLike, type SocketFactory } from './runtime/link';
export { Connection, mineflayerFactory, type BotFactory, type MineflayerBot, type ConnectionState } from './mc/connection';
export { InventoryAdapter } from './mc/inventory';
export { ContainerAdapter, isLikelyContainer } from './mc/container';
export { NavigationAdapter } from './mc/navigation';
export { ShulkerAdapter } from './mc/shulker';
export { ShulkerPlacement } from './mc/shulker-placement';
export { PluginRegistry, BUILTIN_PLUGINS, type Plugin, type PluginContext, type PluginState } from './plugins';
export { Registries, JsonStore } from './core/registries';
export { TaskQueue, type QueuedTask, type QueuedTaskState } from './core/task-queue';
export { EventBus, type BotEvent } from './core/event-bus';
export {
  loadConfig,
  saveConfig,
  normalizeConfig,
  applyRemotePatch,
  defaultConfig,
  configPath,
  DEFAULT_PERMISSIONS,
  ALL_PLUGIN_IDS,
  type BotConfig,
  type BotPermissions,
  type AiProviderConfig,
} from './core/config';
export { Logger, type LogLevel, type LogRecord } from './core/logger';
export { BotError, asBotError } from './core/errors';
export { TASK_CATALOG, permitsTask, validateCommand, validateChat, allowedCommands } from './core/task-catalog';
export { OperationLock, RateLimiter, withRetry, Backoff, withTimeout, CancellationToken } from './core/reliability';
export {
  WORKER_PROTOCOL_VERSION,
  MESSAGE_TYPES,
  CONTROL_ACTIONS,
  TASK_KINDS,
  EXCLUSIVE_TASK_KINDS,
  negotiate,
  decodeEnvelope,
  encodeEnvelope,
} from './core/protocol/messages';
