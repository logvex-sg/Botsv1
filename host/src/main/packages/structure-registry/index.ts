/**
 * Structure registry: the general registry of player structures.
 *
 * Portals are one kind of registered structure; the spec asks for the general case too — storage
 * rooms, farms, workshops, processing areas, temporary constructions — each with a location or a
 * defined region, ownership/authorisation notes, and a protected flag. This engine is the pure
 * model over those records: it validates regions, checks whether a point lies inside a structure,
 * finds what a proposed change would touch, and answers the questions the UI and the maintenance
 * planner ask.
 *
 * It never edits the world. A "removal preview" lists what would be affected and whether each
 * structure passed every safety check; the actual interaction is a separate, approved step.
 */
import type { PortalRecord, StructureRecord, StructureKind } from '../../../shared/types';
import { STRUCTURE_KINDS } from '../../../shared/types';

export type { StructureKind, MaintenanceState } from '../../../shared/types';
export { STRUCTURE_KINDS } from '../../../shared/types';

/**
 * A registered structure.
 *
 * `region` is an axis-aligned box in one dimension, inclusive, in any corner order. A single-block
 * structure still uses a region with equal min and max, so callers never special-case a point.
 */
export type RegisteredStructure = StructureRecord;

/** A structure reduced to a single representative point (its centre), for distance checks. */
export interface StructureCentre {
  dimension: string;
  x: number;
  y: number;
  z: number;
}

