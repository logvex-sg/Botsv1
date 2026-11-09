/**
 * Scheduler: when a task should run, without ever running it twice.
 *
 * Supports the triggers the brief lists: once, repeat at an interval, start at a wall-clock time,
 * stop at a time, and "when a worker becomes available". Everything is computed from a passed-in
 * clock so the whole module is deterministic and unit-testable — no timers live here; the Host
 * ticks this module and asks it what is due.
 *
 * Duplicate-run protection is built in: a trigger fires at most once per occurrence, tracked by a
 * monotonic `lastFiredAt`/`lastFiredSlot` pair, so a Host restart or a slow tick cannot re-run a
 * job that already ran for that slot.
 */

export type ScheduleKind = 'once' | 'interval' | 'daily';

export interface Schedule {
  kind: ScheduleKind;
  /** Epoch ms for a `once` job, or the earliest time an interval job may fire. */
  startAt: number;
  /** Interval in ms for an `interval` job. */
  intervalMs?: number;
  /** Local time of day "HH:MM" for a `daily` job. */
  timeOfDay?: string;
  /** Optional stop time; no occurrence at or after this fires. */
  stopAt?: number;
}

/** The persisted state of one schedule, so duplicate protection survives a restart. */
export interface ScheduleState {
  /** The epoch ms of the last occurrence that fired, or null if none. */
  lastFiredAt: number | null;
  /** How many times this schedule has fired, for execution limits. */
  fireCount: number;
  enabled: boolean;
}

export function initialState(): ScheduleState {
  return { lastFiredAt: null, fireCount: 0, enabled: true };
}

/** Parses "HH:MM" into minutes since midnight, or null when malformed. */
export function parseTimeOfDay(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Whether the schedule is due at `now`, given its state.
 *
 * Pure: it computes the answer and, when due, returns the *slot* it fired for so the caller can
 * record it and prevent a second fire for the same slot.
 */
export interface DueResult {
  due: boolean;
  /** The identity of the occurrence, recorded as `lastFiredAt`. */
  slot: number;
}

export function isDue(schedule: Schedule, state: ScheduleState, now: number): DueResult {
  if (!state.enabled) return { due: false, slot: 0 };
  if (now < schedule.startAt) return { due: false, slot: 0 };
  if (schedule.stopAt !== undefined && now >= schedule.stopAt) return { due: false, slot: 0 };

  if (schedule.kind === 'once') {
    // A once job fires for exactly the start slot, and never again.
    return { due: state.lastFiredAt === null, slot: schedule.startAt };
  }

  if (schedule.kind === 'interval') {
    const interval = schedule.intervalMs && schedule.intervalMs > 0 ? schedule.intervalMs : 60_000;
    // The slot is the most recent interval boundary at or before now.
    const slot = schedule.startAt + Math.floor((now - schedule.startAt) / interval) * interval;
    if (state.lastFiredAt !== null && state.lastFiredAt >= slot) return { due: false, slot };
    return { due: true, slot };
  }

  if (schedule.kind === 'daily') {
    const target = parseTimeOfDay(schedule.timeOfDay);
    if (target === null) return { due: false, slot: 0 };
    const date = new Date(now);
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes < target) return { due: false, slot: 0 };
    // The slot is midnight of today; one fire per calendar day.
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    if (state.lastFiredAt !== null && state.lastFiredAt >= midnight) return { due: false, slot: midnight };
    return { due: true, slot: midnight };
  }

  return { due: false, slot: 0 };
}

/** Records that a schedule fired for `slot`, returning the new state. */
export function markFired(state: ScheduleState, slot: number): ScheduleState {
  return { ...state, lastFiredAt: slot, fireCount: state.fireCount + 1 };
}

/**
 * How many occurrences were missed while the Host was not running.
 *
 * A daily or interval job that should have fired several times while the Host was down is reported
 * with a count, so the operator can decide to catch up or skip; the scheduler never silently runs a
 * backlog.
 */
export function missedRuns(schedule: Schedule, state: ScheduleState, now: number): number {
  if (schedule.kind !== 'interval') return 0;
  const interval = schedule.intervalMs && schedule.intervalMs > 0 ? schedule.intervalMs : 60_000;
  const from = state.lastFiredAt ?? schedule.startAt;
  if (now <= from) return 0;
  const elapsed = now - from;
  const missed = Math.floor(elapsed / interval) - 1;
  return Math.max(0, missed);
}
