/**
 * Worker configuration: persistent, defensive, and split from the host's settings.
 *
 * The file is the worker's own. The host can send a `config` frame to patch a subset of it, but the
 * permission flags are local-only in spirit: the host may narrow them, and the runtime applies the
 * intersection, so a host cannot widen what the operator allowed.
 */

import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { configError } from './errors';
import type { LogLevel } from './logger';
import type { Dimension } from './types';

export const BOT_CONFIG_VERSION = 4;

export interface AccountProfile {
  /** Offline username, or the Microsoft account email when auth is `microsoft`. */
  username: string;
  auth: 'offline' | 'microsoft';
  /** Never logged. Read from the file or an environment variable. */
  password?: string;
}

export interface ServerProfile {
  host: string;
  port: number;
  version?: string;
  /** Dimension the worker expects to work in. Advisory. */
  dimension?: Dimension;
}

export interface NavigationLimits {
  /** Hard cap on a single pathfind, in blocks. 0 disables the cap. */
  maxDistance: number;
  /** Milliseconds before a pathfind is abandoned. */
  timeoutMs: number;
  /** Whether the worker may break blocks to reach a target. */
  allowDigging: boolean;
  /** Whether the worker may place blocks to reach a target. */
  allowPlacing: boolean;
  /** Whether the worker may swim or be pushed by water. */
  allowSwimming: boolean;
}

export interface BotPermissions {
  allowCommands: boolean;
  allowChat: boolean;
  allowContainerMoves: boolean;
  allowShulkerPack: boolean;
  allowShulkerUnpack: boolean;
  allowRestock: boolean;
  allowPortalRemoval: boolean;
  allowDigging: boolean;
  allowCrafting: boolean;
  allowDisposal: boolean;
}

export interface AiProviderConfig {
  /** `ollama`, `openai`, or `none` for the deterministic offline interpreter. */
  provider: 'ollama' | 'openai' | 'none';
  /** Base URL, e.g. `http://127.0.0.1:11434`. */
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Milliseconds before an AI request is abandoned. */
  timeoutMs: number;
  /** Whether a provider failure falls back to the deterministic interpreter. */
  fallbackToDeterministic: boolean;
}

export interface PluginToggle {
  [pluginId: string]: boolean;
}

export interface BotConfig {
  version: number;
  /** Stable identity for this worker. Generated on first run. */
  workerId: string;
  label: string;
  group?: string;
  account: AccountProfile;
  server: ServerProfile;
  /** Host control plane to dial. */
  host: { address: string; port: number; token?: string; pairingCode?: string; path: string; secure: boolean };
  heartbeatSeconds: number;
  reconnectSeconds: number;
  maxReconnectSeconds: number;
  enabled: boolean;
  permissions: BotPermissions;
  navigation: NavigationLimits;
  ai: AiProviderConfig;
  plugins: PluginToggle;
  logLevel: LogLevel;
  /** Where the bot keeps its own state (task queue, registries). */
  stateDir: string;
  /** Rate limit for mutating operations per minute. 0 disables. */
  mutationRateLimitPerMinute: number;
  /** How long to wait for a container screen to open, in ms. */
  containerTimeoutMs: number;
  /** How long to wait for a pathfind, in ms (overridden by navigation.timeoutMs when larger). */
  actionTimeoutMs: number;
}

export const DEFAULT_PERMISSIONS: BotPermissions = {
  allowCommands: false,
  allowChat: false,
  allowContainerMoves: true,
  allowShulkerPack: true,
  allowShulkerUnpack: true,
  allowRestock: true,
  allowPortalRemoval: false,
  allowDigging: false,
  allowCrafting: false,
  allowDisposal: false,
};

export const DEFAULT_NAVIGATION: NavigationLimits = {
  maxDistance: 256,
  timeoutMs: 30_000,
  allowDigging: false,
  allowPlacing: false,
  allowSwimming: true,
};

export const DEFAULT_AI: AiProviderConfig = {
  provider: 'none',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'llama3.2',
  timeoutMs: 30_000,
  fallbackToDeterministic: true,
};

export const ALL_PLUGIN_IDS = [
  'smart-storage',
  'shulker-manager',
  'inventory-manager',
  'item-logistics',
  'restocking',
  'crafting',
  'world-maintenance',
  'portal-manager',
  'navigation',
  'ai-controller',
  'monitoring',
] as const;

export function defaultPluginToggles(): PluginToggle {
  const toggles: PluginToggle = {};
  for (const id of ALL_PLUGIN_IDS) toggles[id] = true;
  return toggles;
}

export function randomWorkerId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(random() * alphabet.length)] ?? 'a';
  return `bot-${out}`;
}

