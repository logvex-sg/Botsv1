/**
 * HiveService: the coordinator that turns the pure hive engine into a running collective.
 *
 * It is the single place that knows *who is in the hive*, *what each is doing* and *what happens
 * next*. It owns no socket and no world: it reads worker state from {@link WorkerService}, decides
 * with the pure engine in `packages/hive`, writes through {@link HiveRepository} and dispatches
 * through `WorkerService.runTask`. That separation is what makes the coordination testable — the
 * tests drive this class with a fake worker service and the same decisions the app makes.
 *
 * Two rules hold throughout:
 *  - an explicit operator instruction is never silently overridden (it sits at EXPLICIT priority);
 *  - a disconnected worker never stalls the hive (its objective and sector are released on the
 *    next tick and reassigned).
 */
import type { EmitEvent } from '../workers/worker-server';
import type { WorkerService } from '../workers/worker-service';
import type { WorkerView } from '../../shared/types';
import { HiveRepository, type HiveCommandRow, type HiveObjectiveRow, type HiveObservationRow, type HiveRoleRow, type HiveSectorRow, type HiveStateRow } from '../db/hive-repositories';
import {
  assignSectors,
  buildGrid,
  capabilitiesFor,
  distribute,
  formationPositions,
  gridAround,
  initialProgress,
  markExplored,
  parseCommand,
  PRIORITY,
  priorityFor,
  releaseForWorker,
  releaseSector,
  summarise,
  type CommanderFrame,
  type ExplorationSummary,
  type FormationSpec,
  type HiveCommand,
  type HiveRole,
  type Objective,
  type Observation,
  type RoleAssignment,
  type Sector,
  type SectorProgress,
  type Vec3,
  type WorkerLoad,
} from '../packages/hive';

/** How often the coordinator reconciles formation, sectors and objectives. */
const DEFAULT_TICK_MS = 1_000;
/** A worker is considered gone if it has not been seen for this long. */
const STALE_MS = 30_000;

export interface HiveServiceDeps {
  repository: HiveRepository;
  workers: WorkerService;
  emit: EmitEvent;
  /** Overridable for tests. */
  now?: () => number;
  tickMs?: number;
}

export interface HiveOverview {
  enabled: boolean;
  commanderId: string | null;
  formation: FormationSpec;
  activeObjective: string;
  members: HiveMember[];
  online: number;
  total: number;
  objectives: HiveObjectiveRow[];
  exploration: ExplorationSummary;
  recentObservations: HiveObservationRow[];
  commands: ReturnType<HiveRepository['listCommands']>;
}

export interface HiveMember {
  workerId: string;
  label: string;
  username: string;
  role: HiveRole;
  isCommander: boolean;
  online: boolean;
  position: Vec3;
  dimension: string;
  health: number;
  maxHealth: number;
  currentTask: string;
  busy: boolean;
  /** The formation slot this member should occupy, when a formation is active. */
  formationTarget: Vec3 | null;
  distanceToCommander: number | null;
  capabilities: string[];
}

export interface HiveMapData {
  commander: { workerId: string; position: Vec3; dimension: string } | null;
  members: { workerId: string; label: string; role: HiveRole; position: Vec3; target: Vec3 | null; dimension: string; online: boolean; busy: boolean; color: string }[];
  sectors: { id: string; minX: number; minZ: number; maxX: number; maxZ: number; state: string; assignedTo: string | null }[];
  landmarks: { id: string; kind: string; label: string; position: Vec3; at: number }[];
  players: { name: string; position: Vec3; at: number; distance: number }[];
}

export interface CommandOutcome {
  accepted: boolean;
  command: HiveCommand;
  message: string;
  dispatched: { workerId: string; objectiveId: string }[];
}

export class HiveService {
  private readonly repository: HiveRepository;
  private readonly workers: WorkerService;
  private readonly emit: EmitEvent;
  private readonly now: () => number;
  private readonly tickMs: number;

  private state: HiveStateRow;
  private sectors: Sector[] = [];
  private progress = new Map<string, SectorProgress>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReconcile = 0;

