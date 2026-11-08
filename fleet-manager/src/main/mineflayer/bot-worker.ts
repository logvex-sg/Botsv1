/**
 * Bot worker: one isolated Node process per Minecraft instance.
 *
 * The worker owns a single mineflayer connection, converts game events into the shared worker
 * protocol and performs role-specific observation. It never attacks other players and never
 * attempts to bypass server restrictions; the HUNTER role only *observes* unless the main process
 * has explicitly authorised combat testing for an allow-listed target.
 */
import { createConnection } from 'node:net';
import type { WorkerCommand, WorkerEnvelope, WorkerEvent, WorkerTelemetry } from './protocol';
import { collectInventory, collectPlayers, collectPosition, collectHealth } from './collectors';
import { evaluateEquipment, evaluateStasis, observeTargets } from './role-tasks';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyBot = any;

let bot: AnyBot = null;
let instanceId = '';
let role = '';
let roleConfig: Record<string, unknown> = {};
let stopping = false;
let connectTimer: NodeJS.Timeout | null = null;
let telemetryTimer: NodeJS.Timeout | null = null;
let roleTimer: NodeJS.Timeout | null = null;
let lastCpu: { usage: NodeJS.CpuUsage; time: number } | null = null;

function send(event: WorkerEvent): void {
  if (!process.send) return;
  const envelope: WorkerEnvelope = { instanceId, event };
  try {
    process.send(envelope);
  } catch {
    // parent gone; nothing we can do
  }
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  send({ kind: 'log', level, message });
}

process.on('message', (raw: unknown) => {
  const command = raw as WorkerCommand;
  if (!command || typeof command !== 'object') return;
  switch (command.kind) {
    case 'start':
      void start(command);
      break;
    case 'stop':
      void stop('stop requested');
      break;
    case 'command':
      runCommand(command.command);
      break;
  }
});

async function start(command: Extract<WorkerCommand, { kind: 'start' }>): Promise<void> {
  instanceId = command.instanceId;
  role = command.role;
  roleConfig = command.roleConfig ?? {};
  send({ kind: 'connecting' });

  let mineflayer: AnyBot;
  try {
    // Loaded lazily so the worker only pays for mineflayer when it actually connects.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mineflayer = require('mineflayer');
  } catch (error) {
    send({ kind: 'error', message: `mineflayer unavailable: ${(error as Error).message}`, fatal: true });
    return;
  }

  const options: Record<string, unknown> = {
    host: command.host,
    port: command.port,
    username: command.username,
    auth: command.auth === 'microsoft' ? 'microsoft' : 'offline',
    version: command.version || undefined,
    hideErrors: true,
  };
  if (command.auth === 'microsoft' && command.accessToken) {
    options.username = undefined;
    options.auth = 'microsoft';
  }

  try {
    bot = mineflayer.createBot(options);
  } catch (error) {
    send({ kind: 'error', message: `failed to create bot: ${(error as Error).message}`, fatal: true });
    return;
  }

  connectTimer = setTimeout(() => {
    if (bot && !bot.entity) {
      send({ kind: 'error', message: `connection timed out after ${command.connectTimeoutMs}ms`, fatal: true });
      void stop('connect timeout');
    }
  }, command.connectTimeoutMs);

  bot.once('spawn', () => {
    send({ kind: 'spawn', username: bot.username ?? command.username });
  });
  bot.once('login', () => send({ kind: 'login' }));
  bot.once('connected', () => {
    if (connectTimer) clearTimeout(connectTimer);
    send({ kind: 'connected', version: String(bot.version ?? command.version ?? '') });
    startTimers();
  });
  bot.on('health', () => {
    const health = collectHealth(bot);
    send({ kind: 'health', health: health.health, food: health.food });
  });
  bot.on('move', () => {
    const pos = collectPosition(bot);
    if (pos) send({ kind: 'position', position: pos.position, dimension: pos.dimension });
  });
  bot.on('chat', (username: string, message: string) => {
    if (username === bot.username) return;
    send({ kind: 'chat', username, message });
  });
  bot.on('playerJoined', (player: AnyBot) => {
    send({ kind: 'playerJoined', username: String(player.username), uuid: player.uuid ?? null });
  });
  bot.on('playerLeft', (player: AnyBot) => {
    send({ kind: 'playerLeft', username: String(player.username), uuid: player.uuid ?? null });
  });
  bot.on('kicked', (reason: unknown) => {
    send({ kind: 'kick', reason: typeof reason === 'string' ? reason : JSON.stringify(reason) });
  });
  bot.on('error', (error: Error) => {
    send({ kind: 'error', message: error.message, fatal: false });
  });
  bot.on('end', (reason: string) => {
    if (!stopping) send({ kind: 'end', reason: reason ?? 'connection closed' });
    cleanup();
  });
}