export function defaultConfig(stateDir: string, random: () => number = Math.random): BotConfig {
  return {
    version: BOT_CONFIG_VERSION,
    workerId: randomWorkerId(random),
    label: 'logvex-bot',
    account: { username: 'logvex-bot', auth: 'offline' },
    server: { host: '127.0.0.1', port: 25565 },
    host: { address: '127.0.0.1', port: 8721, path: '/worker', secure: false },
    heartbeatSeconds: 5,
    reconnectSeconds: 5,
    maxReconnectSeconds: 60,
    enabled: true,
    permissions: { ...DEFAULT_PERMISSIONS },
    navigation: { ...DEFAULT_NAVIGATION },
    ai: { ...DEFAULT_AI },
    plugins: defaultPluginToggles(),
    logLevel: 'info',
    stateDir,
    mutationRateLimitPerMinute: 120,
    containerTimeoutMs: 4_000,
    actionTimeoutMs: 20_000,
  };
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Coerces arbitrary parsed JSON into a valid config, filling every gap from the defaults.
 *
 * A corrupt file therefore degrades to "defaults for the damaged fields" rather than a crash — the
 * requirement is to survive configuration corruption, not to reject it.
 */
export function normalizeConfig(raw: unknown, stateDir: string, random: () => number = Math.random): BotConfig {
  const base = defaultConfig(stateDir, random);
  const input = obj(raw);

  const account = obj(input.account);
  const server = obj(input.server);
  const host = obj(input.host);
  const permissions = obj(input.permissions);
  const navigation = obj(input.navigation);
  const ai = obj(input.ai);
  const pluginsRaw = obj(input.plugins);

  const plugins: PluginToggle = { ...base.plugins };
  for (const id of ALL_PLUGIN_IDS) {
    if (typeof pluginsRaw[id] === 'boolean') plugins[id] = pluginsRaw[id] as boolean;
  }

  const provider = str(ai.provider, base.ai.provider);
  const normalizedProvider: AiProviderConfig['provider'] =
    provider === 'ollama' || provider === 'openai' ? provider : 'none';

  const auth = str(account.auth, base.account.auth);

  return {
    version: BOT_CONFIG_VERSION,
    workerId: str(input.workerId, base.workerId),
    label: str(input.label, base.label),
    group: typeof input.group === 'string' ? input.group : undefined,
    account: {
      username: str(account.username, base.account.username),
      auth: auth === 'microsoft' ? 'microsoft' : 'offline',
      password: typeof account.password === 'string' ? account.password : undefined,
    },
    server: {
      host: str(server.host, base.server.host),
      port: num(server.port, base.server.port, 1, 65535),
      version: typeof server.version === 'string' ? server.version : undefined,
      dimension: typeof server.dimension === 'string' ? server.dimension : undefined,
    },
    host: {
      address: str(host.address, base.host.address),
      port: num(host.port, base.host.port, 1, 65535),
      token: typeof host.token === 'string' ? host.token : undefined,
      pairingCode: typeof host.pairingCode === 'string' ? host.pairingCode : undefined,
      path: str(host.path, base.host.path),
      secure: bool(host.secure, base.host.secure),
    },
    heartbeatSeconds: num(input.heartbeatSeconds, base.heartbeatSeconds, 1, 300),
    reconnectSeconds: num(input.reconnectSeconds, base.reconnectSeconds, 1, 300),
    maxReconnectSeconds: num(input.maxReconnectSeconds, base.maxReconnectSeconds, 1, 600),
    enabled: bool(input.enabled, base.enabled),
    permissions: {
      allowCommands: bool(permissions.allowCommands, base.permissions.allowCommands),
      allowChat: bool(permissions.allowChat, base.permissions.allowChat),
      allowContainerMoves: bool(permissions.allowContainerMoves, base.permissions.allowContainerMoves),
      allowShulkerPack: bool(permissions.allowShulkerPack, base.permissions.allowShulkerPack),
      allowShulkerUnpack: bool(permissions.allowShulkerUnpack, base.permissions.allowShulkerUnpack),
      allowRestock: bool(permissions.allowRestock, base.permissions.allowRestock),
      allowPortalRemoval: bool(permissions.allowPortalRemoval, base.permissions.allowPortalRemoval),
      allowDigging: bool(permissions.allowDigging, base.permissions.allowDigging),
      allowCrafting: bool(permissions.allowCrafting, base.permissions.allowCrafting),
      allowDisposal: bool(permissions.allowDisposal, base.permissions.allowDisposal),
    },
    navigation: {
      maxDistance: num(navigation.maxDistance, base.navigation.maxDistance, 0, 10_000),
      timeoutMs: num(navigation.timeoutMs, base.navigation.timeoutMs, 1_000, 600_000),
      allowDigging: bool(navigation.allowDigging, base.navigation.allowDigging),
      allowPlacing: bool(navigation.allowPlacing, base.navigation.allowPlacing),
      allowSwimming: bool(navigation.allowSwimming, base.navigation.allowSwimming),
    },
    ai: {
      provider: normalizedProvider,
      baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : base.ai.baseUrl,
      model: typeof ai.model === 'string' ? ai.model : base.ai.model,
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : undefined,
      timeoutMs: num(ai.timeoutMs, base.ai.timeoutMs, 1_000, 300_000),
      fallbackToDeterministic: bool(ai.fallbackToDeterministic, base.ai.fallbackToDeterministic),
    },
    plugins,
    logLevel: (['debug', 'info', 'warn', 'error'] as const).includes(input.logLevel as LogLevel)
      ? (input.logLevel as LogLevel)
      : base.logLevel,
    stateDir: str(input.stateDir, base.stateDir),
    mutationRateLimitPerMinute: num(input.mutationRateLimitPerMinute, base.mutationRateLimitPerMinute, 0, 100_000),
    containerTimeoutMs: num(input.containerTimeoutMs, base.containerTimeoutMs, 250, 60_000),
    actionTimeoutMs: num(input.actionTimeoutMs, base.actionTimeoutMs, 250, 300_000),
  };
}

/** Loads a config, creating a default file if none exists. Never throws on a corrupt file. */
export async function loadConfig(path: string, random: () => number = Math.random): Promise<{ config: BotConfig; created: boolean; recovered: boolean }> {
  const absolute = resolve(path);
  const stateDir = dirname(absolute);
  let raw: string | null = null;
  try {
    raw = await fs.readFile(absolute, 'utf8');
  } catch {
    raw = null;
  }

  if (raw === null) {
    const config = defaultConfig(stateDir, random);
    await saveConfig(absolute, config);
    return { config, created: true, recovered: false };
  }

  try {
    const parsed = JSON.parse(raw);
    const config = normalizeConfig(parsed, stateDir, random);
    return { config, created: false, recovered: false };
  } catch (error) {
    // Move the unreadable file aside so the operator can inspect it, then start fresh.
    const backup = `${absolute}.corrupt-${Date.now()}`;
    try {
      await fs.rename(absolute, backup);
    } catch {
      /* best effort */
    }
    const config = defaultConfig(stateDir, random);
    await saveConfig(absolute, config);
    return { config, created: true, recovered: true };
  }
}

export async function saveConfig(path: string, config: BotConfig): Promise<void> {
  const absolute = resolve(path);
  await fs.mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, absolute);
}

