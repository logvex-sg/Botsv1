/**
 * Telemetry tests: metrics with defined sources, and the "no data is not zero" rule.
 */
import { describe, expect, it } from 'vitest';
import {
  availability,
  averageDuration,
  completionRate,
  failureRate,
  histogram,
} from '../../src/main/packages/telemetry';

describe('completionRate / failureRate', () => {
  it('returns null (not zero) when no task has finished', () => {
    expect(completionRate([{ ok: true, durationMs: null, createdAt: 0 }]).value).toBeNull();
    expect(failureRate([]).value).toBeNull();
  });

  it('computes rates over finished tasks only', () => {
    const tasks = [
      { ok: true, durationMs: 100, createdAt: 0 },
      { ok: true, durationMs: 200, createdAt: 0 },
      { ok: false, durationMs: 300, createdAt: 0 },
      { ok: true, durationMs: null, createdAt: 0 },
    ];
    expect(completionRate(tasks).value).toBeCloseTo(2 / 3);
    expect(failureRate(tasks).value).toBeCloseTo(1 / 3);
  });
});

describe('averageDuration', () => {
  it('averages only reported durations', () => {
    expect(averageDuration([
      { ok: true, durationMs: 100, createdAt: 0 },
      { ok: true, durationMs: 300, createdAt: 0 },
      { ok: false, durationMs: null, createdAt: 0 },
    ]).value).toBe(200);
  });

  it('is null with no durations', () => {
    expect(averageDuration([{ ok: true, durationMs: null, createdAt: 0 }]).value).toBeNull();
  });
});

describe('availability', () => {
  it('sums connected time over the window', () => {
    const result = availability([
      { workerId: 'a', connectedMs: 50_000, windowMs: 100_000 },
      { workerId: 'b', connectedMs: 100_000, windowMs: 100_000 },
    ]);
    expect(result.value).toBeCloseTo(0.75);
  });

  it('clamps connected time to the window', () => {
    expect(availability([{ workerId: 'a', connectedMs: 500_000, windowMs: 100_000 }]).value).toBe(1);
  });

  it('is null with no workers', () => {
    expect(availability([]).value).toBeNull();
  });
});

describe('histogram', () => {
  it('buckets timestamps and includes empty buckets as zero', () => {
    const now = 10_000;
    // The window spans [5000, 10000). Both 9500 and 9600 land in the last bucket; 6000 lands in
    // the second, leaving the first empty.
    const buckets = histogram([9_500, 9_600, 6_000], 1_000, 5, now);
    expect(buckets.length).toBe(5);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    expect(buckets[0].count).toBe(0);
    expect(buckets[1].count).toBe(1);
    expect(buckets[4].count).toBe(2);
  });

  it('ignores events outside the window', () => {
    const buckets = histogram([0], 1_000, 5, 10_000);
    expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(0);
  });
});
