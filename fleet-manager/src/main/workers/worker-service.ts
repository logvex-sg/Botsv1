/**
 * Worker service: the one place the rest of the host talks to about workers.
 *
 * It sits between {@link WorkerServer} (which owns sockets) and the UI (which asks questions and
 * presses buttons). Everything the UI can do — list workers, run a task, count an item across a
 * group, regear, send a command, export a report — goes through a method here, so there is exactly
 * one code path per operation and the renderer never talks to the socket layer directly.
 *
 * Two ideas are kept strictly apart throughout:
 *  - a worker's *reported* inventory is the last snapshot it sent, which may be seconds or minutes
 *    old and is always labelled with when it was captured;
 *  - a worker's *accessible* inventory is only what is inside a container screen it currently has
 *    open. The host never claims the two are the same.
 */
import type {
  ItemCountReport,
  ItemCountRow,
  RegearComparison,
  RegearGap,
  RegearPreset,
  WorkerCommandRecord,
  WorkerGroup,
  WorkerInventorySnapshot,
  WorkerOverview,
  WorkerTaskRecord,
  WorkerView,
  WorkerRecord,
} from '../../shared/types';
import type {
  WorkerCommandRepository,
  WorkerGroupRepository,
  RegearPresetRepository,
  WorkerInventoryRepository,
  WorkerRepository,
  WorkerTaskRepository,
  EventRepository,
} from '../db/repositories';
import type { EmitEvent } from './worker-server';
import { WorkerServer } from './worker-server';
import {
  TASK_KINDS,
  emptySnapshot,
  isTaskKind,
  type TaskKind,
  type WorkerItem,
  type WorkerSnapshot,
  type WorkerTaskResult,
} from '../../shared/workers';

/** How old a reported inventory may be before the UI flags it as stale. */
const STALE_INVENTORY_MS = 60_000;

export interface WorkerServiceDeps {
  workers: WorkerRepository;
  groups: WorkerGroupRepository;
  tasks: WorkerTaskRepository;
  commands: WorkerCommandRepository;
  presets: RegearPresetRepository;
  inventory: WorkerInventoryRepository;
  events: EventRepository;
  emit: EmitEvent;
}

export class WorkerService {
  readonly server: WorkerServer;

  constructor(
    private readonly deps: WorkerServiceDeps,
    serverOptions: { host: string; port: number; token: string },
  ) {
    this.server = new WorkerServer(
      {
        workers: deps.workers,
        tasks: deps.tasks,
        commands: deps.commands,
        inventory: deps.inventory,
        emit: deps.emit,
        onSnapshot: (workerId, snapshot) => this.rememberSnapshot(workerId, snapshot),
      },
      serverOptions,
    );
  }

  // ------------------------------------------------------------------ listing

  /** Every known worker (durable rows) merged with live connection state. */
  list(): WorkerView[] {
    return this.deps.workers.list().map((record) => this.toView(record));
  }

  get(workerId: string): WorkerView | undefined {
    const record = this.deps.workers.get(workerId);
    return record ? this.toView(record) : undefined;
  }

  /** Recent console lines for one worker, oldest first. Empty when it has sent none. */
  console(workerId: string): { at: number; message: string }[] {
    return this.server.consoleFor(workerId);
  }

  clearConsole(workerId: string): void {
    this.server.clearConsole(workerId);
  }

  /** Resolves a selector that may be an id, a username, a label or a group name. */
  resolve(selector: string): WorkerRecord[] {
    const needle = selector.trim().toLowerCase();
    if (!needle) return [];
    const group = this.deps.groups.findByName(selector.trim());
    const all = this.deps.workers.list();
    if (group) return all.filter((w) => w.groupId === group.id);
    const exact = all.filter(
      (w) => w.id.toLowerCase() === needle || w.username.toLowerCase() === needle || w.label.toLowerCase() === needle,
    );
    if (exact.length > 0) return exact;
    // Fall back to a prefix match so the operator can type "bot1" for "bot10".
    return all.filter((w) => w.id.toLowerCase().startsWith(needle) || w.username.toLowerCase().startsWith(needle));
  }

  overview(): WorkerOverview {
    const workers = this.list();
    const online = workers.filter((w) => w.online).length;
    const degraded = workers.filter((w) => !w.online && w.status === 'DEGRADED').length;
    const groups = this.deps.groups.list().map((group) => {
      const members = workers.filter((w) => w.groupId === group.id);
      return { group, workers: members.length, online: members.filter((w) => w.online).length };
    });
    const trackedItems = this.deps.inventory
      .all()
      .reduce((sum, snapshot) => sum + snapshot.carried.reduce((n, item) => n + item.count, 0), 0);

    return {
      total: workers.length,
      online,
      offline: workers.length - online,
      degraded,
      activeTasks: this.deps.tasks.activeCount(),
      trackedItems,
      groups,
      recent: this.deps.events
        .list(25)
        .filter((event) => event.type.startsWith('WORKER_')),
    };
  }

