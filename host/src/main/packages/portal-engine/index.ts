/**
 * Portal engine: the portal registry and the controlled removal workflow.
 *
 * A registered portal is an *organisational record*: a name, a location and flags. The engine never
 * locates or destroys a portal on its own — it computes which registered portals are obsolete,
 * groups connected structures, and produces a removal preview that a human must approve. The
 * "authorised area" check is enforced here so a caller cannot remove a portal outside the areas the
 * operator registered.
 *
 * Pure: unit-testable.
 */
import type { PortalRecord } from '../../../shared/types';

/** Two portals within this many blocks are treated as one connected structure. */
export const CONNECTED_RADIUS = 8;

/** How long a temporary portal may go unseen before it is considered obsolete. */
export const OBSOLETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface PortalGroup {
  /** A stable key: the smallest portal id in the group. */
  key: string;
  dimension: string;
  portals: PortalRecord[];
  /** The centroid of the group, for the map. */
  x: number;
  y: number;
  z: number;
}

/** Euclidean distance between two portal records. */
export function distance(a: PortalRecord, b: PortalRecord): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Groups connected portal structures.
 *
 * Portals in the same dimension within {@link CONNECTED_RADIUS} of each other are one structure.
 * The grouping is transitive (A near B, B near C puts all three together), computed with a simple
 * union-find over the registry.
 */
export function groupConnected(portals: readonly PortalRecord[]): PortalGroup[] {
  const byId = new Map(portals.map((portal) => [portal.id, portal]));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const portal of portals) parent.set(portal.id, portal.id);
  for (let i = 0; i < portals.length; i++) {
    for (let j = i + 1; j < portals.length; j++) {
      const a = portals[i];
      const b = portals[j];
      if (a.dimension !== b.dimension) continue;
      if (distance(a, b) <= CONNECTED_RADIUS) union(a.id, b.id);
    }
  }
  const groups = new Map<string, PortalRecord[]>();
  for (const portal of portals) {
    const root = find(portal.id);
    const list = groups.get(root) ?? [];
    list.push(byId.get(portal.id)!);
    groups.set(root, list);
  }
  return [...groups.entries()].map(([key, members]) => ({
    key,
    dimension: members[0]?.dimension ?? '',
    portals: members,
    x: members.reduce((sum, p) => sum + p.x, 0) / members.length,
    y: members.reduce((sum, p) => sum + p.y, 0) / members.length,
    z: members.reduce((sum, p) => sum + p.z, 0) / members.length,
  }));
}

/** Whether a portal is obsolete: temporary, not permanent, and unseen past the window. */
export function isObsolete(portal: PortalRecord, now = Date.now()): boolean {
  if (portal.permanent) return false;
  if (!portal.temporary) return false;
  if (portal.lastSeenAt === null) return false;
  return now - portal.lastSeenAt > OBSOLETE_AFTER_MS;
}

/** Duplicate entries: portals in the same dimension within {@link CONNECTED_RADIUS}. */
export function duplicates(portals: readonly PortalRecord[]): PortalRecord[][] {
  const groups = groupConnected(portals);
  return groups.filter((group) => group.portals.length > 1).map((group) => group.portals);
}

/** Portals that need attention, with a reason. */
export interface PortalFlag {
  portalId: string;
  name: string;
  reason: 'obsolete' | 'duplicate' | 'maintenance' | 'untracked';
  detail: string;
}

/** Flags every portal that the operator should look at, in one pass. */
export function flagged(portals: readonly PortalRecord[], now = Date.now()): PortalFlag[] {
  const flags: PortalFlag[] = [];
  for (const portal of portals) {
    if (isObsolete(portal, now)) {
      flags.push({ portalId: portal.id, name: portal.name, reason: 'obsolete', detail: 'temporary portal has not been seen recently' });
    }
    if (portal.needsMaintenance) {
      flags.push({ portalId: portal.id, name: portal.name, reason: 'maintenance', detail: 'marked for maintenance' });
    }
    if (!portal.tracking) {
      flags.push({ portalId: portal.id, name: portal.name, reason: 'untracked', detail: 'tracking is disabled for this portal' });
    }
  }
  for (const group of duplicates(portals)) {
    for (const portal of group) {
      flags.push({ portalId: portal.id, name: portal.name, reason: 'duplicate', detail: `shares a location with ${group.length - 1} other registered portal(s)` });
    }
  }
  return flags;
}

