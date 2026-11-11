/**
 * Formation engine.
 *
 * Given a formation, a commander position and facing, and the list of member slots, this computes
 * where each member should stand. It is pure: no sockets, no workers, no world. That is what makes
 * "circle around me" testable as arithmetic rather than as a live-bot experiment.
 *
 * Every formation returns absolute target positions, already offset from the commander, so the
 * caller only has to hand them to `navigate`.
 */

export type FormationKind =
  | 'follow'
  | 'circle'
  | 'diamond'
  | 'line'
  | 'escort'
  | 'scatter'
  | 'custom';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface FormationSpec {
  kind: FormationKind;
  /** Spacing between members, in blocks. */
  spacing: number;
  /** Radius for circle/escort/scatter. Ignored by the others. */
  radius?: number;
  /** Rotation in degrees, applied around the commander. */
  rotation?: number;
  /** For `line`, how many ranks wide. For `scatter`, unused. */
  depth?: number;
  /** For `custom`, explicit offsets keyed by slot index. */
  offsets?: Vec3[];
  /** Whether the formation should rotate to face the commander's heading. */
  alignToHeading?: boolean;
}

export const DEFAULT_FORMATION: FormationSpec = {
  kind: 'follow',
  spacing: 3,
  radius: 6,
  rotation: 0,
  depth: 1,
  alignToHeading: false,
};

/** A commander's position and heading, both optional (a commander may not be facing anywhere yet). */
export interface CommanderFrame {
  position: Vec3;
  /** Heading in degrees, 0 = +Z (south), increasing clockwise. */
  heading?: number;
}

/**
 * Places `count` members for the given formation.
 *
 * The result is ordered by slot: index `i` of the output is where member `i` of the input list
 * should stand. Callers pair members to slots themselves so a stable member ordering produces a
 * stable assignment, which is what stops members from swapping places on every recalculation.
 */
export function formationPositions(spec: FormationSpec, frame: CommanderFrame, count: number): Vec3[] {
  if (count <= 0) return [];
  const spacing = spec.spacing > 0 ? spec.spacing : DEFAULT_FORMATION.spacing;
  const rotation = ((spec.rotation ?? 0) * Math.PI) / 180;
  const heading = spec.alignToHeading && typeof frame.heading === 'number' ? (frame.heading * Math.PI) / 180 : 0;

  const local = localOffsets(spec, count, spacing);

  return local.map((offset) => {
    // Rotate first by the formation's own rotation, then by the commander's heading when asked.
    const angle = rotation + heading;
    const x = offset.x * Math.cos(angle) - offset.z * Math.sin(angle);
    const z = offset.x * Math.sin(angle) + offset.z * Math.cos(angle);
    return {
      x: Math.round((frame.position.x + x) * 1000) / 1000,
      y: frame.position.y,
      z: Math.round((frame.position.z + z) * 1000) / 1000,
    };
  });
}

/** Offsets relative to the commander, before rotation. */
function localOffsets(spec: FormationSpec, count: number, spacing: number): Vec3[] {
  switch (spec.kind) {
    case 'follow':
      return followOffsets(count, spacing);
    case 'circle':
      return circleOffsets(count, spec.radius ?? spacing * Math.max(1, count) * 0.5);
    case 'diamond':
      return diamondOffsets(count, spacing);
    case 'line':
      return lineOffsets(count, spacing, spec.depth ?? 1);
    case 'escort':
      return escortOffsets(count, spacing, spec.radius ?? spacing * 2);
    case 'scatter':
      return scatterOffsets(count, spec.radius ?? 12);
    case 'custom':
      return customOffsets(spec, count, spacing);
    default:
      return followOffsets(count, spacing);
  }
}

/**
 * Follow: a queue behind the commander, staggered so members do not stand in a single file that
 * blocks the commander's path. The commander's own cell is never used.
 */
function followOffsets(count: number, spacing: number): Vec3[] {
  const offsets: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const rank = Math.floor(i / 2) + 1;
    const side = i % 2 === 0 ? -1 : 1;
    offsets.push({ x: side * (spacing / 2), y: 0, z: rank * spacing });
  }
  return offsets;
}

