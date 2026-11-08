import { describe, it, expect, beforeEach } from 'vitest';
import { RoleCoordinator } from '../../src/main/services/roles/coordinator';
import { EventBus } from '../../src/main/services/events/event-bus';
import { FleetDatabase } from '../../src/main/db/database';
import { EventRepository, NotificationRepository } from '../../src/main/db/repositories';

let bus: EventBus;
let coordinator: RoleCoordinator;
let db: FleetDatabase;

beforeEach(() => {
  db = new FleetDatabase(':memory:');
  bus = new EventBus(new EventRepository(db), new NotificationRepository(db));
  coordinator = new RoleCoordinator(bus);
});

describe('RoleCoordinator', () => {
  it('accepts a permitted role event and publishes it', () => {
    const result = coordinator.submit({ type: 'EQUIPMENT_READY', role: 'GEARER', instanceId: 'i1' });
    expect(result.accepted).toBe(true);
    expect(bus.recentEvents()).toHaveLength(1);
  });

  it('rejects an event from a role without permission', () => {
    const result = coordinator.submit({ type: 'EQUIPMENT_READY', role: 'HUNTER' });
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('may not emit');
    expect(bus.recentEvents()).toHaveLength(0);
  });

  it('suppresses duplicate events inside the window', () => {
    expect(coordinator.submit({ type: 'TARGET_DETECTED', role: 'HUNTER', targetUuid: 'u1' }).accepted).toBe(true);
    const second = coordinator.submit({ type: 'TARGET_DETECTED', role: 'HUNTER', targetUuid: 'u1' });
    expect(second.accepted).toBe(false);
    expect(second.reason).toContain('duplicate');
  });

  it('allows the same event for a different target', () => {
    coordinator.submit({ type: 'TARGET_DETECTED', role: 'HUNTER', targetUuid: 'u1' });
    expect(coordinator.submit({ type: 'TARGET_DETECTED', role: 'HUNTER', targetUuid: 'u2' }).accepted).toBe(true);
  });

  it('blocks non-system events while emergency-stopped', () => {
    coordinator.setEmergencyStop(true);
    const result = coordinator.submit({ type: 'TARGET_DETECTED', role: 'HUNTER' });
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('emergency');
  });

  it('rejects malformed events', () => {
    expect(coordinator.submit({ type: '', role: 'GEARER' }).accepted).toBe(false);
    expect(coordinator.submit({ type: 'X', role: '' }).accepted).toBe(false);
  });
});
