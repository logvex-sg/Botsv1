/**
 * The permission model, and the task catalog that is the worker's actual security boundary.
 *
 * The host does not get to run code. It picks a `kind` from a closed set and supplies validated
 * primitives. Every kind declares whether it mutates the world and which local permission flag
 * gates it; a kind whose flag is off is refused before it reaches the game.
 */

import type { BotPermissions } from './config';

export type TaskKind =
  | 'status'
  | 'inventory'
  | 'count'
  | 'search'
  | 'equipment'
  | 'position'
  | 'container-read'
  | 'shulker-read'
  | 'portal-scan'
  | 'navigate'
  | 'container-move'
  | 'shulker-pack'
  | 'shulker-unpack'
  | 'restock'
  | 'command'
  | 'chat'
  | 'nl-task';

export type PermissionFlag = keyof BotPermissions;

export interface TaskDescriptor {
  kind: TaskKind;
  /** True when the task can change the world. Mutating tasks take an operation lock. */
  mutating: boolean;
  /** Permission flag that must be on. `null` means the task is always allowed. */
  gate: PermissionFlag | null;
  /** True when only one may run at a time per worker (mutating tasks are exclusive by default). */
  exclusive: boolean;
  description: string;
}

export const TASK_CATALOG: readonly TaskDescriptor[] = [
  { kind: 'status', mutating: false, gate: null, exclusive: false, description: 'Report a full status snapshot.' },
  { kind: 'inventory', mutating: false, gate: null, exclusive: false, description: 'Report the carried inventory.' },
  { kind: 'count', mutating: false, gate: null, exclusive: false, description: 'Count matching carried items.' },
  { kind: 'search', mutating: false, gate: null, exclusive: false, description: 'Find matching stacks with full metadata.' },
  { kind: 'equipment', mutating: false, gate: null, exclusive: false, description: 'Compare gear against a loadout.' },
  { kind: 'position', mutating: false, gate: null, exclusive: false, description: 'Report coordinates, dimension and health.' },
  { kind: 'container-read', mutating: false, gate: null, exclusive: false, description: 'Read a container at a block position.' },
  { kind: 'shulker-read', mutating: false, gate: null, exclusive: false, description: 'Read carried shulker boxes.' },
  { kind: 'portal-scan', mutating: false, gate: null, exclusive: false, description: 'Find nearby portals.' },
  { kind: 'navigate', mutating: true, gate: null, exclusive: true, description: 'Walk to a block position.' },
  { kind: 'container-move', mutating: true, gate: 'allowContainerMoves', exclusive: true, description: 'Move matching items in or out of a container.' },
  { kind: 'shulker-pack', mutating: true, gate: 'allowShulkerPack', exclusive: true, description: 'Fill a carried shulker box.' },
  { kind: 'shulker-unpack', mutating: true, gate: 'allowShulkerUnpack', exclusive: true, description: 'Empty a carried shulker box.' },
  { kind: 'restock', mutating: true, gate: 'allowRestock', exclusive: true, description: 'Top up an item from a source container.' },
  { kind: 'command', mutating: true, gate: 'allowCommands', exclusive: true, description: 'Send an allow-listed server command.' },
  { kind: 'chat', mutating: true, gate: 'allowChat', exclusive: true, description: 'Send a chat line.' },
  { kind: 'nl-task', mutating: true, gate: null, exclusive: true, description: 'Interpret and run a natural-language instruction.' },
];

const BY_KIND = new Map<string, TaskDescriptor>(TASK_CATALOG.map((descriptor) => [descriptor.kind, descriptor]));

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === 'string' && BY_KIND.has(value);
}

export function descriptorFor(kind: string): TaskDescriptor | null {
  return BY_KIND.get(kind) ?? null;
}

export function isMutating(kind: string): boolean {
  return BY_KIND.get(kind)?.mutating ?? true;
}

export function isExclusive(kind: string): boolean {
  return BY_KIND.get(kind)?.exclusive ?? true;
}

export function allTaskKinds(): TaskKind[] {
  return TASK_CATALOG.map((descriptor) => descriptor.kind);
}

export interface TaskGateResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether the worker may run a task, given its own permissions.
 *
 * An unknown kind is refused. A known read-only kind is always allowed. A mutating kind is allowed
 * only when its permission flag is on. This mirrors `TaskCatalog`/`WorkerConfig.permits` on the
 * Fabric side so both runtimes gate identically.
 */
export function permitsTask(kind: string, permissions: BotPermissions): TaskGateResult {
  const descriptor = BY_KIND.get(kind);
  if (!descriptor) return { allowed: false, reason: `unsupported task kind: ${kind}` };
  if (!descriptor.gate) return { allowed: true };
  if (!permissions[descriptor.gate]) {
    return { allowed: false, reason: `permission "${descriptor.gate}" is disabled for this worker` };
  }
  return { allowed: true };
}

export const COMMAND_ALLOWLIST: readonly string[] = [
  'help', 'spawn', 'home', 'sethome', 'delhome', 'tpa', 'tpaccept', 'tpdeny', 'tpahere', 'tp',
  'warp', 'warps', 'list', 'msg', 'tell', 'reply', 'mail', 'pay', 'balance', 'baltop', 'ah',
  'auction', 'shop', 'buy', 'sell', 'kit', 'kits', 'ec', 'enderchest', 'pv', 'back', 'rtp',
  'wild', 'randomtp', 'near', 'who', 'seen', 'ignore', 'unignore', 'friend', 'party', 'claim',
  'unclaim', 'abandonclaim', 'trust', 'untrust', 'container', 'accesstrust', 'permissiontrust',
  'region', 'rg', 'lands', 'plot', 'is', 'island', 'team', 'guild', 'clan', 'vote', 'votes',
  'crates', 'keys', 'daily', 'reward', 'rewards', 'quests', 'quest', 'jobs', 'skills', 'stats',
  'balance', 'pay', 'trade', 'market', 'orders', 'bin', 'baltop', 'leaderboard', 'lb', 'top',
  'discord', 'website', 'rules', 'report', 'ignore', 'afk', 'sit', 'lay', 'sleep', 'wake',
];

const ALLOWLIST_SET = new Set(COMMAND_ALLOWLIST.map((entry) => entry.toLowerCase()));

export interface CommandValidation {
  ok: boolean;
  reason?: string;
}

/** Chat lines are short and control-character free. */
export function validateChat(message: string): CommandValidation {
  if (typeof message !== 'string' || message.length === 0) return { ok: false, reason: 'empty chat line' };
  if (message.length > 256) return { ok: false, reason: 'chat line exceeds 256 characters' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(message)) return { ok: false, reason: 'chat line contains control characters' };
  return { ok: true };
}

/**
 * Commands are validated against an allowlist of verbs, not a denylist of dangerous ones.
 *
 * The leading slash is optional. Only the first token is checked, so `/home base` is allowed while
 * `/op me` is not, whatever the arguments.
 */
export function validateCommand(command: string): CommandValidation {
  if (typeof command !== 'string' || command.length === 0) return { ok: false, reason: 'empty command' };
  const trimmed = command.replace(/^\//, '').trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty command' };
  if (trimmed.length > 256) return { ok: false, reason: 'command exceeds 256 characters' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { ok: false, reason: 'command contains control characters' };
  const verb = trimmed.split(/\s+/)[0]!.toLowerCase();
  if (!ALLOWLIST_SET.has(verb)) return { ok: false, reason: `command "${verb}" is not on the allow-list` };
  return { ok: true };
}

export function allowedCommands(): string[] {
  return [...COMMAND_ALLOWLIST];
}