  constructor(deps: HiveServiceDeps) {
    this.repository = deps.repository;
    this.workers = deps.workers;
    this.emit = deps.emit;
    this.now = deps.now ?? (() => Date.now());
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.state = this.repository.getState();
    this.loadSectors();
  }

  // ------------------------------------------------------------------ lifecycle

  /** Starts the reconcile loop. Safe to call twice. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  isEnabled(): boolean {
    return this.state.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.state = { ...this.state, enabled, updatedAt: this.now() };
    this.repository.saveState(this.state);
    this.emit('HIVE_STATE', enabled ? 'HIVE MODE enabled' : 'HIVE MODE disabled', { enabled });
  }

  /** The emergency stop: disable, cancel every objective and stop the formation loop. */
  emergencyStop(reason = 'emergency stop'): void {
    this.setEnabled(false);
    this.repository.clearObjectives();
    this.emit('HIVE_EMERGENCY_STOP', `Hive emergency stop: ${reason}`, { reason });
  }

  // ------------------------------------------------------------------ state reads

  listRoles(): HiveRoleRow[] {
    return this.repository.listRoles();
  }

  listCommands(limit = 100): HiveCommandRow[] {
    return this.repository.listCommands(limit);
  }

  overview(): HiveOverview {
    const members = this.members();
    return {
      enabled: this.state.enabled,
      commanderId: this.state.commanderId,
      formation: this.state.formation,
      activeObjective: this.state.activeObjective,
      members,
      online: members.filter((member) => member.online).length,
      total: members.length,
      objectives: this.repository.listObjectives(),
      exploration: summarise(this.sectors, this.progress),
      recentObservations: this.repository.listObservations(50),
      commands: this.repository.listCommands(50),
    };
  }

  /** Every worker the hive knows, with its role and computed formation slot. */
  members(): HiveMember[] {
    const views = this.workers.list();
    const roles = new Map(this.repository.listRoles().map((row) => [row.workerId, row]));
    const commander = this.commanderPosition(views);
    const online = views.filter((view) => view.online);
    const targets = new Map<string, Vec3>();
    if (this.state.enabled && commander) {
      const frame: CommanderFrame = { position: commander.position };
      const slots = formationPositions(this.state.formation, frame, online.length);
      online
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((view, index) => {
          if (slots[index]) targets.set(view.id, slots[index]);
        });
    }

    return views.map((view) => {
      const role = roles.get(view.id);
      const position: Vec3 = { x: view.snapshot.x, y: view.snapshot.y, z: view.snapshot.z };
      const distance =
        commander && view.online
          ? Math.round(Math.hypot(position.x - commander.position.x, position.y - commander.position.y, position.z - commander.position.z))
          : null;
      return {
        workerId: view.id,
        label: view.label || view.username || view.id,
        username: view.username,
        role: role?.role ?? 'GENERALIST',
        isCommander: role?.isCommander ?? view.id === this.state.commanderId,
        online: view.online,
        position,
        dimension: view.snapshot.dimension,
        health: view.snapshot.health,
        maxHealth: view.snapshot.maxHealth,
        currentTask: view.currentTask || view.snapshot.currentTask,
        busy: view.busy,
        formationTarget: targets.get(view.id) ?? null,
        distanceToCommander: distance,
        capabilities: role ? capabilitiesFor(toAssignment(role)) : view.capabilities,
      };
    });
  }

