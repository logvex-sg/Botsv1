/**
 * Role coordinator.
 *
 * Every role-generated event flows through here. The coordinator validates the envelope, checks
 * that the emitting role is allowed to send that event type, de-duplicates repeated events inside
 * a short window, records the outcome and forwards accepted events to the {@link EventBus}.
 *
 * It also owns the emergency-stop flag: while engaged, no role action beyond observation is
 * accepted.
 */
import { randomUUID } from 'node:crypto';
import { isRoleAllowed, EVENT_SCHEMA_VERSION, type EventEnvelope } from '../../../shared/events';
import type { EventBus } from '../events/event-bus';
import type { EventSeverity } from '../../../shared/types';

export interface IncomingEvent {
  type: string;
  role: string;
  source?: string;
  instanceId?: string | null;
  targetUuid?: string | null;
  payload?: Record<string, unknown>;
  severity?: EventSeverity;
}

export interface CoordinatorResult {
  accepted: boolean;
  reason?: string;
  envelope?: EventEnvelope;
}

const DEDUPE_WINDOW_MS = 2000;

export class RoleCoordinator {
  private readonly lastSeen = new Map<string, number>();
  private emergencyStopped = false;

  constructor(private readonly bus: EventBus) {}

  setEmergencyStop(engaged: boolean): void {
    this.emergencyStopped = engaged;
  }

  isEmergencyStopped(): boolean {
    return this.emergencyStopped;
  }

  /**
   * Validates and (when accepted) publishes a role event.
   * Returns a {@link CoordinatorResult}; rejected events carry a human-readable reason.
   */
  submit(event: IncomingEvent): CoordinatorResult {
    if (!event || typeof event.type !== 'string' || event.type.length === 0) {
      return { accepted: false, reason: 'event type is required' };
    }
    if (typeof event.role !== 'string' || event.role.length === 0) {
      return { accepted: false, reason: 'role is required' };
    }
    if (!isRoleAllowed(event.type, event.role)) {
      return { accepted: false, reason: `role ${event.role} may not emit ${event.type}` };
    }
    if (this.emergencyStopped && event.type !== 'HEARTBEAT' && event.type !== 'SYSTEM') {
      return { accepted: false, reason: 'emergency stop engaged' };
    }

    const dedupeKey = `${event.role}:${event.type}:${event.instanceId ?? ''}:${event.targetUuid ?? ''}`;
    const now = Date.now();
    const last = this.lastSeen.get(dedupeKey);
    if (last != null && now - last < DEDUPE_WINDOW_MS) {
      return { accepted: false, reason: 'duplicate event suppressed' };
    }
    this.lastSeen.set(dedupeKey, now);

    const envelope: EventEnvelope = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      id: randomUUID(),
      type: event.type,
      timestamp: now,
      source: event.source ?? 'fleet',
      role: event.role,
      instanceId: event.instanceId ?? null,
      targetUuid: event.targetUuid ?? null,
      payload: event.payload ?? {},
    };

    this.bus.publish({
      type: event.type,
      source: envelope.source,
      severity: event.severity ?? 'info',
      instanceId: envelope.instanceId,
      targetUuid: envelope.targetUuid,
      message: describe(envelope),
      payload: { ...envelope.payload, role: envelope.role, schemaVersion: EVENT_SCHEMA_VERSION },
    });

    return { accepted: true, envelope };
  }

  /** Clears the de-duplication window (used by tests and after a reconnect). */
  reset(): void {
    this.lastSeen.clear();
  }
}

function describe(envelope: EventEnvelope): string {
  const subject = envelope.targetUuid ? ` target=${envelope.targetUuid}` : '';
  const instance = envelope.instanceId ? ` instance=${envelope.instanceId}` : '';
  return `${envelope.role} ${envelope.type}${instance}${subject}`;
}
