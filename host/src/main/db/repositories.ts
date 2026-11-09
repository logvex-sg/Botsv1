/**
 * Repository layer: one small class per aggregate.
 *
 * Rows are mapped to the shared domain types (camelCase) so callers never touch raw SQL columns.
 * Every repository takes the {@link FleetDatabase} wrapper, keeping persistence concerns isolated
 * from the service layer.
 */
import { randomUUID } from 'node:crypto';
import type { FleetDatabase } from './database';
import type {
  EventSeverity,
  FleetEvent,
  NotificationItem,
  RegearItem,
  RegearPreset,
  WorkerCommandRecord,
  WorkerGroup,
  WorkerInventorySnapshot,
  WorkerRecord,
  WorkerStatus,
  WorkerTaskRecord,
  WorkerTaskStatus,
} from '../../shared/types';

function now(): number {
  return Date.now();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class EventRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 200, filter?: { type?: string; source?: string; workerId?: string }): FleetEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { clauses.push('type=?'); params.push(filter.type); }
    if (filter?.source) { clauses.push('source=?'); params.push(filter.source); }
    if (filter?.workerId) { clauses.push('worker_id=?'); params.push(filter.workerId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    return this.db.all(`SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ?`, params).map(mapEvent);
  }

  insert(event: FleetEvent): void {
    this.db.run(
      `INSERT INTO events (id, type, source, severity, worker_id, message, payload, timestamp)
       VALUES (?,?,?,?,?,?,?,?)`,
      [event.id, event.type, event.source, event.severity, event.workerId,
        event.message, JSON.stringify(event.payload ?? {}), event.timestamp],
    );
  }

  /** Keeps the event table bounded so the database does not grow without limit. */
  prune(keep: number): void {
    this.db.run(
      `DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY timestamp DESC LIMIT ?)`,
      [keep],
    );
  }
}

function mapEvent(row: Record<string, unknown>): FleetEvent {
  return {
    id: String(row.id),
    type: String(row.type),
    source: String(row.source),
    severity: String(row.severity ?? 'info') as EventSeverity,
    workerId: row.worker_id ? String(row.worker_id) : null,
    message: String(row.message),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    timestamp: Number(row.timestamp),
  };
}

export class NotificationRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 100): NotificationItem[] {
    return this.db.all('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ?', [limit]).map(mapNotification);
  }

  insert(item: NotificationItem): void {
    this.db.run(
      `INSERT INTO notifications (id, event_id, type, severity, title, body, read, timestamp)
       VALUES (?,?,?,?,?,?,?,?)`,
      [item.id, item.eventId, item.type, item.severity, item.title, item.body, item.read ? 1 : 0, item.timestamp],
    );
  }

  markRead(id: string, read = true): boolean {
    return this.db.run('UPDATE notifications SET read=? WHERE id=?', [read ? 1 : 0, id]).changes > 0;
  }

  markAllRead(): void {
    this.db.run('UPDATE notifications SET read=1');
  }
}

function mapNotification(row: Record<string, unknown>): NotificationItem {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    type: String(row.type),
    severity: String(row.severity ?? 'info') as NotificationItem['severity'],
    title: String(row.title),
    body: String(row.body ?? ''),
    read: Number(row.read) === 1,
    timestamp: Number(row.timestamp),
  };
}

export class SettingsRepository {
  constructor(private readonly db: FleetDatabase) {}

  get(key: string): string | undefined {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [key, value],
    );
  }

  all(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings')) {
      out[row.key] = row.value;
    }
    return out;
  }
}

export class ConfigVersionRepository {
  constructor(private readonly db: FleetDatabase) {}

  /** Records a new version, returning the version number. */
  record(scope: string, refId: string, data: unknown): number {
    const row = this.db.get<{ max: number | null }>(
      'SELECT MAX(version) AS max FROM config_versions WHERE scope=? AND ref_id=?',
      [scope, refId],
    );
    const version = (row?.max ?? 0) + 1;
    this.db.run(
      'INSERT INTO config_versions (id, scope, ref_id, version, data, created_at) VALUES (?,?,?,?,?,?)',
      [randomUUID(), scope, refId, version, JSON.stringify(data ?? {}), now()],
    );
    return version;
  }

  history(scope: string, refId: string, limit = 20): { version: number; data: unknown; createdAt: number }[] {
    return this.db
      .all<{ version: number; data: string; created_at: number }>(
        'SELECT version, data, created_at FROM config_versions WHERE scope=? AND ref_id=? ORDER BY version DESC LIMIT ?',
        [scope, refId, limit],
      )
      .map((r) => ({ version: r.version, data: parseJson<unknown>(r.data, {}), createdAt: r.created_at }));
  }
}

