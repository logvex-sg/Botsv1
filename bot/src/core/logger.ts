/**
 * Structured logger.
 *
 * One line per event, always JSON when asked for it, with a stable shape so the host's console view
 * and the log file agree. Rate limiting lives here because "no excessive logging" is a requirement
 * and the tick loops that would otherwise flood the log go through this class.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  level?: LogLevel;
  scope?: string;
  /** Maximum lines emitted per scope per second. 0 disables limiting. */
  rateLimitPerSecond?: number;
  now?: () => number;
}

export class Logger {
  private level: LogLevel;
  private readonly scope: string;
  private readonly rateLimit: number;
  private readonly now: () => number;
  private readonly sinks = new Set<LogSink>();
  private windowStart = 0;
  private windowCount = 0;
  private suppressed = 0;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.scope = options.scope ?? 'bot';
    this.rateLimit = options.rateLimitPerSecond ?? 0;
    this.now = options.now ?? Date.now;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  /** A logger that shares sinks and level but tags every line with a child scope. */
  child(scope: string): Logger {
    const child = new Logger({
      level: this.level,
      scope: `${this.scope}:${scope}`,
      rateLimitPerSecond: this.rateLimit,
      now: this.now,
    });
    for (const sink of this.sinks) child.addSink(sink);
    // Keep the child's level in step with the parent's.
    child.parent = this;
    return child;
  }

  private parent?: Logger;

  addSink(sink: LogSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  private effectiveLevel(): LogLevel {
    return this.parent ? this.parent.getLevel() : this.level;
  }

  private allows(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.effectiveLevel()];
  }

  private limited(): boolean {
    if (this.rateLimit <= 0) return false;
    const now = this.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
      if (this.suppressed > 0) {
        const dropped = this.suppressed;
        this.suppressed = 0;
        this.emit({
          at: now,
          level: 'debug',
          scope: this.scope,
          message: `suppressed ${dropped} log line(s) in the previous second`,
        });
      }
    }
    this.windowCount += 1;
    if (this.windowCount > this.rateLimit) {
      this.suppressed += 1;
      return true;
    }
    return false;
  }

  private emit(record: LogRecord): void {
    for (const sink of this.sinks) {
      try {
        sink(record);
      } catch {
        // A broken sink must never take down the worker.
      }
    }
    if (this.parent && this.parent.sinks.size > 0) return;
    if (this.sinks.size === 0) {
      const line = formatRecord(record);
      if (record.level === 'error') console.error(line);
      else if (record.level === 'warn') console.warn(line);
      else console.log(line);
    }
  }

  log(level: LogLevel, message: string, detail?: Record<string, unknown>): void {
    if (!this.allows(level)) return;
    if (level === 'debug' && this.limited()) return;
    this.emit({ at: this.now(), level, scope: this.scope, message, detail });
  }

  debug(message: string, detail?: Record<string, unknown>): void {
    this.log('debug', message, detail);
  }
  info(message: string, detail?: Record<string, unknown>): void {
    this.log('info', message, detail);
  }
  warn(message: string, detail?: Record<string, unknown>): void {
    this.log('warn', message, detail);
  }
  error(message: string, detail?: Record<string, unknown>): void {
    this.log('error', message, detail);
  }
}

export function formatRecord(record: LogRecord): string {
  const time = new Date(record.at).toISOString();
  const detail = record.detail && Object.keys(record.detail).length > 0 ? ` ${JSON.stringify(record.detail)}` : '';
  return `${time} ${record.level.toUpperCase().padEnd(5)} [${record.scope}] ${record.message}${detail}`;
}

export function parseLevel(value: string | undefined, fallback: LogLevel = 'info'): LogLevel {
  const lower = (value ?? '').toLowerCase();
  return lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error' ? lower : fallback;
}