/** A parsed authorised area: a dimension and an axis-aligned box. */
export interface AuthorisedArea {
  dimension: string;
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

/**
 * Parses an area string of the form "dimension x1 y1 z1 x2 y2 z2".
 *
 * A malformed string yields null, which the caller treats as "not authorised" rather than "any
 * area", so a typo cannot widen the area automation is allowed to touch.
 */
export function parseArea(text: string): AuthorisedArea | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 7) return null;
  const [dimension, ...numbers] = parts;
  const parsed = numbers.map((value) => Number(value));
  if (parsed.some((value) => !Number.isFinite(value))) return null;
  return {
    dimension,
    x1: parsed[0], y1: parsed[1], z1: parsed[2],
    x2: parsed[3], y2: parsed[4], z2: parsed[5],
  };
}

/** Whether a point lies inside an authorised area (inclusive, order-independent). */
export function withinArea(area: AuthorisedArea, dimension: string, x: number, y: number, z: number): boolean {
  if (area.dimension !== dimension) return false;
  const minX = Math.min(area.x1, area.x2);
  const maxX = Math.max(area.x1, area.x2);
  const minY = Math.min(area.y1, area.y2);
  const maxY = Math.max(area.y1, area.y2);
  const minZ = Math.min(area.z1, area.z2);
  const maxZ = Math.max(area.z1, area.z2);
  return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
}

/**
 * Whether a portal is inside one of the authorised areas.
 *
 * An empty area list means the operator has registered no areas, so nothing is authorised: this is
 * deliberately strict. The UI makes the operator add an area before a removal can be approved.
 */
export function isAuthorised(portal: PortalRecord, areas: readonly AuthorisedArea[]): boolean {
  if (areas.length === 0) return false;
  return areas.some((area) => withinArea(area, portal.dimension, portal.x, portal.y, portal.z));
}

/** A removal preview: exactly which portals a plan would remove, and why each is allowed. */
export interface RemovalPreview {
  portalId: string;
  name: string;
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** Whether the portal passed every safety check. */
  authorised: boolean;
  /** Reasons the portal may not be removed. */
  reasons: string[];
  /** The blocks a worker would need to interact with, as a rough count of the portal frame. */
  estimatedBlocks: number;
}

/**
 * Builds a removal preview for the selected portals.
 *
 * The preview never removes anything: it lists what would happen and marks any portal that fails a
 * safety check. A permanent portal is never previewed as removable.
 */
export function previewRemoval(
  portals: readonly PortalRecord[],
  areas: readonly AuthorisedArea[],
  options: { allowPermanent?: boolean } = {},
): RemovalPreview[] {
  return portals.map((portal) => {
    const reasons: string[] = [];
    if (portal.permanent && !options.allowPermanent) reasons.push('portal is marked permanent');
    if (!isAuthorised(portal, areas)) reasons.push('portal is outside every authorised area');
    return {
      portalId: portal.id,
      name: portal.name,
      dimension: portal.dimension,
      x: portal.x,
      y: portal.y,
      z: portal.z,
      authorised: reasons.length === 0,
      reasons,
      // A nether portal frame is 10-14 obsidian; report a conservative 10 as the interaction count.
      estimatedBlocks: portal.category.toLowerCase().includes('nether') ? 10 : 12,
    };
  });
}

/** Every portal whose location has not been confirmed by a worker yet. */
export function unconfirmed(portals: readonly PortalRecord[]): PortalRecord[] {
  return portals.filter((portal) => portal.lastSeenAt === null);
}
