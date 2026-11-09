/**
 * Automation rule engine: WHEN <event> AND <conditions> THEN <action>.
 *
 * Rules are data, not scripts. A rule names an event, a small list of field comparisons, and the
 * task kind to dispatch. There is no expression language to escape and no way for a rule to run
 * arbitrary code, which is what keeps an operator-editable automation layer safe.
 *
 * The evaluation is pure and unit-testable: given an event and its payload, it says whether the
 * rule matches and, if so, what action to take. Cooldown and run-limit enforcement are applied here
 * too; the caller persists the run counters.
 */

export type ConditionOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt';

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  enabled: boolean;
  event: string;
  conditions: Condition[];
  action: string;
  cooldownMs: number;
  maxRuns: number | null;
}

/** Reads a dotted path out of a payload, e.g. `worker.username`. Returns undefined if absent. */
export function readPath(payload: Record<string, unknown>, path: string): unknown {
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Evaluates one condition. A missing field fails every comparison except `neq`. */
export function matchesCondition(payload: Record<string, unknown>, condition: Condition): boolean {
  const actual = readPath(payload, condition.field);
  const expected = condition.value;
  switch (condition.operator) {
    case 'eq': return String(actual ?? '') === expected;
    case 'neq': return String(actual ?? '') !== expected;
    case 'contains': return String(actual ?? '').toLowerCase().includes(expected.toLowerCase());
    case 'gt': return Number(actual) > Number(expected);
    case 'lt': return Number(actual) < Number(expected);
    default: return false;
  }
}

export interface RuleEvent {
  type: string;
  workerId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Whether a rule matches an event.
 *
 * The event name must match exactly and *every* condition must hold (AND). A disabled rule never
 * matches. This is the whole decision; nothing else is consulted.
 */
export function matches(rule: RuleDefinition, event: RuleEvent): boolean {
  if (!rule.enabled) return false;
  if (rule.event !== event.type) return false;
  return rule.conditions.every((condition) => matchesCondition(event.payload, condition));
}

export interface RuleRuntime {
  runCount: number;
  lastRunAt: number | null;
}

export type RuleDecision =
  | { fire: true; reason: string }
  | { fire: false; reason: string };

/**
 * Decides whether a matched rule should actually fire now, applying the cooldown and run limit.
 *
 * Kept separate from {@link matches} so "does this rule apply" and "may it run yet" are two clear
 * questions with two clear answers.
 */
export function mayFire(rule: RuleDefinition, runtime: RuleRuntime, now: number): RuleDecision {
  if (rule.maxRuns !== null && runtime.runCount >= rule.maxRuns) {
    return { fire: false, reason: `rule has already run ${runtime.runCount}/${rule.maxRuns} times` };
  }
  if (rule.cooldownMs > 0 && runtime.lastRunAt !== null && now - runtime.lastRunAt < rule.cooldownMs) {
    const remaining = rule.cooldownMs - (now - runtime.lastRunAt);
    return { fire: false, reason: `cooling down for another ${remaining}ms` };
  }
  return { fire: true, reason: 'rule matched and is not cooling down' };
}

export interface RuleEvaluation {
  /** The rules that matched the event. */
  matched: RuleDefinition[];
  /** The rules that matched and are allowed to fire now. */
  fired: RuleDefinition[];
  /** Why each matched-but-blocked rule did not fire, for the UI to show. */
  blocked: { ruleId: string; reason: string }[];
}

/** Evaluates every rule against one event. */
export function evaluate(
  rules: readonly RuleDefinition[],
  runtimes: Readonly<Record<string, RuleRuntime>>,
  event: RuleEvent,
  now = Date.now(),
): RuleEvaluation {
  const matched: RuleDefinition[] = [];
  const fired: RuleDefinition[] = [];
  const blocked: { ruleId: string; reason: string }[] = [];
  for (const rule of rules) {
    if (!matches(rule, event)) continue;
    matched.push(rule);
    const runtime = runtimes[rule.id] ?? { runCount: 0, lastRunAt: null };
    const decision = mayFire(rule, runtime, now);
    if (decision.fire) fired.push(rule);
    else blocked.push({ ruleId: rule.id, reason: decision.reason });
  }
  return { matched, fired, blocked };
}
