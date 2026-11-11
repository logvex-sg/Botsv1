/**
 * Worker roles for the hive.
 *
 * A role is a *capability profile* plus a default objective. It is deliberately data, not behaviour:
 * the same engine that assigns a scout to a sector assigns a guard to a post, and the role only
 * decides what the coordinator considers a sensible default. Nothing here touches a worker.
 */

export type HiveRole =
  | 'COMMANDER'
  | 'ESCORT'
  | 'SCOUT'
  | 'BUILDER'
  | 'MINER'
  | 'LOGISTICS'
  | 'STORAGE'
  | 'GUARD'
  | 'SUPPORT'
  | 'GENERALIST';

export const HIVE_ROLES: readonly HiveRole[] = [
  'COMMANDER',
  'ESCORT',
  'SCOUT',
  'BUILDER',
  'MINER',
  'LOGISTICS',
  'STORAGE',
  'GUARD',
  'SUPPORT',
  'GENERALIST',
];

export function isHiveRole(value: string): value is HiveRole {
  return (HIVE_ROLES as readonly string[]).includes(value.toUpperCase());
}

export interface RoleProfile {
  role: HiveRole;
  /** A one-line description shown in the UI. */
  description: string;
  /** Capability tags this role is expected to have; used for suitability scoring. */
  capabilities: string[];
  /** Whether this role prefers to stay near the commander. */
  staysNearCommander: boolean;
  /** The objective the coordinator assigns when nothing else is asked for. */
  defaultObjective: string;
  /** A colour used by the map and status chips. */
  color: string;
}

export const ROLE_PROFILES: Record<HiveRole, RoleProfile> = {
  COMMANDER: {
    role: 'COMMANDER',
    description: 'Coordinates the hive and holds the formation anchor.',
    capabilities: ['command'],
    staysNearCommander: true,
    defaultObjective: 'coordinate',
    color: '#f5c542',
  },
  ESCORT: {
    role: 'ESCORT',
    description: 'Keeps formation around the commander.',
    capabilities: ['navigate'],
    staysNearCommander: true,
    defaultObjective: 'escort',
    color: '#4fc3f7',
  },
  SCOUT: {
    role: 'SCOUT',
    description: 'Explores an assigned sector and reports observations.',
    capabilities: ['navigate', 'observe'],
    staysNearCommander: false,
    defaultObjective: 'scout',
    color: '#81c784',
  },
  BUILDER: {
    role: 'BUILDER',
    description: 'Performs authorised building tasks.',
    capabilities: ['build', 'navigate'],
    staysNearCommander: false,
    defaultObjective: 'build',
    color: '#ffb74d',
  },
  MINER: {
    role: 'MINER',
    description: 'Performs authorised mining tasks.',
    capabilities: ['mine', 'navigate'],
    staysNearCommander: false,
    defaultObjective: 'mine',
    color: '#a1887f',
  },
  LOGISTICS: {
    role: 'LOGISTICS',
    description: 'Transports items between locations.',
    capabilities: ['navigate', 'carry'],
    staysNearCommander: false,
    defaultObjective: 'haul',
    color: '#ba68c8',
  },
  STORAGE: {
    role: 'STORAGE',
    description: 'Organises the registered storage network.',
    capabilities: ['storage', 'sort'],
    staysNearCommander: false,
    defaultObjective: 'organise-storage',
    color: '#9575cd',
  },
  GUARD: {
    role: 'GUARD',
    description: 'Monitors an authorised area.',
    capabilities: ['observe', 'navigate'],
    staysNearCommander: false,
    defaultObjective: 'guard',
    color: '#e57373',
  },
  SUPPORT: {
    role: 'SUPPORT',
    description: 'Assists other workers where needed.',
    capabilities: ['navigate'],
    staysNearCommander: false,
    defaultObjective: 'assist',
    color: '#4db6ac',
  },
  GENERALIST: {
    role: 'GENERALIST',
    description: 'Handles miscellaneous tasks.',
    capabilities: [],
    staysNearCommander: false,
    defaultObjective: 'idle',
    color: '#90a4ae',
  },
};

/** A worker's role assignment, plus any extra capabilities it advertises. */
export interface RoleAssignment {
  workerId: string;
  role: HiveRole;
  /** Extra capability tags beyond the role's own. */
  extraCapabilities: string[];
  /** When true this worker is the hive's commander. */
  isCommander: boolean;
}

export function capabilitiesFor(assignment: RoleAssignment): string[] {
  const base = ROLE_PROFILES[assignment.role].capabilities;
  return [...new Set([...base, ...assignment.extraCapabilities])];
}

/**
 * A suitability score in [0, 1] for giving `worker` a task that needs `needed` capabilities.
 *
 * Score is the fraction of needed capabilities the worker has. A task that needs nothing scores
 * 1 for everyone, which is the honest answer: any worker will do.
 */
export function suitability(workerCapabilities: readonly string[], needed: readonly string[]): number {
  if (needed.length === 0) return 1;
  const have = new Set(workerCapabilities);
  let matched = 0;
  for (const need of needed) if (have.has(need)) matched += 1;
  return matched / needed.length;
}

/**
 * The workers that could plausibly do a task.
 *
 * A worker with none of the needed capabilities is excluded rather than scored low, so the
 * coordinator never hands a scouting job to a storage bot just because it was closest.
 */
export function eligibleWorkers(
  assignments: readonly RoleAssignment[],
  needed: readonly string[],
): RoleAssignment[] {
  if (needed.length === 0) return [...assignments];
  return assignments.filter((assignment) => suitability(capabilitiesFor(assignment), needed) > 0);
}
