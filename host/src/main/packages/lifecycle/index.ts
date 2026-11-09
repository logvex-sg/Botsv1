/**
 * Worker lifecycle state machine.
 *
 * The Host distinguishes a worker that is *disconnected* (no socket) from one that is *connected
 * but unresponsive* (socket open, heartbeat overdue) — conflating the two hides the failure that
 * actually matters. This module owns the state names, the legal transitions, and the derived
 * flags the rest of the Host reads, so no caller has to invent its own notion of "is it up".
 *
 * Pure: no sockets, no timers, no clock of its own (callers pass `now`). Unit-testable.
 */

export type LifecycleState =
  | 'UNREGISTERED'
  | 'PAIRING'
  | 'CONNECTING'
  | 'ONLINE'
  | 'IDLE'
  | 'BUSY'
  | 'PAUSED'
  | 'UNRESPONSIVE'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'INCOMPATIBLE';

/** The transitions the Host will accept. A transition not listed here is refused. */
const TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> = {
  UNREGISTERED: ['PAIRING', 'CONNECTING', 'INCOMPATIBLE'],
  PAIRING: ['CONNECTING', 'DISCONNECTED', 'ERROR', 'INCOMPATIBLE'],
  CONNECTING: ['ONLINE', 'IDLE', 'DISCONNECTED', 'ERROR', 'INCOMPATIBLE'],
  ONLINE: ['BUSY', 'IDLE', 'PAUSED', 'UNRESPONSIVE', 'RECONNECTING', 'DISCONNECTED', 'ERROR'],
  IDLE: ['BUSY', 'ONLINE', 'PAUSED', 'UNRESPONSIVE', 'RECONNECTING', 'DISCONNECTED', 'ERROR'],
  BUSY: ['ONLINE', 'IDLE', 'PAUSED', 'UNRESPONSIVE', 'RECONNECTING', 'DISCONNECTED', 'ERROR'],
  PAUSED: ['ONLINE', 'IDLE', 'BUSY', 'UNRESPONSIVE', 'RECONNECTING', 'DISCONNECTED', 'ERROR'],
  UNRESPONSIVE: ['ONLINE', 'IDLE', 'BUSY', 'RECONNECTING', 'DISCONNECTED', 'ERROR'],
  RECONNECTING: ['CONNECTING', 'ONLINE', 'IDLE', 'DISCONNECTED', 'ERROR', 'INCOMPATIBLE'],
  DISCONNECTED: ['CONNECTING', 'RECONNECTING', 'PAIRING', 'INCOMPATIBLE'],
  ERROR: ['CONNECTING', 'RECONNECTING', 'DISCONNECTED', 'INCOMPATIBLE'],
  INCOMPATIBLE: ['CONNECTING', 'RECONNECTING', 'DISCONNECTED'],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when the worker has a live socket (even if it is silent). */
export function isConnected(state: LifecycleState): boolean {
  return state === 'ONLINE' || state === 'IDLE' || state === 'BUSY'
    || state === 'PAUSED' || state === 'UNRESPONSIVE';
}

/** True when the Host may dispatch a mutating task to this worker. */
export function acceptsMutating(state: LifecycleState): boolean {
  return state === 'ONLINE' || state === 'IDLE';
}

/** True when the worker is known but not currently usable. */
export function isDown(state: LifecycleState): boolean {
  return state === 'DISCONNECTED' || state === 'ERROR' || state === 'INCOMPATIBLE'
    || state === 'UNREGISTERED' || state === 'RECONNECTING';
}

export interface DerivedStateInput {
  /** The last state the registry recorded. */
  state: LifecycleState;
  /** When the last heartbeat arrived, or null if none since connecting. */
  lastHeartbeatAt: number | null;
  now: number;
  /** A heartbeat older than this (ms) means the worker is unresponsive. */
  heartbeatTimeoutMs: number;
  /** True while a task is in flight. */
  busy: boolean;
  /** True while the operator has paused mutating tasks. */
  paused: boolean;
}

/**
 * Derives the *effective* state from raw signals.
 *
 * This is the single place "the socket is open but the client stopped answering" is decided, so
 * every caller agrees on it.
 */
export function deriveState(input: DerivedStateInput): LifecycleState {
  if (!isConnected(input.state)) return input.state;
  if (input.lastHeartbeatAt !== null && input.now - input.lastHeartbeatAt > input.heartbeatTimeoutMs) {
    return 'UNRESPONSIVE';
  }
  if (input.paused) return 'PAUSED';
  if (input.busy) return 'BUSY';
  return input.state === 'UNRESPONSIVE' ? 'ONLINE' : input.state;
}

/** A short label for the UI, in plain language. */
export function describe(state: LifecycleState): string {
  switch (state) {
    case 'UNREGISTERED': return 'Never connected';
    case 'PAIRING': return 'Pairing';
    case 'CONNECTING': return 'Connecting';
    case 'ONLINE': return 'Online';
    case 'IDLE': return 'Online, idle';
    case 'BUSY': return 'Online, busy';
    case 'PAUSED': return 'Paused by operator';
    case 'UNRESPONSIVE': return 'Connected but not answering';
    case 'RECONNECTING': return 'Reconnecting';
    case 'DISCONNECTED': return 'Disconnected';
    case 'ERROR': return 'Error';
    case 'INCOMPATIBLE': return 'Incompatible protocol';
  }
}