function mapWorker(row: Record<string, unknown>): WorkerRecord {
  return {
    id: String(row.id),
    label: String(row.label ?? ''),
    username: String(row.username ?? ''),
    minecraftVersion: String(row.minecraft_version ?? ''),
    serverAddress: String(row.server_address ?? ''),
    protocolVersion: Number(row.protocol_version ?? 0),
    modVersion: String(row.mod_version ?? ''),
    groupId: row.group_id == null ? null : String(row.group_id),
    notes: String(row.notes ?? ''),
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
    lastAddress: String(row.last_address ?? ''),
    status: String(row.status ?? 'OFFLINE') as WorkerStatus,
  };
}

function mapWorkerGroup(row: Record<string, unknown>): WorkerGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#6d5efc'),
    createdAt: Number(row.created_at),
  };
}

function mapWorkerTask(row: Record<string, unknown>): WorkerTaskRecord {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    kind: String(row.kind),
    status: String(row.status ?? 'PENDING') as WorkerTaskRecord['status'],
    params: parseJson<Record<string, unknown>>(row.params, {}),
    result: row.result == null ? null : parseJson<Record<string, unknown>>(row.result, {}),
    error: row.error == null ? null : String(row.error),
    createdAt: Number(row.created_at),
    dispatchedAt: row.dispatched_at == null ? null : Number(row.dispatched_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    actor: String(row.actor ?? 'host'),
  };
}

function mapWorkerCommand(row: Record<string, unknown>): WorkerCommandRecord {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    kind: String(row.kind) as 'command' | 'chat',
    line: String(row.line),
    ok: Number(row.ok ?? 0) === 1,
    response: String(row.response ?? ''),
    createdAt: Number(row.created_at),
  };
}

function mapRegearPreset(row: Record<string, unknown>): RegearPreset {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    items: parseJson<RegearItem[]>(row.items, []),
    minArmorPieces: Number(row.min_armor_pieces ?? 0),
    minFood: Number(row.min_food ?? 0),
    lowDurabilityPercent: Number(row.low_durability_percent ?? 10),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapWorkerInventory(row: Record<string, unknown>): WorkerInventorySnapshot {
  return {
    workerId: String(row.worker_id),
    capturedAt: Number(row.captured_at),
    carried: parseJson<WorkerInventorySnapshot['carried']>(row.carried, []),
    accessible: parseJson<WorkerInventorySnapshot['accessible']>(row.accessible, []),
    armor: parseJson<WorkerInventorySnapshot['armor']>(row.armor, []),
    containerOpen: Number(row.container_open ?? 0) === 1,
  };
}

// -------------------------------------------------------------------- workers
//
// A worker is a real Minecraft client that dialled in, not an account the host launches. Its live
// connection state is held in memory by the worker registry; these repositories own the durable
// record: identity, group, last known snapshot, task history and the last reported inventory.

export class WorkerRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): WorkerRecord[] {
    return this.db.all('SELECT * FROM workers ORDER BY username COLLATE NOCASE, id').map(mapWorker);
  }

  get(id: string): WorkerRecord | undefined {
    const row = this.db.get('SELECT * FROM workers WHERE id=?', [id]);
    return row ? mapWorker(row) : undefined;
  }

  /** Inserts or updates a worker, preserving its group and notes across reconnects. */
  upsert(input: {
    id: string;
    label?: string;
    username?: string;
    minecraftVersion?: string;
    serverAddress?: string;
    protocolVersion?: number;
    modVersion?: string;
    lastAddress?: string;
    status?: WorkerStatus;
    snapshot?: Record<string, unknown>;
  }): WorkerRecord {
    const existing = this.get(input.id);
    const stamp = now();
    if (!existing) {
      this.db.run(
        `INSERT INTO workers (id, label, username, minecraft_version, server_address, protocol_version,
          mod_version, group_id, notes, first_seen, last_seen, last_address, status, snapshot)
         VALUES (?,?,?,?,?,?,?,NULL,'',?,?,?,?,?)`,
        [
          input.id,
          input.label ?? '',
          input.username ?? '',
          input.minecraftVersion ?? '',
          input.serverAddress ?? '',
          input.protocolVersion ?? 0,
          input.modVersion ?? '',
          stamp,
          stamp,
          input.lastAddress ?? '',
          input.status ?? 'OFFLINE',
          JSON.stringify(input.snapshot ?? {}),
        ],
      );
    } else {
      this.db.run(
        `UPDATE workers SET label=?, username=?, minecraft_version=?, server_address=?,
          protocol_version=?, mod_version=?, last_seen=?, last_address=?, status=?, snapshot=?
         WHERE id=?`,
        [
          input.label ?? existing.label,
          input.username ?? existing.username,
          input.minecraftVersion ?? existing.minecraftVersion,
          input.serverAddress ?? existing.serverAddress,
          input.protocolVersion ?? existing.protocolVersion,
          input.modVersion ?? existing.modVersion,
          stamp,
          input.lastAddress ?? existing.lastAddress,
          input.status ?? existing.status,
          JSON.stringify(input.snapshot ?? {}),
          input.id,
        ],
      );
    }
    return this.get(input.id)!;
  }

  /** Updates only the mutable bookkeeping fields (group, notes, label). */
  update(id: string, patch: Partial<Pick<WorkerRecord, 'label' | 'groupId' | 'notes' | 'status'>>): WorkerRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run('UPDATE workers SET label=?, group_id=?, notes=?, status=? WHERE id=?', [
      patch.label ?? existing.label,
      patch.groupId === undefined ? existing.groupId : patch.groupId,
      patch.notes ?? existing.notes,
      patch.status ?? existing.status,
      id,
    ]);
    return this.get(id);
  }

  /** Refreshes the cached snapshot and the last-seen stamp without touching group or notes. */
  touch(id: string, snapshot: Record<string, unknown>, status: WorkerStatus): void {
    this.db.run('UPDATE workers SET last_seen=?, status=?, snapshot=? WHERE id=?', [
      now(),
      status,
      JSON.stringify(snapshot ?? {}),
      id,
    ]);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM workers WHERE id=?', [id]).changes > 0;
  }

  /** Workers whose ids are no longer known, used to prune stale rows. */
  ids(): string[] {
    return this.db.all<{ id: string }>('SELECT id FROM workers').map((r) => r.id);
  }
}

