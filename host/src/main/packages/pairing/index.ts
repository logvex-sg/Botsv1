/**
 * The pairing engine: how a worker earns a token, and how the host keeps that token per worker.
 *
 * The host used to hand every paired worker the *same* shared token. That made two promises it
 * could not keep: revoking one worker revoked them all, and a leaked token let anyone in. This
 * module replaces that with one token per worker, plus the short-lived single-use codes that grant
 * them. It is deliberately free of SQLite, Electron and the WebSocket layer so the whole policy —
 * expiry, single use, attempt limiting, revocation — can be unit-tested directly.
 *
 * Identity note: the Worker identifies itself with an `installationId` that it generates once and
 * never changes. The host remembers the mapping installation -> worker id -> token, so a worker that
 * restarts, reconnects or is paired again keeps its identity and history.
 */

/** Characters a pairing code is drawn from: no 0/O/1/I/L, so a code is easy to read out loud. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const PAIRING_CODE_LENGTH = 8;

/** How long a code stays valid if the operator does not change the setting. */
export const DEFAULT_PAIRING_TTL_SECONDS = 600;

/** Refuse this many wrong codes in a row before the current code is burned. */
export const MAX_PAIRING_ATTEMPTS = 5;

export interface PairingCodeState {
  code: string;
  createdAt: number;
  expiresAt: number;
  /** Wrong-code attempts since the code was issued; reaching {@link MAX_PAIRING_ATTEMPTS} burns it. */
  attempts: number;
}

/** One worker's durable credential, as stored. The token is never handed to the renderer. */
export interface WorkerTokenRecord {
  workerId: string;
  /** The worker's self-generated, permanent installation id. */
  installationId: string;
  token: string;
  label: string;
  username: string;
  createdAt: number;
  lastPairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

/** The sanitised view of a token record that is safe to cross the IPC/HTTP boundary. */
export interface WorkerTokenView {
  workerId: string;
  installationId: string;
  label: string;
  username: string;
  createdAt: number;
  lastPairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

export type PairingFailure = 'no-code' | 'expired' | 'wrong-code' | 'too-many-attempts' | 'revoked';

export interface PairingSuccess {
  ok: true;
  token: string;
  workerId: string;
}

export interface PairingRefusal {
  ok: false;
  reason: PairingFailure;
  /** A sentence an operator can act on, shown verbatim in the worker's chat. */
  message: string;
}

export type PairingOutcome = PairingSuccess | PairingRefusal;

/** A source of randomness, injectable so tests can make codes deterministic. */
export interface RandomSource {
  nextInt(bound: number): number;
  token(): string;
}

export const systemRandom: RandomSource = {
  nextInt: (bound) => Math.floor(Math.random() * bound),
  // A 256-bit token: long enough that guessing it is not a strategy.
  token: () => {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  },
};

/**
 * In-memory policy for the current pairing code.
 *
 * The host keeps exactly one active code at a time (the Dashboard shows one). Creating a new code
 * invalidates the previous one, so an operator who regenerates a code never has to worry that the
 * old one still works.
 */
export class PairingPolicy {
  private state: PairingCodeState | null = null;

  constructor(private readonly random: RandomSource = systemRandom) {}

  /** A fresh, single-use code. Any previous code is discarded. */
  create(ttlSeconds: number, now = Date.now()): PairingCodeState {
    const ttl = Math.max(30, ttlSeconds) * 1000;
    const code = Array.from(
      { length: PAIRING_CODE_LENGTH },
      () => PAIRING_ALPHABET[this.random.nextInt(PAIRING_ALPHABET.length)],
    ).join('');
    this.state = { code, createdAt: now, expiresAt: now + ttl, attempts: 0 };
    return this.state;
  }

  /** The current code, or null when none is active or it has expired. */
  current(now = Date.now()): PairingCodeState | null {
    if (this.state && this.state.expiresAt <= now) this.state = null;
    return this.state;
  }

  clear(): void {
    this.state = null;
  }

  /**
   * Checks a presented code and, on success, consumes it.
   *
   * A wrong code is counted; enough wrong codes burn the code so an attacker cannot sit and guess
   * for the whole TTL. A success consumes the code immediately (single use) — the caller then mints
   * a token for the worker.
   */
  consume(presented: string, now = Date.now()): PairingRefusal | null {
    const active = this.current(now);
    if (!active) {
      return { ok: false, reason: 'no-code', message: 'there is no active pairing code; generate one in the Fleet Manager' };
    }
    const normalised = presented.trim().toUpperCase();
    if (normalised !== active.code) {
      active.attempts += 1;
      if (active.attempts >= MAX_PAIRING_ATTEMPTS) {
        this.state = null;
        return { ok: false, reason: 'too-many-attempts', message: 'too many wrong pairing codes; generate a new one in the Fleet Manager' };
      }
      const left = MAX_PAIRING_ATTEMPTS - active.attempts;
      return { ok: false, reason: 'wrong-code', message: `that pairing code is not correct (${left} attempt${left === 1 ? '' : 's'} left)` };
    }
    this.state = null;
    return null;
  }

  /** Remaining seconds before the current code expires, or 0 when there is none. */
  secondsRemaining(now = Date.now()): number {
    const active = this.current(now);
    if (!active) return 0;
    return Math.max(0, Math.round((active.expiresAt - now) / 1000));
  }
}

/** Builds the sentence shown to a worker when pairing is refused, keyed by failure reason. */
export function pairingRefusalMessage(reason: PairingFailure, extra?: string): string {
  switch (reason) {
    case 'revoked':
      return 'this worker was revoked by the Fleet Manager; ask the operator to allow it again';
    case 'expired':
      return 'that pairing code has expired; generate a new one in the Fleet Manager';
    case 'too-many-attempts':
      return 'too many wrong pairing codes; generate a new one in the Fleet Manager';
    case 'no-code':
      return 'there is no active pairing code; generate one in the Fleet Manager';
    case 'wrong-code':
    default:
      return extra ?? 'that pairing code is not correct';
  }
}

/** Strips a token record down to the fields that are safe to show. */
export function toTokenView(record: WorkerTokenRecord): WorkerTokenView {
  return {
    workerId: record.workerId,
    installationId: record.installationId,
    label: record.label,
    username: record.username,
    createdAt: record.createdAt,
    lastPairedAt: record.lastPairedAt,
    lastSeenAt: record.lastSeenAt,
    revoked: record.revoked,
  };
}
