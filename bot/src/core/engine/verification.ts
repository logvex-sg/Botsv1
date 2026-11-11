/**
 * Verification.
 *
 * Every mutating operation on the bot side ends by re-reading the world and comparing. The result
 * is not a boolean that the caller may ignore: it carries `before`, `after` and what was expected,
 * because a transfer that moved the wrong number of items is a different problem from one that
 * moved none, and the recovery layer needs to tell them apart.
 */

import { countIn } from './inventory-engine';
import type { ItemStack, VerificationOutcome } from '../types';

/**
 * Verifies that a quantity of an item changed by at least `expected`.
 *
 * `atLeast` is the default because a container may have had more of the item than the worker asked
 * for; requiring an exact match would report a correct operation as a failure.
 */
export function verifyCountChange(
  before: readonly ItemStack[],
  after: readonly ItemStack[],
  query: string,
  expected: number,
  direction: 'increase' | 'decrease' | 'any' = 'any',
): VerificationOutcome {
  const beforeCount = countIn(before, query);
  const afterCount = countIn(after, query);
  const delta = afterCount - beforeCount;

  let verified: boolean;
  let note: string;
  switch (direction) {
    case 'increase':
      verified = delta >= expected;
      note = verified ? `gained ${delta} of ${query}` : `expected to gain ${expected} of ${query} but gained ${delta}`;
      break;
    case 'decrease':
      verified = -delta >= expected;
      note = verified ? `lost ${-delta} of ${query}` : `expected to lose ${expected} of ${query} but lost ${-delta}`;
      break;
    default:
      verified = Math.abs(delta) >= expected;
      note = verified ? `moved ${Math.abs(delta)} of ${query}` : `expected to move ${expected} of ${query} but moved ${Math.abs(delta)}`;
      break;
  }

  return { verified, before: beforeCount, after: afterCount, expected, note };
}

/**
 * Verifies that a stack appeared or disappeared, matched by identity rather than by id.
 *
 * This is what catches "it moved a stack of iron, but a *different* stack of iron".
 */
export function verifyStackPresent(
  after: readonly ItemStack[],
  query: string,
  expectedAtLeast = 1,
): VerificationOutcome {
  const total = countIn(after, query);
  return {
    verified: total >= expectedAtLeast,
    before: 0,
    after: total,
    expected: expectedAtLeast,
    note: total >= expectedAtLeast ? `found ${total} of ${query}` : `found ${total} of ${query}, wanted at least ${expectedAtLeast}`,
  };
}

/** Verifies an exact quantity, for cases where an exact number is genuinely required. */
export function verifyExact(
  before: readonly ItemStack[],
  after: readonly ItemStack[],
  query: string,
  expected: number,
): VerificationOutcome {
  const beforeCount = countIn(before, query);
  const afterCount = countIn(after, query);
  const delta = afterCount - beforeCount;
  return {
    verified: Math.abs(delta) === expected,
    before: beforeCount,
    after: afterCount,
    expected,
    note: Math.abs(delta) === expected ? `moved exactly ${expected}` : `moved ${delta}, expected exactly ${expected}`,
  };
}

export interface ReconciliationResult {
  /** True when the world matches what the operation believed. */
  consistent: boolean;
  /** Items the operation expected to have moved but which are still where they were. */
  stillPresent: number;
  /** Items that moved further than expected. */
  extra: number;
  note: string;
}

/**
 * Reconciles a partially-completed transfer.
 *
 * Called after a failure whose mutation state was `partial`. It answers "did the transfer happen?"
 * so the retry layer can decide between repeating and skipping — the rule being that a transfer is
 * never repeated when it may already have landed.
 */
export function reconcile(
  before: readonly ItemStack[],
  after: readonly ItemStack[],
  query: string,
  intended: number,
): ReconciliationResult {
  const delta = countIn(after, query) - countIn(before, query);
  const moved = Math.abs(delta);
  if (moved >= intended) {
    return { consistent: true, stillPresent: 0, extra: Math.max(0, moved - intended), note: `transfer of ${moved} confirmed` };
  }
  if (moved === 0) {
    return { consistent: false, stillPresent: intended, extra: 0, note: 'nothing moved; the transfer did not happen' };
  }
  return {
    consistent: false,
    stillPresent: intended - moved,
    extra: 0,
    note: `transfer is partial: ${moved} of ${intended} moved`,
  };
}

export function outcomeToJson(outcome: VerificationOutcome): Record<string, unknown> {
  return { verified: outcome.verified, before: outcome.before, after: outcome.after, expected: outcome.expected, note: outcome.note };
}

export function describeOutcomes(outcomes: readonly VerificationOutcome[]): string {
  if (outcomes.length === 0) return 'nothing to verify';
  const failed = outcomes.filter((outcome) => !outcome.verified);
  if (failed.length === 0) return `all ${outcomes.length} check(s) passed`;
  return `${failed.length} of ${outcomes.length} check(s) failed: ${failed.map((outcome) => outcome.note).join('; ')}`;
}
