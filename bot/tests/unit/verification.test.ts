import { describe, expect, it } from 'vitest';
import {
  describeOutcomes,
  outcomeToJson,
  reconcile,
  verifyCountChange,
  verifyExact,
  verifyStackPresent,
} from '../../src/core/engine/verification';
import type { ItemStack } from '../../src/core/types';

const diamond = (count: number): ItemStack => ({ id: 'minecraft:diamond', count });

describe('verifyCountChange', () => {
  it('verifies an increase when the gain meets the expectation', () => {
    const outcome = verifyCountChange([diamond(10)], [diamond(20)], 'diamond', 5, 'increase');
    expect(outcome.verified).toBe(true);
    expect(outcome.before).toBe(10);
    expect(outcome.after).toBe(20);
    expect(outcome.note).toBe('gained 10 of diamond');
  });

  it('fails an increase when the gain falls short, with an explanatory note', () => {
    const outcome = verifyCountChange([diamond(10)], [diamond(12)], 'diamond', 5, 'increase');
    expect(outcome.verified).toBe(false);
    expect(outcome.note).toBe('expected to gain 5 of diamond but gained 2');
  });

  it('verifies a decrease when the loss meets the expectation', () => {
    const outcome = verifyCountChange([diamond(20)], [diamond(10)], 'diamond', 5, 'decrease');
    expect(outcome.verified).toBe(true);
    expect(outcome.note).toBe('lost 10 of diamond');
  });

  it('fails a decrease when the loss falls short', () => {
    const outcome = verifyCountChange([diamond(20)], [diamond(19)], 'diamond', 5, 'decrease');
    expect(outcome.verified).toBe(false);
    expect(outcome.note).toBe('expected to lose 5 of diamond but lost 1');
  });

  it('verifies any direction on the absolute delta by default', () => {
    const gain = verifyCountChange([diamond(10)], [diamond(15)], 'diamond', 5);
    expect(gain.verified).toBe(true);
    expect(gain.note).toBe('moved 5 of diamond');

    const loss = verifyCountChange([diamond(15)], [diamond(10)], 'diamond', 5);
    expect(loss.verified).toBe(true);
    expect(loss.note).toBe('moved 5 of diamond');
  });

  it('fails "any" when the delta is too small', () => {
    const outcome = verifyCountChange([diamond(10)], [diamond(12)], 'diamond', 5, 'any');
    expect(outcome.verified).toBe(false);
    expect(outcome.note).toBe('expected to move 5 of diamond but moved 2');
  });
});

describe('verifyStackPresent', () => {
  it('passes when at least the expected quantity is present', () => {
    const outcome = verifyStackPresent([diamond(3)], 'diamond', 2);
    expect(outcome.verified).toBe(true);
    expect(outcome.before).toBe(0);
    expect(outcome.after).toBe(3);
    expect(outcome.note).toBe('found 3 of diamond');
  });

  it('fails when too little is present, with the wanted amount in the note', () => {
    const outcome = verifyStackPresent([diamond(1)], 'diamond', 2);
    expect(outcome.verified).toBe(false);
    expect(outcome.note).toBe('found 1 of diamond, wanted at least 2');
  });
});

describe('verifyExact', () => {
  it('passes on an exact move', () => {
    const outcome = verifyExact([diamond(10)], [diamond(7)], 'diamond', 3);
    expect(outcome.verified).toBe(true);
    expect(outcome.note).toBe('moved exactly 3');
  });

  it('fails on an inexact move', () => {
    const outcome = verifyExact([diamond(10)], [diamond(6)], 'diamond', 3);
    expect(outcome.verified).toBe(false);
    expect(outcome.note).toBe('moved -4, expected exactly 3');
  });
});

describe('reconcile', () => {
  it('confirms a full transfer and reports extra movement', () => {
    const result = reconcile([diamond(10)], [diamond(0)], 'diamond', 10);
    expect(result.consistent).toBe(true);
    expect(result.stillPresent).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.note).toBe('transfer of 10 confirmed');
  });

  it('treats a zero transfer as "did not happen"', () => {
    const result = reconcile([diamond(10)], [diamond(10)], 'diamond', 10);
    expect(result.consistent).toBe(false);
    expect(result.stillPresent).toBe(10);
    expect(result.note).toBe('nothing moved; the transfer did not happen');
  });

  it('reports a partial transfer', () => {
    const result = reconcile([diamond(10)], [diamond(4)], 'diamond', 10);
    expect(result.consistent).toBe(false);
    expect(result.stillPresent).toBe(4);
    expect(result.extra).toBe(0);
    expect(result.note).toBe('transfer is partial: 6 of 10 moved');
  });

  it('reports extra when more moved than intended', () => {
    const result = reconcile([diamond(0)], [diamond(15)], 'diamond', 10);
    expect(result.consistent).toBe(true);
    expect(result.extra).toBe(5);
  });
});

describe('describeOutcomes', () => {
  it('reports nothing to verify for an empty list', () => {
    expect(describeOutcomes([])).toBe('nothing to verify');
  });

  it('reports all passed when every check passes', () => {
    const outcomes = [
      verifyCountChange([diamond(1)], [diamond(2)], 'diamond', 1, 'increase'),
      verifyStackPresent([diamond(2)], 'diamond'),
    ];
    expect(describeOutcomes(outcomes)).toBe('all 2 check(s) passed');
  });

  it('lists the failing notes when some checks fail', () => {
    const outcomes = [
      verifyCountChange([diamond(1)], [diamond(1)], 'diamond', 1, 'increase'),
      verifyStackPresent([diamond(2)], 'diamond'),
    ];
    expect(describeOutcomes(outcomes)).toBe(
      '1 of 2 check(s) failed: expected to gain 1 of diamond but gained 0',
    );
  });
});

describe('outcomeToJson', () => {
  it('serialises the outcome fields', () => {
    const json = outcomeToJson(verifyCountChange([diamond(1)], [diamond(3)], 'diamond', 2, 'increase'));
    expect(json).toEqual({ verified: true, before: 1, after: 3, expected: 2, note: 'gained 2 of diamond' });
  });
});
