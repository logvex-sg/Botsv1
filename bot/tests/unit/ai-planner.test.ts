import { describe, expect, it } from 'vitest';
import { interpret } from '../../src/ai/interpret';
import { Planner, previewPlan, validatePlan } from '../../src/ai/planner';
import { isOperationId, knownOperations, operationById, OPERATIONS } from '../../src/ai/operations';
import type { AiProvider, ProviderRequest, ProviderResponse } from '../../src/ai/provider';
import type { Plan } from '../../src/ai/interpret';

const specInstructions: Array<{
  instruction: string;
  operation: string;
  expectArgs?: (args: Record<string, unknown>) => void;
}> = [
  {
    instruction: 'Sort the storage room.',
    operation: 'storage.sort',
  },
  {
    instruction: 'Find all diamonds.',
    operation: 'storage.search',
    expectArgs: (args) => expect(args.query).toBe('diamond'),
  },
  {
    instruction: 'Fill five building-material shulkers.',
    operation: 'shulker.fill',
    expectArgs: (args) => {
      expect(args.count).toBe(5);
      expect(args.category).toBe('building');
    },
  },
  {
    instruction: 'Restock the building supplies.',
    operation: 'restock.run',
  },
  {
    instruction: 'Move all iron into the mining storage.',
    operation: 'storage.move',
    expectArgs: (args) => expect(args.query).toBe('iron'),
  },
  {
    instruction: 'Find full chests.',
    operation: 'container.fullest',
  },
  {
    instruction: 'Inspect the registered portals.',
    operation: 'portal.scan',
  },
  {
    instruction: 'Assign an available Worker to storage maintenance.',
    operation: 'worker.assign',
    expectArgs: (args) => expect(args.task).toBe('maintenance.run'),
  },
];

describe('interpret (spec examples)', () => {
  for (const example of specInstructions) {
    it(`produces a non-empty plan for "${example.instruction}"`, () => {
      const plan = interpret(example.instruction);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0]!.operation).toBe(example.operation);
      expect(plan.confidence).toBeGreaterThanOrEqual(0.8);
      expect(plan.source).toBe('deterministic');
      expect(plan.reasoning).toContain(example.operation);
      expect(isOperationId(plan.steps[0]!.operation)).toBe(true);
      example.expectArgs?.(plan.steps[0]!.arguments as Record<string, unknown>);
    });
  }

  it('reports whether a plan mutates the world', () => {
    expect(interpret('Sort the storage room.').mutating).toBe(true);
    expect(interpret('Find all diamonds.').mutating).toBe(false);
  });

  it('marks an unrecognised instruction as no steps and low confidence, never guessing', () => {
    const plan = interpret('Please recalibrate the quantum flux capacitor.');
    expect(plan.steps).toEqual([]);
    expect(plan.confidence).toBeLessThanOrEqual(0.1);
    expect(plan.reasoning).toContain('no known operation matches');
  });

  it('returns nothing for an empty instruction', () => {
    const plan = interpret('   ');
    expect(plan.steps).toEqual([]);
    expect(plan.confidence).toBe(0);
    expect(plan.reasoning).toBe('empty instruction');
  });

  it('keeps every recognised operation inside the vocabulary', () => {
    const known = new Set<string>(knownOperations());
    for (const example of specInstructions) {
      const plan = interpret(example.instruction);
      for (const step of plan.steps) expect(known.has(step.operation)).toBe(true);
    }
  });
});