  /** The data the live map renders. Pure read; no side effects. */
  map(): HiveMapData {
    const members = this.members();
    const commander = members.find((member) => member.isCommander && member.online) ?? members.find((member) => member.isCommander) ?? null;
    const observations = this.repository.listObservations(300);
    const players = new Map<string, { name: string; position: Vec3; at: number; distance: number }>();
    for (const observation of observations) {
      if (observation.kind !== 'player') continue;
      const name = String(observation.detail.name ?? observation.label);
      const existing = players.get(name);
      if (!existing || observation.at > existing.at) {
        players.set(name, {
          name,
          position: { x: observation.x, y: observation.y, z: observation.z },
          at: observation.at,
          distance: Number(observation.detail.distance ?? 0),
        });
      }
    }
    return {
      commander: commander ? { workerId: commander.workerId, position: commander.position, dimension: commander.dimension } : null,
      members: members.map((member) => ({
        workerId: member.workerId,
        label: member.label,
        role: member.role,
        position: member.position,
        target: member.formationTarget,
        dimension: member.dimension,
        online: member.online,
        busy: member.busy,
        color: roleColor(member.role),
      })),
      sectors: this.sectors.map((sector) => {
        const entry = this.progress.get(sector.id);
        return {
          id: sector.id,
          minX: sector.minX,
          minZ: sector.minZ,
          maxX: sector.maxX,
          maxZ: sector.maxZ,
          state: entry?.state ?? 'unexplored',
          assignedTo: entry?.assignedTo ?? null,
        };
      }),
      landmarks: observations
        .filter((observation) => observation.kind !== 'player')
        .map((observation) => ({
          id: observation.id,
          kind: observation.kind,
          label: observation.label,
          position: { x: observation.x, y: observation.y, z: observation.z },
          at: observation.at,
        })),
      players: [...players.values()],
    };
  }

  // ------------------------------------------------------------------ roles

  assignRole(workerId: string, role: HiveRole, options: { commander?: boolean; extraCapabilities?: string[] } = {}): HiveRoleRow {
    if (options.commander) {
      this.repository.clearCommanders();
      this.state = { ...this.state, commanderId: workerId, updatedAt: this.now() };
      this.repository.saveState(this.state);
    }
    const row = this.repository.setRole({
      workerId,
      role,
      extraCapabilities: options.extraCapabilities,
      isCommander: options.commander,
    });
    this.emit('HIVE_ROLE', `${workerId} is now ${role}`, { workerId, role });
    return row;
  }

  /** Promotes a worker to commander, demoting the previous one to ESCORT. */
  setCommander(workerId: string): void {
    const previous = this.state.commanderId;
    if (previous && previous !== workerId) {
      const previousRole = this.repository.listRoles().find((row) => row.workerId === previous);
      if (previousRole) this.repository.setRole({ ...previousRole, role: 'ESCORT', isCommander: false });
    }
    this.assignRole(workerId, 'COMMANDER', { commander: true });
    this.emit('HIVE_COMMANDER', `${workerId} is the hive commander`, { workerId, previous });
  }

  /**
   * Reassigns the commander when the current one goes offline.
   *
   * Chooses the online member with the most capabilities, then the one that has been connected
   * longest. Returns the new commander id, or null when nobody is online to take over.
   */
  reassignCommander(): string | null {
    const current = this.state.commanderId;
    const views = this.workers.list();
    const currentOnline = current ? views.find((view) => view.id === current && view.online) : undefined;
    if (currentOnline) return current;
    const candidate = views
      .filter((view) => view.online)
      .sort((a, b) => (b.capabilities.length - a.capabilities.length) || ((a.connectedAt ?? 0) - (b.connectedAt ?? 0)))[0];
    if (!candidate) return null;
    this.setCommander(candidate.id);
    return candidate.id;
  }

  // ------------------------------------------------------------------ formations

  setFormation(spec: Partial<FormationSpec>): FormationSpec {
    const merged: FormationSpec = { ...this.state.formation, ...spec };
    this.state = { ...this.state, formation: merged, updatedAt: this.now() };
    this.repository.saveState(this.state);
    this.emit('HIVE_FORMATION', `Formation set to ${merged.kind}`, { formation: merged });
    return merged;
  }

  /**
   * Computes each member's formation target.
   *
   * The commander is the anchor and is never given a target of its own. Targets are recalculated
   * whenever the commander moves, so the formation follows rather than lagging behind a snapshot.
   */
  formationTargets(): Map<string, Vec3> {
    const views = this.workers.list().filter((view) => view.online);
    const commander = this.commanderPosition(this.workers.list());
    const targets = new Map<string, Vec3>();
    if (!commander) return targets;
    const followers = views.filter((view) => view.id !== this.state.commanderId).sort((a, b) => a.id.localeCompare(b.id));
    const slots = formationPositions(this.state.formation, { position: commander.position }, followers.length);
    followers.forEach((view, index) => {
      if (slots[index]) targets.set(view.id, slots[index]);
    });
    return targets;
  }

