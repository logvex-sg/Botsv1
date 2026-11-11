/**
 * AI-planner tests: intent recognition, plan expansion, permission checks, the destructive
 * confirmation, and honest reporting of interrupted operations.
 */
import { describe, expect, it } from 'vitest';
import { knownIntents, plan, preview, report, type PlanContext } from '../../src/main/packages/ai-planner';
import type { Grant } from '../../src/main/packages/permissions';

const admin: PlanContext = { grant: { subject: 'admin', level: 'administer' } };
const viewer: PlanContext = { grant: { subject: 'viewer', level: 'view' } };
const sorter: PlanContext = { grant: { subject: 'sorter', level: 'sort' } };

describe('plan', () => {
  it('expands a sort request into ordered, verified steps', () => {
    const result = plan('organize my entire storage', admin);
    expect(result.intent).toBe('storage.sort');
    expect(result.executable).toBe(true);
    expect(result.steps.map((step) => step.operation)).toEqual(['inspect', 'sort', 'verify']);
  });

  it('extracts a query from a find request', () => {
    const result = plan('find all diamonds', admin);
    expect(result.intent).toBe('storage.find');
    expect(result.query).toBe('diamonds');
    expect(result.steps).toHaveLength(1);
  });

  it('plans a shulker unload with a verification step', () => {
    const result = plan('empty my shulkers', admin);
    expect(result.intent).toBe('shulker.empty');
    expect(result.steps.some((step) => step.operation === 'shulker.unload')).toBe(true);
    expect(result.steps.at(-1)?.operation).toBe('verify');
  });

  it('refuses an instruction it does not understand, without inventing an action', () => {
    const result = plan('please make me a sandwich', admin);
    expect(result.intent).toBeNull();
    expect(result.steps).toEqual([]);
    expect(result.executable).toBe(false);
    expect(result.note).toMatch(/don't recognise|do not recognise/i);
  });

  it('blocks a plan whose steps need a level the subject lacks', () => {
    const result = plan('organize my entire storage', viewer);
    expect(result.executable).toBe(false);
    expect(result.steps[1]?.authorised).toBe(false);
    expect(result.note).toContain('Blocked');
  });

  it('marks a destructive plan as needing confirmation', () => {
    const result = plan('remove obsolete portals', admin);
    expect(result.intent).toBe('portal.cleanup');
    expect(result.needsConfirmation).toBe(true);
    expect(result.steps.some((step) => step.operation === 'portal.remove' && step.destructive)).toBe(true);
  });

  it('checks a protected target object and blocks it', () => {
    const context: PlanContext = {
      grant: { subject: 'maint', level: 'maintenance' },
      targets: { 'portal.remove': { kind: 'region', id: 'r1', protected: true } },
    };
    const result = plan('remove obsolete portals', context);
    const removeStep = result.steps.find((step) => step.operation === 'portal.remove');
    expect(removeStep?.authorised).toBe(false);
    expect(removeStep?.blockedReason).toContain('protected');
  });

  it('reports a confidence for a recognised intent', () => {
    const result = plan('restock my building inventory', admin);
    expect(result.intent).toBe('restock');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('recognises a structure audit request', () => {
    const result = plan('check my registered structures', admin);
    expect(result.intent).toBe('structure.audit');
    expect(result.steps[0]?.system).toBe('structure');
    expect(result.executable).toBe(true);
  });
});

describe('preview', () => {
  it('lists every step with its authorisation state', () => {
    const allowed = preview(plan('organize my entire storage', sorter));
    expect(allowed).toHaveLength(3);
    expect(allowed.every((line) => line.authorised)).toBe(true);
    expect(allowed[0]?.summary).toContain('Inspect');

    const blocked = preview(plan('organize my entire storage', viewer));
    expect(blocked.some((line) => !line.authorised)).toBe(true);
  });
});

describe('report', () => {
  const result = plan('organize my entire storage', admin);

  it('reports completion when every step succeeded', () => {
    const outcomes = result.steps.map((step) => ({ stepId: step.id, ok: true, detail: '' }));
    const summary = report(result, outcomes);
    expect(summary.completed).toBe(true);
    expect(summary.succeeded).toHaveLength(3);
    expect(summary.failed).toEqual([]);
  });

  it('stops after a failure and skips the rest', () => {
    const outcomes = [
      { stepId: result.steps[0]!.id, ok: true, detail: '' },
      { stepId: result.steps[1]!.id, ok: false, detail: 'destination full' },
    ];
    const summary = report(result, outcomes);
    expect(summary.completed).toBe(false);
    expect(summary.failed[0]?.detail).toBe('destination full');
    expect(summary.skipped).toEqual([result.steps[2]!.id]);
    expect(summary.summary).toContain('not run');
  });

  it('treats a step with no reported outcome as skipped, not failed', () => {
    const summary = report(result, [{ stepId: result.steps[0]!.id, ok: true, detail: '' }]);
    expect(summary.failed).toEqual([]);
    expect(summary.skipped).toEqual([result.steps[1]!.id, result.steps[2]!.id]);
    expect(summary.completed).toBe(false);
  });
});

describe('knownIntents', () => {
  it('lists the recognised intents', () => {
    const intents = knownIntents();
    expect(intents.length).toBeGreaterThan(5);
    expect(intents.map((intent) => intent.id)).toContain('storage.sort');
  });
});
