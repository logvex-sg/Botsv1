/**
 * In-process publish/subscribe bus plus durable event log.
 *
 * Services publish {@link FleetEvent}s; the bus validates them, persists them, prunes old rows,
 * mirrors important ones into the notification centre and forwards them to any live subscribers
 * (IPC renderer, WebSocket clients). A throwing listener is isolated so one bad consumer cannot
 * break the rest.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { EventRepository, NotificationRepository } from '../../db/repositories';
import type { EventSeverity, FleetEvent } from '../../../shared/types';

export interface PublishInput {
  type: string;
  source: string;
  message: string;
  severity?: EventSeverity;
  instanceId?: string | null;
  accountId?: string | null;
  targetUuid?: string | null;
  payload?: Record<string, unknown>;
  /** When false the event is broadcast but not persisted (e.g. high-frequency metrics). */
  persist?: boolean;
}

const MAX_EVENTS = 5000;
const NOTIFY_SEVERITIES: EventSeverity[] = ['warning', 'error', 'success'];

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly recent: FleetEvent[] = [];
  private prunedSinceLast = 0;

  constructor(
    private readonly events: EventRepository,
    private readonly notifications: NotificationRepository,
  ) {
    this.emitter.setMaxListeners(100);
  }

  publish(input: PublishInput): FleetEvent {
    const event: FleetEvent = {
      id: randomUUID(),
      type: input.type,
      source: input.source,
      severity: input.severity ?? 'info',
      instanceId: input.instanceId ?? null,
      accountId: input.accountId ?? null,
      targetUuid: input.targetUuid ?? null,
      message: input.message,
      payload: input.payload ?? {},
      timestamp: Date.now(),
    };

    if (input.persist !== false) {
      this.events.insert(event);
      this.recent.push(event);
      if (this.recent.length > MAX_EVENTS) this.recent.shift();
      this.prune();
      if (NOTIFY_SEVERITIES.includes(event.severity)) this.notify(event);
    }

    this.emit(event);
    return event;
  }

  private notify(event: FleetEvent): void {
    this.notifications.insert({
      id: randomUUID(),
      eventId: event.id,
      type: event.type,
      severity: event.severity,
      title: humanise(event.type),
      body: event.message,
      read: false,
      timestamp: event.timestamp,
    });
  }

  private prune(): void {
    this.prunedSinceLast++;
    if (this.prunedSinceLast < 200) return;
    this.prunedSinceLast = 0;
    this.events.prune(MAX_EVENTS);
  }

  private emit(event: FleetEvent): void {
    for (const listener of this.emitter.listeners('event')) {
      try {
        (listener as (e: FleetEvent) => void)(event);
      } catch {
        // Isolate listeners: a broken consumer must not stop the others.
      }
    }
  }

  subscribe(listener: (event: FleetEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  /** Recent in-memory events (newest first) for the dashboard. */
  recentEvents(limit = 100): FleetEvent[] {
    return [...this.recent].reverse().slice(0, limit);
  }
}

function humanise(type: string): string {
  return type
    .toLowerCase()
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
