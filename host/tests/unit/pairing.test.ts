/**
 * Pairing tests.
 *
 * The rules that matter for a real fleet are the ones exercised here: a code admits exactly one
 * worker, it expires, enough wrong guesses burn it, and — the point of the redesign — revoking one
 * worker does not disturb the rest. The policy and the service are tested without a socket, because
 * the whole point of keeping them separate is that the policy can be proven on its own.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { WorkerTokenRepository } from '../../src/main/db/repositories';
import { PairingPolicy, MAX_PAIRING_ATTEMPTS, type RandomSource } from '../../src/main/packages/pairing';
import { PairingService } from '../../src/main/pairing/pairing-service';

/** A deterministic random source: codes are a known alphabet run, tokens a counted sequence. */
function seededRandom(): RandomSource {
  let counter = 0;
  return {
    nextInt: (bound) => counter++ % bound,
    token: () => `token-${String(++counter).padStart(4, '0')}`,
  };
}

describe('PairingPolicy', () => {
  it('issues a code that consumes exactly once', () => {
    const policy = new PairingPolicy(seededRandom());
    const state = policy.create(600);
    expect(state.code).toHaveLength(8);
    expect(policy.consume(state.code)).toBeNull();
    // Single use: the same code no longer exists.
    const second = policy.consume(state.code);
    expect(second?.reason).toBe('no-code');
  });

  it('accepts a code regardless of case and surrounding whitespace', () => {
    const policy = new PairingPolicy(seededRandom());
    const state = policy.create(600);
    expect(policy.consume(`  ${state.code.toLowerCase()}  `)).toBeNull();
  });

  it('expires a code after its lifetime', () => {
    const policy = new PairingPolicy(seededRandom());
    const state = policy.create(30, 1_000);
    expect(policy.current(1_000 + 29_999)?.code).toBe(state.code);
    expect(policy.current(1_000 + 30_000)).toBeNull();
    expect(policy.consume(state.code, 1_000 + 30_000)?.reason).toBe('no-code');
  });

  it('burns the code after too many wrong guesses', () => {
    const policy = new PairingPolicy(seededRandom());
    const state = policy.create(600);
    for (let attempt = 1; attempt < MAX_PAIRING_ATTEMPTS; attempt++) {
      expect(policy.consume('WRONG234')?.reason).toBe('wrong-code');
    }
    expect(policy.consume('WRONG234')?.reason).toBe('too-many-attempts');
    // The real code no longer works once the code was burned.
    expect(policy.consume(state.code)?.reason).toBe('no-code');
  });

  it('creates a fresh code that invalidates the previous one', () => {
    const policy = new PairingPolicy(seededRandom());
    const first = policy.create(600);
    const second = policy.create(600);
    expect(second.code).not.toBe(first.code);
    expect(policy.consume(first.code)?.reason).toBe('wrong-code');
  });

  it('reports the remaining seconds, and zero when there is no code', () => {
    const policy = new PairingPolicy(seededRandom());
    expect(policy.secondsRemaining(1_000)).toBe(0);
    policy.create(120, 1_000);
    expect(policy.secondsRemaining(1_000)).toBe(120);
    expect(policy.secondsRemaining(1_000 + 60_000)).toBe(60);
  });
});

