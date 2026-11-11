/**
 * Persistent task queue.
 *
 * Tasks survive a restart: the queue is written to disk after every state change, and a task that
 * was `running` when the process died is recovered as `interrupted` rather than silently retried —
 * because the worker cannot know how far it got.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { internalError } from './errors';

export type QueuedTaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface QueuedTask {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  state: QueuedTaskState;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  maxAttempts: number;
  /** Id of the worker that owns the task, so a duplicate dispatch can be detected. */
  ownerId: string;
  result?: Record<string, unknown>;
  error?: { message: string; category: string };
  /** A stable key for idempotency: two tasks with the same key are the same operation. */
  idempotencyKey?: string;
}

export interface QueueSnapshot {
  version: number;
  tasks: QueuedTask[];
}

const QUEUE_VERSION = 1;

export interface TaskQueueOptions {
  stateDir: string;
  /** How many finished tasks to keep for the history. */
  historyLimit?: number;
  now?: () => number;
  /** Disable disk persistence (used in tests). */
  inMemory?: boolean;
}

export class TaskQueue {
  private readonly tasks = new Map<string, QueuedTask>();
  private readonly order: string[] = [];
  private readonly now: () => number;
  private readonly historyLimit: number;
  private readonly inMemory: boolean;
  private readonly path: string;
  private writing: Promise<void> = Promise.resolve();
  private counter = 0;

  constructor(options: TaskQueueOptions) {
    this.now = options.now ?? Date.now;
    this.historyLimit = options.historyLimit ?? 200;
    this.inMemory = options.inMemory ?? false;
    this.path = resolve(options.stateDir, 'task-queue.json');
  }

  /** Loads persisted tasks, marking anything that was running as interrupted. */
  async load(): Promise<void> {
    if (this.inMemory) return;
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch {
      return;
    }
    let snapshot: QueueSnapshot;
    try {
      snapshot = JSON.parse(raw) as QueueSnapshot;
    } catch {
      return;
    }
    if (!snapshot || !Array.isArray(snapshot.tasks)) return;
    for (const task of snapshot.tasks) {
      if (!task || typeof task.id !== 'string') continue;
      if (task.state === 'running') {
        task.state = 'interrupted';
        task.error = { message: 'the worker restarted while this task was running', category: 'internal' };
      }
      this.tasks.set(task.id, task);
      this.order.push(task.id);
    }
    this.pruneHistory();
  }

  private async persist(): Promise<void> {
    if (this.inMemory) return;
    const snapshot: QueueSnapshot = { version: QUEUE_VERSION, tasks: this.order.map((id) => this.tasks.get(id)!).filter(Boolean) };
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    // Serialise writes so two rapid state changes cannot interleave.
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await fs.writeFile(temporary, payload, 'utf8');
      await fs.rename(temporary, this.path);
    });
    await this.writing;
  }

  enqueue(input: {
    kind: string;
    payload: Record<string, unknown>;
    ownerId: string;
    maxAttempts?: number;
    idempotencyKey?: string;
  }): QueuedTask {
    if (input.idempotencyKey) {
      const existing = this.findByIdempotencyKey(input.idempotencyKey);
      if (existing && (existing.state === 'pending' || existing.state === 'running')) return existing;
    }
    this.counter += 1;
    const id = `q-${this.now().toString(36)}-${this.counter.toString(36)}`;
    const task: QueuedTask = {
      id,
      kind: input.kind,
      payload: input.payload,
      state: 'pending',
      enqueuedAt: this.now(),
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 1,
      ownerId: input.ownerId,
      idempotencyKey: input.idempotencyKey,
    };
    this.tasks.set(id, task);
    this.order.push(id);
    void this.persist();
    return task;
  }

  markRunning(id: string): QueuedTask {
    const task = this.require(id);
    task.state = 'running';
    task.startedAt = this.now();
    task.attempts += 1;
    void this.persist();
    return task;
  }

  markSucceeded(id: string, result?: Record<string, unknown>): QueuedTask {
    const task = this.require(id);
    task.state = 'succeeded';
    task.finishedAt = this.now();
    task.result = result;
    void this.persist();
    return task;
  }

  markFailed(id: string, error: { message: string; category: string }): QueuedTask {
    const task = this.require(id);
    task.state = 'failed';
    task.finishedAt = this.now();
    task.error = error;
    void this.persist();
    return task;
  }

  /** Returns a failed or interrupted task to the queue when a retry is safe. */
  requeue(id: string): QueuedTask {
    const task = this.require(id);
    task.state = 'pending';
    task.startedAt = undefined;
    task.finishedAt = undefined;
    void this.persist();
    return task;
  }

  cancel(id: string): QueuedTask {
    const task = this.require(id);
    if (task.state === 'pending' || task.state === 'running') {
      task.state = 'cancelled';
      task.finishedAt = this.now();
      void this.persist();
    }
    return task;
  }

  nextPending(): QueuedTask | null {
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (task && task.state === 'pending') return task;
    }
    return null;
  }

  get(id: string): QueuedTask | undefined {
    return this.tasks.get(id);
  }

  private require(id: string): QueuedTask {
    const task = this.tasks.get(id);
    if (!task) throw internalError(`unknown queued task ${id}`);
    return task;
  }

  findByIdempotencyKey(key: string): QueuedTask | undefined {
    for (const task of this.tasks.values()) if (task.idempotencyKey === key) return task;
    return undefined;
  }

  list(): QueuedTask[] {
    return this.order.map((id) => this.tasks.get(id)!).filter(Boolean);
  }

  pending(): QueuedTask[] {
    return this.list().filter((task) => task.state === 'pending');
  }

  active(): QueuedTask[] {
    return this.list().filter((task) => task.state === 'pending' || task.state === 'running');
  }

  stats(): Record<QueuedTaskState, number> {
    const result: Record<QueuedTaskState, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    };
    for (const task of this.tasks.values()) result[task.state] += 1;
    return result;
  }

  private pruneHistory(): void {
    const finished = this.order.filter((id) => {
      const state = this.tasks.get(id)?.state;
      return state && state !== 'pending' && state !== 'running';
    });
    const excess = finished.length - this.historyLimit;
    if (excess <= 0) return;
    for (const id of finished.slice(0, excess)) {
      this.tasks.delete(id);
      const index = this.order.indexOf(id);
      if (index >= 0) this.order.splice(index, 1);
    }
  }

  /** Waits for any in-flight disk write. Used by tests and shutdown. */
  async flush(): Promise<void> {
    await this.writing;
    this.pruneHistory();
    await this.persist();
  }

  clear(): void {
    this.tasks.clear();
    this.order.length = 0;
  }
}