  // ------------------------------------------------------------------ commands

  /** Parses, validates and applies one natural-language instruction. */
  runCommand(instruction: string): CommandOutcome {
    const command = parseCommand(instruction);
    const id = `cmd-${this.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (command.kind === 'unknown') {
      const outcome: CommandOutcome = { accepted: false, command, message: command.note ?? 'Unrecognised instruction.', dispatched: [] };
      this.repository.addCommand({ id, at: this.now(), instruction, kind: command.kind, accepted: false, payload: {}, result: outcome.message });
      return outcome;
    }

    const outcome = this.applyCommand(command);
    this.repository.addCommand({
      id,
      at: this.now(),
      instruction,
      kind: command.kind,
      accepted: outcome.accepted,
      payload: { count: command.count, role: command.role, formation: command.formation, direction: command.direction },
      result: outcome.message,
    });
    this.emit('HIVE_COMMAND', `${command.kind}: ${instruction}`, { accepted: outcome.accepted, message: outcome.message });
    return outcome;
  }

  private applyCommand(command: HiveCommand): CommandOutcome {
    switch (command.kind) {
      case 'follow':
        this.setFormation({ kind: 'follow', ...command.formation });
        return { accepted: true, command, message: 'Everyone will follow the commander.', dispatched: [] };
      case 'circle':
        this.setFormation({ kind: 'circle', ...command.formation });
        return { accepted: true, command, message: 'Everyone will circle the commander.', dispatched: [] };
      case 'protect':
        this.setFormation({ kind: 'escort', ...command.formation });
        return { accepted: true, command, message: 'Everyone will hold a defensive ring.', dispatched: [] };
      case 'scatter':
        this.setFormation({ kind: 'scatter', ...command.formation });
        return { accepted: true, command, message: 'Everyone will spread out.', dispatched: [] };
      case 'formation':
        this.setFormation(command.formation ?? { kind: 'follow' });
        return { accepted: true, command, message: 'Formation updated.', dispatched: [] };
      case 'regroup':
        this.setFormation({ kind: this.state.formation.kind });
        return { accepted: true, command, message: 'Everyone will return to formation.', dispatched: [] };
      case 'recall':
        return this.dispatchObjectives(this.recallObjectives(), command, 'Everyone is returning to the commander.');
      case 'stop':
        this.repository.clearObjectives();
        this.setEnabled(false);
        return { accepted: true, command, message: 'All tasks stopped.', dispatched: [] };
      case 'store':
        return this.dispatchObjectives(
          this.objectivesForRole(command, 'STORAGE', 'storage', ['storage', 'sort'], 'Organise storage'),
          command,
          'Storage workers assigned.',
        );
      case 'guard':
        return this.dispatchObjectives(
          this.objectivesForRole(command, 'GUARD', 'guard', ['observe'], 'Guard the area'),
          command,
          'Guards assigned.',
        );
      case 'scout':
        return this.scoutCommand(command);
      case 'assign':
        return this.assignCommand(command);
      case 'role':
        return { accepted: true, command, message: `Role ${command.role} noted; assign it to a specific worker from the map.`, dispatched: [] };
      case 'status':
        return { accepted: true, command, message: 'Hive status is shown in the dashboard.', dispatched: [] };
      default:
        return { accepted: false, command, message: 'Unrecognised instruction.', dispatched: [] };
    }
  }

  /** Sets up a scouting grid around the commander (or a named direction) and assigns sectors. */
  private scoutCommand(command: HiveCommand): CommandOutcome {
    const commander = this.commanderPosition(this.workers.list());
    const center = commander?.position ?? { x: 0, y: 64, z: 0 };
    const radius = command.radius ?? 64;
    const tileSize = 16;
    const tilesAcross = Math.max(2, Math.ceil((radius * 2) / tileSize));
    const dimension = commander?.dimension ?? 'overworld';

    let originX = center.x;
    let originZ = center.z;
    if (command.direction) {
      const offset = radius;
      if (command.direction === 'north') originZ -= offset;
      if (command.direction === 'south') originZ += offset;
      if (command.direction === 'east') originX += offset;
      if (command.direction === 'west') originX -= offset;
    }

    const spec = gridAround(originX, originZ, tilesAcross, tileSize, dimension);
    this.sectors = buildGrid(spec);
    this.progress = initialProgress(this.sectors);
    this.persistSectors();
    const outcome = this.dispatchObjectives(this.sectorObjectives(command), command, `Scouting ${this.sectors.length} sectors (${radius} block radius).`);
    this.setFormation({ kind: this.state.formation.kind });
    return outcome;
  }

  private assignCommand(command: HiveCommand): CommandOutcome {
    const role = command.role ?? 'GENERALIST';
    const objectives = this.objectivesForRole(command, role, roleObjectiveKind(role), roleNeeds(role), `${role} task`, command.count ?? 1);
    return this.dispatchObjectives(objectives, command, `${command.count ?? 1} worker(s) assigned to ${role}.`);
  }

  private recallObjectives(): Objective[] {
    const commander = this.commanderPosition(this.workers.list());
    const position = commander?.position ?? { x: 0, y: 64, z: 0 };
    return this.workers
      .list()
      .filter((view) => view.online && view.id !== this.state.commanderId)
      .map((view) => ({
        id: `recall-${view.id}`,
        kind: 'formation' as const,
        needs: [] as string[],
        position,
        assignedTo: view.id,
        priority: PRIORITY.EXPLICIT,
        label: 'Return to commander',
      }));
  }

  private objectivesForRole(
    command: HiveCommand,
    role: HiveRole,
    kind: Objective['kind'],
    needs: string[],
    label: string,
    count?: number,
  ): Objective[] {
    const members = this.members().filter((member) => member.online);
    const matching = members.filter((member) => member.role === role);
    const pool = matching.length > 0 ? matching : members;
    const wanted = count ?? command.count ?? pool.length;
    const chosen = pool.slice(0, Math.max(1, wanted));
    return chosen.map((member, index) => ({
      id: `${kind}-${member.workerId}-${this.now()}-${index}`,
      kind,
      needs,
      position: command.direction ? undefined : member.position,
      assignedTo: member.workerId,
      priority: PRIORITY.EXPLICIT,
      label,
    }));
  }

  private sectorObjectives(command: HiveCommand): Objective[] {
    const scouts = this.members()
      .filter((member) => member.online && member.workerId !== this.state.commanderId)
      .filter((member) => member.role === 'SCOUT' || member.role === 'GENERALIST' || member.role === 'SUPPORT');
    const pool = scouts.length > 0 ? scouts : this.members().filter((member) => member.online);
    const wanted = command.count ?? pool.length;
    return pool.slice(0, Math.max(1, wanted)).map((member, index) => ({
      id: `scout-${member.workerId}-${this.now()}-${index}`,
      kind: 'scout' as const,
      needs: ['navigate'],
      assignedTo: member.workerId,
      priority: PRIORITY.EXPLORATION,
      label: 'Scout sector',
    }));
  }

  /** Dispatches a set of objectives, persists them, and runs the first pass of assignment. */
  private dispatchObjectives(objectives: Objective[], command: HiveCommand, message: string): CommandOutcome {
    for (const objective of objectives) {
      this.repository.upsertObjective({
        id: objective.id,
        kind: objective.kind,
        needs: objective.needs,
        position: objective.position ?? null,
        priority: objective.priority,
        label: objective.label,
        assignedTo: objective.assignedTo ?? null,
        state: objective.assignedTo ? 'assigned' : 'pending',
        progress: 0,
        detail: { instruction: command.instruction, direction: command.direction ?? null },
        createdAt: this.now(),
        updatedAt: this.now(),
      });
    }
    this.state = { ...this.state, activeObjective: command.instruction, updatedAt: this.now() };
    this.repository.saveState(this.state);
    return {
      accepted: true,
      command,
      message,
      dispatched: objectives.map((objective) => ({ workerId: objective.assignedTo ?? '', objectiveId: objective.id })),
    };
  }

  // ------------------------------------------------------------------ observations

  /** Records an observation a worker reported, deduplicating by a spatial id. */
  recordObservation(observation: Observation): void {
    this.repository.addObservation({
      id: observation.id,
      kind: observation.kind,
      workerId: observation.workerId,
      x: observation.position.x,
      y: observation.position.y,
      z: observation.position.z,
      dimension: observation.dimension,
      at: observation.at,
      label: observation.label,
      detail: observation.detail,
    });
    // A scout reporting from inside a sector marks that sector explored.
    const sector = this.sectorAt(observation.position.x, observation.position.z);
    if (sector) {
      markExplored(this.progress, sector.id, 1, observation.at);
      this.repository.updateSector(sector.id, {
        state: 'explored',
        assignedTo: null,
        exploredAt: observation.at,
        observations: this.progress.get(sector.id)?.observations ?? 0,
      });
    }
  }

  // ------------------------------------------------------------------ reconciliation

  /** One reconcile pass: commander, formation, sectors, objectives. */
  tick(): void {
    if (!this.state.enabled) return;
    const stamp = this.now();
    if (stamp - this.lastReconcile < this.tickMs / 2) return;
    this.lastReconcile = stamp;

    this.reassignCommander();
    this.releaseOrphaned();
    this.assignScoutSectors();
  }

  /** Releases objectives and sectors held by workers that are gone or stale. */
  private releaseOrphaned(): void {
    const views = this.workers.list();
    const online = new Set(views.filter((view) => view.online).map((view) => view.id));
    const stale = new Set(
      views
        .filter((view) => view.online && view.lastHeartbeatAgeSeconds !== null && view.lastHeartbeatAgeSeconds * 1000 > STALE_MS)
        .map((view) => view.id),
    );
    const gone = (workerId: string): boolean => !online.has(workerId) || stale.has(workerId);

    for (const objective of this.repository.listObjectives()) {
      if (objective.assignedTo && gone(objective.assignedTo)) {
        this.repository.upsertObjective({ ...objective, assignedTo: null, state: 'pending', updatedAt: this.now() });
      }
    }
    for (const [id, entry] of this.progress) {
      if (entry.state === 'assigned' && entry.assignedTo && gone(entry.assignedTo)) {
        releaseSector(this.progress, id);
        this.repository.updateSector(id, { state: 'unexplored', assignedTo: null });
      }
    }
  }

  /** Hands unexplored sectors to idle scouts, one each. */
  private assignScoutSectors(): void {
    if (this.sectors.length === 0) return;
    const scouts = this.members().filter(
      (member) => member.online && !member.busy && (member.role === 'SCOUT' || member.role === 'GENERALIST') && !member.isCommander,
    );
    if (scouts.length === 0) return;
    const commander = this.commanderPosition(this.workers.list());
    const from = commander?.position ?? { x: 0, y: 64, z: 0 };
    const assignment = assignSectors(this.sectors, this.progress, scouts.map((scout) => scout.workerId), { x: from.x, z: from.z });
    for (const [workerId, sector] of assignment) {
      const entry = this.progress.get(sector.id);
      if (!entry) continue;
      this.progress.set(sector.id, { ...entry, state: 'assigned', assignedTo: workerId });
      this.repository.updateSector(sector.id, { state: 'assigned', assignedTo: workerId });
      this.repository.upsertObjective({
        id: `sector-${sector.id}`,
        kind: 'scout',
        needs: ['navigate'],
        position: { x: sector.centerX, y: from.y, z: sector.centerZ },
        priority: priorityFor('scout'),
        label: `Scout sector ${sector.col},${sector.row}`,
        assignedTo: workerId,
        state: 'assigned',
        progress: 0,
        detail: { sectorId: sector.id },
        createdAt: this.now(),
        updatedAt: this.now(),
      });
    }
  }

  /**
   * The next objective to give a worker, chosen by priority and suitability.
   *
   * Exposed so a caller (the tick, or a test) can ask the same question the coordinator asks.
   */
  planDistribution(): ReturnType<typeof distribute> {
    const roles = this.repository.listRoles().map(toAssignment);
    const loads: WorkerLoad[] = this.members().map((member) => ({
      workerId: member.workerId,
      position: member.position,
      health: member.health,
      busy: member.busy,
      online: member.online,
    }));
    const objectives: Objective[] = this.repository.listObjectives().map((row) => ({
      id: row.id,
      kind: row.kind as Objective['kind'],
      needs: row.needs,
      position: row.position ?? undefined,
      assignedTo: row.assignedTo,
      priority: row.priority,
      label: row.label,
    }));
    return distribute(objectives, roles, loads);
  }

  // ------------------------------------------------------------------ helpers

  private commanderPosition(views: WorkerView[]): { position: Vec3; dimension: string } | null {
    const id = this.state.commanderId;
    if (!id) return null;
    const view = views.find((candidate) => candidate.id === id);
    if (!view) return null;
    return { position: { x: view.snapshot.x, y: view.snapshot.y, z: view.snapshot.z }, dimension: view.snapshot.dimension };
  }

  private loadSectors(): void {
    const rows = this.repository.listSectors();
    this.sectors = rows.map((row) => ({
      id: row.id,
      col: row.col,
      row: row.row,
      minX: row.minX,
      minZ: row.minZ,
      maxX: row.maxX,
      maxZ: row.maxZ,
      centerX: row.centerX,
      centerZ: row.centerZ,
      dimension: row.dimension,
    }));
    const progress = initialProgress(this.sectors);
    for (const row of rows) {
      progress.set(row.id, {
        id: row.id,
        state: row.state,
        assignedTo: row.assignedTo,
        exploredAt: row.exploredAt,
        observations: row.observations,
      });
    }
    this.progress = progress;
  }

  private persistSectors(): void {
    const rows: HiveSectorRow[] = this.sectors.map((sector) => {
      const entry = this.progress.get(sector.id);
      return {
        id: sector.id,
        dimension: sector.dimension,
        col: sector.col,
        row: sector.row,
        minX: sector.minX,
        minZ: sector.minZ,
        maxX: sector.maxX,
        maxZ: sector.maxZ,
        centerX: sector.centerX,
        centerZ: sector.centerZ,
        state: entry?.state ?? 'unexplored',
        assignedTo: entry?.assignedTo ?? null,
        exploredAt: entry?.exploredAt ?? null,
        observations: entry?.observations ?? 0,
      };
    });
    this.repository.replaceSectors(rows);
  }

  private sectorAt(x: number, z: number): Sector | null {
    return this.sectors.find((sector) => x >= sector.minX && x <= sector.maxX && z >= sector.minZ && z <= sector.maxZ) ?? null;
  }
}

function toAssignment(row: HiveRoleRow): RoleAssignment {
  return { workerId: row.workerId, role: row.role, extraCapabilities: row.extraCapabilities, isCommander: row.isCommander };
}

function roleObjectiveKind(role: HiveRole): Objective['kind'] {
  switch (role) {
    case 'SCOUT':
      return 'scout';
    case 'STORAGE':
      return 'storage';
    case 'GUARD':
      return 'guard';
    case 'BUILDER':
      return 'build';
    case 'MINER':
      return 'mine';
    case 'LOGISTICS':
      return 'haul';
    case 'SUPPORT':
      return 'assist';
    default:
      return 'idle';
  }
}

function roleNeeds(role: HiveRole): string[] {
  switch (role) {
    case 'SCOUT':
      return ['navigate'];
    case 'STORAGE':
      return ['storage', 'sort'];
    case 'GUARD':
      return ['observe'];
    case 'BUILDER':
      return ['build'];
    case 'MINER':
      return ['mine'];
    case 'LOGISTICS':
      return ['carry'];
    default:
      return [];
  }
}

function roleColor(role: HiveRole): string {
  const colors: Record<HiveRole, string> = {
    COMMANDER: '#f5c542',
    ESCORT: '#4fc3f7',
    SCOUT: '#81c784',
    BUILDER: '#ffb74d',
    MINER: '#a1887f',
    LOGISTICS: '#ba68c8',
    STORAGE: '#9575cd',
    GUARD: '#e57373',
    SUPPORT: '#4db6ac',
    GENERALIST: '#90a4ae',
  };
  return colors[role];
}
