/**
 * Workflow engine: named sequences of storage operations.
 *
 * A workflow is a name plus an ordered list of operation ids. The engine expands it into a concrete
 * sequence the storage service can plan and run one operation at a time, and provides the catalogue
 * of built-in workflows from the brief (empty-shulker cleanup, consolidation, portal maintenance,
 * restock, storage-room maintenance). It is pure: it describes *what* to do, never *how* to reach a
 * worker.
 *
 * Pure: unit-testable.
 */
import type { AutomationMode, WorkflowRecord } from '../../../shared/types';

/** An operation a workflow step can invoke. */
export interface OperationDescriptor {
  id: string;
  label: string;
  description: string;
  /** True when the operation changes inventory and therefore needs a worker that may move items. */
  mutating: boolean;
  /** True when the operation is safe to run with no approval in `automatic` mode. */
  autoSafe: boolean;
}

/** Every operation the storage subsystem can perform, in one table. */
export const OPERATIONS: OperationDescriptor[] = [
  { id: 'inspect', label: 'Inspect containers', description: 'Ask workers to report the contents of registered containers.', mutating: false, autoSafe: true },
  { id: 'sort', label: 'Sort incoming items', description: 'Move unsorted items from input containers into their category containers.', mutating: true, autoSafe: true },
  { id: 'consolidate', label: 'Consolidate stacks', description: 'Merge partial stacks of the same item spread across containers.', mutating: true, autoSafe: true },
  { id: 'distribute', label: 'Distribute items', description: 'Spread a full container into containers with free space.', mutating: true, autoSafe: true },
  { id: 'shulker-organise', label: 'Organise shulkers', description: 'Sort and consolidate shulker boxes by category.', mutating: true, autoSafe: true },
  { id: 'shulker-unpack', label: 'Unpack shulkers', description: 'Empty a shulker into its category containers.', mutating: true, autoSafe: false },
  { id: 'shulker-cleanup', label: 'Clean up empty shulkers', description: 'Move surplus empty shulkers to the designated storage.', mutating: true, autoSafe: false },
  { id: 'portal-cleanup', label: 'Clean up obsolete portals', description: 'Preview and, with approval, remove obsolete registered portals.', mutating: true, autoSafe: false },
  { id: 'restock', label: 'Restock inventories', description: 'Top workers up to their configured minimums.', mutating: true, autoSafe: true },
  { id: 'dispose', label: 'Dispose of unwanted items', description: 'Move items matched by a disposal rule to a disposal container.', mutating: true, autoSafe: false },
  { id: 'maintain', label: 'Storage-room maintenance', description: 'Find misplaced items and produce an optimisation plan.', mutating: false, autoSafe: true },
];

export function operationById(id: string): OperationDescriptor | undefined {
  return OPERATIONS.find((operation) => operation.id === id);
}

/** The built-in workflows, as data. */
export const BUILTIN_WORKFLOWS: { name: string; description: string; operations: string[]; mode: AutomationMode }[] = [
  { name: 'Empty shulker cleanup', description: 'Find empty shulkers, keep the reserve, move the rest to storage.', operations: ['inspect', 'shulker-cleanup'], mode: 'supervised' },
  { name: 'Storage consolidation', description: 'Merge partial stacks while keeping categories separate.', operations: ['inspect', 'consolidate'], mode: 'supervised' },
  { name: 'Portal maintenance', description: 'Flag obsolete temporary portals and preview their removal.', operations: ['portal-cleanup'], mode: 'supervised' },
  { name: 'Inventory restock', description: 'Top every worker up to its configured minimums.', operations: ['inspect', 'restock'], mode: 'automatic' },
  { name: 'Storage room maintenance', description: 'Scan containers and produce an optimisation plan.', operations: ['inspect', 'maintain'], mode: 'supervised' },
];

/** Expands a workflow into its operations, dropping any id the engine does not know. */
export function expand(workflow: WorkflowRecord): OperationDescriptor[] {
  return workflow.operations
    .map((id) => operationById(id))
    .filter((operation): operation is OperationDescriptor => Boolean(operation));
}

/** The operations a workflow needs approval for, under its mode. */
export function requiresApproval(workflow: WorkflowRecord, operation: OperationDescriptor): boolean {
  if (workflow.mode === 'manual') return true;
  if (workflow.mode === 'supervised') return true;
  // Automatic mode still asks for the operations that are not auto-safe.
  return !operation.autoSafe;
}

/**
 * Validates a workflow definition.
 *
 * A workflow must have a name and at least one known operation; an empty or entirely unknown list
 * is rejected so the UI cannot save a workflow that would do nothing.
 */
export function validate(input: { name: string; operations: string[] }): string[] {
  const problems: string[] = [];
  if (!input.name.trim()) problems.push('a workflow needs a name');
  if (input.operations.length === 0) problems.push('a workflow needs at least one operation');
  for (const id of input.operations) {
    if (!operationById(id)) problems.push(`unknown operation "${id}"`);
  }
  return problems;
}

/** A one-line description of what a workflow will do, in order. */
export function describe(workflow: WorkflowRecord): string {
  const labels = expand(workflow).map((operation) => operation.label);
  return labels.length === 0 ? 'no operations' : labels.join(' → ');
}
