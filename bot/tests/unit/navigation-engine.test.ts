import { describe, expect, it } from 'vitest';
import {
  blockKey,
  distance3D,
  distanceBetween,
  horizontalDistance,
  orderWaypoints,
  planNavigation,
  planRecovery,
  sameBlock,
  type NavigationLimitsView,
} from '../../src/core/engine/navigation-engine';

const limits: NavigationLimitsView = {
  maxDistance: 100,
  timeoutMs: 10_000,
  allowDigging: true,
  allowPlacing: false,
};

describe('distances', () => {
  it('computes straight-line distance', () => {
    expect(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
    expect(distance3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })).toBe(5);
  });

  it('ignores the vertical axis for horizontal distance', () => {
    expect(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 100, z: 4 })).toBe(5);
  });
});

describe('planNavigation', () => {
  it('is trivial when already within range', () => {
    const plan = planNavigation({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, limits);
    expect(plan.trivial).toBe(true);
    expect(plan.allowed).toBe(true);
    expect(plan.reason).toBe('already within range');
  });

  it('refuses a destination beyond maxDistance with a reason naming the limit', () => {
    const plan = planNavigation({ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }, limits);
    expect(plan.allowed).toBe(false);
    expect(plan.trivial).toBe(false);
    expect(plan.reason).toContain('200 blocks away');
    expect(plan.reason).toContain('100-block limit');
  });

  it('allows a destination within maxDistance', () => {
    const plan = planNavigation({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, limits);
    expect(plan.allowed).toBe(true);
    expect(plan.reason).toBe('path of 30 blocks');
    expect(plan.distance).toBe(30);
  });

  it('clamps the timeout by the limit', () => {
    const plan = planNavigation({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, limits, { timeoutMs: 99_999 });
    expect(plan.timeoutMs).toBe(10_000);

    const shorter = planNavigation({ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, limits, { timeoutMs: 2_000 });
    expect(shorter.timeoutMs).toBe(2_000);
  });

  it('honours a custom range for the trivial check', () => {
    const plan = planNavigation({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, limits, { range: 5 });
    expect(plan.trivial).toBe(true);
  });
});

describe('planRecovery', () => {
  it('gives up on a cancelled walk', () => {
    const step = planRecovery('cancelled', 1);
    expect(step.action).toBe('give-up');
    expect(step.reason).toContain('cancelled');
    expect(step.delayMs).toBe(0);
  });

  it('gives up once the attempt count reaches three', () => {
    const step = planRecovery('timeout', 3);
    expect(step.action).toBe('give-up');
    expect(step.reason).toContain('after 3 attempts');
  });

  it('produces distinct actions and delays for timeout, stuck and unreachable', () => {
    expect(planRecovery('timeout', 1)).toEqual({ action: 'repath', reason: 'the path timed out', delayMs: 500 });
    expect(planRecovery('stuck', 1)).toEqual({ action: 'jump', reason: 'the worker stopped making progress', delayMs: 300 });
    expect(planRecovery('unreachable', 1).action).toBe('repath');
    expect(planRecovery('unreachable', 2).action).toBe('give-up');
  });

  it('escalates actions on the second attempt', () => {
    expect(planRecovery('timeout', 2)).toEqual({ action: 'retry', reason: 'the path timed out', delayMs: 1_000 });
    expect(planRecovery('stuck', 2)).toEqual({ action: 'repath', reason: 'the worker stopped making progress', delayMs: 600 });
  });

  it('retries an interrupted walk with a scaled delay', () => {
    expect(planRecovery('interrupted', 2)).toEqual({ action: 'retry', reason: 'the walk was interrupted', delayMs: 1_500 });
  });

  it('retries an unknown failure with a scaled delay', () => {
    expect(planRecovery('unknown', 2).delayMs).toBe(1_000);
  });
});

describe('orderWaypoints', () => {
  it('orders waypoints nearest-first greedily from the start', () => {
    const ordered = orderWaypoints({ x: 0, y: 0, z: 0 }, [
      { position: { x: 30, y: 0, z: 0 }, label: 'far' },
      { position: { x: 5, y: 0, z: 0 }, label: 'near' },
      { position: { x: 10, y: 0, z: 0 }, label: 'mid' },
    ]);
    expect(ordered.map((waypoint) => waypoint.label)).toEqual(['near', 'mid', 'far']);
  });

  it('re-anchors the next pick on the last visited waypoint', () => {
    // From the origin, A(1,0,0) is nearest; from A, B(2,0,0) is nearer than C(0,0,50).
    const ordered = orderWaypoints({ x: 0, y: 0, z: 0 }, [
      { position: { x: 0, y: 0, z: 50 }, label: 'C' },
      { position: { x: 2, y: 0, z: 0 }, label: 'B' },
      { position: { x: 1, y: 0, z: 0 }, label: 'A' },
    ]);
    expect(ordered.map((waypoint) => waypoint.label)).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty list for no waypoints', () => {
    expect(orderWaypoints({ x: 0, y: 0, z: 0 }, [])).toEqual([]);
  });
});

describe('sameBlock / blockKey', () => {
  it('treats fractional positions within a block as the same block', () => {
    expect(sameBlock({ x: 1.2, y: 2.9, z: 3.0 }, { x: 1.8, y: 2.1, z: 3.5 })).toBe(true);
    expect(sameBlock({ x: 1.9, y: 0, z: 0 }, { x: 2.0, y: 0, z: 0 })).toBe(false);
  });

  it('builds a floor-based block key', () => {
    expect(blockKey({ x: 1.9, y: -0.1, z: 3.5 })).toBe('1,-1,3');
  });
});
