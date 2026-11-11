/**
 * Shared observations.
 *
 * An observation is something a worker saw and reported: a player, a structure, a container, a
 * landmark. The hive keeps them together so one worker's sighting is visible to the whole swarm,
 * and so the same thing is not reported twice. Observations are *observations*: they record what
 * was visible from legitimate gameplay, never a hidden position or a private server fact, and they
 * carry no claim of ownership or permission to touch anything.
 */

import type { Vec3 } from './formations';

export type ObservationKind = 'player' | 'structure' | 'container' | 'landmark' | 'terrain';

export interface Observation {
  id: string;
  kind: ObservationKind;
  /** The worker that reported it. */
  workerId: string;
  position: Vec3;
  dimension: string;
  /** When the worker reported it (ms since epoch). */
  at: number;
  /** A player's name, a structure's shape, a container's block, etc. */
  label: string;
  /** Free-form detail the worker attached. */
  detail: Record<string, unknown>;
}

export interface PlayerObservation {
  name: string;
  position: Vec3;
  dimension: string;
  at: number;
  /** How far the reporting worker was when it saw the player. */
  distance: number;
  /** The worker that reported it. */
  reportedBy: string;
  /** Whether the player was within the worker's visible range when last seen. */
  visible: boolean;
}

/**
 * Deduplicates observations by a spatial key.
 *
 * Two workers reporting the same structure within `radius` blocks collapse to the most recent one,
 * so the map does not fill with near-identical pins. A new observation with a different label in
 * the same place is kept, because it may be a genuinely different finding.
 */
export function dedupe(observations: readonly Observation[], radius = 8): Observation[] {
  const kept: Observation[] = [];
  for (const observation of observations) {
    const existing = kept.find(
      (candidate) =>
        candidate.kind === observation.kind &&
        candidate.label === observation.label &&
        candidate.dimension === observation.dimension &&
        distance2(candidate.position, observation.position) <= radius * radius,
    );
    if (existing) {
      // Keep the newer one in place, preserving the original ordering.
      if (observation.at > existing.at) {
        const index = kept.indexOf(existing);
        kept[index] = observation;
      }
      continue;
    }
    kept.push(observation);
  }
  return kept;
}

/** The most recent sighting of each player, newest first. */
export function latestPlayers(observations: readonly Observation[]): PlayerObservation[] {
  const byName = new Map<string, PlayerObservation>();
  for (const observation of observations) {
    if (observation.kind !== 'player') continue;
    const name = String(observation.detail.name ?? observation.label);
    const distance = Number(observation.detail.distance ?? 0);
    const visible = observation.detail.visible !== false;
    const current = byName.get(name);
    if (!current || observation.at > current.at) {
      byName.set(name, {
        name,
        position: observation.position,
        dimension: observation.dimension,
        at: observation.at,
        distance,
        reportedBy: observation.workerId,
        visible,
      });
    }
  }
  return [...byName.values()].sort((a, b) => b.at - a.at);
}

function distance2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** A stable id for an observation, so re-reporting the same thing updates rather than duplicates. */
export function observationId(kind: ObservationKind, label: string, position: Vec3): string {
  return `${kind}:${label}:${position.x}:${position.y}:${position.z}`;
}