describe('operations vocabulary', () => {
  it('recognises known ids and rejects unknown ones', () => {
    expect(isOperationId('storage.sort')).toBe(true);
    expect(isOperationId('storage.sortt')).toBe(false);
    expect(isOperationId(42)).toBe(false);
    expect(operationById('shulker.fill')?.mutating).toBe(true);
  });

  it('has a unique id for every operation', () => {
    const ids = OPERATIONS.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('validatePlan', () => {
  it('rejects a step naming an unknown operation', () => {
    const plan: Plan = {
      instruction: 'do the impossible',
      steps: [{ operation: 'bogus.operation' as Plan['steps'][number]['operation'], arguments: {}, description: 'nope' }],
      source: 'model',
      confidence: 0.9,
      reasoning: 'model guess',
      mutating: true,
    };
    const validation = validatePlan(plan);
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain('unknown operation');
  });

  it('rejects an empty plan', () => {
    const plan: Plan = {
      instruction: 'nothing',
      steps: [],
      source: 'deterministic',
      confidence: 0.1,
      reasoning: 'no idea',
      mutating: false,
    };
    const validation = validatePlan(plan);
    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe('no idea');
  });

  it('accepts a plan built from real operations', () => {
    expect(validatePlan(interpret('Find all diamonds.')).ok).toBe(true);
  });
});

describe('previewPlan', () => {
  it('computes required permissions and requiresApproval for a mutating plan', () => {
    const preview = previewPlan(interpret('Sort the storage room.'), ['allowContainerMoves']);
    expect(preview.requiredPermissions).toEqual(['allowContainerMoves']);
    expect(preview.requiresApproval).toBe(true);
    expect(preview.mutating).toBe(true);
    expect(preview.summary).toContain('needs approval');
  });

  it('does not require approval for a read-only plan', () => {
    const preview = previewPlan(interpret('Find all diamonds.'));
    expect(preview.requiredPermissions).toEqual([]);
    expect(preview.requiresApproval).toBe(false);
    expect(preview.summary).toContain('ready to run');
  });

  it('blocks with a summary when a required permission is missing', () => {
    const preview = previewPlan(interpret('Sort the storage room.'), ['somethingElse']);
    expect(preview.requiredPermissions).toEqual(['allowContainerMoves']);
    expect(preview.summary).toBe('blocked: this plan needs the permission(s) allowContainerMoves');
  });

  it('does not block when the permission is granted', () => {
    const preview = previewPlan(interpret('Sort the storage room.'), ['allowContainerMoves']);
    expect(preview.summary).not.toContain('blocked');
  });

  it('summarises an empty plan with its reasoning', () => {
    const preview = previewPlan(interpret('recalibrate the quantum flux capacitor'));
    expect(preview.steps).toEqual([]);
    expect(preview.summary).toBe('no known operation matches this instruction');
  });
});

/** A hand-written fake provider object literal: no mock library, just the AiProvider contract. */
function fakeProvider(over: {
  available?: boolean;
  text?: string;
  remote?: boolean;
} = {}): AiProvider {
  const available = over.available ?? true;
  const text = over.text ?? '';
  return {
    id: 'fake',
    name: 'Fake',
    remote: over.remote ?? true,
    async available(): Promise<boolean> {
      return available;
    },
    async complete(_request: ProviderRequest): Promise<ProviderResponse> {
      return { text, model: 'fake-model', provider: 'fake', durationMs: 1 };
    },
  };
}

describe('Planner', () => {
  it('uses the deterministic path when no provider is configured', async () => {
    const planner = new Planner({ fallbackToDeterministic: true, minimumConfidence: 0.5 });
    const plan = await planner.plan('Find all diamonds.');
    expect(plan.source).toBe('deterministic');
    expect(plan.steps[0]!.operation).toBe('storage.search');
    expect(plan.steps[0]!.arguments.query).toBe('diamond');
  });

  it('uses the deterministic path for a non-remote provider', async () => {
    const planner = new Planner({
      provider: fakeProvider({ remote: false }),
      fallbackToDeterministic: true,
      minimumConfidence: 0.5,
    });
    expect((await planner.plan('Find all diamonds.')).source).toBe('deterministic');
  });

  it('returns the model plan when the provider answers with valid JSON', async () => {
    const provider = fakeProvider({
      text: JSON.stringify({ operation: 'storage.count', arguments: { query: 'iron' }, reasoning: 'count the iron' }),
    });
    const planner = new Planner({ provider, fallbackToDeterministic: true, minimumConfidence: 0.5 });
    const plan = await planner.plan('how much iron do i have');
    expect(plan.source).toBe('model');
    expect(plan.steps[0]!.operation).toBe('storage.count');
    expect(plan.steps[0]!.arguments.query).toBe('iron');
    expect(plan.reasoning).toBe('count the iron');
    expect(plan.confidence).toBe(0.9);
  });

  it('parses JSON wrapped in prose', async () => {
    const provider = fakeProvider({
      text: 'Sure! Here is the plan: {"operation": "storage.count", "arguments": {"query": "iron"}} — hope that helps.',
    });
    const planner = new Planner({ provider, fallbackToDeterministic: true, minimumConfidence: 0.5 });
    const plan = await planner.plan('how much iron');
    expect(plan.source).toBe('model');
    expect(plan.steps[0]!.operation).toBe('storage.count');
  });

  it('falls back to deterministic when the provider is unavailable', async () => {
    const planner = new Planner({
      provider: fakeProvider({ available: false }),
      fallbackToDeterministic: true,
      minimumConfidence: 0.5,
    });
    const plan = await planner.plan('Find all diamonds.');
    expect(plan.source).toBe('deterministic');
    expect(plan.steps[0]!.operation).toBe('storage.search');
  });

  it('falls back to deterministic when the provider returns garbage text', async () => {
    const planner = new Planner({
      provider: fakeProvider({ text: 'I am a teapot, no JSON here' }),
      fallbackToDeterministic: true,
      minimumConfidence: 0.5,
    });
    const plan = await planner.plan('Find all diamonds.');
    expect(plan.source).toBe('deterministic');
    expect(plan.steps[0]!.operation).toBe('storage.search');
  });

  it('falls back when the model names an unknown operation', async () => {
    const provider = fakeProvider({
      text: JSON.stringify({ operation: 'evil.drop_all_items', arguments: {} }),
    });
    const planner = new Planner({ provider, fallbackToDeterministic: true, minimumConfidence: 0.5 });
    const plan = await planner.plan('Find all diamonds.');
    expect(plan.source).toBe('deterministic');
    expect(plan.steps[0]!.operation).toBe('storage.search');
  });

  it('raises instead of falling back when fallbackToDeterministic is false', async () => {
    const planner = new Planner({
      provider: fakeProvider({ available: false }),
      fallbackToDeterministic: false,
      minimumConfidence: 0.5,
    });
    await expect(planner.plan('Find all diamonds.')).rejects.toThrow();
  });

  it('accepts a model plan that declines with a null operation as a low-confidence plan', async () => {
    const provider = fakeProvider({ text: JSON.stringify({ operation: null, reasoning: 'nothing fits' }) });
    const planner = new Planner({ provider, fallbackToDeterministic: true, minimumConfidence: 0.5 });
    // The model plan is valid but below minimumConfidence, so the planner falls back.
    const plan = await planner.plan('recalibrate the flux capacitor');
    expect(plan.source).toBe('deterministic');
  });

  it('planOffline always uses the deterministic interpreter', () => {
    const planner = new Planner({ fallbackToDeterministic: true, minimumConfidence: 0.5 });
    expect(planner.planOffline('Find all diamonds.').source).toBe('deterministic');
  });
});
