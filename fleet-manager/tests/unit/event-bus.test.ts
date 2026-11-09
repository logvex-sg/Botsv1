import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { EventRepository, NotificationRepository } from '../../src/main/db/repositories';
import { EventBus } from '../../src/main/services/events/event-bus';

let db: FleetDatabase;
let bus: EventBus;
let notifications: NotificationRepository;
beforeEach(() => {
  db = new FleetDatabase(':memory:');
  notifications = new NotificationRepository(db);
  bus = new EventBus(new EventRepository(db), notifications);
});
afterEach(() => db.close());

describe('EventBus', () => {
  it('publishes, persists and notifies listeners', () => {
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    const event = bus.publish({ type: 'WORKER_REGISTERED', source: 'host', message: 'hi' });
    expect(seen).toEqual(['WORKER_REGISTERED']);
    expect(event.id).toBeTruthy();
    expect(bus.recentEvents()).toHaveLength(1);
  });

  it('carries the worker scope through to the stored event', () => {
    bus.publish({ type: 'WORKER_DISCONNECTED', source: 'host', message: 'bye', workerId: 'w9' });
    expect(bus.recentEvents()[0].workerId).toBe('w9');
  });

  it('creates notifications only for notable severities', () => {
    bus.publish({ type: 'A', source: 'host', message: 'info', severity: 'info' });
    bus.publish({ type: 'B', source: 'host', message: 'warn', severity: 'warning' });
    bus.publish({ type: 'C', source: 'host', message: 'err', severity: 'error' });
    expect(notifications.list()).toHaveLength(2);
  });

  it('unsubscribes cleanly', () => {
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.publish({ type: 'X', source: 'host', message: '1' });
    off();
    bus.publish({ type: 'Y', source: 'host', message: '2' });
    expect(seen).toEqual(['X']);
  });
});
