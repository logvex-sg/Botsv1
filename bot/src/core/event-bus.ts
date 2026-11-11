/**
 * A small synchronous event bus.
 *
 * Listeners are isolated: a throwing subscriber is logged and skipped, never allowed to break the
 * publisher. This is the same contract the host's bus uses, so an event means the same thing on
 * both sides.
 */

import { Logger } from './logger';

export interface BotEvent {
  type: string;
  at: number;
  workerId?: string;
  payload?: Record<string, unknown>;
}

export type Listener = (event: BotEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly anyListeners = new Set<Listener>();
  private readonly ring: BotEvent[] = [];
  private readonly limit: number;
  private readonly logger?: Logger;
  private readonly now: () => number;

  constructor(options: { limit?: number; logger?: Logger; now?: () => number } = {}) {
    this.limit = options.limit ?? 500;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  subscribe(type: string, listener: Listener): () => void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
    return () => bucket.delete(listener);
  }

  subscribeAll(listener: Listener): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  publish(type: string, payload?: Record<string, unknown>, workerId?: string): BotEvent {
    const event: BotEvent = { type, at: this.now(), payload, workerId };
    this.ring.push(event);
    if (this.ring.length > this.limit) this.ring.splice(0, this.ring.length - this.limit);

    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.warn('event listener threw', { type, error: String(error) });
      }
    }
    for (const listener of this.anyListeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger?.warn('event listener threw', { type, error: String(error) });
      }
    }
    return event;
  }

  recent(limit = 100): BotEvent[] {
    return this.ring.slice(Math.max(0, this.ring.length - limit));
  }

  clear(): void {
    this.ring.length = 0;
  }
}
