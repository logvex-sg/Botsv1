/**
 * Reliability primitives: operation locks, rate limiting, and safe retry.
 *
 * The retry policy is the important one. It refuses to repeat an operation whose mutation state is
 * `partial` or `applied`, because repeating a transfer that may already have happened is exactly
 * how a bot duplicates or destroys items.
 */

import { BotError, asBotError, mayRetry } from './errors';

/**
 * A named mutex.
 *
 * Locks are held by an owner id so a cancelled operation can release its own lock without touching
 * someone else's, and so a stale lock can be detected rather than deadlocking the worker.
 */
export class OperationLock {
  private readonly held = new Map<string, { owner: string; acquiredAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  tryAcquire(resource: string, owner: string): boolean {
    if (this.held.has(resource)) return false;
    this.held.set(resource, { owner, acquiredAt: this.now() });
    return true;
  }

  release(resource: string, owner: string): void {
    const entry = this.held.get(resource);
    if (entry && entry.owner === owner) this.held.delete(resource);
  }

  releaseAll(owner: string): void {
    for (const [resource, entry] of this.held) {
      if (entry.owner === owner) this.held.delete(resource);
    }
  }

  isHeld(resource: string): boolean {
    return this.held.has(resource);
  }

  holder(resource: string): string | undefined {
    return this.held.get(resource)?.owner;
  }

  /** Resources held longer than `maxAgeMs`, which are assumed to belong to a dead operation. */
  stale(maxAgeMs: number): string[] {
    const now = this.now();
    const result: string[] = [];
    for (const [resource, entry] of this.held) {
      if (now - entry.acquiredAt > maxAgeMs) result.push(resource);
    }
    return result;
  }

  heldResources(): string[] {
    return [...this.held.keys()];
  }

  clear(): void {
    this.held.clear();
  }
}

/** A token bucket, used to bound mutating operations. */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;

  constructor(perMinute: number, now: () => number = Date.now, capacity?: number) {
    this.capacity = capacity ?? Math.max(1, perMinute);
    this.tokens = this.capacity;
    this.refillPerMs = perMinute / 60_000;
    this.now = now;
    this.lastRefill = now();
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Takes one token, or returns false when the bucket is empty. */
  tryTake(count = 1): boolean {
    if (this.refillPerMs <= 0) return true;
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Milliseconds until the next token is available. */
  retryAfterMs(count = 1): number {
    if (this.refillPerMs <= 0) return 0;
    this.refill();
    if (this.tokens >= count) return 0;
    return Math.ceil((count - this.tokens) / this.refillPerMs);
  }

  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Called before each retry so the caller can reconcile a partial mutation. */
  onRetry?: (error: BotError, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
  /** When false, a non-retryable error is thrown immediately. Defaults to true. */
  respectRetryable?: boolean;
}

export const DEFAULT_RETRY: RetryOptions = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an operation with bounded retries.
 *
 * Retries happen only when `mayRetry` says so: the error must be marked retryable *and* nothing may
 * have been mutated. A `partial` mutation is surfaced immediately for reconciliation instead.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const config = { ...DEFAULT_RETRY, ...options };
  const sleep = config.sleep ?? defaultSleep;
  let lastError: BotError | null = null;

  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const bot = asBotError(error);
      lastError = bot;
      const canRetry = config.respectRetryable === false ? true : mayRetry(bot);
      if (!canRetry || attempt === config.attempts) throw bot;
      const delay = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1));
      config.onRetry?.(bot, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastError ?? new BotError('retry loop exhausted', { category: 'internal' });
}

export interface BackoffState {
  attempt: number;
  nextDelayMs: number;
}

/** Exponential backoff with a ceiling, for reconnection. */
export class Backoff {
  private attempt = 0;
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly random: () => number;

  constructor(baseMs: number, maxMs: number, random: () => number = Math.random) {
    this.baseMs = Math.max(1, baseMs);
    this.maxMs = Math.max(this.baseMs, maxMs);
    this.random = random;
  }

  next(): BackoffState {
    this.attempt += 1;
    const exponential = Math.min(this.maxMs, this.baseMs * 2 ** (this.attempt - 1));
    // Jitter avoids a fleet of workers reconnecting in lockstep after a server restart.
    const jitter = exponential * 0.2 * this.random();
    return { attempt: this.attempt, nextDelayMs: Math.round(exponential + jitter) };
  }

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}

/**
 * A simple deadline that can be cancelled, used to bound every adapter call.
 *
 * It is deliberately not `AbortController`: Mineflayer's operations do not take a signal, so the
 * adapters race their work against this promise and abandon it.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (ms <= 0) return promise;
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BotError(message, { category: 'timeout', retryable: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** A cancellation flag, checked between steps of a long operation. */
export class CancellationToken {
  private cancelled = false;
  private readonly listeners = new Set<() => void>();

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a listener must not break cancellation */
      }
    }
    this.listeners.clear();
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new BotError('operation cancelled', { category: 'cancelled' });
  }

  onCancel(listener: () => void): () => void {
    if (this.cancelled) {
      listener();
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
