/**
 * The host's pairing service: the one place that decides whether a worker may join, and with what.
 *
 * It owns three things:
 *  - the single active pairing code (issued from the Dashboard, shown to the operator, single use);
 *  - the per-worker token records (one token per worker, so a single worker can be revoked);
 *  - the answer to a worker's `hello`, in the form the {@link WorkerServer} needs.
 *
 * The `WorkerServer` stays a transport: it asks this service to authenticate and to bind a worker
 * id, and it never reads the token table itself. That keeps every policy decision — expiry, single
 * use, attempt limiting, revocation, identity continuity — in one testable class.
 */
import type { WorkerTokenRepository } from '../db/repositories';
import type { PairingCode, PairingStatus } from '../../shared/types';
import {
  PairingPolicy,
  pairingRefusalMessage,
  systemRandom,
  toTokenView,
  type PairingCodeState,
  type PairingOutcome,
  type RandomSource,
  type WorkerTokenRecord,
  type WorkerTokenView,
} from '../packages/pairing';

export type { PairingOutcome, PairingCodeState } from '../packages/pairing';
export type { PairingCode, PairingStatus } from '../../shared/types';

/** What a worker tells the host about itself in its `hello`. */
export interface HelloInfo {
  /** The worker's self-generated, permanent installation id. Blank from an older mod. */
  installationId: string;
  /** A worker id the worker would like to keep; the host honours it when it is free. */
  workerId: string;
  username: string;
}

/** The authentication half of the worker server, so the transport does not know the policy. */
export interface WorkerAuthorizer {
  authorizeWithCode(code: string, hello: HelloInfo): PairingOutcome;
  authorizeWithToken(token: string, hello: HelloInfo): PairingOutcome;
}

/** The pairing code as shown in the Dashboard. */
export type PairingCodeView = PairingCode;

export interface PairingServiceDeps {
  tokens: WorkerTokenRepository;
  emit: (type: string, message: string, payload?: Record<string, unknown>) => void;
  /** The configured lifetime of a new code, in seconds. Read fresh so a setting change applies. */
  ttlSeconds: () => number;
  /**
   * The host-local shared secret. It authenticates the desktop app acting as a worker on the same
   * machine; a remote worker never learns it, so revoking a paired worker still locks it out.
   */
  sharedToken: () => string;
  random?: RandomSource;
  /** Generates a worker id when a worker arrives without one. */
  newWorkerId?: () => string;
}

export class PairingService implements WorkerAuthorizer {
  private readonly policy: PairingPolicy;
  private readonly random: RandomSource;

  constructor(private readonly deps: PairingServiceDeps) {
    this.random = deps.random ?? systemRandom;
    this.policy = new PairingPolicy(this.random);
  }

  // ---------------------------------------------------------------- code

  /** Issues a fresh code, discarding any previous one. */
  createCode(now = Date.now()): PairingCodeView {
    const state = this.policy.create(this.deps.ttlSeconds(), now);
    this.deps.emit('SYSTEM', 'Pairing code created; it admits one worker and expires shortly.', {
      expiresAt: state.expiresAt,
    });
    return this.view(state);
  }

  currentCode(now = Date.now()): PairingCodeView | null {
    const state = this.policy.current(now);
    return state ? this.view(state) : null;
  }

  clearCode(): boolean {
    const had = this.policy.current() !== null;
    this.policy.clear();
    return had;
  }

  status(now = Date.now()): PairingStatus {
    return {
      code: this.currentCode(now),
      secondsRemaining: this.policy.secondsRemaining(now),
      workers: this.list(),
    };
  }

  private view(state: PairingCodeState): PairingCodeView {
    return { code: state.code, createdAt: state.createdAt, expiresAt: state.expiresAt };
  }

  // ---------------------------------------------------------------- auth

