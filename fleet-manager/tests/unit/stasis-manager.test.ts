import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDatabase } from '../../src/main/db/database';
import { StasisRepository } from '../../src/main/db/repositories';
import { StasisManager } from '../../src/main/services/stasis/stasis-manager';

let db: FleetDatabase;
let manager: StasisManager;
beforeEach(() => {
  db = new FleetDatabase(':memory:');
  manager = new StasisManager(new StasisRepository(db));
});
afterEach(() => db.close());

describe('StasisManager', () => {
  it('creates locations and requires a name', () => {
    expect(() => manager.create({ name: '', x: 0, y: 0, z: 0 })).toThrow();
    const location = manager.create({ name: 'Base', x: 10, y: 64, z: -5 });
    expect(location.state).toBe('UNKNOWN');
    expect(manager.list()).toHaveLength(1);
  });

  it('records a history entry only when the state changes', () => {
    const location = manager.create({ name: 'Base', x: 0, y: 0, z: 0 });
    const first = manager.setState(location.id, 'READY', 'verified');
    expect(first).not.toBeNull();
    expect(first?.to).toBe('READY');
    const second = manager.setState(location.id, 'READY');
    expect(second).toBeNull();
    const third = manager.setState(location.id, 'UNAVAILABLE', 'missing blocks');
    expect(third?.from).toBe('READY');
    expect(manager.historyFor(location.id)).toHaveLength(2);
  });

  it('reflects readiness reports without acting on the world', () => {
    const location = manager.create({ name: 'Base', x: 0, y: 0, z: 0 });
    manager.applyReadiness(location.id, true);
    expect(manager.get(location.id)?.state).toBe('READY');
    manager.applyReadiness(location.id, false, 'blocked');
    expect(manager.get(location.id)?.state).toBe('UNAVAILABLE');
    expect(manager.get(location.id)?.lastError).toBe('blocked');
  });
});
