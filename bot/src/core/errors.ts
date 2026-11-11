/**
 * Error taxonomy.
 *
 * Every failure the worker produces is classified, because the recovery layer's behaviour depends
 * on *why* something failed, not just that it did. In particular, a transfer that failed before it
 * could be observed to have happened is safe to retry; one that failed *after* a mutation may have
 * been applied must never be blindly repeated.
 */

export type ErrorCategory =
  | 'config'
  | 'connection'
  | 'protocol'
  | 'permission'
  | 'validation'
  | 'navigation'
  | 'inventory'
  | 'container'
  | 'shulker'
  | 'ai'
  | 'timeout'
  | 'cancelled'
  | 'internal';

/**
 * How much is known about whether the world changed before the failure.
 *
 * - `none`   — the operation had not started, or was purely read-only. Always safe to retry.
 * - `partial`— some mutation may have been applied and not observed. Retry only after reconciling.
 * - `applied`— the mutation definitely happened; the failure was in the report. Never repeat.
 */
export type MutationState = 'none' | 'partial' | 'applied';

export interface BotErrorOptions {
  category: ErrorCategory;
  /** True when repeating the whole operation cannot corrupt state. */
  retryable?: boolean;
  mutation?: MutationState;
  /** Extra structured context, logged and reported to the host. */
  detail?: Record<string, unknown>;
  cause?: unknown;
}

export class BotError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly mutation: MutationState;
  readonly detail: Record<string, unknown>;

  constructor(message: string, options: BotErrorOptions) {
    super(message);
    this.name = 'BotError';
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.mutation = options.mutation ?? 'none';
    this.detail = options.detail ?? {};
    if (options.cause !== undefined) this.cause = options.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      retryable: this.retryable,
      mutation: this.mutation,
      detail: this.detail,
    };
  }
}

export function isBotError(value: unknown): value is BotError {
  return value instanceof BotError;
}

/** Normalises anything thrown into a BotError so callers never have to branch on unknown shapes. */
export function asBotError(value: unknown, fallbackCategory: ErrorCategory = 'internal'): BotError {
  if (isBotError(value)) return value;
  if (value instanceof Error) {
    return new BotError(value.message, { category: fallbackCategory, cause: value });
  }
  return new BotError(String(value), { category: fallbackCategory });
}

export function configError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'config', detail });
}

export function connectionError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'connection', retryable: true, detail });
}

export function protocolError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'protocol', detail });
}

export function permissionError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'permission', detail });
}

export function validationError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'validation', detail });
}

export function navigationError(
  message: string,
  detail?: Record<string, unknown>,
  mutation: MutationState = 'none',
): BotError {
  return new BotError(message, { category: 'navigation', retryable: mutation === 'none', mutation, detail });
}

export function containerError(
  message: string,
  detail?: Record<string, unknown>,
  mutation: MutationState = 'none',
): BotError {
  return new BotError(message, { category: 'container', retryable: mutation === 'none', mutation, detail });
}

export function shulkerError(
  message: string,
  detail?: Record<string, unknown>,
  mutation: MutationState = 'none',
): BotError {
  return new BotError(message, { category: 'shulker', retryable: mutation === 'none', mutation, detail });
}

export function timeoutError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'timeout', retryable: true, detail });
}

export function cancelledError(message = 'operation cancelled'): BotError {
  return new BotError(message, { category: 'cancelled', retryable: false });
}

export function aiError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'ai', detail });
}

export function internalError(message: string, detail?: Record<string, unknown>): BotError {
  return new BotError(message, { category: 'internal', detail });
}

/**
 * Whether the recovery layer may repeat an operation, given its error.
 *
 * An error is only retryable when the operation is marked retryable *and* nothing was observed to
 * have mutated the world. `partial` is explicitly not retryable on its own — the caller must
 * reconcile first, which `verify.ts` does.
 */
export function mayRetry(error: unknown): boolean {
  const bot = asBotError(error);
  return bot.retryable && bot.mutation === 'none';
}
