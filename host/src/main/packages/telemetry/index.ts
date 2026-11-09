/**
 * Telemetry: metrics with a defined source and calculation.
 *
 * The brief is explicit that statistics must not be decorative — every number must come from
 * something real and be computable. So each metric here takes the records it needs and returns a
 * value plus the count it was derived from; a metric with no underlying data returns `null`, which
 * the UI renders as "no data" rather than a misleading zero.
 *
 * Pure: unit-testable.
 */

export interface MetricValue {
  /** The value, or null when there was nothing to compute from. */
  value: number | null;
  /** How many underlying records the value was derived from. */
  sampleSize: number;
  /** A short description of the calculation, shown as a tooltip. */
  description: string;
}

export interface TaskSample {
  /** Whether the task finished successfully. */
  ok: boolean;
  /** Wall-clock duration in ms, or null when it never completed. */
  durationMs: number | null;
  /** When the task was created (for time-windowed rates). */
  createdAt: number;
}

/** Completion rate over the tasks that reached a terminal state. */
export function completionRate(tasks: readonly TaskSample[]): MetricValue {
  const finished = tasks.filter((task) => task.durationMs !== null);
  const ok = finished.filter((task) => task.ok).length;
  return {
    value: finished.length === 0 ? null : ok / finished.length,
    sampleSize: finished.length,
    description: 'completed tasks / finished tasks',
  };
}

/** Failure rate over the tasks that reached a terminal state. */
export function failureRate(tasks: readonly TaskSample[]): MetricValue {
  const finished = tasks.filter((task) => task.durationMs !== null);
  const failed = finished.filter((task) => !task.ok).length;
  return {
    value: finished.length === 0 ? null : failed / finished.length,
    sampleSize: finished.length,
    description: 'failed tasks / finished tasks',
  };
}

/** Mean task duration in ms over the tasks that reported a duration. */
export function averageDuration(tasks: readonly TaskSample[]): MetricValue {
  const durations = tasks.map((task) => task.durationMs).filter((value): value is number => value !== null);
  return {
    value: durations.length === 0 ? null : durations.reduce((sum, value) => sum + value, 0) / durations.length,
    sampleSize: durations.length,
    description: 'mean of reported task durations',
  };
}

export interface UptimeSample {
  workerId: string;
  /** Total ms the worker has been connected, summed over its sessions. */
  connectedMs: number;
  /** The window the uptime is measured over. */
  windowMs: number;
}

/** Availability as connected time / window, over all workers. */
export function availability(samples: readonly UptimeSample[]): MetricValue {
  if (samples.length === 0) return { value: null, sampleSize: 0, description: 'connected time / window' };
  const window = samples.reduce((sum, sample) => sum + sample.windowMs, 0);
  if (window <= 0) return { value: null, sampleSize: samples.length, description: 'connected time / window' };
  const connected = samples.reduce((sum, sample) => sum + Math.min(sample.connectedMs, sample.windowMs), 0);
  return { value: connected / window, sampleSize: samples.length, description: 'connected time / window' };
}

export interface ActivityBucket {
  /** The start of the bucket, epoch ms. */
  at: number;
  count: number;
}

/**
 * Buckets timestamps into fixed-width windows for a chart.
 *
 * Empty buckets are included as zero, so a gap in activity shows as a gap rather than being hidden.
 */
export function histogram(timestamps: readonly number[], windowMs: number, buckets: number, now = Date.now()): ActivityBucket[] {
  const start = now - windowMs * buckets;
  const out: ActivityBucket[] = [];
  for (let i = 0; i < buckets; i++) out.push({ at: start + i * windowMs, count: 0 });
  for (const timestamp of timestamps) {
    if (timestamp < start || timestamp > now) continue;
    const index = Math.min(buckets - 1, Math.floor((timestamp - start) / windowMs));
    out[index].count += 1;
  }
  return out;
}