  private toView(record: WorkerRecord): WorkerView {
    const online = this.server.isOnline(record.id);
    const snapshot: WorkerSnapshot = this.server.liveSnapshot(record.id) ?? this.durableSnapshot(record);
    return {
      ...record,
      status: online ? 'ONLINE' : record.status === 'ONLINE' ? 'OFFLINE' : record.status,
      online,
      lastHeartbeatAgeSeconds: this.server.heartbeatAgeSeconds(record.id),
      connectedAt: this.server.connectedAt(record.id),
      snapshot,
      currentTask: snapshot.currentTask ?? '',
      capabilities: snapshot.capabilities ?? [],
    };
  }

  /**
   * The last snapshot seen for an offline worker.
   *
   * The durable row keeps identity, but the live snapshot map is what remembers coordinates and
   * health; when the host restarts, an offline worker simply shows its identity until it reconnects.
   */
  private durableSnapshot(record: WorkerRecord): WorkerSnapshot {
    const stored = this.lastSnapshots.get(record.id);
    if (stored) return stored;
    return {
      ...emptySnapshot(record.id),
      label: record.label,
      username: record.username,
      minecraftVersion: record.minecraftVersion,
      serverAddress: record.serverAddress,
    };
  }

  /** Last known snapshots by worker id, so an offline worker still shows its final state. */
  private readonly lastSnapshots = new Map<string, WorkerSnapshot>();

  /** Called by the context whenever a worker snapshot changes, to remember the final state. */
  rememberSnapshot(workerId: string, snapshot: WorkerSnapshot): void {
    this.lastSnapshots.set(workerId, snapshot);
  }

  // ------------------------------------------------------------------ groups

  listGroups(): WorkerGroup[] {
    return this.deps.groups.list();
  }

  createGroup(name: string, description = '', color = '#6d5efc'): WorkerGroup {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A group needs a name.');
    if (this.deps.groups.findByName(trimmed)) throw new Error(`A group named "${trimmed}" already exists.`);
    const group = this.deps.groups.create(trimmed, description, color);
    this.deps.emit('WORKER_GROUP_CHANGED', `Worker group "${trimmed}" created`, { groupId: group.id });
    return group;
  }

  updateGroup(id: string, patch: { name?: string; description?: string; color?: string }): WorkerGroup | undefined {
    const updated = this.deps.groups.update(id, patch);
    if (updated) this.deps.emit('WORKER_GROUP_CHANGED', `Worker group "${updated.name}" updated`, { groupId: id });
    return updated;
  }

  removeGroup(id: string): boolean {
    const group = this.deps.groups.get(id);
    const removed = this.deps.groups.remove(id);
    if (removed && group) {
      this.deps.emit('WORKER_GROUP_CHANGED', `Worker group "${group.name}" deleted`, { groupId: id });
    }
    return removed;
  }

  assignGroup(workerId: string, groupId: string | null): boolean {
    if (groupId && !this.deps.groups.get(groupId)) throw new Error('That group no longer exists.');
    const updated = this.deps.workers.update(workerId, { groupId });
    if (updated) {
      const group = groupId ? this.deps.groups.get(groupId) : undefined;
      this.deps.emit('WORKER_GROUP_CHANGED',
        `${updated.username || workerId} moved to ${group ? group.name : 'no group'}`, { workerId, groupId });
    }
    return Boolean(updated);
  }

  /** Moves many workers into a group (or out of one) in one operation. */
  assignGroupBulk(workerIds: string[], groupId: string | null): number {
    let moved = 0;
    for (const workerId of workerIds) {
      if (this.assignGroup(workerId, groupId)) moved++;
    }
    return moved;
  }

  setLabel(workerId: string, label: string): boolean {
    return Boolean(this.deps.workers.update(workerId, { label: label.trim() }));
  }

  setNotes(workerId: string, notes: string): boolean {
    return Boolean(this.deps.workers.update(workerId, { notes }));
  }

  /** Removes a worker's durable record and cached inventory. */
  forget(workerId: string): boolean {
    if (this.server.isOnline(workerId)) this.server.kick(workerId, 'removed from the fleet');
    this.deps.inventory.remove(workerId);
    this.server.clearConsole(workerId);
    return this.deps.workers.remove(workerId);
  }

