/**
 * Canonical event catalog shared by the Fleet Manager backend, the renderer and the Logvex
 * Hunter addon integration. Keeping the names in one place lets both sides agree on the
 * versioned event schema.
 */

export const EVENT_SCHEMA_VERSION = 1;

export const FleetEventType = {
  // Target lifecycle
  TARGET_DETECTED: 'TARGET_DETECTED',
  TARGET_UPDATED: 'TARGET_UPDATED',
  TARGET_DISAPPEARED: 'TARGET_DISAPPEARED',
  TARGET_REAPPEARED: 'TARGET_REAPPEARED',
  TARGET_CLASSIFIED: 'TARGET_CLASSIFIED',
  // Instance lifecycle
  INSTANCE_CONNECTED: 'INSTANCE_CONNECTED',
  INSTANCE_DISCONNECTED: 'INSTANCE_DISCONNECTED',
  INSTANCE_STATE_CHANGED: 'INSTANCE_STATE_CHANGED',
  INSTANCE_HEALTH: 'INSTANCE_HEALTH',
  INSTANCE_ERROR: 'INSTANCE_ERROR',
  // Deployment
  DEPLOYMENT_STARTED: 'DEPLOYMENT_STARTED',
  DEPLOYMENT_STAGE: 'DEPLOYMENT_STAGE',
  DEPLOYMENT_FINISHED: 'DEPLOYMENT_FINISHED',
  DEPLOYMENT_FAILED: 'DEPLOYMENT_FAILED',
  DEPLOYMENT_PAUSED: 'DEPLOYMENT_PAUSED',
  DEPLOYMENT_RESUMED: 'DEPLOYMENT_RESUMED',
  DEPLOYMENT_CANCELLED: 'DEPLOYMENT_CANCELLED',
  // Roles
  EQUIPMENT_READY: 'EQUIPMENT_READY',
  EQUIPMENT_WARNING: 'EQUIPMENT_WARNING',
  INVENTORY_CHANGED: 'INVENTORY_CHANGED',
  STASIS_READY: 'STASIS_READY',
  STASIS_UNAVAILABLE: 'STASIS_UNAVAILABLE',
  STASIS_STATE_CHANGED: 'STASIS_STATE_CHANGED',
  ENCOUNTER_STARTED: 'ENCOUNTER_STARTED',
  ENCOUNTER_FINISHED: 'ENCOUNTER_FINISHED',
  // Cross-cutting
  MODULE_STATUS_CHANGED: 'MODULE_STATUS_CHANGED',
  COMBAT_EVENT: 'COMBAT_EVENT',
  NOTIFICATION: 'NOTIFICATION',
  SYSTEM: 'SYSTEM',
  HEARTBEAT: 'HEARTBEAT',
  // Workers (real Minecraft clients running the logvex-worker mod)
  WORKER_REGISTERED: 'WORKER_REGISTERED',
  WORKER_DISCONNECTED: 'WORKER_DISCONNECTED',
  WORKER_INVENTORY: 'WORKER_INVENTORY',
  WORKER_TASK_DISPATCHED: 'WORKER_TASK_DISPATCHED',
  WORKER_TASK_FINISHED: 'WORKER_TASK_FINISHED',
  WORKER_TASK_FAILED: 'WORKER_TASK_FAILED',
  WORKER_COMMAND: 'WORKER_COMMAND',
  WORKER_GROUP_CHANGED: 'WORKER_GROUP_CHANGED',
  WORKER_ERROR: 'WORKER_ERROR',
} as const;

export type FleetEventTypeName = (typeof FleetEventType)[keyof typeof FleetEventType];

/** Roles allowed to emit each event type. Enforced by the role coordinator. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  EQUIPMENT_READY: ['GEARER'],
  EQUIPMENT_WARNING: ['GEARER'],
  INVENTORY_CHANGED: ['GEARER'],
  STASIS_READY: ['STASIS'],
  STASIS_UNAVAILABLE: ['STASIS'],
  STASIS_STATE_CHANGED: ['STASIS'],
  TARGET_DETECTED: ['HUNTER', 'meteor'],
  TARGET_UPDATED: ['HUNTER', 'meteor'],
  TARGET_DISAPPEARED: ['HUNTER', 'meteor'],
  TARGET_REAPPEARED: ['HUNTER', 'meteor'],
  TARGET_CLASSIFIED: ['HUNTER', 'meteor'],
  ENCOUNTER_STARTED: ['HUNTER'],
  ENCOUNTER_FINISHED: ['HUNTER'],
  COMBAT_EVENT: ['HUNTER', 'meteor'],
  MODULE_STATUS_CHANGED: ['meteor'],
  INSTANCE_CONNECTED: ['fleet'],
  INSTANCE_DISCONNECTED: ['fleet'],
  INSTANCE_STATE_CHANGED: ['fleet'],
  INSTANCE_HEALTH: ['fleet'],
  INSTANCE_ERROR: ['fleet'],
  SYSTEM: ['fleet', 'meteor'],
  HEARTBEAT: ['fleet', 'meteor'],
};

export function isRoleAllowed(eventType: string, role: string): boolean {
  const allowed = ROLE_PERMISSIONS[eventType];
  if (!allowed) return true; // unclassified event types are not role-gated
  return allowed.includes(role);
}

/** Envelope for every event crossing the API boundary. */
export interface EventEnvelope<T = Record<string, unknown>> {
  schemaVersion: number;
  id: string;
  type: string;
  timestamp: number;
  source: string;
  role: string;
  instanceId: string | null;
  targetUuid: string | null;
  payload: T;
}
