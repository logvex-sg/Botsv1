/**
 * The planner: instruction in, validated plan out.
 *
 * The model is an *advisor*, never an authority. Whatever it returns is parsed, checked against the
 * operation vocabulary, and rejected if it names an operation that does not exist. If the model is
 * unavailable or returns something unusable, the deterministic interpreter answers instead. The
 * result is a plan that is always within the vocabulary, always carries its reasoning, and always
 * states whether it mutates the world.
 */

import { Logger } from '../core/logger';
import { isOperationId, operationById, type IntentOperation } from './operations';
import { interpret, plannerSystemPrompt, type Plan, type PlanArguments, type PlanStep } from './interpret';
import type { AiProvider } from './provider';

export interface PlannerOptions {
  provider?: AiProvider;
  logger?: Logger;
  /** When false, a provider failure is raised instead of falling back. */
  fallbackToDeterministic: boolean;
  /** Minimum confidence a model plan must reach to be accepted. */
  minimumConfidence: number;
}

export interface PlanValidation {
  ok: boolean;
  plan?: Plan;
  reason?: string;
}

function parseModelPlan(text: string, instruction: string): Plan | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Models sometimes wrap JSON in prose or fences; take the first object.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;

  const operation = record.operation;
  if (operation === null || operation === undefined) {
    return {
      instruction,
      steps: [],
      source: 'model',
      confidence: 0.2,
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : 'the model declined to choose an operation',
      mutating: false,
    };
  }
  if (!isOperationId(operation)) return null;

  const descriptor = operationById(operation)!;
  const rawArgs = record.arguments && typeof record.arguments === 'object' ? (record.arguments as Record<string, unknown>) : {};
  const args: PlanArguments = {};
  for (const key of descriptor.arguments) {
    const value = rawArgs[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' || typeof value === 'string') (args as Record<string, unknown>)[key] = value;
  }

  return {
    instruction,
    steps: [{ operation, arguments: args, description: descriptor.description }],
    source: 'model',
    confidence: 0.9,
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : 'chosen by the configured model',
    mutating: descriptor.mutating,
  };
}

/**
 * Validates a plan against the vocabulary and the instruction.
 *
 * A step naming an unknown operation is a hard failure: a plan is only ever as safe as the
 * operations it can reach.
 */
export function validatePlan(plan: Plan): PlanValidation {
  if (plan.steps.length === 0) {
    return { ok: false, reason: plan.reasoning || 'no operation was identified' };
  }
  for (const step of plan.steps) {
    if (!isOperationId(step.operation)) {
      return { ok: false, reason: `the plan names an unknown operation: ${String(step.operation)}` };
    }
  }
  return { ok: true, plan };
}

export class Planner {
  private readonly provider?: AiProvider;
  private readonly logger?: Logger;
  private readonly fallback: boolean;
  private readonly minimumConfidence: number;

  constructor(options: PlannerOptions) {
    this.provider = options.provider;
    this.logger = options.logger;
    this.fallback = options.fallbackToDeterministic;
    this.minimumConfidence = options.minimumConfidence;
  }

  /** Plans from the configured provider, falling back to the deterministic interpreter. */
  async plan(instruction: string): Promise<Plan> {
    if (!this.provider || !this.provider.remote) {
      return interpret(instruction);
    }

    try {
      const available = await this.provider.available();
      if (!available) {
        if (!this.fallback) throw new Error(`provider ${this.provider.id} is not reachable`);
        this.logger?.debug('AI provider is not reachable; using the deterministic interpreter', { provider: this.provider.id });
        return interpret(instruction);
      }

      const response = await this.provider.complete({
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: instruction },
        ],
        json: true,
        temperature: 0.1,
        maxTokens: 400,
      });

      const plan = parseModelPlan(response.text, instruction);
      if (!plan) {
        if (!this.fallback) throw new Error('the model returned an unparseable plan');
        this.logger?.warn('the model returned an unusable plan; falling back', { provider: this.provider.id });
        return interpret(instruction);
      }

      const validation = validatePlan(plan);
      if (!validation.ok || plan.confidence < this.minimumConfidence) {
        if (!this.fallback) throw new Error(validation.reason ?? 'the model plan was rejected');
        this.logger?.warn('the model plan was rejected; falling back', { reason: validation.reason, confidence: plan.confidence });
        return interpret(instruction);
      }

      return plan;
    } catch (error) {
      if (!this.fallback) throw error;
      this.logger?.warn('the AI provider failed; using the deterministic interpreter', { error: String(error) });
      return interpret(instruction);
    }
  }

  /** Plans without a provider, for callers that want the offline path explicitly. */
  planOffline(instruction: string): Plan {
    return interpret(instruction);
  }
}

export interface PlanPreviewStep {
  operation: IntentOperation;
  description: string;
  arguments: PlanArguments;
  mutating: boolean;
  requiresApproval: boolean;
  requires: string | null;
}

export interface PlanPreview {
  instruction: string;
  source: Plan['source'];
  confidence: number;
  reasoning: string;
  mutating: boolean;
  requiresApproval: boolean;
  steps: PlanPreviewStep[];
  /** Permission flags the plan needs, deduplicated. */
  requiredPermissions: string[];
  /** A plain-language summary for the operator. */
  summary: string;
}

/**
 * Builds the preview an operator sees before approving.
 *
 * The preview is the approval gate's input: it states exactly which permissions the plan needs and
 * whether any step is mutating.
 */
export function previewPlan(plan: Plan, grantedPermissions: readonly string[] = []): PlanPreview {
  const granted = new Set(grantedPermissions);
  const steps: PlanPreviewStep[] = plan.steps.map((step) => {
    const descriptor = operationById(step.operation);
    return {
      operation: step.operation,
      description: step.description,
      arguments: step.arguments,
      mutating: descriptor?.mutating ?? true,
      requiresApproval: descriptor?.requiresApproval ?? true,
      requires: descriptor?.requires ?? null,
    };
  });

  const requiredPermissions = [...new Set(steps.map((step) => step.requires).filter((value): value is string => Boolean(value)))];
  const missing = requiredPermissions.filter((permission) => !granted.has(permission));
  const requiresApproval = steps.some((step) => step.requiresApproval);

  let summary: string;
  if (steps.length === 0) {
    summary = plan.reasoning || 'no operation matched this instruction';
  } else if (missing.length > 0) {
    summary = `blocked: this plan needs the permission(s) ${missing.join(', ')}`;
  } else if (requiresApproval) {
    summary = `ready to run, but needs approval: ${steps.map((step) => step.description).join(', then ')}`;
  } else {
    summary = `ready to run: ${steps.map((step) => step.description).join(', then ')}`;
  }

  return {
    instruction: plan.instruction,
    source: plan.source,
    confidence: plan.confidence,
    reasoning: plan.reasoning,
    mutating: plan.mutating,
    requiresApproval,
    steps,
    requiredPermissions,
    summary,
  };
}

export function stepSummary(step: PlanStep): string {
  const args = Object.entries(step.arguments)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  return args.length > 0 ? `${step.operation} (${args})` : step.operation;
}

export { interpret, plannerSystemPrompt };
export type { Plan, PlanStep, PlanArguments };