/** A normalised, order-independent region. */
export interface NormalisedRegion {
  dimension: string;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Normalises a structure's region so min/max are ordered regardless of how the corners were entered. */
export function regionOf(structure: RegisteredStructure): NormalisedRegion {
  return {
    dimension: structure.dimension,
    minX: Math.min(structure.x1, structure.x2),
    minY: Math.min(structure.y1, structure.y2),
    minZ: Math.min(structure.z1, structure.z2),
    maxX: Math.max(structure.x1, structure.x2),
    maxY: Math.max(structure.y1, structure.y2),
    maxZ: Math.max(structure.z1, structure.z2),
  };
}

/** The centre of a structure's region, for distance and map views. */
export function centreOf(structure: RegisteredStructure): StructureCentre {
  const region = regionOf(structure);
  return {
    dimension: region.dimension,
    x: (region.minX + region.maxX) / 2,
    y: (region.minY + region.maxY) / 2,
    z: (region.minZ + region.maxZ) / 2,
  };
}

/** The volume of a structure in blocks (inclusive of both corners). */
export function volumeOf(structure: RegisteredStructure): number {
  const region = regionOf(structure);
  return (region.maxX - region.minX + 1) * (region.maxY - region.minY + 1) * (region.maxZ - region.minZ + 1);
}

/** Whether a point lies inside a structure's region (inclusive). */
export function contains(structure: RegisteredStructure, dimension: string, x: number, y: number, z: number): boolean {
  const region = regionOf(structure);
  if (region.dimension !== dimension) return false;
  return x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY && z >= region.minZ && z <= region.maxZ;
}

/** Whether two structures' regions overlap (same dimension and boxes intersect). */
export function overlaps(a: RegisteredStructure, b: RegisteredStructure): boolean {
  const ra = regionOf(a);
  const rb = regionOf(b);
  if (ra.dimension !== rb.dimension) return false;
  return ra.minX <= rb.maxX && ra.maxX >= rb.minX && ra.minY <= rb.maxY && ra.maxY >= rb.minY && ra.minZ <= rb.maxZ && ra.maxZ >= rb.minZ;
}

/** The Euclidean distance between two structure centres (0 when in different dimensions is not meaningful; returns Infinity). */
export function distanceBetween(a: RegisteredStructure, b: RegisteredStructure): number {
  const ca = centreOf(a);
  const cb = centreOf(b);
  if (ca.dimension !== cb.dimension) return Number.POSITIVE_INFINITY;
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  const dz = ca.z - cb.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A structural problem the operator should look at. */
export interface StructureIssue {
  structureId: string;
  name: string;
  reason: 'protected' | 'maintenance' | 'unconfirmed' | 'overlap' | 'disabled';
  detail: string;
}

/** Flags every structure that needs attention, in one pass. */
export function issues(structures: readonly RegisteredStructure[], now = Date.now()): StructureIssue[] {
  const found: StructureIssue[] = [];
  for (const structure of structures) {
    if (structure.protected) {
      found.push({ structureId: structure.id, name: structure.name, reason: 'protected', detail: 'protected structures are never modified by automation' });
    }
    if (structure.maintenance === 'overdue') {
      found.push({ structureId: structure.id, name: structure.name, reason: 'maintenance', detail: 'maintenance is overdue' });
    }
    if (structure.maintenance === 'disabled') {
      found.push({ structureId: structure.id, name: structure.name, reason: 'disabled', detail: 'maintenance is disabled for this structure' });
    }
    if (structure.lastSeenAt === null) {
      found.push({ structureId: structure.id, name: structure.name, reason: 'unconfirmed', detail: 'no worker has confirmed this structure' });
    }
  }
  for (let i = 0; i < structures.length; i++) {
    for (let j = i + 1; j < structures.length; j++) {
      const a = structures[i];
      const b = structures[j];
      if (overlaps(a, b)) {
        found.push({ structureId: a.id, name: a.name, reason: 'overlap', detail: `overlaps ${b.name}` });
        found.push({ structureId: b.id, name: b.name, reason: 'overlap', detail: `overlaps ${a.name}` });
      }
    }
  }
  return found;
}

/** A structure whose maintenance window has elapsed. */
export function maintenanceDue(structures: readonly RegisteredStructure[], intervalMs: number, now = Date.now()): RegisteredStructure[] {
  return structures.filter((structure) => {
    if (structure.protected || structure.maintenance === 'disabled') return false;
    if (structure.maintenance === 'overdue' || structure.maintenance === 'due') return true;
    if (structure.lastSeenAt === null) return false;
    return now - structure.lastSeenAt > intervalMs;
  });
}

/**
 * A change preview: exactly which structures a proposed operation would touch.
 *
 * The preview never performs anything. A protected structure is listed but marked not actionable,
 * with the reason, so an operator sees the whole picture before approving.
 */
export interface StructureChangePreview {
  structureId: string;
  name: string;
  kind: StructureKind;
  /** Whether the structure passed every safety check for the proposed change. */
  actionable: boolean;
  /** Reasons the structure may not be changed. */
  reasons: string[];
  /** How many blocks the operation is estimated to touch. */
  estimatedBlocks: number;
}

/**
 * Builds a change preview for the structures a region intersects.
 *
 * `region` is the area the operator wants to act in. Any structure that overlaps it is listed;
 * protected structures and structures in another dimension are marked not actionable.
 */
export function previewChange(
  structures: readonly RegisteredStructure[],
  region: NormalisedRegion,
  options: { allowProtected?: boolean } = {},
): StructureChangePreview[] {
  const probe: RegisteredStructure = {
    id: '__probe__',
    name: 'probe',
    kind: 'other',
    dimension: region.dimension,
    x1: region.minX,
    y1: region.minY,
    z1: region.minZ,
    x2: region.maxX,
    y2: region.maxY,
    z2: region.maxZ,
    ownership: '',
    protected: false,
    maintenance: 'ok',
    lastSeenBy: null,
    lastSeenAt: null,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
  };
  return structures
    .filter((structure) => overlaps(structure, probe))
    .map((structure) => {
      const reasons: string[] = [];
      if (structure.protected && !options.allowProtected) reasons.push('structure is protected');
      if (structure.maintenance === 'disabled') reasons.push('maintenance is disabled for this structure');
      const overlap = regionOf(structure);
      const minX = Math.max(overlap.minX, region.minX);
      const maxX = Math.min(overlap.maxX, region.maxX);
      const minY = Math.max(overlap.minY, region.minY);
      const maxY = Math.min(overlap.maxY, region.maxY);
      const minZ = Math.max(overlap.minZ, region.minZ);
      const maxZ = Math.min(overlap.maxZ, region.maxZ);
      return {
        structureId: structure.id,
        name: structure.name,
        kind: structure.kind,
        actionable: reasons.length === 0,
        reasons,
        estimatedBlocks: (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1),
      };
    });
}

/** A count of structures by kind, for the dashboard. */
export function countByKind(structures: readonly RegisteredStructure[]): Record<StructureKind, number> {
  const counts = Object.fromEntries(STRUCTURE_KINDS.map((kind) => [kind, 0])) as Record<StructureKind, number>;
  for (const structure of structures) counts[structure.kind] += 1;
  return counts;
}

/**
 * Adopts a portal record into the general registry.
 *
 * Portals keep their richer record for the portal workflow; this projects one into a registered
 * structure so the structure dashboard can show portals alongside everything else without
 * duplicating the portal model.
 */
export function fromPortal(portal: PortalRecord): RegisteredStructure {
  return {
    id: portal.id,
    name: portal.name,
    kind: 'portal',
    dimension: portal.dimension,
    x1: portal.x,
    y1: portal.y,
    z1: portal.z,
    x2: portal.x,
    y2: portal.y,
    z2: portal.z,
    ownership: portal.permanent ? 'permanent' : portal.temporary ? 'temporary' : '',
    protected: portal.permanent,
    maintenance: portal.needsMaintenance ? 'due' : 'ok',
    lastSeenBy: portal.lastSeenBy,
    lastSeenAt: portal.lastSeenAt,
    notes: portal.notes,
    createdAt: portal.createdAt,
    updatedAt: portal.updatedAt,
  };
}
