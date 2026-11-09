/**
 * Scheduler tests: due calculation, duplicate-run protection and missed-run counting.
 */
import { describe, expect, it } from 'vitest';
import {
  initialState,
  isDue,
  markFired,
  missedRuns,
  parseTimeOfDay,
  type Schedule,
} from '../../src/main/packages/scheduler';

const DAY = 86_400_000;

describe('parseTimeOfDay', () => {
  it('parses a valid HH:MM', () => {
    expect(parseTimeOfDay('09:30')).toBe(9 * 60 + 30);
    expect(parseTimeOfDay('00:00')).toBe(0);
    expect(parseTimeOfDay('23:59')).toBe(23 * 60 + 59);
  });

  it('rejects malformed or out-of-range times', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('9:5')).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
  });
});

describe('once', () => {
  const schedule: Schedule = { kind: 'once', startAt: 1_000 };

  it('is not due before its start', () => {
    expect(isDue(schedule, initialState(), 500).due).toBe(false);
  });

  it('is due at its start and never again after firing', () => {
    expect(isDue(schedule, initialState(), 1_000).due).toBe(true);
    const fired = markFired(initialState(), 1_000);
    expect(isDue(schedule, fired, 2_000).due).toBe(false);
  });
});

describe('interval', () => {
  const schedule: Schedule = { kind: 'interval', startAt: 0, intervalMs: 1_000 };

  it('is due at each boundary and reports the slot', () => {
    expect(isDue(schedule, initialState(), 1_000)).toEqual({ due: true, slot: 1_000 });
  });

  it('does not fire twice for the same slot even after a restart', () => {
    const fired = markFired(initialState(), 1_000);
    expect(isDue(schedule, fired, 1_500).due).toBe(false);
    // A persisted state with the same slot must still suppress a re-fire.
    expect(isDue(schedule, { ...fired }, 1_999).due).toBe(false);
  });

  it('fires again on the next boundary', () => {
    const fired = markFired(initialState(), 1_000);
    expect(isDue(schedule, fired, 2_000).due).toBe(true);
  });

  it('respects a stop time', () => {
    const stopped: Schedule = { ...schedule, stopAt: 1_500 };
    expect(isDue(stopped, initialState(), 1_000).due).toBe(true);
    expect(isDue(stopped, initialState(), 2_000).due).toBe(false);
  });
});

describe('daily', () => {
  it('is not due before the configured time', () => {
    const now = new Date(2026, 0, 5, 8, 0).getTime();
    expect(isDue({ kind: 'daily', startAt: 0, timeOfDay: '09:00' }, initialState(), now).due).toBe(false);
  });

  it('is due at or after the time, once per day', () => {
    const schedule: Schedule = { kind: 'daily', startAt: 0, timeOfDay: '09:00' };
    const now = new Date(2026, 0, 5, 9, 30).getTime();
    const midnight = new Date(2026, 0, 5, 0, 0).getTime();
    expect(isDue(schedule, initialState(), now)).toEqual({ due: true, slot: midnight });
    const fired = markFired(initialState(), midnight);
    expect(isDue(schedule, fired, now).due).toBe(false);
    // Next day it is due again.
    expect(isDue(schedule, fired, midnight + DAY + 9 * 3_600_000).due).toBe(true);
  });
});

describe('disabled and missed', () => {
  it('never fires a disabled schedule', () => {
    const schedule: Schedule = { kind: 'interval', startAt: 0, intervalMs: 1_000 };
    expect(isDue(schedule, { ...initialState(), enabled: false }, 5_000).due).toBe(false);
  });

  it('counts occurrences missed while the host was down', () => {
    const schedule: Schedule = { kind: 'interval', startAt: 0, intervalMs: 1_000 };
    const fired = markFired(initialState(), 0);
    expect(missedRuns(schedule, fired, 5_000)).toBe(4);
  });

  it('reports no missed runs for a non-interval schedule', () => {
    expect(missedRuns({ kind: 'once', startAt: 0 }, initialState(), 1_000_000)).toBe(0);
  });
});