/** Circle: evenly spaced on a ring, so no two members share a cell even as the count changes. */
function circleOffsets(count: number, radius: number): Vec3[] {
  const offsets: Vec3[] = [];
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i += 1) {
    const angle = step * i;
    offsets.push({
      x: Math.round(Math.cos(angle) * radius * 1000) / 1000,
      y: 0,
      z: Math.round(Math.sin(angle) * radius * 1000) / 1000,
    });
  }
  return offsets;
}

/** Diamond: rings expanding outwards, filled in a stable order. */
function diamondOffsets(count: number, spacing: number): Vec3[] {
  const offsets: Vec3[] = [];
  let ring = 1;
  while (offsets.length < count) {
    const r = ring * spacing;
    const ringPoints: Vec3[] = [
      { x: 0, y: 0, z: r },
      { x: r, y: 0, z: 0 },
      { x: 0, y: 0, z: -r },
      { x: -r, y: 0, z: 0 },
    ];
    for (const point of ringPoints) {
      if (offsets.length >= count) break;
      offsets.push(point);
    }
    ring += 1;
  }
  return offsets;
}

/** Line: ranks behind the commander, `depth` wide. */
function lineOffsets(count: number, spacing: number, depth: number): Vec3[] {
  const width = Math.max(1, depth);
  const offsets: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const column = i % width;
    const rank = Math.floor(i / width) + 1;
    const centred = column - (width - 1) / 2;
    offsets.push({ x: centred * spacing, y: 0, z: rank * spacing });
  }
  return offsets;
}

/** Escort: a forward arc, so members flank rather than trail. */
function escortOffsets(count: number, spacing: number, radius: number): Vec3[] {
  const offsets: Vec3[] = [];
  const arc = Math.PI; // a half-circle in front
  const step = count > 1 ? arc / (count - 1) : 0;
  for (let i = 0; i < count; i += 1) {
    const angle = -arc / 2 + step * i;
    offsets.push({
      x: Math.round(Math.sin(angle) * radius * 1000) / 1000,
      y: 0,
      z: Math.round(-Math.cos(angle) * radius * 1000) / 1000,
    });
  }
  void spacing;
  return offsets;
}

/** Scatter: a stable grid, so members spread out without ever overlapping. */
function scatterOffsets(count: number, halfExtent: number): Vec3[] {
  const offsets: Vec3[] = [];
  const side = Math.ceil(Math.sqrt(count));
  const step = Math.max(2, Math.floor((halfExtent * 2) / Math.max(1, side)));
  for (let i = 0; i < count; i += 1) {
    const column = i % side;
    const row = Math.floor(i / side);
    offsets.push({
      x: (column - (side - 1) / 2) * step,
      y: 0,
      z: (row - (side - 1) / 2) * step,
    });
  }
  return offsets;
}

/** Custom: explicit offsets, falling back to a circle when the list is short. */
function customOffsets(spec: FormationSpec, count: number, spacing: number): Vec3[] {
  const provided = spec.offsets ?? [];
  if (provided.length >= count) return provided.slice(0, count);
  const fallback = circleOffsets(count - provided.length, spec.radius ?? spacing * Math.max(1, count) * 0.5);
  return [...provided, ...fallback];
}

/**
 * Which member should take a given slot.
 *
 * Slots are handed out in a stable order (by member id) so the same set of members always produces
 * the same assignment. Without this, members would chase each other's positions forever.
 */
export function assignSlots(memberIds: readonly string[], count: number): Map<string, number> {
  const ordered = [...memberIds].sort();
  const assignment = new Map<string, number>();
  for (let i = 0; i < ordered.length && i < count; i += 1) assignment.set(ordered[i], i);
  return assignment;
}

/** True when `position` is close enough to `target` to count as in place. */
export function inPosition(position: Vec3, target: Vec3, tolerance = 2): boolean {
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  return Math.sqrt(dx * dx + dz * dz) <= tolerance;
}

/**
 * The members furthest from their slot.
 *
 * Used by the "regroup" behaviour: if any member is beyond `threshold` from its assigned position,
 * the hive regroups rather than continuing.
 */
export function stragglers(
  positions: ReadonlyMap<string, Vec3>,
  targets: ReadonlyMap<string, Vec3>,
  threshold: number,
): string[] {
  const out: string[] = [];
  for (const [id, target] of targets) {
    const position = positions.get(id);
    if (!position) continue;
    if (!inPosition(position, target, threshold)) out.push(id);
  }
  return out;
}
