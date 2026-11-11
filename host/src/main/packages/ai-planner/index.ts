/**
 * AI planner: turning a plain-language instruction into a checked, previewable plan.
 *
 * This is the spec's §13 pipeline made explicit and testable. It is a *deterministic planner*, not
 * a language model: it recognises the requests in the brief by keyword, maps each to a storage
 * system and an operation, expands the operation into ordered steps, checks every step against the
 * permission engine, and returns a plan with an execution preview and a confirmation requirement.
 * A request it does not understand is refused honestly with what it *can* do — it never invents an
 * action, which is why the same instruction always yields the same plan.
 *
 * The planner decides; it never executes. Execution, verification and failure reporting are driven
 * by the caller through {@link report}, so a plan can be shown, approved, run step by step and
 * reconciled without the planner touching a worker.
 */
import { authorize, isDestructive, type ActionId, type Grant, type TargetObject } from '../permissions';

/** The systems an instruction can address, mirroring the control centre's sections. */
export type PlanSystem =
  | 'storage'
  | 'inventory'
  | 'shulker'
  | 'logistics'
  | 'restock'
  | 'disposal'
  | 'portal'
  | 'structure'
  | 'crafting'
  | 'workers'
  | 'automation'
  | 'reports';

/** One step of a plan: a named operation against one system. */
export interface PlanStep {
  id: string;
  system: PlanSystem;
  /** A stable operation id, e.g. `sort`, `shulker.unpack`. */
  operation: string;
  /** A human-readable description shown in the preview. */
  summary: string;
  /** The permission action this step needs. */
  action: ActionId;
  /** Whether the subject may run this step. */
  authorised: boolean;
  /** When not authorised, why. */
  blockedReason: string;
  /** Whether this step changes or destroys something. */
  destructive: boolean;
  /** Whether this step still needs an explicit confirmation. */
  needsConfirmation: boolean;
}

/** A complete plan for one instruction. */
export interface Plan {
  instruction: string;
  /** The recognised intent id, or null when nothing matched. */
  intent: string | null;
  /** A query extracted from the instruction (e.g. the item to find), or ''. */
  query: string;
  /** A confidence in [0, 1]. */
  confidence: number;
  steps: PlanStep[];
  /** Whether every step is authorised. */
  executable: boolean;
  /** Whether the plan needs a confirmation before it runs. */
  needsConfirmation: boolean;
  /** A one-line answer when the instruction was only a question, or a refusal reason. */
  note: string;
}

/** The recognised intents, mapped to the systems and operations they touch. */
interface IntentRule {
  id: string;
  phrases: string[];
  system: PlanSystem;
  operations: { operation: string; summary: string; action: ActionId }[];
  /** Words to strip when extracting a query. */
  strip?: string[];
  /** A question that needs no plan: answered with this note. */
  answer?: string;
}