  /**
   * Admits a worker that presents a fresh code, and mints a token unique to it.
   *
   * The worker's installation id is what ties the token to this client across restarts, so a worker
   * that re-pairs (or comes back after a host restart) keeps the same worker id and history.
   */
  authorizeWithCode(code: string, hello: HelloInfo, now = Date.now()): PairingOutcome {
    const refusal = this.policy.consume(code, now);
    if (refusal) {
      this.deps.emit('WORKER_ERROR', `Pairing refused: ${refusal.message}`, { reason: refusal.reason });
      return refusal;
    }

    const bound = hello.installationId ? this.deps.tokens.find({ installationId: hello.installationId }) : undefined;
    const workerId = bound?.workerId || hello.workerId || this.deps.newWorkerId?.() || `worker-${this.random.token().slice(0, 8)}`;
    const token = this.random.token();
    this.deps.tokens.upsert({
      workerId,
      installationId: hello.installationId,
      token,
      label: bound?.label ?? '',
      username: hello.username || bound?.username || '',
      lastPairedAt: now,
      lastSeenAt: now,
      revoked: false,
    });
    this.deps.emit('WORKER_PAIRED', `Worker ${hello.username || workerId} paired with the host`, {
      workerId,
      username: hello.username,
      installationId: hello.installationId,
    });
    return { ok: true, token, workerId };
  }

  /**
   * Admits a worker that already holds a token.
   *
   * A revoked token is refused by name, which is the point of the whole redesign: the operator can
   * lock out one worker without disturbing the rest. The host-local shared token is also accepted,
   * for the desktop app acting as a worker on the same machine.
   */
  authorizeWithToken(token: string, hello: HelloInfo, now = Date.now()): PairingOutcome {
    const record = token ? this.deps.tokens.find({ token }) : undefined;
    if (record) {
      if (record.revoked) {
        this.deps.emit('WORKER_ERROR', `Worker ${record.workerId} tried to connect while revoked`, { workerId: record.workerId });
        return { ok: false, reason: 'revoked', message: pairingRefusalMessage('revoked') };
      }
      // A token belongs to one installation. If a different installation presents it, refuse: the
      // token was copied, and re-pairing is the safe way to move a worker.
      if (record.installationId && hello.installationId && record.installationId !== hello.installationId) {
        return {
          ok: false,
          reason: 'revoked',
          message: 'this token belongs to a different installation; pair this client again with a new code',
        };
      }
      this.deps.tokens.touch(record.workerId, now);
      return { ok: true, token: record.token, workerId: record.workerId };
    }

    if (token && token === this.deps.sharedToken()) {
      return { ok: true, token, workerId: hello.workerId };
    }
    return { ok: false, reason: 'wrong-code', message: 'invalid token' };
  }

  // ---------------------------------------------------------------- records

  list(): WorkerTokenView[] {
    return this.deps.tokens
      .list()
      .map(toTokenView)
      .sort((a, b) => b.lastPairedAt - a.lastPairedAt);
  }

  get(workerId: string): WorkerTokenView | undefined {
    const record = this.deps.tokens.find({ workerId });
    return record ? toTokenView(record) : undefined;
  }

  /** The raw record, for the transport's own bookkeeping. Not for the renderer. */
  record(workerId: string): WorkerTokenRecord | undefined {
    return this.deps.tokens.find({ workerId });
  }

  /** Revokes one worker's credential. It can still reach the host, but only to be told it is out. */
  revoke(workerId: string): boolean {
    const changed = this.deps.tokens.setRevoked(workerId, true);
    if (changed) this.deps.emit('SYSTEM', `Worker ${workerId} revoked; it must be paired again to reconnect.`, { workerId });
    return changed;
  }

  /** Lifts a revocation without issuing a new token. */
  allow(workerId: string): boolean {
    const changed = this.deps.tokens.setRevoked(workerId, false);
    if (changed) this.deps.emit('SYSTEM', `Worker ${workerId} allowed again.`, { workerId });
    return changed;
  }

  /** Forgets a worker's credential entirely, so it must be paired from scratch. */
  forget(workerId: string): boolean {
    return this.deps.tokens.remove(workerId);
  }

  /** Revokes every paired worker. Used when an operator wants to re-pair the whole fleet. */
  revokeAll(): number {
    let count = 0;
    for (const record of this.deps.tokens.list()) {
      if (!record.revoked) {
        this.deps.tokens.setRevoked(record.workerId, true);
        count++;
      }
    }
    if (count > 0) this.deps.emit('SYSTEM', `Revoked ${count} worker${count === 1 ? '' : 's'}.`);
    return count;
  }
}
