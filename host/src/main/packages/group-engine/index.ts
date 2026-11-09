/**
 * Group engine: named sets of workers, and honest aggregation of bulk-operation results.
 *
 * The important part is {@link aggregateResults}. A group operation must never be reported as
 * "completed" when some workers failed or were unreachable: the caller gets per-worker outcomes and
 * a derived summary that is only `ok` when every member succeeded. The UI renders exactly this, so
 * the rule cannot be lost in a page.
 *
 * Pure: unit-testable.
 */

export interface GroupMemberOutcome {
  workerId: string;
  /** A short label for the report (username or display name). */
  label: string;
  /** Whether the operation reached this worker and it reported success. */
  ok: boolean;
  /** One of the summary buckets, so the UI can group the lines. */
  outcome: 'completed' | 'failed' | 'disconnected' | 'skipped';
  detail: string;
}

export interface BulkSummary {
  /** True only when every targeted worker completed successfully. */
  ok: boolean;
  total: number;
  completed: number;
  failed: number;
  disconnected: number;
  skipped: number;
  /** The per-worker lines, in the order given. */
  outcomes: GroupMemberOutcome[];
  /** A one-line summary in plain language, e.g. "2 completed, 1 disconnected, 1 failed". */
  message: string;
}

/**
 * Aggregates per-worker outcomes into an honest summary.
 *
 * `ok` is true only when there was at least one member and every one completed. An empty selection
 * is *not* success — it is nothing to do, which the message says plainly.
 */
export function aggregateResults(outcomes: readonly GroupMemberOutcome[]): BulkSummary {
  const completed = outcomes.filter((o) => o.outcome === 'completed').length;
  const failed = outcomes.filter((o) => o.outcome === 'failed').length;
  const disconnected = outcomes.filter((o) => o.outcome === 'disconnected').length;
  const skipped = outcomes.filter((o) => o.outcome === 'skipped').length;
  const total = outcomes.length;

  const parts: string[] = [];
  if (completed > 0) parts.push(`${completed} completed`);
  if (disconnected > 0) parts.push(`${disconnected} disconnected`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (failed > 0) parts.push(`${failed} failed`);

  const message = total === 0
    ? 'No workers matched the selection.'
    : parts.length > 0 ? parts.join(', ') : 'No result reported.';

  return {
    ok: total > 0 && completed === total,
    total,
    completed,
    failed,
    disconnected,
    skipped,
    outcomes: [...outcomes],
    message,
  };
}

/** Filters a worker list to the members of a group. */
export function membersOf<T extends { groupId: string | null }>(workers: readonly T[], groupId: string): T[] {
  return workers.filter((worker) => worker.groupId === groupId);
}

/** Filters a worker list to those carrying every one of the given tags. */
export function withTags<T extends { tags: string[] }>(workers: readonly T[], tags: readonly string[]): T[] {
  if (tags.length === 0) return [...workers];
  return workers.filter((worker) => tags.every((tag) => worker.tags.includes(tag)));
}

/** A reusable group template: default tasks, settings and permissions for a new group. */
export interface GroupTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  /** Task preset ids the group runs by default. */
  defaultTaskPresetIds: string[];
  /** Equipment preset ids the group uses by default. */
  defaultEquipmentPresetIds: string[];
  /** Permission keys granted to the group. */
  permissions: string[];
}

/**
 * Applies a template to a group's defaults without touching existing workers.
 *
 * A template only supplies *defaults*; it must not add, remove or reconfigure workers, which is the
 * brief's explicit warning about templates overwriting existing configuration.
 */
export function applyTemplate(template: GroupTemplate): {
  name: string;
  description: string;
  color: string;
  defaultTaskPresetIds: string[];
  defaultEquipmentPresetIds: string[];
  permissions: string[];
} {
  return {
    name: template.name,
    description: template.description,
    color: template.color,
    defaultTaskPresetIds: [...template.defaultTaskPresetIds],
    defaultEquipmentPresetIds: [...template.defaultEquipmentPresetIds],
    permissions: [...template.permissions],
  };
}
