/**
 * Test support: an in-process Minecraft server and a real Mineflayer bot.
 *
 * These helpers make it possible to test the adapters against a genuine server rather than a mock.
 * `flying-squid` is a JavaScript Minecraft server that runs in the same process, so a test can boot
 * it, connect a real `mineflayer` bot to it, and assert on what the bot actually sees.
 *
 * Two facts about flying-squid shape these helpers:
 *   - it supports `/setblock` and `/setblockaction`, so a test can place a real chest and open it;
 *   - it does not persist container mutations, so a test can prove a read but not a completed move.
 *     The move mechanics are therefore exercised against a controlled window double, and the reads,
 *     opens, navigation and lifecycle against the real server.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);

export interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
  /** The server's own registry, for block ids. */
  registry: { blocksByName: Record<string, { id: number }> };
}

export interface BotHandle {
  bot: EventEmitter & Record<string, unknown>;
  stop: () => Promise<void>;
}

/** The versions flying-squid can serve that are new enough for the code under test. */
export const SUPPORTED_SERVER_VERSION = '1.20.4';

/**
 * Boots a flying-squid server.
 *
 * Port 0 lets the OS pick a free port, which avoids collisions between test files.
 */
export async function startServer(version = SUPPORTED_SERVER_VERSION): Promise<ServerHandle> {
  const squid = require('flying-squid') as {
    createMCServer: (options: Record<string, unknown>) => EventEmitter & { waitForReady?: () => Promise<void>; stop?: () => void };
    testedVersions: string[];
  };
  const settings = require('flying-squid/config/default-settings.json') as Record<string, unknown>;

  const options: Record<string, unknown> = {
    ...settings,
    'online-mode': false,
    'everybody-op': true,
    port: 0,
    'view-distance': 2,
    worldFolder: undefined,
    logging: false,
    version,
    generation: { name: 'diamond_square', options: { worldHeight: 80 } },
    // flying-squid crashes serialising a non-string player-list header, so give it empty strings.
    'player-list-text': { header: '', footer: '' },
  };

  const server = squid.createMCServer(options);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the test server did not start within 20s')), 20_000);
    server.on('listening', (value: unknown) => {
      clearTimeout(timer);
      resolve(typeof value === 'number' ? value : (server as unknown as { port: number }).port);
    });
    server.on('error', (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  if (typeof server.waitForReady === 'function') await server.waitForReady();

  return {
    port,
    registry: require('minecraft-data')(version) as { blocksByName: Record<string, { id: number }> },
    stop: async () => {
      try {
        server.stop?.();
      } catch {
        /* best effort */
      }
    },
  };
}

/** Connects a real Mineflayer bot to a running test server and waits for spawn. */
export async function startBot(
  port: number,
  options: { username?: string; version?: string; loadPathfinder?: boolean } = {},
): Promise<BotHandle> {
  const mineflayer = require('mineflayer') as { createBot: (options: Record<string, unknown>) => EventEmitter & Record<string, unknown> };
  const bot = mineflayer.createBot({
    host: '127.0.0.1',
    port,
    username: options.username ?? 'TestBot',
    version: options.version ?? SUPPORTED_SERVER_VERSION,
    auth: 'offline',
  });

  if (options.loadPathfinder !== false) {
    const pathfinder = require('mineflayer-pathfinder') as { pathfinder: unknown };
    (bot as unknown as { loadPlugin: (plugin: unknown) => void }).loadPlugin(pathfinder.pathfinder);
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the bot did not spawn within 25s')), 25_000);
    bot.on('spawn', () => {
      clearTimeout(timer);
      resolve();
    });
    bot.on('error', (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  // Let the first chunks arrive so `blockAt` has something to return.
  await new Promise((resolve) => setTimeout(resolve, 750));

  return {
    bot,
    stop: async () => {
      try {
        (bot as unknown as { quit: (reason?: string) => void }).quit('test finished');
      } catch {
        /* best effort */
      }
    },
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The vec3 constructor, as a function that takes a plain position. */
export function vec3Factory(): (position: { x: number; y: number; z: number }) => unknown {
  const { Vec3 } = require('vec3') as { Vec3: new (x: number, y: number, z: number) => unknown };
  return (position) => new Vec3(position.x, position.y, position.z);
}

export function pathfinderGoals(): { GoalBlock: (x: number, y: number, z: number) => unknown; GoalNear: (x: number, y: number, z: number, range: number) => unknown } {
  const { goals } = require('mineflayer-pathfinder') as {
    goals: { GoalBlock: (x: number, y: number, z: number) => unknown; GoalNear: (x: number, y: number, z: number, range: number) => unknown };
  };
  return goals;
}

export function pathfinderMovements(): (bot: unknown) => unknown {
  const { Movements } = require('mineflayer-pathfinder') as { Movements: new (bot: unknown) => unknown };
  return (bot) => new Movements(bot);
}

export { createRequire, require };
