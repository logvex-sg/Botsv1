/**
 * Hive repositories: the durable half of HIVE MODE.
 *
 * The coordinator keeps its working state in memory and writes it here after every change, so a
 * restart does not lose the objective queue, the scouting grid or the command history. Rows are
 * plain and mapped to typed records, mirroring the style of the other repositories.
 */
import type { FleetDatabase } from './database';
import type { FormationSpec } from '../packages/hive/formations';
import type { HiveRole } from '../packages/hive/roles';
import type { ObjectiveKind } from '../packages/hive/distribution';
import type { ObservationKind } from '../packages/hive/observations';
import type { SectorState } from '../packages/hive/sectors';

function now(): number {
  return Date.now();
}

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface HiveStateRow {
  id: string;
  enabled: boolean;
  commanderId: string | null;
  formation: FormationSpec;
  activeObjective: string;
  updatedAt: number;
}

export interface HiveRoleRow {
  workerId: string;
  role: HiveRole;
  extraCapabilities: string[];
  isCommander: boolean;
  updatedAt: number;
}

export interface HiveObjectiveRow {
  id: string;
  kind: ObjectiveKind;
  needs: string[];
  position: { x: number; y: number; z: number } | null;
  priority: number;
  label: string;
  assignedTo: string | null;
  state: string;
  progress: number;
  detail: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface HiveSectorRow {
  id: string;
  dimension: string;
  col: number;
  row: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  state: SectorState;
  assignedTo: string | null;
  exploredAt: number | null;
  observations: number;
}

export interface HiveObservationRow {
  id: string;
  kind: ObservationKind;
  workerId: string;
  x: number;
  y: number;
  z: number;
  dimension: string;
  at: number;
  label: string;
  detail: Record<string, unknown>;
}

export interface HiveCommandRow {
  id: string;
  at: number;
  instruction: string;
  kind: string;
  accepted: boolean;
  payload: Record<string, unknown>;
  result: string;
}

export class HiveRepository {
  constructor(private readonly db: FleetDatabase) {}

  // ---------------------------------------------------------------- state

  getState(): HiveStateRow {
    const row = this.db.get('SELECT * FROM hive_state WHERE id=?', ['singleton']);
    if (!row) {
      const created: HiveStateRow = {
        id: 'singleton',
        enabled: false,
        commanderId: null,
        formation: { kind: 'follow', spacing: 3 },
        activeObjective: '',
        updatedAt: now(),
      };
      this.saveState(created);
      return created;
    }
    return {
      id: 'singleton',
      enabled: Number(row.enabled) === 1,
      commanderId: (row.commander_id as string) ?? null,
      formation: parse<FormationSpec>(row.formation, { kind: 'follow', spacing: 3 }),
      activeObjective: String(row.active_objective ?? ''),
      updatedAt: Number(row.updated_at ?? now()),
    };
  }

  saveState(state: HiveStateRow): void {
    this.db.run(
      `INSERT INTO hive_state (id, enabled, commander_id, formation, active_objective, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, commander_id=excluded.commander_id,
         formation=excluded.formation, active_objective=excluded.active_objective, updated_at=excluded.updated_at`,
      [
        'singleton',
        state.enabled ? 1 : 0,
        state.commanderId,
        JSON.stringify(state.formation),
        state.activeObjective,
        state.updatedAt,
      ],
    );
  }

  // ---------------------------------------------------------------- roles

  listRoles(): HiveRoleRow[] {
    return this.db.all('SELECT * FROM hive_roles ORDER BY worker_id').map((row) => ({
      workerId: String(row.worker_id),
      role: String(row.role) as HiveRole,
      extraCapabilities: parse<string[]>(row.extra_capabilities, []),
      isCommander: Number(row.is_commander) === 1,
      updatedAt: Number(row.updated_at ?? now()),
    }));
  }

