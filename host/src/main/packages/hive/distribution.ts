/**
 * Task distribution.
 *
 * Given a pool of objectives and a set of workers, decide who does what. This is the part of the
 * hive that has to be *fair* and *non-duplicating*: two workers must never be handed the same
 * objective, and an objective already in progress must not be reassigned unless its worker went
 * away. It is pure, so those properties are testable without a server.
 *
 * The scoring is deliberately transparent — distance, capability match, health and current load —
 * rather than a black box, so an operator can see why a worker was chosen.
 */

import type { RoleAssignment } from './roles';
import { capabilitiesFor, suitability } from './roles';
import type { Vec3 } from './formations';

export type ObjectiveKind = 'formation' | 'scout' | 'guard' | 'storage' | 'build' | 'mine' | 'haul' | 'assist' | 'idle';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  /** Capabilities a worker needs to take this on. */
  needs: string[];
  /** Where the objective is, when it is somewhere specific. */
  position?: Vec3;
  /** The worker currently holding it, if any. */
  assignedTo?: string | null;
  /** A stable priority; higher wins when two objectives compete for one worker. */
  priority: number;
  /** A human label for the UI. */
  label: string;
}

export interface WorkerLoad {
  workerId: string;
  position?: Vec3;
  health?: number;
  /** True while the worker is running a task. */
  busy: boolean;
  /** True while the worker is connected. */
  online: boolean;
}

export interface Assignment {
  objectiveId: string;
  workerId: string;
  score: number;
  reason: string;
}

export interface DistributionOptions {
  /** Distance (in blocks) beyond which a worker is considered too far for a non-urgent task. */
  maxDistance?: number;
  /** A worker below this health is not given a new objective. */
  minHealth?: number;
}

const DEFAULTS: Required<DistributionOptions> = { maxDistance: 512, minHealth: 6 };

/**
 * Assigns objectives to workers.
 *
 * Objectives already held by an online worker are left alone — that is the duplicate-task
 * prevention. Everything else is matched by score. Objectives are taken in priority order, and a
 * worker is used at most once per pass.
 */
export function distribute(
  objectives: readonly Objective[],
  assignments: readonly RoleAssignment[],
  loads: readonly WorkerLoad[],
  options: DistributionOptions = {},
): { assignments: Assignment[]; unassigned: string[] } {
  const config = { ...DEFAULTS, ...options };
  const loadById = new Map(loads.map((load) => [load.workerId, load]));
  const roleById = new Map(assignments.map((assignment) => [assignment.workerId, assignment]));

  const result: Assignment[] = [];
  const takenWorkers = new Set<string>();
  const unassigned: string[] = [];

  // A worker already holding an objective keeps it, and is not offered another.
  for (const objective of objectives) {
    if (objective.assignedTo && loadById.get(objective.assignedTo)?.online) {
      takenWorkers.add(objective.assignedTo);
      result.push({ objectiveId: objective.id, workerId: objective.assignedTo, score: 1, reason: 'already assigned' });
    }
  }

  const pending = objectives
    .filter((objective) => !(objective.assignedTo && loadById.get(objective.assignedTo)?.online))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  for (const objective of pending) {
    const candidates = loads
      .filter((load) => load.online && !takenWorkers.has(load.workerId) && !load.busy)
      .filter((load) => (load.health ?? config.minHealth) >= config.minHealth)
      .map((load) => {
        const role = roleById.get(load.workerId);
        const capabilities = role ? capabilitiesFor(role) : [];
        return { load, role, score: score(objective, load, capabilities, config), capabilities };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.load.workerId.localeCompare(b.load.workerId));

    const best = candidates[0];
    if (!best) {
      unassigned.push(objective.id);
      continue;
    }
    takenWorkers.add(best.load.workerId);
    result.push({
      objectiveId: objective.id,
      workerId: best.load.workerId,
      score: Math.round(best.score * 1000) / 1000,
      reason: explain(objective, best.load, best.capabilities, config),
    });
  }

  return { assignments: result, unassigned };
}

function score(objective: Objective, load: WorkerLoad, capabilities: readonly string[], config: Required<DistributionOptions>): number {
  const capability = suitability(capabilities, objective.needs);
  if (objective.needs.length > 0 && capability === 0) return 0; // never hand a job to the wrong role

  const distance = objective.position && load.position ? euclid(objective.position, load.position) : 0;
  const distanceScore = objective.position ? Math.max(0, 1 - distance / config.maxDistance) : 1;
  const healthScore = Math.min(1, (load.health ?? 20) / 20);

  // Capability is weighted highest, then closeness, then health. Idle workers score full on load.
  return 0.55 * capability + 0.3 * distanceScore + 0.15 * healthScore;
}

function explain(objective: Objective, load: WorkerLoad, capabilities: readonly string[], config: Required<DistributionOptions>): string {
  const matched = objective.needs.filter((need) => capabilities.includes(need));
  const parts: string[] = [];
  if (matched.length > 0) parts.push(`has ${matched.join(', ')}`);
  if (objective.position && load.position) parts.push(`${Math.round(euclid(objective.position, load.position))} blocks away`);
  parts.push(`health ${Math.round(load.health ?? 20)}`);
  void config;
  return parts.join('; ');
}

export function euclid(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * The priority ladder, highest first.
 *
 * Safety outranks everything, then an explicit operator instruction, then keeping formation, then
 * the hive's own objectives, then exploration, then idling. The commander never reorders these
 * silently; an explicit instruction is placed at level 2 and stays there until it completes.
 */
export const PRIORITY = {
  EMERGENCY: 100,
  EXPLICIT: 80,
  FORMATION: 60,
  OBJECTIVE: 40,
  EXPLORATION: 20,
  IDLE: 0,
} as const;

export function priorityFor(kind: ObjectiveKind): number {
  switch (kind) {
    case 'formation':
      return PRIORITY.FORMATION;
    case 'scout':
      return PRIORITY.EXPLORATION;
    case 'idle':
      return PRIORITY.IDLE;
    default:
      return PRIORITY.OBJECTIVE;
  }
}

/**
 * Rebuilds the objective list when a worker disappears.
 *
 * Objectives held by a disconnected worker are released so they can be reassigned; the others are
 * untouched. This is what keeps one dead worker from stalling the whole hive.
 */
export function releaseForWorker(objectives: readonly Objective[], workerId: string): Objective[] {
  return objectives.map((objective) => (objective.assignedTo === workerId ? { ...objective, assignedTo: null } : objective));
}
