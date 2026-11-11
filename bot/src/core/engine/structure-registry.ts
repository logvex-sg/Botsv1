/**
 * Structure registry.
 *
 * A structure is an inclusive region the operator has authorised. The registry answers three
 * questions: is a point inside a structure, would a proposed change overlap one, and which
 * structures need attention. A protected structure is never actionable — the preview says so and
 * refuses to plan around it.
 */

import type { MaintenanceState, Region, RegisteredStructure, StructureKind, Vec3, PortalRecord } from '../types';

export const DEFAULT_MAINTENANCE_INTERVAL_DAYS = 7;
export const OVERDUE_GRACE_DAYS = 3;

export function regionOf(a: Vec3, b: Vec3, dimension: string): Region {
  return {
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    dimension,
  };
}

export function volumeOf(region: Region): number {
  return (
    (region.max.x - region.min.x + 1) * (region.max.y - region.min.y + 1) * (region.max.z - region.min.z + 1)
  );
}

export function centreOf(region: Region): Vec3 {
  return {
    x: Math.floor((region.min.x + region.max.x) / 2),
    y: Math.floor((region.min.y + region.max.y) / 2),
    z: Math.floor((region.min.z + region.max.z) / 2),
  };
}

export function contains(region: Region, point: Vec3, dimension?: string): boolean {
  if (dimension && dimension !== region.dimension) return false;
  return (
    point.x >= region.min.x &&
    point.x <= region.max.x &&
    point.y >= region.min.y &&
    point.y <= region.max.y &&
    point.z >= region.min.z &&
    point.z <= region.max.z
  );
}

export function overlaps(a: Region, b: Region): boolean {
  if (a.dimension !== b.dimension) return false;
  return !(
    a.max.x < b.min.x ||
    a.min.x > b.max.x ||
    a.max.y < b.min.y ||
    a.min.y > b.max.y ||
    a.max.z < b.min.z ||
    a.min.z > b.max.z
  );
}

export function regionDistance(a: Region, b: Region): number {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x));
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y));
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export type StructureIssueKind =
  | 'protected'
  | 'overdue'
  | 'unconfirmed'
  | 'overlapping'
  | 'unsized';

export interface StructureIssue {
  structureId: string;
  name: string;
  kind: StructureIssueKind;
  detail: string;
}

/**
 * Every reason a structure needs a human's attention.
 *
 * `overlapping` is deliberately reported rather than resolved: two structures claiming the same
 * blocks is an operator decision, not something the bot should silently fix.
 */
export function issues(
  structures: readonly RegisteredStructure[],
  now: number,
  options: { staleMs?: number } = {},
): StructureIssue[] {
  const staleMs = options.staleMs ?? 30 * 24 * 60 * 60 * 1000;
  const found: StructureIssue[] = [];

  for (const structure of structures) {
    if (volumeOf(structure.region) <= 0) {
      found.push({ structureId: structure.id, name: structure.name, kind: 'unsized', detail: 'region is empty' });
    }
    if (structure.protected) {
      found.push({
        structureId: structure.id,
        name: structure.name,
        kind: 'protected',
        detail: 'protected structures are never modified automatically',
      });
    }
    if (structure.maintenance === 'overdue') {
      found.push({ structureId: structure.id, name: structure.name, kind: 'overdue', detail: 'maintenance is overdue' });
    }
    if (typeof structure.lastMaintainedAt === 'number' && now - structure.lastMaintainedAt > staleMs) {
      found.push({
        structureId: structure.id,
        name: structure.name,
        kind: 'unconfirmed',
        detail: 'maintenance has not been confirmed recently',
      });
    }
  }

  for (let i = 0; i < structures.length; i += 1) {
    for (let j = i + 1; j < structures.length; j += 1) {
      const a = structures[i]!;
      const b = structures[j]!;
      if (overlaps(a.region, b.region)) {
        found.push({
          structureId: a.id,
          name: a.name,
          kind: 'overlapping',
          detail: `overlaps "${b.name}"`,
        });
      }
    }
  }

  return found;
}