const INTENT_RULES: IntentRule[] = [
  {
    id: 'storage.sort',
    phrases: ['organize my entire storage', 'organise my entire storage', 'organize my storage', 'organise my storage', 'sort my storage', 'sort my chests', 'organize my chests', 'organise my chests'],
    system: 'storage',
    operations: [
      { operation: 'inspect', summary: 'Inspect the registered containers', action: 'storage.inspect' },
      { operation: 'sort', summary: 'Route unsorted items to their categories', action: 'inventory.sort' },
      { operation: 'verify', summary: 'Verify the resulting inventory state', action: 'storage.inspect' },
    ],
  },
  {
    id: 'storage.sort-unsorted',
    phrases: ['sort all unsorted', 'sort unsorted items', 'sort every unsorted', 'sort the unsorted'],
    system: 'storage',
    operations: [
      { operation: 'inspect', summary: 'Find containers holding unsorted items', action: 'storage.inspect' },
      { operation: 'sort', summary: 'Route the unsorted items to their categories', action: 'inventory.sort' },
      { operation: 'verify', summary: 'Verify the transfers', action: 'storage.inspect' },
    ],
  },
  {
    id: 'storage.find',
    phrases: ['find all', 'find every', 'where are my', 'search for', 'locate all'],
    system: 'storage',
    operations: [{ operation: 'search', summary: 'Search the registered storage for the item', action: 'storage.search' }],
    strip: ['find all', 'find every', 'find', 'where are my', 'where are', 'search for', 'search', 'locate all', 'locate'],
  },
  {
    id: 'storage.full-report',
    phrases: ['show all full chests', 'show full containers', 'show every full', 'which chests are full', 'full chests'],
    system: 'reports',
    operations: [{ operation: 'report-full', summary: 'List the full containers', action: 'storage.inspect' }],
  },
  {
    id: 'storage.mixed-report',
    phrases: ['containers with mixed categories', 'mixed categories', 'mixed containers', 'mixed-category'],
    system: 'reports',
    operations: [{ operation: 'report-mixed', summary: 'List containers holding several categories', action: 'storage.inspect' }],
  },
  {
    id: 'storage.optimize',
    phrases: ['optimize the', 'optimise the', 'optimize my', 'optimise my', 'optimize storage', 'optimise storage'],
    system: 'storage',
    operations: [
      { operation: 'analyse', summary: 'Analyse the storage for bottlenecks', action: 'storage.inspect' },
      { operation: 'optimize', summary: 'Consolidate partial stacks and rebalance categories', action: 'inventory.consolidate' },
      { operation: 'verify', summary: 'Verify the new arrangement', action: 'storage.inspect' },
    ],
  },
  {
    id: 'shulker.empty',
    phrases: ['empty the registered shulkers', 'empty my shulkers', 'unload my shulkers', 'unpack my shulkers', 'unload the shulkers'],
    system: 'shulker',
    operations: [
      { operation: 'shulker.inspect', summary: 'Inspect the shulkers and their contents', action: 'storage.inspect' },
      { operation: 'shulker.unload', summary: 'Unload each shulker into its assigned storage', action: 'shulker.unload' },
      { operation: 'verify', summary: 'Verify the unloaded quantities', action: 'storage.inspect' },
    ],
  },
  {
    id: 'shulker.fill',
    phrases: ['fill these shulkers', 'fill my shulkers', 'fill the shulkers', 'pack my shulkers'],
    system: 'shulker',
    operations: [
      { operation: 'shulker.inspect', summary: 'Inspect the shulkers to be filled', action: 'storage.inspect' },
      { operation: 'shulker.fill', summary: 'Fill each shulker with matching items', action: 'shulker.fill' },
      { operation: 'verify', summary: 'Verify the shulker contents', action: 'storage.inspect' },
    ],
  },
  {
    id: 'shulker.find-empty',
    phrases: ['find all empty shulker', 'find every empty shulker', 'empty shulker boxes', 'which shulkers are empty'],
    system: 'shulker',
    operations: [{ operation: 'shulker.report-empty', summary: 'List the empty shulkers', action: 'storage.inspect' }],
  },
  {
    id: 'shulker.dispose-empty',
    phrases: ['move unwanted empty shulkers', 'dispose of empty shulkers', 'remove empty shulkers', 'dispose empty shulkers'],
    system: 'disposal',
    operations: [
      { operation: 'shulker.report-empty', summary: 'Identify the empty shulkers', action: 'storage.inspect' },
      { operation: 'shulker.dispose', summary: 'Move them to the disposal container', action: 'items.dispose' },
      { operation: 'verify', summary: 'Verify the disposal', action: 'storage.inspect' },
    ],
  },
  {
    id: 'restock',
    phrases: ['restock my', 'restock the', 'restock building', 'restock mining', 'top up my', 'refill my inventory'],
    system: 'restock',
    operations: [
      { operation: 'restock.check', summary: 'Compare the inventory against its minimums', action: 'storage.inspect' },
      { operation: 'restock.transfer', summary: 'Transfer the shortfall from network stock', action: 'items.transfer' },
      { operation: 'verify', summary: 'Verify the restocked quantities', action: 'storage.inspect' },
    ],
  },
  {
    id: 'portal.maintenance',
    phrases: ['check my registered portals', 'portals for maintenance', 'portal maintenance', 'check my portals'],
    system: 'portal',
    operations: [{ operation: 'portal.report', summary: 'Report the portals needing maintenance', action: 'storage.inspect' }],
  },
  {
    id: 'portal.cleanup-report',
    phrases: ['obsolete portal cleanup report', 'obsolete portal report', 'portal cleanup report', 'obsolete portal'],
    system: 'portal',
    operations: [{ operation: 'portal.report-obsolete', summary: 'Prepare the obsolete-portal cleanup report', action: 'storage.inspect' }],
  },
  {
    id: 'portal.cleanup',
    phrases: ['remove obsolete portals', 'clean up obsolete portals', 'cleanup obsolete portals', 'delete obsolete portals'],
    system: 'portal',
    operations: [
      { operation: 'portal.report-obsolete', summary: 'Identify the obsolete portals', action: 'storage.inspect' },
      { operation: 'portal.remove', summary: 'Remove the approved portals', action: 'portal.remove' },
      { operation: 'verify', summary: 'Verify the removals', action: 'storage.inspect' },
    ],
  },
  {
    id: 'structure.audit',
    phrases: ['check my structures', 'audit my structures', 'structure maintenance', 'structures for maintenance', 'check my registered structures', 'structures needing attention'],
    system: 'structure',
    operations: [{ operation: 'structure.report', summary: 'Report the registered structures needing attention', action: 'storage.inspect' }],
  },
  {
    id: 'tasks.unfinished',
    phrases: ['unfinished storage task', 'show every unfinished', 'pending storage task', 'incomplete tasks'],
    system: 'reports',
    operations: [{ operation: 'report-tasks', summary: 'List every unfinished storage task', action: 'storage.inspect' }],
  },
  {
    id: 'workers.assign',
    phrases: ['assign available workers', 'assign workers to storage', 'assign workers to maintenance', 'assign a worker'],
    system: 'workers',
    operations: [{ operation: 'workers.assign', summary: 'Assign available workers to storage maintenance', action: 'workers.assign' }],
  },
  {
    id: 'automation.pause',
    phrases: ['pause all storage automation', 'pause storage automation', 'pause all automation', 'pause automation'],
    system: 'automation',
    operations: [{ operation: 'automation.pause', summary: 'Pause all storage automation', action: 'automation.configure' }],
  },
  {
    id: 'automation.resume',
    phrases: ['resume all storage automation', 'resume storage automation', 'resume all automation', 'resume automation'],
    system: 'automation',
    operations: [{ operation: 'automation.resume', summary: 'Resume all storage automation', action: 'automation.configure' }],
  },
];