  // ------------------------------------------------------------------ tasks

  /**
   * Runs a task on one worker and records it.
   *
   * The result is whatever the worker actually reported; a task that timed out or was refused
   * throws, so a caller can never mistake "asked" for "done".
   */
  async runTask(workerId: string, kind: TaskKind, params: Record<string, unknown> = {}): Promise<WorkerTaskResult> {
    if (!isTaskKind(kind)) throw new Error(`unknown task kind: ${kind}`);
    this.deps.emit('WORKER_TASK_DISPATCHED', `${kind} → ${workerId}`, { workerId, kind });
    try {
      const result = await this.server.sendTask(workerId, kind, params);
      if (result.kind === 'inventory' && result.ok) {
        this.deps.emit('WORKER_INVENTORY', `Inventory updated for ${workerId}`, { workerId });
      }
      this.deps.emit(result.ok ? 'WORKER_TASK_FINISHED' : 'WORKER_TASK_FAILED',
        `${kind} ${result.ok ? 'finished' : 'failed'} on ${workerId}: ${result.message}`,
        { workerId, kind, message: result.message });
      return result;
    } catch (error) {
      this.deps.emit('WORKER_TASK_FAILED', `${kind} failed on ${workerId}: ${(error as Error).message}`,
        { workerId, kind, error: (error as Error).message });
      throw error;
    }
  }

  /** Runs the same task on many workers, tolerating individual failures. */
  async runTaskMany(
    workerIds: string[],
    kind: TaskKind,
    params: Record<string, unknown> = {},
  ): Promise<{ workerId: string; ok: boolean; result?: WorkerTaskResult; error?: string }[]> {
    const outcomes: { workerId: string; ok: boolean; result?: WorkerTaskResult; error?: string }[] = [];
    for (const workerId of workerIds) {
      try {
        outcomes.push({ workerId, ok: true, result: await this.runTask(workerId, kind, params) });
      } catch (error) {
        outcomes.push({ workerId, ok: false, error: (error as Error).message });
      }
    }
    return outcomes;
  }

  listTasks(limit = 200, workerId?: string): WorkerTaskRecord[] {
    return this.deps.tasks.list(limit, workerId);
  }

  taskKinds(): readonly string[] {
    return TASK_KINDS;
  }

  // ------------------------------------------------------------- commands