/**
 * Applies a partial configuration patch from the host.
 *
 * Permissions may only be narrowed by a remote patch. A host that asks to enable a permission the
 * operator disabled is silently ignored — the local file is the authority for what the worker is
 * allowed to do.
 */
export function applyRemotePatch(current: BotConfig, patch: Record<string, unknown>): BotConfig {
  const merged = structuredClone(current) as unknown as Record<string, unknown>;
  const patchObj = obj(patch);

  if (typeof patchObj.label === 'string') merged.label = patchObj.label;
  if (typeof patchObj.group === 'string') merged.group = patchObj.group;

  const serverPatch = obj(patchObj.server);
  if (Object.keys(serverPatch).length > 0) {
    const server = { ...(current.server as unknown as Record<string, unknown>) };
    if (typeof serverPatch.host === 'string') server.host = serverPatch.host;
    if (typeof serverPatch.port === 'number') server.port = serverPatch.port;
    if (typeof serverPatch.version === 'string') server.version = serverPatch.version;
    merged.server = server;
  }

  const pluginPatch = obj(patchObj.plugins);
  if (Object.keys(pluginPatch).length > 0) {
    const plugins = { ...current.plugins };
    for (const [id, value] of Object.entries(pluginPatch)) {
      if (typeof value === 'boolean' && id in plugins) plugins[id] = value;
    }
    merged.plugins = plugins;
  }

  const permissionPatch = obj(patchObj.permissions);
  if (Object.keys(permissionPatch).length > 0) {
    const permissions = { ...current.permissions };
    for (const key of Object.keys(permissions) as Array<keyof BotPermissions>) {
      const requested = permissionPatch[key];
      // Narrowing only: `current[key] && requested` can never turn a false into a true.
      if (typeof requested === 'boolean') permissions[key] = permissions[key] && requested;
    }
    merged.permissions = permissions;
  }

  return normalizeConfig(merged, current.stateDir);
}

export function configPath(baseDir: string): string {
  return join(baseDir, 'logvex-bot.json');
}
