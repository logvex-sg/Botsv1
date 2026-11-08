/**
 * Stasis manager.
 *
 * Tracks named stasis locations, their readiness and state history. It observes only: readiness is
 * derived from the associated instance's health and inventory reports, and state-changing actions
 * require an explicit confirmation flag.
 */
import type { StasisRepository } from '../../db/repositories';
import type { StasisLocation, StasisState } from '../../../shared/types';

export interface StasisInput {
  name: string;
  instanceId?: string | null;
  serverProfileId?: string | null;
  dimension?: string;
  x: number;
  y: number;
  z: number;
  config?: Record<string, unknown>;
}

export interface StasisChange {
  id: string;
  locationId: string;
  from: StasisState;
  to: StasisState;
  reason: string;
  timestamp: number;
}

const HISTORY_LIMIT = 200;

export class StasisManager {
  private readonly history: StasisChange[] = [];

  constructor(private readonly repo: StasisRepository) {}

  list(): StasisLocation[] {
    return this.repo.list();
  }

  get(id: string): StasisLocation | undefined {
    return this.repo.get(id);
  }

  create(input: StasisInput): StasisLocation {
    if (!input.name || input.name.trim().length === 0) throw new Error('Stasis location name is required.');
    return this.repo.create({
      name: input.name.trim(),
      instanceId: input.instanceId ?? null,
      serverProfileId: input.serverProfileId ?? null,
      dimension: input.dimension ?? '',
      x: input.x,
      y: input.y,
      z: input.z,
      state: 'UNKNOWN',
      lastActivity: null,
      lastVerified: null,
      lastError: null,
      config: input.config ?? {},
    });
  }

  update(id: string, patch: Partial<StasisLocation>): StasisLocation | undefined {
    return this.repo.update(id, patch);
  }

  remove(id: string): boolean {
    return this.repo.remove(id);
  }

  /**
   * Records a new state for a location, appending to the history only when it actually changed.
   * Returns the change (or null when the state was unchanged).
   */
  setState(id: string, state: StasisState, reason = ''): StasisChange | null {
    const location = this.repo.get(id);
    if (!location) return null;
    const from = location.state;
    this.repo.update(id, {
      state,
      lastVerified: Date.now(),
      lastActivity: Date.now(),
      lastError: state === 'ERROR' || state === 'UNAVAILABLE' ? reason : null,
    });
    if (from === state) return null;
    const change: StasisChange = { id: `${id}-${Date.now()}`, locationId: id, from, to: state, reason, timestamp: Date.now() };
    this.history.push(change);
    while (this.history.length > HISTORY_LIMIT) this.history.shift();
    return change;
  }

  historyFor(locationId?: string): StasisChange[] {
    return locationId ? this.history.filter((c) => c.locationId === locationId) : [...this.history];
  }

  /**
   * Applies an observed readiness report from a STASIS instance.
   * Never performs a state change on its own; it only reflects what was observed.
   */
  applyReadiness(id: string, ready: boolean, reason = ''): StasisChange | null {
    return this.setState(id, ready ? 'READY' : 'UNAVAILABLE', reason);
  }
}
