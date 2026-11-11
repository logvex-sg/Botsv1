/**
 * The worker wire contract, version 4, mirrored from `protocol/protocol.json`.
 *
 * The canonical declaration is `protocol/protocol.json`; this file, the host's
 * `src/shared/workers.ts` and the mod's `core/Protocol.java` are all checked against it by
 * `protocol/check-protocol.mjs`. Version 4 is additive over 3:
 *
 *   - `hello`, `register` and `status` may carry `runtime` ("mineflayer" | "fabric").
 *   - one new task kind, `nl-task`, carrying `{ instruction }`.
 *   - one new outbound frame, `config`, carrying a runtime configuration patch.
 *
 * A version-3 peer that omits `runtime` is treated as "fabric", and a runtime that does not know
 * `nl-task` or `config` refuses/ignores them, so a v3 worker and a v4 host interoperate.
 */

export const WORKER_PROTOCOL_VERSION = 4;
export const WORKER_PATH = '/worker';
export const SUPPORTED_VERSION_WINDOW = 1;

export const MESSAGE_TYPES = {
  // worker -> host
  HELLO: 'hello',
  REGISTER: 'register',
  STATUS: 'status',
  INVENTORY: 'inventory',
  EQUIPMENT: 'equipment',
  RESULT: 'result',
  PROGRESS: 'progress',
  PONG: 'pong',
  ERROR: 'error',
  LOG: 'log',
  // host -> worker
  HELLO_ACK: 'hello-ack',
  COMMAND: 'command',
  TASK: 'task',
  PING: 'ping',
  KICK: 'kick',
  CONTROL: 'control',
  CONFIG: 'config',
} as const;

export const INBOUND_TYPES: readonly string[] = [
  'hello',
  'register',
  'status',
  'inventory',
  'equipment',
  'result',
  'progress',
  'pong',
  'error',
  'log',
];

export const OUTBOUND_TYPES: readonly string[] = ['hello-ack', 'command', 'task', 'ping', 'kick', 'control', 'config'];

export const CONTROL_ACTIONS = ['connect', 'disconnect', 'restart', 'pause', 'resume'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export function isControlAction(value: unknown): value is ControlAction {
  return typeof value === 'string' && (CONTROL_ACTIONS as readonly string[]).includes(value);
}

export const TASK_KINDS: readonly string[] = [
  'status',
  'inventory',
  'count',
  'search',
  'equipment',
  'regear',
  'command',
  'chat',
  'position',
  'efly',
  'container-read',
  'container-move',
  'shulker-read',
  'shulker-pack',
  'shulker-unpack',
  'restock',
  'portal-scan',
  'navigate',
  'nl-task',
];

export const EXCLUSIVE_TASK_KINDS: readonly string[] = [
  'regear',
  'command',
  'chat',
  'efly',
  'container-move',
  'shulker-pack',
  'shulker-unpack',
  'restock',
  'navigate',
  'nl-task',
];

export function isExclusiveKind(kind: string): boolean {
  return EXCLUSIVE_TASK_KINDS.includes(kind);
}

export interface WorkerEnvelope {
  v: number;
  type: string;
  id?: string;
  payload?: Record<string, unknown>;
}

export function encodeEnvelope(envelope: WorkerEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Parses an envelope defensively.
 *
 * A frame that is not an object, or whose `type` is not a string, is dropped. An unknown `type` is
 * returned as-is so a newer host can send frames an older worker ignores rather than errors on.
 */
export function decodeEnvelope(text: string): WorkerEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.type !== 'string') return null;
  const payload =
    record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : {};
  const envelope: WorkerEnvelope = { v: Number(record.v) || 0, type: record.type, payload };
  if (typeof record.id === 'string') envelope.id = record.id;
  return envelope;
}

export interface NegotiationOutcome {
  accepted: boolean;
  reason?: string;
  /** The version both sides will speak. */
  version: number;
}

/**
 * Accepts a peer within one version of ours, in either direction.
 *
 * Being one version out is normal during a migration and does not affect any frame that has not
 * changed. Anything further apart is refused rather than guessed at.
 */
export function negotiate(peerVersion: number, ourVersion: number = WORKER_PROTOCOL_VERSION): NegotiationOutcome {
  if (!Number.isFinite(peerVersion) || peerVersion <= 0) {
    return { accepted: false, reason: 'missing or invalid protocol version', version: ourVersion };
  }
  const delta = Math.abs(peerVersion - ourVersion);
  if (delta > SUPPORTED_VERSION_WINDOW) {
    return {
      accepted: false,
      reason: `protocol version ${peerVersion} is not within ${SUPPORTED_VERSION_WINDOW} of ${ourVersion}`,
      version: ourVersion,
    };
  }
  return { accepted: true, version: Math.min(peerVersion, ourVersion) };
}

export interface RuntimeConfigPatch {
  label?: string;
  group?: string;
  server?: { host?: string; port?: number; version?: string };
  plugins?: Record<string, boolean>;
  permissions?: Record<string, boolean>;
}

export function emptySnapshot(): Record<string, unknown> {
  return {
    workerId: '',
    username: '',
    runtime: 'mineflayer',
    paused: false,
    stopped: false,
  };
}
