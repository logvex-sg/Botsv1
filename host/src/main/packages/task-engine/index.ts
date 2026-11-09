/**
 * Task engine: task definitions, lifecycle and validation.
 *
 * A *task definition* describes a unit of client-side functionality: its category, the capability a
 * worker must have, whether it mutates state, and the shape of its configuration. The Host uses a
 * definition to validate a request before it is dispatched and to decide which workers may run it.
 *
 * This module is the single registry of definitions, so the task library, the task builder and the
 * scheduler all agree on what a task is. It is pure and unit-testable.
 */
import { TASK_KINDS, isExclusiveKind, isTaskKind, type TaskKind } from '../../../shared/workers';
import { canRun, type CapabilityKey, type CapabilitySet } from '../capabilities';

export type TaskCategory =
  | 'Inventory'
  | 'Equipment'
  | 'Movement'
  | 'Communication'
  | 'Monitoring'
  | 'Storage'
  | 'System';

/** Task lifecycle states. A task is created DRAFT or QUEUED and moves forward only. */
export type TaskState =
  | 'DRAFT'
  | 'QUEUED'
  | 'VALIDATING'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

const TERMINAL: readonly TaskState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL.includes(state);
}

/** Legal forward transitions. Anything else is refused rather than silently allowed. */
const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  DRAFT: ['QUEUED', 'CANCELLED'],
  QUEUED: ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canAdvance(from: TaskState, to: TaskState): boolean {
  if (from === to) return true;
  return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TaskDefinition {
  /** The wire kind this definition executes. */
  kind: TaskKind;
  name: string;
  description: string;
  category: TaskCategory;
  /** The definition's own version, so a config can be migrated. */
  version: number;
  /** Capabilities a worker must advertise before it is offered this task. */
  requires: readonly CapabilityKey[];
  /** Whether the task changes game state (and so runs one at a time per worker). */
  mutating: boolean;
  /** Whether the task accepts a pause/resume while running. */
  pausable: boolean;
  /** Default timeout in ms; a worker that does not answer in time is reported as timed out. */
  timeoutMs: number;
}

function define(
  kind: TaskKind,
  name: string,
  description: string,
  category: TaskCategory,
  requires: readonly CapabilityKey[],
  pausable = false,
  timeoutMs = 15_000,
): TaskDefinition {
  return { kind, name, description, category, version: 1, requires, mutating: isExclusiveKind(kind), pausable, timeoutMs };
}

/** The task library. One entry per supported kind; the closed set is the security boundary. */
export const TASK_LIBRARY: readonly TaskDefinition[] = [
  define('status', 'Worker status', 'Report health, position, dimension and current activity.', 'Monitoring', [], false, 5_000),
  define('inventory', 'Inspect inventory', 'Capture the worker\'s carried items and armor.', 'Inventory', ['inventory']),
  define('count', 'Count items', 'Count how many of an item the worker is carrying.', 'Inventory', ['item_counting']),
  define('search', 'Search for items', 'Find where a named item is in the worker\'s inventory.', 'Inventory', ['item_search']),
  define('equipment', 'Inspect equipment', 'Report armor, held and offhand items with durability.', 'Equipment', ['equipment_inspection']),
  define('regear', 'Regear to a loadout', 'Compare against a loadout and, when allowed, move items to match it.', 'Equipment', ['regear', 'inventory'], false, 30_000),
  define('command', 'Run a server command', 'Send one permitted command line from the worker.', 'Communication', ['command'], false, 10_000),
  define('chat', 'Send a chat message', 'Send one chat line from the worker.', 'Communication', ['chat'], false, 10_000),
  define('position', 'Report position', 'Report the worker\'s current coordinates and dimension.', 'Movement', ['position_reporting'], false, 5_000),
  define('efly', 'Elytra flight', 'Start or stop elytra flight toward a target, through Meteor.', 'Movement', ['efly'], true, 20_000),
];

const BY_KIND = new Map<TaskKind, TaskDefinition>(TASK_LIBRARY.map((def) => [def.kind, def]));

export function definitionFor(kind: TaskKind): TaskDefinition | undefined {
  return BY_KIND.get(kind);
}

export function libraryByCategory(): { category: TaskCategory; tasks: TaskDefinition[] }[] {
  const order: TaskCategory[] = ['Inventory', 'Equipment', 'Movement', 'Communication', 'Monitoring', 'Storage', 'System'];
  return order
    .map((category) => ({ category, tasks: TASK_LIBRARY.filter((def) => def.category === category) }))
    .filter((entry) => entry.tasks.length > 0);
}

export type TaskRequestValidation =
  | { ok: true; definition: TaskDefinition }
  | { ok: false; error: string };

/**
 * Validates a task request against the definition and a worker's capabilities.
 *
 * This is where "the Host must never offer a task a worker cannot execute" is enforced, so the UI
 * can grey out a button and the API can refuse it with the same reason.
 */
export function validateRequest(
  kind: string,
  capabilities: CapabilitySet | CapabilityKey[],
): TaskRequestValidation {
  if (!isTaskKind(kind)) {
    return { ok: false, error: `"${kind}" is not a supported task` };
  }
  const definition = definitionFor(kind);
  if (!definition) {
    return { ok: false, error: `"${kind}" has no task definition` };
  }
  const eligibility = canRun(capabilities, kind);
  if (!eligibility.ok) {
    return { ok: false, error: eligibility.reason };
  }
  return { ok: true, definition };
}

/** A saved, reusable task configuration. */
export interface TaskPreset {
  id: string;
  name: string;
  description: string;
  kind: TaskKind;
  params: Record<string, unknown>;
  /** The default worker ids or group ids this preset targets. */
  targetWorkerIds: string[];
  targetGroupIds: string[];
  /** Whether a scheduled run of this preset repeats. */
  createdAt: number;
  updatedAt: number;
}

/** Every kind the library knows, in library order. */
export function knownKinds(): TaskKind[] {
  return TASK_KINDS.slice();
}