  setRole(input: { workerId: string; role: HiveRole; extraCapabilities?: string[]; isCommander?: boolean }): HiveRoleRow {
    const stamp = now();
    this.db.run(
      `INSERT INTO hive_roles (worker_id, role, extra_capabilities, is_commander, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(worker_id) DO UPDATE SET role=excluded.role,
         extra_capabilities=excluded.extra_capabilities, is_commander=excluded.is_commander, updated_at=excluded.updated_at`,
      [input.workerId, input.role, JSON.stringify(input.extraCapabilities ?? []), input.isCommander ? 1 : 0, stamp],
    );
    return { workerId: input.workerId, role: input.role, extraCapabilities: input.extraCapabilities ?? [], isCommander: Boolean(input.isCommander), updatedAt: stamp };
  }

  removeRole(workerId: string): void {
    this.db.run('DELETE FROM hive_roles WHERE worker_id=?', [workerId]);
  }

  clearCommanders(): void {
    this.db.run('UPDATE hive_roles SET is_commander=0');
  }

  // ---------------------------------------------------------------- objectives

  listObjectives(): HiveObjectiveRow[] {
    return this.db.all('SELECT * FROM hive_objectives ORDER BY priority DESC, created_at').map(mapObjective);
  }

  upsertObjective(row: HiveObjectiveRow): void {
    this.db.run(
      `INSERT INTO hive_objectives (id, kind, needs, x, y, z, priority, label, assigned_to, state, progress, detail, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, needs=excluded.needs, x=excluded.x, y=excluded.y, z=excluded.z,
         priority=excluded.priority, label=excluded.label, assigned_to=excluded.assigned_to, state=excluded.state,
         progress=excluded.progress, detail=excluded.detail, updated_at=excluded.updated_at`,
      [
        row.id,
        row.kind,
        JSON.stringify(row.needs),
        row.position?.x ?? null,
        row.position?.y ?? null,
        row.position?.z ?? null,
        row.priority,
        row.label,
        row.assignedTo,
        row.state,
        row.progress,
        JSON.stringify(row.detail),
        row.createdAt,
        row.updatedAt,
      ],
    );
  }

  removeObjective(id: string): void {
    this.db.run('DELETE FROM hive_objectives WHERE id=?', [id]);
  }

  clearObjectives(): void {
    this.db.run('DELETE FROM hive_objectives');
  }

  // ---------------------------------------------------------------- sectors

  listSectors(): HiveSectorRow[] {
    return this.db.all('SELECT * FROM hive_sectors ORDER BY col, row').map((row) => ({
      id: String(row.id),
      dimension: String(row.dimension ?? ''),
      col: Number(row.col ?? 0),
      row: Number(row.row ?? 0),
      minX: Number(row.min_x ?? 0),
      minZ: Number(row.min_z ?? 0),
      maxX: Number(row.max_x ?? 0),
      maxZ: Number(row.max_z ?? 0),
      centerX: Number(row.center_x ?? 0),
      centerZ: Number(row.center_z ?? 0),
      state: String(row.state ?? 'unexplored') as SectorState,
      assignedTo: (row.assigned_to as string) ?? null,
      exploredAt: row.explored_at === null || row.explored_at === undefined ? null : Number(row.explored_at),
      observations: Number(row.observations ?? 0),
    }));
  }

  replaceSectors(rows: HiveSectorRow[]): void {
    this.db.transaction(() => {
      for (const row of rows) {
        this.db.run(
          `INSERT INTO hive_sectors (id, dimension, col, row, min_x, min_z, max_x, max_z, center_x, center_z, state, assigned_to, explored_at, observations)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET state=excluded.state, assigned_to=excluded.assigned_to,
             explored_at=excluded.explored_at, observations=excluded.observations`,
          [
            row.id, row.dimension, row.col, row.row, row.minX, row.minZ, row.maxX, row.maxZ,
            row.centerX, row.centerZ, row.state, row.assignedTo, row.exploredAt, row.observations,
          ],
        );
      }
    });
  }

