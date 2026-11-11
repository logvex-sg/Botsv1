/**
 * The AI layer's public surface.
 *
 * The host imports `@logvex/bot/ai`. Nothing reachable from here imports Mineflayer, so pulling the
 * planner into Electron's main process does not drag the Minecraft protocol stack along with it.
 */

export {
  OllamaProvider,
  OpenAiCompatibleProvider,
  type AiProvider,
  type ProviderRequest,
  type ProviderResponse,
  type ProviderMessage,
  type OllamaOptions,
  type OpenAiOptions,
} from './provider';

export {
  OPERATIONS,
  operationById,
  isOperationId,
  knownOperations,
  type IntentOperation,
  type OperationDescriptor,
} from './operations';

export {
  interpret,
  describePlan,
  plannerSystemPrompt,
  type Plan,
  type PlanStep,
  type PlanArguments,
} from './interpret';

export {
  Planner,
  previewPlan,
  validatePlan,
  stepSummary,
  type PlannerOptions,
  type PlanPreview,
  type PlanPreviewStep,
  type PlanValidation,
} from './planner';

export { createProvider, type ProviderFactoryOptions } from './factory';
