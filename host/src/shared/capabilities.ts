/**
 * Worker capabilities: what a worker says it can do, and what the Host therefore may ask of it.
 *
 * The Host must never offer a task a worker cannot execute. Capabilities are reported by the worker
 * and versioned, so a newer worker can advertise more without the Host having to guess or assume.
 * The check lives here, once, so every caller agrees.
 *
 * Pure: unit-testable.
 */
import { TASK_KINDS, isTaskKind, type TaskKind } from './workers';

/** The capability set a worker advertises, with a schema version of its own. */
export const CAPABILITY_SCHEMA_VERSION = 1;

/** The named capabilities a worker may advertise. Keys are stable; add, never rename. */
export const CAPABILITY_KEYS = [
  'inventory',
  'item_counting',
  'item_search',
  'equipment_inspection',
  'regear',
  'position_reporting',
  'command',
  'chat',
  'efly',
  'meteor_integration',
  'container_access',
  'container_move',
  'shulker_read',
  'shulker_pack',
  'shulker_unpack',
  'restock',
  'portal_scan',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export interface CapabilitySet {
  version: number;
  capabilities: CapabilityKey[];
}

/** Which capabilities a task kind requires before the Host will dispatch it. */
const TASK_REQUIREMENTS: Record<TaskKind, readonly CapabilityKey[]> = {
  status: [],
  inventory: ['inventory'],
  count: ['item_counting'],
  search: ['item_search'],
  equipment: ['equipment_inspection'],
  regear: ['regear', 'inventory'],
  command: ['command'],
  chat: ['chat'],
  position: ['position_reporting'],
  efly: ['efly'],
  'container-read': ['container_access'],
  'container-move': ['container_move', 'container_access'],
  'shulker-read': ['shulker_read', 'container_access'],
  'shulker-pack': ['shulker_pack', 'container_move'],
  'shulker-unpack': ['shulker_unpack', 'container_move'],
  restock: ['restock', 'container_move'],
  'portal-scan': ['portal_scan'],
};

export function requirementsFor(kind: TaskKind): readonly CapabilityKey[] {
  return TASK_REQUIREMENTS[kind] ?? [];
}

/**
 * Normalises an untrusted capability list from a worker.
 *
 * <p>A worker reports the task kinds it implements (see {@code docs/PROTOCOL.md}), while the Host
 * reasons in capability keys. Both vocabularies are accepted here and reduced to capability keys, so
 * a real worker's report is understood rather than silently dropped. Unknown names are dropped and
 * duplicates removed, so a worker cannot smuggle in a capability the Host does not understand and a
 * malformed list cannot throw.
 */
export function normalize(raw: unknown): CapabilitySet {
  if (!Array.isArray(raw)) return { version: CAPABILITY_SCHEMA_VERSION, capabilities: [] };
  const seen = new Set<CapabilityKey>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    if ((CAPABILITY_KEYS as readonly string[]).includes(entry)) {
      seen.add(entry as CapabilityKey);
    } else if (isTaskKind(entry)) {
      for (const need of requirementsFor(entry)) seen.add(need);
    }
  }
  return { version: CAPABILITY_SCHEMA_VERSION, capabilities: [...seen] };
}

export interface TaskEligibility {
  ok: boolean;
  /** When not ok, the capabilities the worker is missing. */
  missing: CapabilityKey[];
  reason: string;
}

/** The capability keys a caller's argument denotes: a raw list is normalised, a set is used as-is. */
function toCapabilityKeys(caps: CapabilitySet | readonly string[]): CapabilityKey[] {
  return Array.isArray(caps) ? normalize(caps as unknown[]).capabilities : (caps as CapabilitySet).capabilities;
}

/** Whether a worker advertising `caps` may be asked to run `kind`. */
export function canRun(caps: CapabilitySet | readonly string[], kind: TaskKind): TaskEligibility {
  // A bare list may be a worker's raw report (task kinds) or already-normalised keys; normalising
  // again makes both work and keeps this the single place the rule is enforced.
  const have = new Set(toCapabilityKeys(caps));
  const missing = requirementsFor(kind).filter((need) => !have.has(need));
  if (missing.length === 0) return { ok: true, missing: [], reason: '' };
  return {
    ok: false,
    missing,
    reason: `the worker does not advertise ${missing.join(', ')}`,
  };
}

/** The task kinds this worker can actually run, for the UI to offer. */
export function availableTaskKinds(caps: CapabilitySet | readonly string[]): TaskKind[] {
  return TASK_KINDS.filter((kind) => canRun(caps, kind).ok);
}