  clearSectors(): void {
    this.db.run('DELETE FROM hive_sectors');
  }

  updateSector(id: string, patch: Partial<Pick<HiveSectorRow, 'state' | 'assignedTo' | 'exploredAt' | 'observations'>>): void {
    const current = this.db.get('SELECT * FROM hive_sectors WHERE id=?', [id]);
    if (!current) return;
    this.db.run(
      'UPDATE hive_sectors SET state=?, assigned_to=?, explored_at=?, observations=? WHERE id=?',
      [
        patch.state ?? current.state,
        patch.assignedTo === undefined ? current.assigned_to : patch.assignedTo,
        patch.exploredAt === undefined ? current.explored_at : patch.exploredAt,
        patch.observations ?? current.observations,
        id,
      ],
    );
  }

  // ---------------------------------------------------------------- observations

  listObservations(limit = 500): HiveObservationRow[] {
    return this.db.all('SELECT * FROM hive_observations ORDER BY at DESC LIMIT ?', [limit]).map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as ObservationKind,
      workerId: String(row.worker_id),
      x: Number(row.x ?? 0),
      y: Number(row.y ?? 0),
      z: Number(row.z ?? 0),
      dimension: String(row.dimension ?? ''),
      at: Number(row.at ?? 0),
      label: String(row.label ?? ''),
      detail: parse<Record<string, unknown>>(row.detail, {}),
    }));
  }

  addObservation(row: HiveObservationRow): void {
    this.db.run(
      `INSERT INTO hive_observations (id, kind, worker_id, x, y, z, dimension, at, label, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET at=excluded.at, x=excluded.x, y=excluded.y, z=excluded.z, detail=excluded.detail`,
      [row.id, row.kind, row.workerId, row.x, row.y, row.z, row.dimension, row.at, row.label, JSON.stringify(row.detail)],
    );
  }

  clearObservations(): void {
    this.db.run('DELETE FROM hive_observations');
  }

  // ---------------------------------------------------------------- commands

  listCommands(limit = 100): HiveCommandRow[] {
    return this.db.all('SELECT * FROM hive_commands ORDER BY at DESC LIMIT ?', [limit]).map((row) => ({
      id: String(row.id),
      at: Number(row.at ?? 0),
      instruction: String(row.instruction ?? ''),
      kind: String(row.kind ?? ''),
      accepted: Number(row.accepted) === 1,
      payload: parse<Record<string, unknown>>(row.payload, {}),
      result: String(row.result ?? ''),
    }));
  }

  addCommand(row: HiveCommandRow): void {
    this.db.run(
      `INSERT INTO hive_commands (id, at, instruction, kind, accepted, payload, result)
       VALUES (?,?,?,?,?,?,?)`,
      [row.id, row.at, row.instruction, row.kind, row.accepted ? 1 : 0, JSON.stringify(row.payload), row.result],
    );
  }

  clearCommands(): void {
    this.db.run('DELETE FROM hive_commands');
  }
}

function mapObjective(row: Record<string, unknown>): HiveObjectiveRow {
  const x = row.x === null || row.x === undefined ? null : Number(row.x);
  const y = row.y === null || row.y === undefined ? null : Number(row.y);
  const z = row.z === null || row.z === undefined ? null : Number(row.z);
  return {
    id: String(row.id),
    kind: String(row.kind) as ObjectiveKind,
    needs: parse<string[]>(row.needs, []),
    position: x !== null && y !== null && z !== null ? { x, y, z } : null,
    priority: Number(row.priority ?? 0),
    label: String(row.label ?? ''),
    assignedTo: (row.assigned_to as string) ?? null,
    state: String(row.state ?? 'pending'),
    progress: Number(row.progress ?? 0),
    detail: parse<Record<string, unknown>>(row.detail, {}),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
  };
}
