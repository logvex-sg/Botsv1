/**
 * Rule engine tests: matching, cooldowns, run limits and evaluation.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  matches,
  matchesCondition,
  mayFire,
  readPath,
  type RuleDefinition,
} from '../../src/main/packages/rule-engine';

function rule(partial: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    id: 'r1', name: 'On join', enabled: true, event: 'WORKER_REGISTERED',
    conditions: [], action: 'inventory', cooldownMs: 0, maxRuns: null, ...partial,
  };
}

describe('readPath', () => {
  it('reads a nested field', () => {
    expect(readPath({ worker: { username: 'Steve' } }, 'worker.username')).toBe('Steve');
  });
  it('returns undefined for a missing path', () => {
    expect(readPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
});

describe('matchesCondition', () => {
  const payload = { worker: { username: 'Steve' }, count: 5 };
  it('compares strings for eq/neq', () => {
    expect(matchesCondition(payload, { field: 'worker.username', operator: 'eq', value: 'Steve' })).toBe(true);
    expect(matchesCondition(payload, { field: 'worker.username', operator: 'neq', value: 'Alex' })).toBe(true);
  });
  it('does case-insensitive contains', () => {
    expect(matchesCondition(payload, { field: 'worker.username', operator: 'contains', value: 'teve' })).toBe(true);
  });
  it('compares numbers for gt/lt', () => {
    expect(matchesCondition(payload, { field: 'count', operator: 'gt', value: '3' })).toBe(true);
    expect(matchesCondition(payload, { field: 'count', operator: 'lt', value: '3' })).toBe(false);
  });
  it('fails eq for a missing field but passes neq', () => {
    expect(matchesCondition(payload, { field: 'missing', operator: 'eq', value: '' })).toBe(true);
    expect(matchesCondition(payload, { field: 'missing', operator: 'eq', value: 'x' })).toBe(false);
  });
});

describe('matches', () => {
  const event = { type: 'WORKER_REGISTERED', payload: { worker: { username: 'Steve' } } };

  it('requires the event name to match exactly', () => {
    expect(matches(rule(), event)).toBe(true);
    expect(matches(rule({ event: 'OTHER' }), event)).toBe(false);
  });

  it('requires every condition (AND)', () => {
    const both = rule({ conditions: [
      { field: 'worker.username', operator: 'eq', value: 'Steve' },
      { field: 'worker.username', operator: 'contains', value: 'tev' },
    ] });
    expect(matches(both, event)).toBe(true);
    const failsOne = rule({ conditions: [
      { field: 'worker.username', operator: 'eq', value: 'Steve' },
      { field: 'worker.username', operator: 'eq', value: 'Alex' },
    ] });
    expect(matches(failsOne, event)).toBe(false);
  });

  it('never matches a disabled rule', () => {
    expect(matches(rule({ enabled: false }), event)).toBe(false);
  });
});

describe('mayFire', () => {
  it('blocks after the run limit is reached', () => {
    expect(mayFire(rule({ maxRuns: 2 }), { runCount: 2, lastRunAt: null }, 0).fire).toBe(false);
  });
  it('blocks during a cooldown and allows after it', () => {
    const r = rule({ cooldownMs: 1_000 });
    expect(mayFire(r, { runCount: 1, lastRunAt: 1_000 }, 1_500).fire).toBe(false);
    expect(mayFire(r, { runCount: 1, lastRunAt: 1_000 }, 2_100).fire).toBe(true);
  });
});

describe('evaluate', () => {
  const event = { type: 'WORKER_REGISTERED', payload: { worker: { username: 'Steve' } } };

  it('separates matched, fired and blocked', () => {
    const rules = [
      rule({ id: 'a' }),
      rule({ id: 'b', cooldownMs: 10_000 }),
    ];
    const result = evaluate(rules, { b: { runCount: 1, lastRunAt: 9_500 } }, event, 10_000);
    expect(result.matched.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result.fired.map((r) => r.id)).toEqual(['a']);
    expect(result.blocked[0].ruleId).toBe('b');
  });

  it('fires a rule with no prior runtime', () => {
    const result = evaluate([rule()], {}, event);
    expect(result.fired.length).toBe(1);
  });
});