export class WorkerGroupRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): WorkerGroup[] {
    return this.db.all('SELECT * FROM worker_groups ORDER BY name COLLATE NOCASE').map(mapWorkerGroup);
  }

  get(id: string): WorkerGroup | undefined {
    const row = this.db.get('SELECT * FROM worker_groups WHERE id=?', [id]);
    return row ? mapWorkerGroup(row) : undefined;
  }

  findByName(name: string): WorkerGroup | undefined {
    const row = this.db.get('SELECT * FROM worker_groups WHERE name=?', [name]);
    return row ? mapWorkerGroup(row) : undefined;
  }

  create(name: string, description = '', color = '#6d5efc'): WorkerGroup {
    const group: WorkerGroup = { id: randomUUID(), name, description, color, createdAt: now() };
    this.db.run('INSERT INTO worker_groups (id, name, description, color, created_at) VALUES (?,?,?,?,?)', [
      group.id, group.name, group.description, group.color, group.createdAt,
    ]);
    return group;
  }

  update(id: string, patch: { name?: string; description?: string; color?: string }): WorkerGroup | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run('UPDATE worker_groups SET name=?, description=?, color=? WHERE id=?', [
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      patch.color ?? existing.color,
      id,
    ]);
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM worker_groups WHERE id=?', [id]).changes > 0;
  }
}

export class WorkerTaskRepository {
  constructor(private readonly db: FleetDatabase) {}

  create(input: { id: string; workerId: string; kind: string; params: Record<string, unknown>; actor?: string }): WorkerTaskRecord {
    this.db.run(
      'INSERT INTO worker_tasks (id, worker_id, kind, status, params, created_at, actor) VALUES (?,?,?,?,?,?,?)',
      [input.id, input.workerId, input.kind, 'PENDING', JSON.stringify(input.params ?? {}), now(), input.actor ?? 'host'],
    );
    return this.get(input.id)!;
  }

  get(id: string): WorkerTaskRecord | undefined {
    const row = this.db.get('SELECT * FROM worker_tasks WHERE id=?', [id]);
    return row ? mapWorkerTask(row) : undefined;
  }

  list(limit = 200, workerId?: string): WorkerTaskRecord[] {
    const rows = workerId
      ? this.db.all('SELECT * FROM worker_tasks WHERE worker_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?', [workerId, limit])
      : this.db.all('SELECT * FROM worker_tasks ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit]);
    return rows.map(mapWorkerTask);
  }

  markDispatched(id: string): void {
    this.db.run("UPDATE worker_tasks SET status='DISPATCHED', dispatched_at=? WHERE id=? AND status='PENDING'", [now(), id]);
  }

  complete(id: string, status: WorkerTaskStatus, result: Record<string, unknown> | null, error: string | null): WorkerTaskRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const completedAt = now();
    const duration = existing.dispatchedAt ? completedAt - existing.dispatchedAt : null;
    this.db.run(
      'UPDATE worker_tasks SET status=?, result=?, error=?, completed_at=?, duration_ms=? WHERE id=?',
      [status, result ? JSON.stringify(result) : null, error, completedAt, duration, id],
    );
    return this.get(id);
  }

  /** Tasks left mid-flight by a crash or a host restart, so they can be marked timed out. */
  open(): WorkerTaskRecord[] {
    return this.db
      .all("SELECT * FROM worker_tasks WHERE status IN ('PENDING','DISPATCHED') ORDER BY created_at")
      .map(mapWorkerTask);
  }

