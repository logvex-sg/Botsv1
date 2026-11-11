/**
 * The connection: one Mineflayer bot, its lifecycle, and its reconnect loop.
 *
 * The adapter owns the socket and nothing else. It never decides *what* to do — it reports what
 * happened, so the runtime above it can apply its own policy.
 */

import type { EventEmitter } from 'node:events';
import { BotError, connectionError, timeoutError } from '../core/errors';
import type { Logger } from '../core/logger';
import { Backoff } from '../core/reliability';
import type { BotConfig } from '../core/config';

/** The subset of the Mineflayer bot this adapter uses. Typed loosely on purpose. */
export interface MineflayerBot extends EventEmitter {
  version?: string;
  username?: string;
  entity?: { position: { x: number; y: number; z: number } };
  game?: { dimension?: string; gameMode?: string };
  health?: number;
  food?: number;
  time?: { age?: number; timeOfDay?: number };
  players?: Record<string, unknown>;
  registry?: unknown;
  loadPlugin?(plugin: unknown): void;
  chat?(message: string): void;
  quit?(reason?: string): void;
  end?(reason?: string): void;
  waitForChunksToLoad?(): Promise<void>;
  blockAt?(position: unknown): unknown;
}

export interface BotFactory {
  create(options: {
    host: string;
    port: number;
    username: string;
    auth?: string;
    password?: string;
    version?: string;
  }): MineflayerBot;
}

export type ConnectionState = 'idle' | 'connecting' | 'spawned' | 'disconnected' | 'ended' | 'kicked';

export interface ConnectionEvents {
  onState?: (state: ConnectionState, detail?: string) => void;
  onSpawn?: () => void;
  onDisconnect?: (reason: string) => void;
  onKick?: (reason: string) => void;
  onError?: (error: BotError) => void;
}

export interface ConnectionOptions {
  config: BotConfig;
  logger: Logger;
  factory: BotFactory;
  events: ConnectionEvents;
  /** Seconds to wait for a spawn before giving up on this attempt. */
  spawnTimeoutMs?: number;
}

/**
 * Owns one bot connection and the reconnect policy.
 *
 * A deliberate `stop()` cancels reconnection; an unexpected drop starts a backoff. That distinction
 * matters because a worker told to disconnect must stay disconnected.
 */
export class Connection {
  private bot: MineflayerBot | null = null;
  private state: ConnectionState = 'idle';
  private readonly backoff: Backoff;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private spawnTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly options: ConnectionOptions;
  private readonly logger: Logger;
  private lastKickReason: string | null = null;

  constructor(options: ConnectionOptions) {
    this.options = options;
    this.logger = options.logger.child('connection');
    this.backoff = new Backoff(options.config.reconnectSeconds * 1000, options.config.maxReconnectSeconds * 1000);
  }

  getState(): ConnectionState {
    return this.state;
  }

  getBot(): MineflayerBot | null {
    return this.bot;
  }

  isSpawned(): boolean {
    return this.state === 'spawned';
  }

  /** Resolves once the bot has spawned, or rejects after `timeoutMs`. */
  async waitForSpawn(timeoutMs = 30_000): Promise<void> {
    if (this.isSpawned()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(timeoutError(`no spawn within ${timeoutMs}ms`)), timeoutMs);
      const poll = setInterval(() => {
        if (this.isSpawned()) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 100);
      poll.unref?.();
    });
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.options.events.onState?.(state, detail);
  }

  /** Connects once, without starting the reconnect loop. */
  async connectOnce(): Promise<void> {
    if (this.bot) return;
    this.setState('connecting');
    const { config } = this.options;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const spawnTimeoutMs = this.options.spawnTimeoutMs ?? 30_000;

      const settle = (error?: BotError): void => {
        if (settled) return;
        settled = true;
        if (this.spawnTimer) {
          clearTimeout(this.spawnTimer);
          this.spawnTimer = null;
        }
        if (error) reject(error);
        else resolve();
      };

      let bot: MineflayerBot;
      try {
        bot = this.options.factory.create({
          host: config.server.host,
          port: config.server.port,
          username: config.account.username,
          auth: config.account.auth,
          password: config.account.password,
          version: config.server.version,
        });
      } catch (error) {
        settle(connectionError(`could not create the bot: ${String(error)}`));
        return;
      }

      this.bot = bot;

      this.spawnTimer = setTimeout(() => {
        settle(timeoutError(`no spawn within ${spawnTimeoutMs}ms`));
      }, spawnTimeoutMs);

      bot.on('spawn', () => {
        this.setState('spawned');
        this.backoff.reset();
        this.options.events.onSpawn?.();
        settle();
      });

      bot.on('error', (error: unknown) => {
        const botError = connectionError(`connection error: ${String(error)}`);
        this.options.events.onError?.(botError);
        settle(botError);
      });

      bot.on('kicked', (reason: unknown) => {
        const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
        this.lastKickReason = text;
        this.setState('kicked', text);
        this.options.events.onKick?.(text);
        // A kick is terminal for this attempt; it must not be reported as a successful connect.
        settle(connectionError(`kicked: ${text}`));
      });

      bot.on('end', (reason: unknown) => {
        const text = typeof reason === 'string' ? reason : 'the connection ended';
        this.setState('disconnected', text);
        this.bot = null;
        this.options.events.onDisconnect?.(text);
        settle(connectionError(`disconnected before spawn: ${text}`));
        if (!this.stopped) this.scheduleReconnect();
      });
    });
  }

  /** Connects and keeps reconnecting until `stop()` is called. */
  async start(): Promise<void> {
    this.stopped = false;
    try {
      await this.connectOnce();
    } catch (error) {
      this.logger.warn('initial connection failed', { error: String(error) });
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const { nextDelayMs, attempt } = this.backoff.next();
    this.logger.info('scheduling a reconnect', { attempt, delayMs: nextDelayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      void this.connectOnce().catch(() => {
        if (!this.stopped) this.scheduleReconnect();
      });
    }, nextDelayMs);
  }

  /** Sends a chat line or command through the client's own connection. */
  chat(message: string): void {
    if (!this.bot?.chat) throw connectionError('the bot is not connected');
    this.bot.chat(message);
  }

  /** Disconnects and stays disconnected. */
  async stop(reason = 'stopped by the operator'): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.spawnTimer) {
      clearTimeout(this.spawnTimer);
      this.spawnTimer = null;
    }
    const bot = this.bot;
    this.bot = null;
    this.setState('ended', reason);
    if (bot) {
      try {
        bot.quit?.(reason);
      } catch {
        try {
          bot.end?.(reason);
        } catch {
          /* best effort */
        }
      }
    }
  }

  getLastKickReason(): string | null {
    return this.lastKickReason;
  }
}

/** The real Mineflayer factory. Kept separate so tests can substitute a fake without a live socket. */
export function mineflayerFactory(createBot: (options: Record<string, unknown>) => unknown): BotFactory {
  return {
    create(options) {
      return createBot({
        host: options.host,
        port: options.port,
        username: options.username,
        auth: options.auth === 'microsoft' ? 'microsoft' : 'offline',
        ...(options.password ? { password: options.password } : {}),
        ...(options.version ? { version: options.version } : {}),
      }) as MineflayerBot;
    },
  };
}
