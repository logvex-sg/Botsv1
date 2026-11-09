/**
 * Protocol package tests: version negotiation and outbound/inbound frame validation.
 */
import { describe, expect, it } from 'vitest';
import { acceptInbound, negotiate, validateOutbound, encodeEnvelope } from '../../src/main/packages/protocol';

describe('negotiate', () => {
  it('accepts the current version', () => {
    expect(negotiate(3, 3)).toEqual({ ok: true, version: 3 });
  });

  it('accepts one version back (within the window)', () => {
    expect(negotiate(2, 3).ok).toBe(true);
  });

  it('refuses a worker that is too far behind', () => {
    const outcome = negotiate(1, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('too-old');
  });

  it('refuses a worker ahead of the host so a newer payload is never mis-read', () => {
    const outcome = negotiate(4, 3);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('too-new');
  });

  it('refuses a missing or non-numeric version', () => {
    expect(negotiate(undefined).ok).toBe(false);
    expect(negotiate('3').ok).toBe(false);
    expect(negotiate(0).ok).toBe(false);
  });
});

describe('validateOutbound', () => {
  it('accepts a task with a known kind', () => {
    const result = validateOutbound({ v: 3, type: 'task', id: 't1', payload: { kind: 'inventory' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.taskKind).toBe('inventory');
  });

  it('refuses a task with an unknown kind (the security boundary)', () => {
    const result = validateOutbound({ v: 3, type: 'task', payload: { kind: 'exec' } });
    expect(result.ok).toBe(false);
  });

  it('accepts a control with a known action', () => {
    const result = validateOutbound({ v: 3, type: 'control', payload: { action: 'pause' } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.controlAction).toBe('pause');
  });

  it('refuses a control with an unknown action', () => {
    expect(validateOutbound({ v: 3, type: 'control', payload: { action: 'rm-rf' } }).ok).toBe(false);
  });

  it('accepts a ping with no payload requirements', () => {
    expect(validateOutbound({ v: 3, type: 'ping' }).ok).toBe(true);
  });
});

describe('acceptInbound', () => {
  it('decodes and negotiates a well-formed status frame', () => {
    const raw = encodeEnvelope({ v: 3, type: 'status', payload: { workerId: 'w1' } });
    const result = acceptInbound(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.kind).toBe('other');
  });

  it('drops a frame that is not valid JSON', () => {
    expect(acceptInbound('not json').ok).toBe(false);
  });

  it('drops a frame from a peer ahead of the host', () => {
    const raw = encodeEnvelope({ v: 99, type: 'status' });
    const result = acceptInbound(raw);
    expect(result.ok).toBe(false);
  });
});
