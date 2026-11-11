/**
 * Scouting sectors: turning an area into tiles, handing them out, and remembering what was covered.
 *
 * A sector is a square tile on the horizontal plane. The grid is anchored at an origin so the same
 * area always yields the same tile ids across restarts; that is what lets a report survive a
 * reconnect and stop the hive from re-exploring ground it has already covered.
 */

export interface Sector {
  /** Stable id: `<originX>:<originZ>:<col>:<row>`. */
  id: string;
  col: number;
  row: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  /** `overworld`, `nether`, `end` or a namespaced id. */
  dimension: string;
}

export type SectorState = 'unexplored' | 'assigned' | 'explored';

export interface SectorProgress {
  id: string;
  state: SectorState;
  assignedTo: string | null;
  exploredAt: number | null;
  /** Observations the worker reported for this sector. */
  observations: number;
}

export interface SectorGridSpec {
  /** Top-left corner of the whole area. */
  originX: number;
  originZ: number;
  /** How many tiles across and down. */
  cols: number;
  rows: number;
  /** Tile side length in blocks. */
  tileSize: number;
  dimension: string;
}

/**
 * Builds the tile grid for an area.
 *
 * Tiles are square and block-aligned. The grid is deterministic for a given spec, so a sector id
 * computed today names the same ground tomorrow.
 */
export function buildGrid(spec: SectorGridSpec): Sector[] {
  const tileSize = Math.max(1, Math.floor(spec.tileSize));
  const sectors: Sector[] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      const minX = spec.originX + col * tileSize;
      const minZ = spec.originZ + row * tileSize;
      const maxX = minX + tileSize - 1;
      const maxZ = minZ + tileSize - 1;
      sectors.push({
        id: sectorId(spec.originX, spec.originZ, col, row),
        col,
        row,
        minX,
        minZ,
        maxX,
        maxZ,
        centerX: Math.floor((minX + maxX) / 2),
        centerZ: Math.floor((minZ + maxZ) / 2),
        dimension: spec.dimension,
      });
    }
  }
  return sectors;
}

export function sectorId(originX: number, originZ: number, col: number, row: number): string {
  return `${originX}:${originZ}:${col}:${row}`;
}

/** Builds a square area centred on a point, with a whole number of tiles. */
export function gridAround(centerX: number, centerZ: number, tilesAcross: number, tileSize: number, dimension: string): SectorGridSpec {
  const span = Math.max(1, Math.ceil(tilesAcross)) * tileSize;
  const originX = Math.floor(centerX - span / 2);
  const originZ = Math.floor(centerZ - span / 2);
  const side = Math.max(1, Math.ceil(tilesAcross));
  return { originX, originZ, cols: side, rows: side, tileSize, dimension };
}

/** A fresh progress record for every sector in a grid. */
export function initialProgress(sectors: readonly Sector[]): Map<string, SectorProgress> {
  const progress = new Map<string, SectorProgress>();
  for (const sector of sectors) {
    progress.set(sector.id, { id: sector.id, state: 'unexplored', assignedTo: null, exploredAt: null, observations: 0 });
  }
  return progress;
}

/**
 * Hands out the next batch of unexplored sectors, one per worker.
 *
 * Sectors already assigned or explored are skipped, so two workers are never sent to the same tile.
 * The ordering is by distance from the commander so the nearest ground is covered first.
 */
export function assignSectors(
  sectors: readonly Sector[],
  progress: ReadonlyMap<string, SectorProgress>,
  workers: readonly string[],
  from: { x: number; z: number },
): Map<string, Sector> {
  const assignment = new Map<string, Sector>();
  const available = sectors
    .filter((sector) => (progress.get(sector.id)?.state ?? 'unexplored') === 'unexplored')
    .sort((a, b) => distance2(a.centerX, a.centerZ, from.x, from.z) - distance2(b.centerX, b.centerZ, from.x, from.z));
  for (const worker of workers) {
    const next = available.shift();
    if (!next) break;
    assignment.set(worker, next);
  }
  return assignment;
}

function distance2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Marks a sector explored and records how many observations came from it. */
export function markExplored(progress: Map<string, SectorProgress>, id: string, observations: number, at: number): boolean {
  const current = progress.get(id);
  if (!current) return false;
  progress.set(id, { ...current, state: 'explored', exploredAt: at, assignedTo: null, observations: current.observations + observations });
  return true;
}

/** Returns a sector to the pool when its worker disconnects mid-exploration. */
export function releaseSector(progress: Map<string, SectorProgress>, id: string): boolean {
  const current = progress.get(id);
  if (!current || current.state !== 'assigned') return false;
  progress.set(id, { ...current, state: 'unexplored', assignedTo: null });
  return true;
}

export interface ExplorationSummary {
  total: number;
  explored: number;
  assigned: number;
  unexplored: number;
  percentComplete: number;
  /** Total observations recorded across every sector. */
  observations: number;
}

export function summarise(sectors: readonly Sector[], progress: ReadonlyMap<string, SectorProgress>): ExplorationSummary {
  let explored = 0;
  let assigned = 0;
  let observations = 0;
  for (const sector of sectors) {
    const entry = progress.get(sector.id);
    const state = entry?.state ?? 'unexplored';
    observations += entry?.observations ?? 0;
    if (state === 'explored') explored += 1;
    else if (state === 'assigned') assigned += 1;
  }
  const total = sectors.length;
  return {
    total,
    explored,
    assigned,
    unexplored: total - explored - assigned,
    percentComplete: total === 0 ? 0 : Math.round((explored / total) * 100),
    observations,
  };
}

/** The sector a position falls inside, or null when it is outside the grid. */
export function sectorAt(sectors: readonly Sector[], x: number, z: number): Sector | null {
  for (const sector of sectors) {
    if (x >= sector.minX && x <= sector.maxX && z >= sector.minZ && z <= sector.maxZ) return sector;
  }
  return null;
}