  activeCount(): number {
    const row = this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM worker_tasks WHERE status IN ('PENDING','DISPATCHED')",
    );
    return row?.n ?? 0;
  }

  prune(keep: number): void {
    this.db.run(
      `DELETE FROM worker_tasks WHERE id IN (
         SELECT id FROM worker_tasks ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
      [keep],
    );
  }
}

export class WorkerCommandRepository {
  constructor(private readonly db: FleetDatabase) {}

  record(input: { workerId: string; kind: 'command' | 'chat'; line: string; ok: boolean; response?: string }): WorkerCommandRecord {
    const record: WorkerCommandRecord = {
      id: randomUUID(),
      workerId: input.workerId,
      kind: input.kind,
      line: input.line,
      ok: input.ok,
      response: input.response ?? '',
      createdAt: now(),
    };
    this.db.run(
      'INSERT INTO worker_commands (id, worker_id, kind, line, ok, response, created_at) VALUES (?,?,?,?,?,?,?)',
      [record.id, record.workerId, record.kind, record.line, record.ok ? 1 : 0, record.response, record.createdAt],
    );
    return record;
  }

  list(limit = 200, workerId?: string): WorkerCommandRecord[] {
    // rowid breaks the tie between rows written in the same millisecond, so the newest is always
    // first even for a burst of commands.
    const rows = workerId
      ? this.db.all('SELECT * FROM worker_commands WHERE worker_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?', [workerId, limit])
      : this.db.all('SELECT * FROM worker_commands ORDER BY created_at DESC, rowid DESC LIMIT ?', [limit]);
    return rows.map(mapWorkerCommand);
  }

  prune(keep: number): void {
    this.db.run(
      `DELETE FROM worker_commands WHERE id IN (
         SELECT id FROM worker_commands ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
      [keep],
    );
  }
}

export class RegearPresetRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): RegearPreset[] {
    return this.db.all('SELECT * FROM regear_presets ORDER BY name COLLATE NOCASE').map(mapRegearPreset);
  }

  get(id: string): RegearPreset | undefined {
    const row = this.db.get('SELECT * FROM regear_presets WHERE id=?', [id]);
    return row ? mapRegearPreset(row) : undefined;
  }

  findByName(name: string): RegearPreset | undefined {
    const row = this.db.get('SELECT * FROM regear_presets WHERE name=?', [name]);
    return row ? mapRegearPreset(row) : undefined;
  }

  create(input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>): RegearPreset {
    const stamp = now();
    const preset: RegearPreset = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.run(
      `INSERT INTO regear_presets (id, name, description, items, min_armor_pieces, min_food,
        low_durability_percent, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        preset.id, preset.name, preset.description, JSON.stringify(preset.items),
        preset.minArmorPieces, preset.minFood, preset.lowDurabilityPercent, stamp, stamp,
      ],
    );
    return preset;
  }

  update(id: string, patch: Partial<Omit<RegearPreset, 'id' | 'createdAt'>>): RegearPreset | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE regear_presets SET name=?, description=?, items=?, min_armor_pieces=?, min_food=?,
        low_durability_percent=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        JSON.stringify(patch.items ?? existing.items),
        patch.minArmorPieces ?? existing.minArmorPieces,
        patch.minFood ?? existing.minFood,
        patch.lowDurabilityPercent ?? existing.lowDurabilityPercent,
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM regear_presets WHERE id=?', [id]).changes > 0;
  }
}

export class WorkerInventoryRepository {
  constructor(private readonly db: FleetDatabase) {}

  save(snapshot: WorkerInventorySnapshot): void {
    this.db.run(
      `INSERT INTO worker_inventory (worker_id, captured_at, carried, accessible, armor, container_open)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(worker_id) DO UPDATE SET captured_at=excluded.captured_at, carried=excluded.carried,
         accessible=excluded.accessible, armor=excluded.armor, container_open=excluded.container_open`,
      [
        snapshot.workerId,
        snapshot.capturedAt,
        JSON.stringify(snapshot.carried ?? []),
        JSON.stringify(snapshot.accessible ?? []),
        JSON.stringify(snapshot.armor ?? []),
        snapshot.containerOpen ? 1 : 0,
      ],
    );
  }

  get(workerId: string): WorkerInventorySnapshot | undefined {
    const row = this.db.get('SELECT * FROM worker_inventory WHERE worker_id=?', [workerId]);
    return row ? mapWorkerInventory(row) : undefined;
  }

  all(): WorkerInventorySnapshot[] {
    return this.db.all('SELECT * FROM worker_inventory').map(mapWorkerInventory);
  }

  remove(workerId: string): void {
    this.db.run('DELETE FROM worker_inventory WHERE worker_id=?', [workerId]);
  }
}
