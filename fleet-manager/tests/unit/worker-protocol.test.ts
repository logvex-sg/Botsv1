/**
 * Worker protocol unit tests.
 *
 * The envelope decoder is the host's only defence against a malformed or hostile frame from a
 * remote client, so it is tested directly and hard: anything that is not a well-formed object with a
 * string type must be dropped, and no input may throw.
 */
import { describe, expect, it } from 'vitest';
import {
  WORKER_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  emptySnapshot,
  isTaskKind,
  TASK_KINDS,
} from '../../src/shared/workers';

describe('envelope decoding', () => {
  it('round-trips a well-formed envelope', () => {
    const envelope = { v: WORKER_PROTOCOL_VERSION, type: 'status', id: 'abc', payload: { health: 20 } };
    expect(decodeEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
  });

  it('drops input that is not JSON', () => {
    expect(decodeEnvelope('{not json')).toBeNull();
    expect(decodeEnvelope('')).toBeNull();
    expect(decodeEnvelope('undefined')).toBeNull();
  });

  it('drops JSON that is not an object', () => {
    expect(decodeEnvelope('null')).toBeNull();
    expect(decodeEnvelope('42')).toBeNull();
    expect(decodeEnvelope('"status"')).toBeNull();
    expect(decodeEnvelope('[]')).toBeNull();
  });

  it('drops an object with no usable type', () => {
    expect(decodeEnvelope('{}')).toBeNull();
    expect(decodeEnvelope('{"type":123}')).toBeNull();
    expect(decodeEnvelope('{"type":""}')).toBeNull();
  });

  it('defaults a missing version and normalises a missing payload', () => {
    const decoded = decodeEnvelope('{"type":"status"}');
    expect(decoded?.v).toBe(WORKER_PROTOCOL_VERSION);
    expect(decoded?.payload).toEqual({});
    expect(decoded?.id).toBeNull();
  });

  it('replaces a non-object payload with an empty one rather than trusting it', () => {
    expect(decodeEnvelope('{"type":"status","payload":"oops"}')?.payload).toEqual({});
    expect(decodeEnvelope('{"type":"status","payload":[1,2]}')?.payload).toEqual({});
  });
});

describe('task kinds', () => {
  it('accepts every advertised kind', () => {
    for (const kind of TASK_KINDS) expect(isTaskKind(kind)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTaskKind('rm-rf')).toBe(false);
    expect(isTaskKind('')).toBe(false);
    expect(isTaskKind('Status')).toBe(false);
  });
});

describe('empty snapshot', () => {
  it('is inert and carries no capabilities', () => {
    const snapshot = emptySnapshot('w-1');
    expect(snapshot.workerId).toBe('w-1');
    expect(snapshot.inWorld).toBe(false);
    expect(snapshot.capabilities).toEqual([]);
  });
});