describe('PairingService', () => {
  let db: FleetDatabase;
  let tokens: WorkerTokenRepository;
  let service: PairingService;
  const events: string[] = [];

  beforeEach(() => {
    db = new FleetDatabase(':memory:');
    tokens = new WorkerTokenRepository(db);
    events.length = 0;
    service = new PairingService({
      tokens,
      emit: (type, message) => events.push(`${type}:${message}`),
      ttlSeconds: () => 600,
      sharedToken: () => 'host-local-secret',
      random: seededRandom(),
      newWorkerId: () => 'generated-id',
    });
  });
  afterEach(() => db.close());

  it('mints a unique token on a code join and records the worker', () => {
    const code = service.createCode().code;
    const outcome = service.authorizeWithCode(code, { installationId: 'inst-1', workerId: 'w-1', username: 'Miner' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.token).not.toBe('host-local-secret');
    const record = tokens.find({ workerId: 'w-1' })!;
    expect(record.token).toBe(outcome.token);
    expect(record.installationId).toBe('inst-1');
    expect(record.username).toBe('Miner');
  });

  it('keeps the same worker id when the same installation pairs again', () => {
    const first = service.authorizeWithCode(service.createCode().code, { installationId: 'inst-9', workerId: '', username: 'A' });
    const second = service.authorizeWithCode(service.createCode().code, { installationId: 'inst-9', workerId: '', username: 'A' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.workerId).toBe(first.workerId);
    // Re-pairing rotates the token, so a leaked old token stops working.
    expect(second.token).not.toBe(first.token);
    expect(tokens.list()).toHaveLength(1);
  });

  it('accepts a worker that presents its own token', () => {
    const code = service.createCode().code;
    const paired = service.authorizeWithCode(code, { installationId: 'inst-2', workerId: 'w-2', username: 'B' });
    if (!paired.ok) throw new Error('expected pairing to succeed');
    const again = service.authorizeWithToken(paired.token, { installationId: 'inst-2', workerId: 'w-2', username: 'B' });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.workerId).toBe('w-2');
  });

  it('refuses a revoked worker by name, leaving the others untouched', () => {
    const a = service.authorizeWithCode(service.createCode().code, { installationId: 'i-a', workerId: 'w-a', username: 'A' });
    const b = service.authorizeWithCode(service.createCode().code, { installationId: 'i-b', workerId: 'w-b', username: 'B' });
    if (!a.ok || !b.ok) throw new Error('expected both to pair');

    expect(service.revoke('w-a')).toBe(true);
    const refused = service.authorizeWithToken(a.token, { installationId: 'i-a', workerId: 'w-a', username: 'A' });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('revoked');
    // The other worker is entirely unaffected.
    expect(service.authorizeWithToken(b.token, { installationId: 'i-b', workerId: 'w-b', username: 'B' }).ok).toBe(true);
  });

  it('lifts a revocation with allow without issuing a new token', () => {
    const paired = service.authorizeWithCode(service.createCode().code, { installationId: 'i-c', workerId: 'w-c', username: 'C' });
    if (!paired.ok) throw new Error('expected pairing to succeed');
    service.revoke('w-c');
    expect(service.allow('w-c')).toBe(true);
    expect(service.authorizeWithToken(paired.token, { installationId: 'i-c', workerId: 'w-c', username: 'C' }).ok).toBe(true);
  });

  it('refuses a token presented from a different installation', () => {
    const paired = service.authorizeWithCode(service.createCode().code, { installationId: 'i-orig', workerId: 'w-orig', username: 'D' });
    if (!paired.ok) throw new Error('expected pairing to succeed');
    const stolen = service.authorizeWithToken(paired.token, { installationId: 'i-other', workerId: 'w-other', username: 'X' });
    expect(stolen.ok).toBe(false);
  });

  it('accepts the host-local shared secret without recording a worker token', () => {
    const outcome = service.authorizeWithToken('host-local-secret', { installationId: '', workerId: 'app-1', username: 'App' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.workerId).toBe('app-1');
    expect(tokens.list()).toHaveLength(0);
  });

  it('refuses an unknown token', () => {
    const outcome = service.authorizeWithToken('nope', { installationId: '', workerId: '', username: '' });
    expect(outcome.ok).toBe(false);
  });

  it('reports status with the live code, its life and the paired workers, newest first', () => {
    service.authorizeWithCode(service.createCode().code, { installationId: 'i-1', workerId: 'w-1', username: 'One' });
    const code = service.createCode();
    const status = service.status();
    expect(status.code?.code).toBe(code.code);
    expect(status.secondsRemaining).toBeGreaterThan(0);
    expect(status.workers).toHaveLength(1);
    expect(status.workers[0].workerId).toBe('w-1');
  });

  it('revokeAll revokes every paired worker', () => {
    service.authorizeWithCode(service.createCode().code, { installationId: 'i-1', workerId: 'w-1', username: 'One' });
    service.authorizeWithCode(service.createCode().code, { installationId: 'i-2', workerId: 'w-2', username: 'Two' });
    expect(service.revokeAll()).toBe(2);
    expect(service.list().every((w) => w.revoked)).toBe(true);
  });

  it('never exposes the token in a listed view', () => {
    const paired = service.authorizeWithCode(service.createCode().code, { installationId: 'i-1', workerId: 'w-1', username: 'One' });
    if (!paired.ok) throw new Error('expected pairing to succeed');
    const view = service.list()[0] as unknown as Record<string, unknown>;
    expect(view.token).toBeUndefined();
    expect(JSON.stringify(service.list())).not.toContain(paired.token);
  });

  it('emits a pairing event when a worker joins', () => {
    service.authorizeWithCode(service.createCode().code, { installationId: 'i-1', workerId: 'w-1', username: 'One' });
    expect(events.some((e) => e.startsWith('WORKER_PAIRED'))).toBe(true);
  });
});
