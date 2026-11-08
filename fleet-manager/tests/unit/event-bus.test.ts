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
    const event = bus.publish({ type: 'TARGET_DETECTED', source: 'fleet', message: 'hi' });
    expect(seen).toEqual(['TARGET_DETECTED']);
    expect(event.id).toBeTruthy();
    expect(bus.recentEvents()).toHaveLength(1);
  });

  it('creates notifications only for notable severities', () => {
    bus.publish({ type: 'A', source: 'fleet', message: 'info', severity: 'info' });
    bus.publish({ type: 'B', source: 'fleet', message: 'warn', severity: 'warning' });
    bus.publish({ type: 'C', source: 'fleet', message: 'err', severity: 'error' });
    expect(notifications.list()).toHaveLength(2);
  });

  it('does not persist events marked persist:false', () => {
    bus.publish({ type: 'HEARTBEAT', source: 'fleet', message: 'beat', persist: false });
    expect(bus.recentEvents()).toHaveLength(0);
  });

  it('isolates throwing listeners', () => {
    bus.subscribe(() => { throw new Error('boom'); });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    expect(() => bus.publish({ type: 'X', source: 'fleet', message: 'x' })).not.toThrow();
    expect(seen).toEqual(['X']);
  });

  it('returns recent events newest first', () => {
    bus.publish({ type: 'A', source: 'fleet', message: '1' });
    bus.publish({ type: 'B', source: 'fleet', message: '2' });
    expect(bus.recentEvents()[0].type).toBe('B');
  });

  it('unsubscribes listeners', () => {
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    off();
    bus.publish({ type: 'A', source: 'fleet', message: '1' });
    expect(seen).toHaveLength(0);
  });
});
