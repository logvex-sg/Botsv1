/**
 * Wire protocol: encoding, defensive decoding and version negotiation.
 *
 * This is the Host's *typed* view of the contract declared in `protocol/protocol.json`. It sits on
 * top of the low-level mirror in `src/shared/workers.ts` and adds the pieces the rest of the Host
 * needs but the raw constants cannot express: strict validation of an untrusted frame, a parsed
 * result type, and a negotiation step that refuses an incompatible peer instead of guessing.
 *
 * Nothing here touches Electron, SQLite or a socket, so it is unit-testable on its own.
 */
import {
  WORKER_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  isControlAction,
  isTaskKind,
  type ControlAction,
  type TaskKind,
  type WorkerEnvelope,
} from '../../../shared/workers';

export type { ControlAction, TaskKind, WorkerEnvelope };

/** How many versions back a peer may be and still be accepted. */
export const SUPPORTED_VERSION_WINDOW = 1;

export type NegotiationOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: 'too-old' | 'too-new' | 'missing' | 'malformed'; message: string };

/**
 * Decides whether this Host can talk to a peer that announced `version`.
 *
 * A mismatch is refused rather than coerced: coercing a frame the other side shaped differently is
 * how a silent data-corruption bug is born. A peer one version behind is accepted because the
 * envelope is additive within a window; a peer ahead is refused so the Host never mis-reads a
 * newer payload.
 */
export function negotiate(version: unknown, hostVersion = WORKER_PROTOCOL_VERSION): NegotiationOutcome {
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    return { ok: false, reason: 'missing', message: 'the peer did not announce a protocol version' };
  }
  if (version > hostVersion) {
    return {
      ok: false,
      reason: 'too-new',
      message: `the worker speaks protocol v${version} but this host speaks v${hostVersion}; update the host`,
    };
  }
  if (hostVersion - version > SUPPORTED_VERSION_WINDOW) {
    return {
      ok: false,
      reason: 'too-old',
      message: `the worker speaks protocol v${version}, older than the supported v${hostVersion - SUPPORTED_VERSION_WINDOW}`,
    };
  }
  return { ok: true, version };
}

export type FrameKind = 'task' | 'control' | 'ping' | 'kick' | 'hello-ack' | 'other';

export interface ValidatedFrame {
  envelope: WorkerEnvelope;
  kind: FrameKind;
  /** Present only for a `task` frame with a valid kind. */
  taskKind?: TaskKind;
  /** Present only for a `control` frame with a valid action. */
  controlAction?: ControlAction;
}

export type FrameValidation =
  | { ok: true; frame: ValidatedFrame }
  | { ok: false; error: string };

function classify(type: string): FrameKind {
  switch (type) {
    case 'task': return 'task';
    case 'control': return 'control';
    case 'ping': return 'ping';
    case 'kick': return 'kick';
    case 'hello-ack': return 'hello-ack';
    default: return 'other';
  }
}

/**
 * Validates an outbound frame before it is written to a socket.
 *
 * A `task` must name a kind in the closed set and a `control` must name a known action; anything
 * else is refused here, so a bug in a caller cannot put an unexecutable frame on the wire.
 */
export function validateOutbound(envelope: WorkerEnvelope): FrameValidation {
  if (typeof envelope.type !== 'string' || envelope.type.length === 0) {
    return { ok: false, error: 'frame has no type' };
  }
  const kind = classify(envelope.type);
  if (kind === 'task') {
    const taskKind = envelope.payload?.kind;
    if (typeof taskKind !== 'string' || !isTaskKind(taskKind)) {
      return { ok: false, error: `unknown task kind: ${String(taskKind)}` };
    }
    return { ok: true, frame: { envelope, kind, taskKind } };
  }
  if (kind === 'control') {
    const action = envelope.payload?.action;
    if (typeof action !== 'string' || !isControlAction(action)) {
      return { ok: false, error: `unknown control action: ${String(action)}` };
    }
    return { ok: true, frame: { envelope, kind, controlAction: action } };
  }
  return { ok: true, frame: { envelope, kind } };
}

/**
 * Decodes and validates an inbound frame from a worker.
 *
 * The worker is a remote process the Host does not fully trust, so the frame is shape-checked and
 * version-negotiated before anything reads it. A frame the Host cannot understand is dropped with
 * a reason, never half-applied.
 */
export function acceptInbound(raw: string, hostVersion = WORKER_PROTOCOL_VERSION): FrameValidation {
  const envelope = decodeEnvelope(raw);
  if (!envelope) return { ok: false, error: 'frame is not a valid JSON envelope' };
  const outcome = negotiate(envelope.v, hostVersion);
  if (!outcome.ok) return { ok: false, error: outcome.message };
  return { ok: true, frame: { envelope, kind: classify(envelope.type) } };
}

export { decodeEnvelope, encodeEnvelope };