/** Splits an instruction into a query by removing the matched phrases and filler words. */
function extractQuery(instruction: string, rule: IntentRule): string {
  let text = ` ${instruction.toLowerCase()} `;
  for (const phrase of rule.phrases) {
    const index = text.indexOf(phrase);
    if (index >= 0) {
      text = `${text.slice(0, index)} ${text.slice(index + phrase.length)}`;
      break;
    }
  }
  const filler = ['move all', 'move', 'find all', 'find', 'show me', 'show', 'get', 'check', 'organize', 'organise', 'sort', 'consolidate', 'clean up', 'cleanup', 'my', 'all', 'the', 'into', 'to', 'in', 'for', 'of', 'a', 'an', 'these', 'those'];
  let result = text;
  for (const word of filler) result = result.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ');
  return result.replace(/[^a-z0-9_:\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The best-matching rule for an instruction, or null. Longer phrases win. */
function matchIntent(instruction: string): { rule: IntentRule; score: number } | null {
  const text = instruction.toLowerCase();
  let best: { rule: IntentRule; score: number } | null = null;
  for (const rule of INTENT_RULES) {
    for (const phrase of rule.phrases) {
      if (!text.includes(phrase)) continue;
      const score = phrase.length;
      if (!best || score > best.score) best = { rule, score };
    }
  }
  return best;
}

/** What the planner needs to know about the environment to build a plan. */
export interface PlanContext {
  grant: Grant;
  /** Objects the plan will touch, keyed by the operation id, so protection can be checked per step. */
  targets?: Partial<Record<string, TargetObject>>;
}

/** Builds a plan for an instruction, or a refusal when nothing matches. */
export function plan(instruction: string, context: PlanContext): Plan {
  const match = matchIntent(instruction);
  if (!match) {
    return {
      instruction,
      intent: null,
      query: '',
      confidence: 0,
      steps: [],
      executable: false,
      needsConfirmation: false,
      note: "I don't recognise that request. Try: sort my storage, find all diamonds, empty my shulkers, restock building, or check my registered portals.",
    };
  }

  const { rule, score } = match;
  const query = extractQuery(instruction, rule);
  const steps: PlanStep[] = rule.operations.map((operation, index) => {
    const target = context.targets?.[operation.operation];
    const decision = target ? authorize(context.grant, operation.action, target) : authorize(context.grant, operation.action);
    return {
      id: `${rule.id}-${index + 1}`,
      system: rule.system,
      operation: operation.operation,
      summary: operation.summary,
      action: operation.action,
      authorised: decision.allowed,
      blockedReason: decision.allowed ? '' : decision.reason,
      destructive: isDestructive(operation.action),
      needsConfirmation: isDestructive(operation.action),
    };
  });

  const blocked = steps.filter((step) => !step.authorised);
  const executable = blocked.length === 0;
  const needsConfirmation = executable && steps.some((step) => step.needsConfirmation);
  const note = rule.answer
    ? rule.answer
    : executable
      ? needsConfirmation
        ? 'This plan includes a change that needs confirmation.'
        : ''
      : `Blocked: ${blocked[0]?.blockedReason ?? 'not authorised'}`;

  return {
    instruction,
    intent: rule.id,
    query,
    confidence: Math.min(1, score / 24),
    steps,
    executable,
    needsConfirmation,
    note,
  };
}

/** A per-step preview line, for the confirmation dialog. */
export interface PlanPreview {
  stepId: string;
  system: PlanSystem;
  summary: string;
  destructive: boolean;
  authorised: boolean;
  blockedReason: string;
}

/** The preview of a plan: exactly what would run, and what is blocked. */
export function preview(plan: Plan): PlanPreview[] {
  return plan.steps.map((step) => ({
    stepId: step.id,
    system: step.system,
    summary: step.summary,
    destructive: step.destructive,
    authorised: step.authorised,
    blockedReason: step.blockedReason,
  }));
}

/** The outcome of one step, reported back by the executor. */
export interface StepOutcome {
  stepId: string;
  ok: boolean;
  detail: string;
}

/** The result of running a plan: what succeeded, what failed, and whether it completed. */
export interface PlanReport {
  intent: string | null;
  completed: boolean;
  succeeded: string[];
  failed: { stepId: string; detail: string }[];
  /** Steps that never ran because an earlier step failed. */
  skipped: string[];
  summary: string;
}

/**
 * Reconciles a plan with the outcomes the executor reported.
 *
 * A step that did not report an outcome is *skipped*, not assumed to have failed: an interrupted
 * operation is reported honestly, and the caller can re-inspect and resume rather than blindly
 * retrying.
 */
export function report(plan: Plan, outcomes: readonly StepOutcome[]): PlanReport {
  const byId = new Map(outcomes.map((outcome) => [outcome.stepId, outcome]));
  const succeeded: string[] = [];
  const failed: { stepId: string; detail: string }[] = [];
  const skipped: string[] = [];
  let stopped = false;
  for (const step of plan.steps) {
    const outcome = byId.get(step.id);
    if (!outcome) {
      skipped.push(step.id);
      continue;
    }
    if (outcome.ok && !stopped) {
      succeeded.push(step.id);
    } else {
      failed.push({ stepId: step.id, detail: outcome.detail || 'step failed' });
      stopped = true;
    }
  }
  const completed = failed.length === 0 && skipped.length === 0 && succeeded.length === plan.steps.length;
  const summary = completed
    ? `Completed ${succeeded.length} step(s).`
    : failed.length > 0
      ? `Stopped after ${succeeded.length} step(s); ${failed.length} failed, ${skipped.length} not run.`
      : `Ran ${succeeded.length} step(s); ${skipped.length} not run.`;
  return { intent: plan.intent, completed, succeeded, failed, skipped, summary };
}

/** The intents the planner understands, for the assistant's help text and autocomplete. */
export function knownIntents(): { id: string; system: PlanSystem }[] {
  return INTENT_RULES.map((rule) => ({ id: rule.id, system: rule.system }));
}
