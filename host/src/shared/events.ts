/**
 * Canonical event catalog shared by the Host backend and the renderer.
 *
 * Every event describes something a worker (or the host itself) did, so the Activity view and the
 * WebSocket stream both read from one vocabulary. Keeping the names in one place lets the two
 * sides agree on the versioned event schema.
 */

export const EVENT_SCHEMA_VERSION = 1;

export const FleetEventType = {
  // Worker lifecycle
  WORKER_PAIRED: 'WORKER_PAIRED',
  WORKER_REGISTERED: 'WORKER_REGISTERED',
  WORKER_DISCONNECTED: 'WORKER_DISCONNECTED',
  WORKER_CONTROL: 'WORKER_CONTROL',
  WORKER_GROUP_CHANGED: 'WORKER_GROUP_CHANGED',
  WORKER_INVENTORY: 'WORKER_INVENTORY',
  WORKER_LOG: 'WORKER_LOG',
  WORKER_ERROR: 'WORKER_ERROR',
  // Tasks
  WORKER_TASK_DISPATCHED: 'WORKER_TASK_DISPATCHED',
  WORKER_TASK_FINISHED: 'WORKER_TASK_FINISHED',
  WORKER_TASK_FAILED: 'WORKER_TASK_FAILED',
  // Commands / chat
  WORKER_COMMAND: 'WORKER_COMMAND',
  // Multiverse layer
  SERVER_PROFILE_CHANGED: 'SERVER_PROFILE_CHANGED',
  WORKER_TAGS_CHANGED: 'WORKER_TAGS_CHANGED',
  SCHEDULE_FIRED: 'SCHEDULE_FIRED',
  RULE_TRIGGERED: 'RULE_TRIGGERED',
  INVENTORY_CHANGED: 'INVENTORY_CHANGED',
  // HIVE MODE
  HIVE_STATE: 'HIVE_STATE',
  HIVE_COMMANDER: 'HIVE_COMMANDER',
  HIVE_ROLE: 'HIVE_ROLE',
  HIVE_FORMATION: 'HIVE_FORMATION',
  HIVE_COMMAND: 'HIVE_COMMAND',
  HIVE_EMERGENCY_STOP: 'HIVE_EMERGENCY_STOP',
  HIVE_OBSERVATION: 'HIVE_OBSERVATION',
  // Cross-cutting
  SYSTEM: 'SYSTEM',
} as const;

export type FleetEventTypeName = (typeof FleetEventType)[keyof typeof FleetEventType];

/** Envelope for every event crossing the API boundary. */
export interface EventEnvelope<T = Record<string, unknown>> {
  schemaVersion: number;
  id: string;
  type: string;
  timestamp: number;
  source: string;
  workerId: string | null;
  payload: T;
}
