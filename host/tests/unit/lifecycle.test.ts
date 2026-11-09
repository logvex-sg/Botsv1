/**
 * Lifecycle package tests: transition legality and effective-state derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  acceptsMutating,
  canTransition,
  deriveState,
  describe as describeState,
  isConnected,
  isDown,
  type LifecycleState,
} from '../../src/main/packages/lifecycle';

describe('canTransition', () => {
  it('allows the normal bring-up path', () => {
    expect(canTransition('UNREGISTERED', 'PAIRING')).toBe(true);
    expect(canTransition('PAIRING', 'CONNECTING')).toBe(true);
    expect(canTransition('CONNECTING', 'ONLINE')).toBe(true);
  });

  it('refuses a jump straight from unregistered to busy', () => {
    expect(canTransition('UNREGISTERED', 'BUSY')).toBe(false);
  });

  it('treats a self-transition as legal (idempotent updates)', () => {
    expect(canTransition('ONLINE', 'ONLINE')).toBe(true);
  });

  it('lets an unresponsive worker come back or drop', () => {
    expect(canTransition('UNRESPONSIVE', 'ONLINE')).toBe(true);
    expect(canTransition('UNRESPONSIVE', 'DISCONNECTED')).toBe(true);
  });
});

describe('state predicates', () => {
  const connected: LifecycleState[] = ['ONLINE', 'IDLE', 'BUSY', 'PAUSED', 'UNRESPONSIVE'];
  const down: LifecycleState[] = ['DISCONNECTED', 'ERROR', 'INCOMPATIBLE', 'UNREGISTERED', 'RECONNECTING'];

  it('classifies every connected state', () => {
    for (const state of connected) expect(isConnected(state)).toBe(true);
  });

  it('classifies every down state', () => {
    for (const state of down) expect(isDown(state)).toBe(true);
  });

  it('only allows mutating tasks when online and idle', () => {
    expect(acceptsMutating('ONLINE')).toBe(true);
    expect(acceptsMutating('IDLE')).toBe(true);
    expect(acceptsMutating('BUSY')).toBe(false);
    expect(acceptsMutating('PAUSED')).toBe(false);
    expect(acceptsMutating('UNRESPONSIVE')).toBe(false);
  });
});

describe('deriveState', () => {
  const base = {
    state: 'ONLINE' as LifecycleState,
    lastHeartbeatAt: 1_000,
    now: 1_100,
    heartbeatTimeoutMs: 30_000,
    busy: false,
    paused: false,
  };

  it('reports a silent-but-connected worker as unresponsive, not disconnected', () => {
    expect(deriveState({ ...base, now: 100_000 })).toBe('UNRESPONSIVE');
  });

  it('reports a paused worker as paused', () => {
    expect(deriveState({ ...base, paused: true })).toBe('PAUSED');
  });

  it('reports an in-flight task as busy', () => {
    expect(deriveState({ ...base, busy: true })).toBe('BUSY');
  });

  it('does not fabricate a connected state for a down worker', () => {
    expect(deriveState({ ...base, state: 'DISCONNECTED' })).toBe('DISCONNECTED');
  });

  it('recovers to online when the heartbeat resumes', () => {
    expect(deriveState({ ...base, state: 'UNRESPONSIVE', now: 1_200 })).toBe('ONLINE');
  });
});

describe('describe', () => {
  it('gives every state a non-empty plain-language label', () => {
    const states: LifecycleState[] = [
      'UNREGISTERED', 'PAIRING', 'CONNECTING', 'ONLINE', 'IDLE', 'BUSY', 'PAUSED',
      'UNRESPONSIVE', 'RECONNECTING', 'DISCONNECTED', 'ERROR', 'INCOMPATIBLE',
    ];
    for (const state of states) expect(describeState(state).length).toBeGreaterThan(0);
  });
});