function startTimers(): void {
  telemetryTimer = setInterval(() => {
    send({ kind: 'telemetry', telemetry: collectTelemetry() });
  }, 2000);
  telemetryTimer.unref?.();

  const interval = Number(roleConfig.monitorIntervalMs ?? roleConfig.observeIntervalMs ?? 5000);
  roleTimer = setInterval(() => runRoleTasks(), Math.max(1000, interval));
  roleTimer.unref?.();

  // Emit player and inventory snapshots on the same cadence as telemetry.
  setInterval(() => {
    if (!bot || !bot.entity) return;
    send({ kind: 'players', players: collectPlayers(bot) });
    send({ kind: 'inventory', items: collectInventory(bot).items, armor: collectInventory(bot).armor });
  }, 5000).unref?.();
}

function runRoleTasks(): void {
  if (!bot || !bot.entity) return;
  try {
    if (role === 'GEARER') {
      const result = evaluateEquipment(bot, roleConfig);
      send({ kind: 'roleEvent', type: result.ready ? 'EQUIPMENT_READY' : 'EQUIPMENT_WARNING', payload: result.payload });
    } else if (role === 'STASIS') {
      const result = evaluateStasis(bot, roleConfig);
      send({ kind: 'roleEvent', type: result.type, payload: result.payload });
    } else if (role === 'HUNTER') {
      const events = observeTargets(bot, roleConfig);
      for (const event of events) send({ kind: 'roleEvent', type: event.type, payload: event.payload });
    }
  } catch (error) {
    send({ kind: 'error', message: `role task failed: ${(error as Error).message}`, fatal: false });
  }
}

function collectTelemetry(): WorkerTelemetry {
  const mem = process.memoryUsage();
  const usage = process.cpuUsage();
  const now = Date.now();
  let cpuPercent = 0;
  if (lastCpu) {
    const elapsed = (now - lastCpu.time) * 1000;
    const used = (usage.user - lastCpu.usage.user) + (usage.system - lastCpu.usage.system);
    if (elapsed > 0) cpuPercent = Math.max(0, Math.min(100, (used / elapsed) * 100));
  }
  lastCpu = { usage, time: now };

  const telemetry: WorkerTelemetry = {
    memoryBytes: mem.rss,
    cpuPercent,
    ping: bot && typeof bot.player?.ping === 'number' ? bot.player.ping : 0,
  };
  if (bot && bot.entity) {
    const pos = collectPosition(bot);
    const health = collectHealth(bot);
    if (pos) {
      telemetry.position = pos.position;
      telemetry.dimension = pos.dimension;
    }
    telemetry.health = health.health;
    telemetry.food = health.food;
  }
  return telemetry;
}

function runCommand(command: string): void {
  if (!bot || !bot.entity) return;
  const trimmed = command.trim();
  if (!trimmed) return;
  // Administrative commands only; combat is driven by the role observer, never raw chat.
  try {
    bot.chat(trimmed);
    log('info', `sent command: ${trimmed}`);
  } catch (error) {
    send({ kind: 'error', message: `command failed: ${(error as Error).message}`, fatal: false });
  }
}

async function stop(reason: string): Promise<void> {
  stopping = true;
  cleanup();
  if (bot) {
    try {
      bot.quit(reason);
    } catch {
      // ignore
    }
    bot = null;
  }
  send({ kind: 'end', reason });
  setTimeout(() => process.exit(0), 50).unref?.();
}

function cleanup(): void {
  if (connectTimer) clearTimeout(connectTimer);
  if (telemetryTimer) clearInterval(telemetryTimer);
  if (roleTimer) clearInterval(roleTimer);
  connectTimer = telemetryTimer = roleTimer = null;
}

process.on('SIGTERM', () => void stop('sigterm'));
process.on('SIGINT', () => void stop('sigint'));
process.on('uncaughtException', (error) => {
  send({ kind: 'error', message: `uncaught: ${error.message}`, fatal: true });
  void stop('uncaught exception');
});

/** Exported for the mock-server integration test to reuse the DNS probe. */
export function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

send({ kind: 'ready' });
