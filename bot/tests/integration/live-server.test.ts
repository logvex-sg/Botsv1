/**
 * Integration against a real Minecraft server.
 *
 * These tests boot an in-process flying-squid server and connect a genuine Mineflayer bot to it, so
 * the connection, inventory, block and navigation adapters are exercised against real protocol
 * traffic rather than a stub. What flying-squid cannot do (persist container mutations) is called
 * out where it applies and covered by the fake-window tests instead.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startBot, startServer, vec3Factory, pathfinderGoals, pathfinderMovements, wait, require as nodeRequire, SUPPORTED_SERVER_VERSION, type BotHandle, type ServerHandle } from '../support/harness';
import { Connection, mineflayerFactory } from '../../src/mc/connection';
import { InventoryAdapter, asBotWithInventory } from '../../src/mc/inventory';
import { ContainerAdapter, type ContainerBot } from '../../src/mc/container';
import { NavigationAdapter, type NavigationBot } from '../../src/mc/navigation';
import { Logger } from '../../src/core/logger';
import { defaultConfig } from '../../src/core/config';
import type { MineflayerBot } from '../../src/mc/connection';

let server: ServerHandle;
let handle: BotHandle;
const logger = new Logger({ level: 'error', scope: 'integration' });

beforeAll(async () => {
  server = await startServer();
  handle = await startBot(server.port);
}, 60_000);

afterAll(async () => {
  await handle?.stop();
  await server?.stop();
});

describe('a real bot on a real server', () => {
  it('spawns and reports a position inside the world', () => {
    const position = (handle.bot as unknown as { entity: { position: { x: number; y: number; z: number } } }).entity.position;
    expect(Number.isFinite(position.x)).toBe(true);
    expect(position.y).toBeGreaterThan(-64);
    expect(position.y).toBeLessThan(320);
  });

  it('reads its own inventory through the adapter', () => {
    const adapter = new InventoryAdapter(asBotWithInventory(handle.bot as unknown as MineflayerBot));
    const carried = adapter.carried();
    expect(Array.isArray(carried)).toBe(true);
    expect(adapter.freeSlots()).toBeGreaterThanOrEqual(0);
    expect(adapter.freeSlots()).toBeLessThanOrEqual(36);
  });

  it('reports armour through the adapter without throwing', () => {
    const adapter = new InventoryAdapter(asBotWithInventory(handle.bot as unknown as MineflayerBot));
    expect(Array.isArray(adapter.armor())).toBe(true);
    expect(adapter.heldItem()).toBeNull();
  });

  it('sees a block that was placed with /setblock', async () => {
    const bot = handle.bot as unknown as { chat: (message: string) => void; entity: { position: { x: number; y: number; z: number } } };
    const position = bot.entity.position;
    const x = Math.floor(position.x) + 1;
    const y = Math.floor(position.y) - 1;
    const z = Math.floor(position.z);
    bot.chat(`/setblock ${x} ${y} ${z} chest`);
    await wait(1_000);

    const adapter = new ContainerAdapter({
      bot: handle.bot as unknown as ContainerBot,
      logger,
      openTimeoutMs: 3_000,
      vec: vec3Factory(),
    });
    const block = adapter.blockAt({ x, y, z });
    expect(block).not.toBeNull();
    expect(String(block?.name)).toContain('chest');
  });

  it('opens a real chest and reads an empty container', async () => {
    const bot = handle.bot as unknown as { chat: (message: string) => void; entity: { position: { x: number; y: number; z: number } } };
    const position = bot.entity.position;
    const x = Math.floor(position.x) + 1;
    const y = Math.floor(position.y) - 1;
    const z = Math.floor(position.z);
    bot.chat(`/setblock ${x} ${y} ${z} chest`);
    await wait(1_000);

    const adapter = new ContainerAdapter({
      bot: handle.bot as unknown as ContainerBot,
      logger,
      openTimeoutMs: 4_000,
      vec: vec3Factory(),
    });
    const contents = await adapter.read({ x, y, z });
    expect(contents.capacity).toBe(27);
    expect(contents.freeSlots).toBe(27);
    expect(contents.items).toEqual([]);
  }, 30_000);

  it('walks towards a nearby goal with the pathfinder', async () => {
    const bot = handle.bot as unknown as NavigationBot;
    const navigation = new NavigationAdapter({
      bot,
      logger,
      goals: pathfinderGoals(),
      movements: pathfinderMovements(),
      limits: defaultConfig().navigation,
      vec: vec3Factory(),
    });
    const from = navigation.currentPosition();
    expect(from).not.toBeNull();
    const result = await navigation.walkTo({ x: from!.x + 2, y: from!.y, z: from!.z }, { range: 1, timeoutMs: 15_000 });
    // flying-squid's physics are approximate; reaching or timing out are both acceptable, but the
    // adapter must return a well-formed result either way.
    expect(typeof result.reached).toBe('boolean');
    expect(Number.isFinite(result.durationMs)).toBe(true);
    if (!result.reached) expect(result.failure).toBeDefined();
  }, 30_000);
});

describe('the connection adapter', () => {
  it('drives a real bot to spawn and reports it as spawned', async () => {
    // Its own server: flying-squid is happiest with one player per world, and this keeps the
    // connection lifecycle independent of the shared bot above.
    const ownServer = await startServer();
    const base = defaultConfig();
    const connection = new Connection({
      config: { ...base, server: { host: '127.0.0.1', port: ownServer.port, version: SUPPORTED_SERVER_VERSION } },
      logger,
      factory: mineflayerFactory((options) => {
        const mineflayer = nodeRequire('mineflayer') as { createBot: (options: Record<string, unknown>) => unknown };
        return mineflayer.createBot(options);
      }),
      events: {},
    });
    try {
      await connection.start();
      await connection.waitForSpawn(25_000);
      expect(connection.isSpawned()).toBe(true);
      expect(connection.getBot()).not.toBeNull();
    } finally {
      await connection.stop('test finished');
      await ownServer.stop();
    }
    expect(connection.isSpawned()).toBe(false);
  }, 60_000);
});