  /** Sends a server command or a chat line, recording it in the audit log. */
  async sendLine(workerId: string, kind: 'command' | 'chat', line: string): Promise<WorkerCommandRecord> {
    const trimmed = line.trim();
    if (!trimmed) throw new Error('Nothing to send.');
    const taskKind: TaskKind = kind === 'chat' ? 'chat' : 'command';
    const params = kind === 'chat' ? { message: trimmed } : { command: trimmed.replace(/^\//, '') };
    let ok = false;
    let response = '';
    try {
      const result = await this.runTask(workerId, taskKind, params);
      ok = result.ok;
      response = result.message;
    } catch (error) {
      response = (error as Error).message;
    }
    return this.deps.commands.record({ workerId, kind, line: trimmed, ok, response });
  }

  /** Sends the same line to many workers, recording one row per worker. */
  async sendLineMany(
    workerIds: string[],
    kind: 'command' | 'chat',
    line: string,
  ): Promise<{ workerId: string; ok: boolean; response: string }[]> {
    const results: { workerId: string; ok: boolean; response: string }[] = [];
    for (const workerId of workerIds) {
      const record = await this.sendLine(workerId, kind, line);
      results.push({ workerId, ok: record.ok, response: record.response });
    }
    return results;
  }

  listCommands(limit = 200, workerId?: string): WorkerCommandRecord[] {
    return this.deps.commands.list(limit, workerId);
  }

  // ------------------------------------------------------------- inventory

  inventory(workerId: string): WorkerInventorySnapshot | undefined {
    return this.deps.inventory.get(workerId);
  }

  /** Total quantity of an item across the given workers (all workers when none are given). */
  countItem(query: string, workerIds?: string[]): ItemCountReport {
    const workers = workerIds && workerIds.length > 0
      ? workerIds.map((id) => this.deps.workers.get(id)).filter((w): w is WorkerRecord => Boolean(w))
      : this.deps.workers.list();

    const rows: ItemCountRow[] = [];
    let oldest: number | null = null;
    for (const worker of workers) {
      const snapshot = this.deps.inventory.get(worker.id);
      const count = snapshot ? countIn(snapshot.carried, query) : 0;
      if (snapshot) {
        oldest = oldest === null ? snapshot.capturedAt : Math.min(oldest, snapshot.capturedAt);
      }
      rows.push({
        workerId: worker.id,
        label: worker.label || worker.username || worker.id,
        username: worker.username,
        online: this.server.isOnline(worker.id),
        count,
        capturedAt: snapshot?.capturedAt ?? 0,
      });
    }
    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      query,
      total: rows.reduce((sum, row) => sum + row.count, 0),
      rows,
      stale: oldest === null || Date.now() - oldest > STALE_INVENTORY_MS,
      oldestCapture: oldest,
    };
  }

  /** Combined inventory totals across workers, keyed by item id. */
  combinedTotals(workerIds?: string[]): { id: string; name: string; count: number }[] {
    const workers = workerIds && workerIds.length > 0
      ? workerIds.map((id) => this.deps.workers.get(id)).filter((w): w is WorkerRecord => Boolean(w))
      : this.deps.workers.list();

    const totals = new Map<string, { id: string; name: string; count: number }>();
    for (const worker of workers) {
      const snapshot = this.deps.inventory.get(worker.id);
      if (!snapshot) continue;
      for (const item of snapshot.carried) {
        const existing = totals.get(item.id);
        if (existing) existing.count += item.count;
        else totals.set(item.id, { id: item.id, name: item.name, count: item.count });
      }
    }
    return [...totals.values()].sort((a, b) => b.count - a.count);
  }

  // --------------------------------------------------------------- regear

  listPresets(): RegearPreset[] {
    return this.deps.presets.list();
  }

  createPreset(input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>): RegearPreset {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('A preset needs a name.');
    if (this.deps.presets.findByName(trimmed)) throw new Error(`A preset named "${trimmed}" already exists.`);
    return this.deps.presets.create({ ...input, name: trimmed });
  }

  updatePreset(id: string, patch: Partial<Omit<RegearPreset, 'id' | 'createdAt'>>): RegearPreset | undefined {
    return this.deps.presets.update(id, patch);
  }

  removePreset(id: string): boolean {
    return this.deps.presets.remove(id);
  }

  /**
   * Compares a preset with a worker's last reported inventory.
   *
   * This is a pure computation over the cached snapshot; it never asks the worker anything. The
   * caller is responsible for refreshing the snapshot first when freshness matters.
   */
  comparePreset(workerId: string, presetId: string): RegearComparison {
    const preset = this.deps.presets.get(presetId);
    if (!preset) throw new Error('That preset no longer exists.');
    const worker = this.deps.workers.get(workerId);
    if (!worker) throw new Error('That worker is not known.');
    const snapshot = this.deps.inventory.get(workerId);

    const carried: WorkerItem[] = snapshot?.carried ?? [];
    const gaps: RegearGap[] = preset.items.map((item) => {
      const found = countIn(carried, item.query);
      return {
        query: item.query,
        label: item.label || item.query,
        required: item.count,
        found,
        missing: Math.max(0, item.count - found),
      };
    });

    const armorPieces = snapshot?.armor.filter((piece) => piece.count > 0).length ?? 0;
    const food = carried.reduce((sum, item) => sum + (isFoodish(item) ? item.count : 0), 0);
    const damaged = (snapshot?.armor ?? [])
      .filter((piece) => piece.damageable && piece.maxDamage > 0
        && Math.round(((piece.maxDamage - piece.damage) * 100) / piece.maxDamage) <= preset.lowDurabilityPercent)
      .map((piece) => `${piece.name} (${Math.round(((piece.maxDamage - piece.damage) * 100) / piece.maxDamage)}%)`);

    const ready = gaps.every((gap) => gap.missing === 0)
      && armorPieces >= preset.minArmorPieces
      && food >= preset.minFood;

    return {
      workerId,
      presetId,
      presetName: preset.name,
      ready,
      gaps,
      armorPieces,
      minArmorPieces: preset.minArmorPieces,
      food,
      minFood: preset.minFood,
      damaged,
      capturedAt: snapshot?.capturedAt ?? 0,
    };
  }

  /**
   * Requests a regear on a worker.
   *
   * A dry run (the default) only asks the worker to compare and report; it moves nothing. When
   * `allowMoves` is set the worker may shift-click matching items out of a container it already has
   * open, and it re-reads its inventory afterwards. Either way the returned report is the worker's
   * confirmation, never an assumption by the host.
   */
  async regear(workerId: string, presetId: string, allowMoves = false): Promise<WorkerTaskResult> {
    const preset = this.deps.presets.get(presetId);
    if (!preset) throw new Error('That preset no longer exists.');
    const params = {
      name: preset.name,
      items: preset.items,
      minArmorPieces: preset.minArmorPieces,
      minFood: preset.minFood,
      lowDurabilityPercent: preset.lowDurabilityPercent,
      allowMoves,
    };
    const result = await this.runTask(workerId, 'regear', params);
    // A regear changes the inventory; pull a fresh snapshot so the next comparison is accurate.
    try {
      await this.runTask(workerId, 'inventory');
    } catch {
      // The worker may have disconnected between the two calls; the report is still valid.
    }
    return result;
  }

  /** Requests a regear across a set of workers, reporting each one's outcome. */
  async regearMany(
    workerIds: string[],
    presetId: string,
    allowMoves = false,
  ): Promise<{ workerId: string; ok: boolean; message: string }[]> {
    const out: { workerId: string; ok: boolean; message: string }[] = [];
    for (const workerId of workerIds) {
      try {
        const result = await this.regear(workerId, presetId, allowMoves);
        out.push({ workerId, ok: result.ok, message: result.message });
      } catch (error) {
        out.push({ workerId, ok: false, message: (error as Error).message });
      }
    }
    return out;
  }

  /**
   * Starts or stops elytra flight on a worker.
   *
   * The flying is done by the worker's Meteor `ElytraFly` module — the host only asks for it and
   * reports the worker's own confirmation. With a target the worker flies there; without one it
   * engages flight where it stands. `stop` always cancels pathing and disengages flight.
   */
  async efly(
    workerId: string,
    options: {
      action?: 'start' | 'stop';
      x?: number;
      y?: number;
      z?: number;
      mode?: string;
      useFireworks?: boolean;
      minHeight?: number;
    } = {},
  ): Promise<WorkerTaskResult> {
    const action = options.action ?? 'start';
    const params: Record<string, unknown> = { action };
    if (action === 'start') {
      if (options.x !== undefined && options.z !== undefined) {
        params.x = options.x;
        params.y = options.y ?? 120;
        params.z = options.z;
      }
      if (options.mode) params.mode = options.mode;
      if (options.useFireworks !== undefined) params.useFireworks = options.useFireworks;
      if (options.minHeight !== undefined) params.minHeight = options.minHeight;
    }
    return this.runTask(workerId, 'efly', params);
  }

  /** Starts or stops elytra flight across a set of workers, reporting each outcome. */
  async eflyMany(
    workerIds: string[],
    options: { action?: 'start' | 'stop'; x?: number; y?: number; z?: number; mode?: string } = {},
  ): Promise<{ workerId: string; ok: boolean; message: string }[]> {
    const out: { workerId: string; ok: boolean; message: string }[] = [];
    for (const workerId of workerIds) {
      try {
        const result = await this.efly(workerId, options);
        out.push({ workerId, ok: result.ok, message: result.message });
      } catch (error) {
        out.push({ workerId, ok: false, message: (error as Error).message });
      }
    }
    return out;
  }
}

/** Counts how many of an item a reported stack list holds, using the worker's alias rules. */
function countIn(items: WorkerItem[], query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  return items
    .filter((item) => matchesQuery(item, needle))
    .reduce((sum, item) => sum + item.count, 0);
}

/**
 * The host mirrors the worker's forgiving matching so counts agree with what the worker itself
 * reports for the same query. Kept in one function so the two never drift.
 */
function matchesQuery(item: WorkerItem, needle: string): boolean {
  const id = (item.id ?? '').toLowerCase();
  const name = (item.name ?? '').toLowerCase();
  const path = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  if (id === needle || path === needle) return true;
  if (path.includes(needle) || name.includes(needle)) return true;
  const aliases: Record<string, string> = {
    totem: 'totem_of_undying',
    totems: 'totem_of_undying',
    gapple: 'golden_apple',
    gapples: 'golden_apple',
    pearl: 'ender_pearl',
    pearls: 'ender_pearl',
    iron: 'iron_ingot',
    gold: 'gold_ingot',
    xp: 'experience_bottle',
  };
  const alias = aliases[needle];
  if (alias) return path === alias || path.endsWith(`_${alias}`) || path.includes(alias);
  return false;
}

/** Best-effort food detection from an item id, since the host only sees the id and the name. */
function isFoodish(item: WorkerItem): boolean {
  const id = (item.id ?? '').toLowerCase();
  const foodWords = ['apple', 'bread', 'cooked_', 'beef', 'porkchop', 'chicken', 'mutton', 'cod', 'salmon',
    'potato', 'carrot', 'melon', 'stew', 'cookie', 'cake', 'pie', 'golden_apple', 'golden_carrot', 'berry'];
  return foodWords.some((word) => id.includes(word));
}

export { STALE_INVENTORY_MS };