/** Structures whose maintenance interval has elapsed, worst first. */
export function maintenanceDue(
  structures: readonly RegisteredStructure[],
  now: number,
): RegisteredStructure[] {
  const due: Array<{ structure: RegisteredStructure; overdueDays: number }> = [];
  for (const structure of structures) {
    if (structure.protected) continue;
    const interval = structure.maintenanceIntervalDays ?? DEFAULT_MAINTENANCE_INTERVAL_DAYS;
    const last = structure.lastMaintainedAt ?? structure.createdAt;
    const elapsedDays = (now - last) / (24 * 60 * 60 * 1000);
    if (elapsedDays >= interval) due.push({ structure, overdueDays: elapsedDays - interval });
  }
  return due.sort((a, b) => b.overdueDays - a.overdueDays).map((entry) => entry.structure);
}

export function maintenanceStateFor(
  structure: Pick<RegisteredStructure, 'lastMaintainedAt' | 'createdAt' | 'maintenanceIntervalDays'>,
  now: number,
): MaintenanceState {
  const interval = structure.maintenanceIntervalDays ?? DEFAULT_MAINTENANCE_INTERVAL_DAYS;
  const last = structure.lastMaintainedAt ?? structure.createdAt;
  const elapsedDays = (now - last) / (24 * 60 * 60 * 1000);
  if (elapsedDays >= interval + OVERDUE_GRACE_DAYS) return 'overdue';
  if (elapsedDays >= interval) return 'due';
  return 'ok';
}

export interface StructureChangePreview {
  /** Structures the proposed region overlaps. */
  touched: Array<{ structureId: string; name: string; kind: StructureKind; protected: boolean; actionable: boolean; reason: string }>;
  /** Blocks the change would cover. */
  volume: number;
  /** True only when nothing protected is in the way. */
  safe: boolean;
  reason: string;
}

/**
 * Previews what a proposed change would touch.
 *
 * This never performs anything. Its job is to say, before the fact, which structures are involved
 * and whether any of them is off limits.
 */
export function previewChange(
  region: Region,
  structures: readonly RegisteredStructure[],
  options: { excludeIds?: readonly string[] } = {},
): StructureChangePreview {
  const exclude = new Set(options.excludeIds ?? []);
  const touched: StructureChangePreview['touched'] = [];

  for (const structure of structures) {
    if (exclude.has(structure.id)) continue;
    if (!overlaps(region, structure.region)) continue;
    touched.push({
      structureId: structure.id,
      name: structure.name,
      kind: structure.kind,
      protected: structure.protected,
      actionable: !structure.protected,
      reason: structure.protected ? 'protected structure' : 'structure may be maintained',
    });
  }

  const blocked = touched.filter((entry) => !entry.actionable);
  return {
    touched,
    volume: volumeOf(region),
    safe: blocked.length === 0,
    reason:
      blocked.length === 0
        ? touched.length === 0
          ? 'the change touches no registered structure'
          : `the change touches ${touched.length} structure(s), none protected`
        : `${blocked.length} protected structure(s) are in the way`,
  };
}

export function countByKind(structures: readonly RegisteredStructure[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const structure of structures) counts[structure.kind] = (counts[structure.kind] ?? 0) + 1;
  return counts;
}

/**
 * Projects a registered portal into the structure registry so one dashboard shows everything.
 *
 * The projection is read-only: a portal's protected flag is derived from whether it is confirmed.
 */
export function fromPortal(portal: PortalRecord): RegisteredStructure {
  return {
    id: `portal:${portal.id}`,
    name: portal.label,
    kind: 'other',
    region: regionOf(portal.position, portal.position, portal.dimension),
    protected: !portal.confirmed,
    maintenance: 'ok',
    createdAt: portal.registeredAt,
    lastMaintainedAt: portal.lastSeenAt,
    notes: portal.target ? `leads to ${portal.targetDimension ?? 'unknown'} ${portal.target.x},${portal.target.y},${portal.target.z}` : undefined,
  };
}

export function findByPoint(
  structures: readonly RegisteredStructure[],
  point: Vec3,
  dimension: string,
): RegisteredStructure[] {
  return structures.filter((structure) => contains(structure.region, point, dimension));
}

export function normaliseRegion(region: Region): Region {
  return regionOf(region.min, region.max, region.dimension);
}
