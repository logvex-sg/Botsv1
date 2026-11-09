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
  AuditEntry,
  AutomationRule,
  ContainerRecord,
  EventSeverity,
  FleetEvent,
  GroupTemplate,
  NotificationItem,
  RegearItem,
  RegearPreset,
  RuleCondition,
  ScheduleRecord,
  ServerProfile,
  TaskPreset,
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
    tags: parseJson<string[]>(row.tags, []),
    serverProfileId: row.server_profile_id == null ? null : String(row.server_profile_id),
    fabricVersion: String(row.fabric_version ?? ''),
    meteorVersion: String(row.meteor_version ?? ''),
    capabilities: parseJson<string[]>(row.capabilities, []),
    archived: Number(row.archived ?? 0) === 1,
  };
}

function mapWorkerGroup(row: Record<string, unknown>): WorkerGroup {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#6d5efc'),
    createdAt: Number(row.created_at),
    defaultTaskPresetIds: parseJson<string[]>(row.default_task_preset_ids, []),
    defaultEquipmentPresetIds: parseJson<string[]>(row.default_equipment_preset_ids, []),
    permissions: parseJson<string[]>(row.permissions, []),
    archived: Number(row.archived ?? 0) === 1,
  };
}

function mapGroupTemplate(row: Record<string, unknown>): GroupTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#6d5efc'),
    defaultTaskPresetIds: parseJson<string[]>(row.default_task_preset_ids, []),
    defaultEquipmentPresetIds: parseJson<string[]>(row.default_equipment_preset_ids, []),
    permissions: parseJson<string[]>(row.permissions, []),
    createdAt: Number(row.created_at),
  };
}

function mapServerProfile(row: Record<string, unknown>): ServerProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    host: String(row.host ?? ''),
    port: Number(row.port ?? 25565),
    version: String(row.version ?? ''),
    environment: String(row.environment ?? 'production') as ServerProfile['environment'],
    notes: String(row.notes ?? ''),
    tags: parseJson<string[]>(row.tags, []),
    archived: Number(row.archived ?? 0) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapTaskPreset(row: Record<string, unknown>): TaskPreset {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    kind: String(row.kind),
    params: parseJson<Record<string, unknown>>(row.params, {}),
    targetWorkerIds: parseJson<string[]>(row.target_worker_ids, []),
    targetGroupIds: parseJson<string[]>(row.target_group_ids, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapSchedule(row: Record<string, unknown>): ScheduleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    presetId: row.preset_id == null ? null : String(row.preset_id),
    kind: String(row.task_kind ?? row.kind ?? ''),
    params: parseJson<Record<string, unknown>>(row.params, {}),
    targetWorkerIds: parseJson<string[]>(row.target_worker_ids, []),
    targetGroupIds: parseJson<string[]>(row.target_group_ids, []),
    scheduleKind: String(row.schedule_kind) as ScheduleRecord['scheduleKind'],
    startAt: Number(row.start_at),
    intervalMs: row.interval_ms == null ? null : Number(row.interval_ms),
    timeOfDay: row.time_of_day == null ? null : String(row.time_of_day),
    stopAt: row.stop_at == null ? null : Number(row.stop_at),
    enabled: Number(row.enabled ?? 1) === 1,
    lastFiredAt: row.last_fired_at == null ? null : Number(row.last_fired_at),
    fireCount: Number(row.fire_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapAutomationRule(row: Record<string, unknown>): AutomationRule {
  return {
    id: String(row.id),
    name: String(row.name),
    enabled: Number(row.enabled ?? 1) === 1,
    event: String(row.event),
    conditions: parseJson<RuleCondition[]>(row.conditions, []),
    action: String(row.action),
    cooldownMs: Number(row.cooldown_ms ?? 0),
    maxRuns: row.max_runs == null ? null : Number(row.max_runs),
    runCount: Number(row.run_count ?? 0),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapContainer(row: Record<string, unknown>): ContainerRecord {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    label: String(row.label ?? ''),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    dimension: String(row.dimension ?? ''),
    items: parseJson<ContainerRecord['items']>(row.items, []),
    inspectedAt: Number(row.inspected_at),
  };
}

function mapAudit(row: Record<string, unknown>): AuditEntry {
  return {
    id: String(row.id),
    at: Number(row.at),
    actor: String(row.actor ?? 'operator'),
    action: String(row.action),
    target: String(row.target ?? ''),
    detail: String(row.detail ?? ''),
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

  /** Inserts or updates a worker, preserving its group, notes, tags and profile across reconnects. */
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
    fabricVersion?: string;
    meteorVersion?: string;
    capabilities?: string[];
  }): WorkerRecord {
    const existing = this.get(input.id);
    const stamp = now();
    if (!existing) {
      this.db.run(
        `INSERT INTO workers (id, label, username, minecraft_version, server_address, protocol_version,
          mod_version, group_id, notes, first_seen, last_seen, last_address, status, snapshot,
          fabric_version, meteor_version, capabilities)
         VALUES (?,?,?,?,?,?,?,NULL,'',?,?,?,?,?,?,?,?)`,
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
          input.fabricVersion ?? '',
          input.meteorVersion ?? '',
          JSON.stringify(input.capabilities ?? []),
        ],
      );
    } else {
      this.db.run(
        `UPDATE workers SET label=?, username=?, minecraft_version=?, server_address=?,
          protocol_version=?, mod_version=?, last_seen=?, last_address=?, status=?, snapshot=?,
          fabric_version=?, meteor_version=?, capabilities=?
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
          input.fabricVersion ?? existing.fabricVersion,
          input.meteorVersion ?? existing.meteorVersion,
          JSON.stringify(input.capabilities ?? existing.capabilities),
          input.id,
        ],
      );
    }
    return this.get(input.id)!;
  }

  /** Updates only the mutable bookkeeping fields (group, notes, label, tags, server profile). */
  update(id: string, patch: Partial<Pick<WorkerRecord,
    'label' | 'groupId' | 'notes' | 'status' | 'tags' | 'serverProfileId' | 'archived'>>): WorkerRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      'UPDATE workers SET label=?, group_id=?, notes=?, status=?, tags=?, server_profile_id=?, archived=? WHERE id=?',
      [
        patch.label ?? existing.label,
        patch.groupId === undefined ? existing.groupId : patch.groupId,
        patch.notes ?? existing.notes,
        patch.status ?? existing.status,
        JSON.stringify(patch.tags ?? existing.tags),
        patch.serverProfileId === undefined ? existing.serverProfileId : patch.serverProfileId,
        (patch.archived ?? existing.archived) ? 1 : 0,
        id,
      ],
    );
    return this.get(id);
  }

  /** The workers assigned to a server profile. */
  byServerProfile(profileId: string): WorkerRecord[] {
    return this.db
      .all('SELECT * FROM workers WHERE server_profile_id=? ORDER BY username COLLATE NOCASE', [profileId])
      .map(mapWorker);
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
    const group: WorkerGroup = {
      id: randomUUID(), name, description, color, createdAt: now(),
      defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [], archived: false,
    };
    this.db.run(
      `INSERT INTO worker_groups (id, name, description, color, created_at, default_task_preset_ids,
        default_equipment_preset_ids, permissions, archived) VALUES (?,?,?,?,?,'[]','[]','[]',0)`,
      [group.id, group.name, group.description, group.color, group.createdAt],
    );
    return group;
  }

  update(id: string, patch: Partial<Pick<WorkerGroup,
    'name' | 'description' | 'color' | 'defaultTaskPresetIds' | 'defaultEquipmentPresetIds' | 'permissions' | 'archived'>>): WorkerGroup | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE worker_groups SET name=?, description=?, color=?, default_task_preset_ids=?,
        default_equipment_preset_ids=?, permissions=?, archived=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        patch.color ?? existing.color,
        JSON.stringify(patch.defaultTaskPresetIds ?? existing.defaultTaskPresetIds),
        JSON.stringify(patch.defaultEquipmentPresetIds ?? existing.defaultEquipmentPresetIds),
        JSON.stringify(patch.permissions ?? existing.permissions),
        (patch.archived ?? existing.archived) ? 1 : 0,
        id,
      ],
    );
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

// --------------------------------------------------------------- server profiles
//
// A server profile is an organisational record. It says which server a set of workers is *meant*
// to run on; the live connection state always comes from what a worker reports.

export class ServerProfileRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(includeArchived = false): ServerProfile[] {
    const where = includeArchived ? '' : 'WHERE archived=0';
    return this.db.all(`SELECT * FROM server_profiles ${where} ORDER BY name COLLATE NOCASE`).map(mapServerProfile);
  }

  get(id: string): ServerProfile | undefined {
    const row = this.db.get('SELECT * FROM server_profiles WHERE id=?', [id]);
    return row ? mapServerProfile(row) : undefined;
  }

  findByName(name: string): ServerProfile | undefined {
    const row = this.db.get('SELECT * FROM server_profiles WHERE name=?', [name]);
    return row ? mapServerProfile(row) : undefined;
  }

  create(input: Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'>): ServerProfile {
    const stamp = now();
    const profile: ServerProfile = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.run(
      `INSERT INTO server_profiles (id, name, host, port, version, environment, notes, tags, archived, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        profile.id, profile.name, profile.host, profile.port, profile.version, profile.environment,
        profile.notes, JSON.stringify(profile.tags ?? []), profile.archived ? 1 : 0, stamp, stamp,
      ],
    );
    return profile;
  }

  update(id: string, patch: Partial<Omit<ServerProfile, 'id' | 'createdAt'>>): ServerProfile | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE server_profiles SET name=?, host=?, port=?, version=?, environment=?, notes=?, tags=?,
        archived=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        patch.host ?? existing.host,
        patch.port ?? existing.port,
        patch.version ?? existing.version,
        patch.environment ?? existing.environment,
        patch.notes ?? existing.notes,
        JSON.stringify(patch.tags ?? existing.tags),
        (patch.archived ?? existing.archived) ? 1 : 0,
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM server_profiles WHERE id=?', [id]).changes > 0;
  }
}

// ------------------------------------------------------------------ group templates

export class GroupTemplateRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): GroupTemplate[] {
    return this.db.all('SELECT * FROM group_templates ORDER BY name COLLATE NOCASE').map(mapGroupTemplate);
  }

  get(id: string): GroupTemplate | undefined {
    const row = this.db.get('SELECT * FROM group_templates WHERE id=?', [id]);
    return row ? mapGroupTemplate(row) : undefined;
  }

  findByName(name: string): GroupTemplate | undefined {
    const row = this.db.get('SELECT * FROM group_templates WHERE name=?', [name]);
    return row ? mapGroupTemplate(row) : undefined;
  }

  create(input: Omit<GroupTemplate, 'id' | 'createdAt'>): GroupTemplate {
    const template: GroupTemplate = { ...input, id: randomUUID(), createdAt: now() };
    this.db.run(
      `INSERT INTO group_templates (id, name, description, color, default_task_preset_ids,
        default_equipment_preset_ids, permissions, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [
        template.id, template.name, template.description, template.color,
        JSON.stringify(template.defaultTaskPresetIds), JSON.stringify(template.defaultEquipmentPresetIds),
        JSON.stringify(template.permissions), template.createdAt,
      ],
    );
    return template;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM group_templates WHERE id=?', [id]).changes > 0;
  }
}

// --------------------------------------------------------------------- task presets

export class TaskPresetRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): TaskPreset[] {
    return this.db.all('SELECT * FROM task_presets ORDER BY name COLLATE NOCASE').map(mapTaskPreset);
  }

  get(id: string): TaskPreset | undefined {
    const row = this.db.get('SELECT * FROM task_presets WHERE id=?', [id]);
    return row ? mapTaskPreset(row) : undefined;
  }

  findByName(name: string): TaskPreset | undefined {
    const row = this.db.get('SELECT * FROM task_presets WHERE name=?', [name]);
    return row ? mapTaskPreset(row) : undefined;
  }

  create(input: Omit<TaskPreset, 'id' | 'createdAt' | 'updatedAt'>): TaskPreset {
    const stamp = now();
    const preset: TaskPreset = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.db.run(
      `INSERT INTO task_presets (id, name, description, kind, params, target_worker_ids, target_group_ids, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        preset.id, preset.name, preset.description, preset.kind, JSON.stringify(preset.params),
        JSON.stringify(preset.targetWorkerIds), JSON.stringify(preset.targetGroupIds), stamp, stamp,
      ],
    );
    return preset;
  }

  update(id: string, patch: Partial<Omit<TaskPreset, 'id' | 'createdAt'>>): TaskPreset | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE task_presets SET name=?, description=?, kind=?, params=?, target_worker_ids=?, target_group_ids=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        patch.kind ?? existing.kind,
        JSON.stringify(patch.params ?? existing.params),
        JSON.stringify(patch.targetWorkerIds ?? existing.targetWorkerIds),
        JSON.stringify(patch.targetGroupIds ?? existing.targetGroupIds),
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM task_presets WHERE id=?', [id]).changes > 0;
  }
}

// ----------------------------------------------------------------------- schedules

export class ScheduleRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): ScheduleRecord[] {
    return this.db.all('SELECT * FROM schedules ORDER BY created_at DESC').map(mapSchedule);
  }

  get(id: string): ScheduleRecord | undefined {
    const row = this.db.get('SELECT * FROM schedules WHERE id=?', [id]);
    return row ? mapSchedule(row) : undefined;
  }

  create(input: Omit<ScheduleRecord, 'id' | 'createdAt' | 'updatedAt' | 'fireCount' | 'lastFiredAt'>): ScheduleRecord {
    const stamp = now();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO schedules (id, name, preset_id, kind, task_kind, params, target_worker_ids, target_group_ids,
        schedule_kind, start_at, interval_ms, time_of_day, stop_at, enabled, last_fired_at, fire_count, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,0,?,?)`,
      [
        id, input.name, input.presetId, input.kind, input.kind, JSON.stringify(input.params),
        JSON.stringify(input.targetWorkerIds), JSON.stringify(input.targetGroupIds),
        input.scheduleKind, input.startAt, input.intervalMs, input.timeOfDay, input.stopAt,
        input.enabled ? 1 : 0, stamp, stamp,
      ],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<ScheduleRecord, 'id' | 'createdAt' | 'fireCount' | 'lastFiredAt'>>): ScheduleRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE schedules SET name=?, preset_id=?, task_kind=?, params=?, target_worker_ids=?, target_group_ids=?,
        schedule_kind=?, start_at=?, interval_ms=?, time_of_day=?, stop_at=?, enabled=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        patch.presetId === undefined ? existing.presetId : patch.presetId,
        patch.kind ?? existing.kind,
        JSON.stringify(patch.params ?? existing.params),
        JSON.stringify(patch.targetWorkerIds ?? existing.targetWorkerIds),
        JSON.stringify(patch.targetGroupIds ?? existing.targetGroupIds),
        patch.scheduleKind ?? existing.scheduleKind,
        patch.startAt ?? existing.startAt,
        patch.intervalMs === undefined ? existing.intervalMs : patch.intervalMs,
        patch.timeOfDay === undefined ? existing.timeOfDay : patch.timeOfDay,
        patch.stopAt === undefined ? existing.stopAt : patch.stopAt,
        (patch.enabled ?? existing.enabled) ? 1 : 0,
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  /** Records a fire. The guard is the duplicate-run protection: a slot already fired is ignored. */
  markFired(id: string, slot: number): void {
    this.db.run(
      'UPDATE schedules SET last_fired_at=?, fire_count=fire_count+1 WHERE id=? AND (last_fired_at IS NULL OR last_fired_at < ?)',
      [slot, id, slot],
    );
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM schedules WHERE id=?', [id]).changes > 0;
  }
}

// ------------------------------------------------------------------ automation rules

export class AutomationRuleRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): AutomationRule[] {
    return this.db.all('SELECT * FROM automation_rules ORDER BY name COLLATE NOCASE').map(mapAutomationRule);
  }

  get(id: string): AutomationRule | undefined {
    const row = this.db.get('SELECT * FROM automation_rules WHERE id=?', [id]);
    return row ? mapAutomationRule(row) : undefined;
  }

  create(input: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'lastRunAt'>): AutomationRule {
    const stamp = now();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO automation_rules (id, name, enabled, event, conditions, action, cooldown_ms, max_runs, run_count, last_run_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,0,NULL,?,?)`,
      [
        id, input.name, input.enabled ? 1 : 0, input.event, JSON.stringify(input.conditions),
        input.action, input.cooldownMs, input.maxRuns, stamp, stamp,
      ],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<AutomationRule, 'id' | 'createdAt' | 'runCount' | 'lastRunAt'>>): AutomationRule | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.run(
      `UPDATE automation_rules SET name=?, enabled=?, event=?, conditions=?, action=?, cooldown_ms=?, max_runs=?, updated_at=? WHERE id=?`,
      [
        patch.name ?? existing.name,
        (patch.enabled ?? existing.enabled) ? 1 : 0,
        patch.event ?? existing.event,
        JSON.stringify(patch.conditions ?? existing.conditions),
        patch.action ?? existing.action,
        patch.cooldownMs ?? existing.cooldownMs,
        patch.maxRuns === undefined ? existing.maxRuns : patch.maxRuns,
        now(),
        id,
      ],
    );
    return this.get(id);
  }

  markRun(id: string): void {
    this.db.run('UPDATE automation_rules SET run_count=run_count+1, last_run_at=? WHERE id=?', [now(), id]);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM automation_rules WHERE id=?', [id]).changes > 0;
  }
}

// ---------------------------------------------------------------- inventory history

export class InventoryHistoryRepository {
  constructor(private readonly db: FleetDatabase) {}

  /** Records one capture's item totals, replacing any capture at the same timestamp. */
  record(workerId: string, capturedAt: number, items: { id: string; name: string; count: number }[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM inventory_history WHERE worker_id=? AND captured_at=?', [workerId, capturedAt]);
      for (const item of items) {
        this.db.run(
          'INSERT INTO inventory_history (worker_id, captured_at, item_id, item_name, count) VALUES (?,?,?,?,?)',
          [workerId, capturedAt, item.id, item.name, item.count],
        );
      }
    });
  }

  /** The item totals recorded at or before `at`, for the closest capture. */
  snapshotAt(workerId: string, at: number): { id: string; name: string; count: number }[] {
    const row = this.db.get<{ captured_at: number }>(
      'SELECT captured_at FROM inventory_history WHERE worker_id=? AND captured_at<=? ORDER BY captured_at DESC LIMIT 1',
      [workerId, at],
    );
    if (!row) return [];
    return this.db
      .all<{ item_id: string; item_name: string; count: number }>(
        'SELECT item_id, item_name, count FROM inventory_history WHERE worker_id=? AND captured_at=?',
        [workerId, row.captured_at],
      )
      .map((r) => ({ id: r.item_id, name: r.item_name, count: r.count }));
  }

  /** The count of an item over time, oldest first, for a trend chart. */
  trend(workerId: string, itemId: string, limit = 200): { at: number; count: number }[] {
    return this.db
      .all<{ captured_at: number; count: number }>(
        `SELECT captured_at, count FROM inventory_history WHERE worker_id=? AND item_id=? ORDER BY captured_at DESC LIMIT ?`,
        [workerId, itemId, limit],
      )
      .map((r) => ({ at: r.captured_at, count: r.count }))
      .reverse();
  }

  /** Every distinct capture time for a worker, newest first. */
  captures(workerId: string, limit = 100): number[] {
    return this.db
      .all<{ captured_at: number }>(
        'SELECT DISTINCT captured_at FROM inventory_history WHERE worker_id=? ORDER BY captured_at DESC LIMIT ?',
        [workerId, limit],
      )
      .map((r) => r.captured_at);
  }

  prune(keepCaptures: number): void {
    this.db.run(
      `DELETE FROM inventory_history WHERE captured_at < (
         SELECT MIN(captured_at) FROM (
           SELECT DISTINCT captured_at FROM inventory_history ORDER BY captured_at DESC LIMIT ?
         )
       )`,
      [keepCaptures],
    );
  }
}

// ------------------------------------------------------------------------ containers

export class ContainerRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(workerId?: string): ContainerRecord[] {
    const rows = workerId
      ? this.db.all('SELECT * FROM containers WHERE worker_id=? ORDER BY inspected_at DESC', [workerId])
      : this.db.all('SELECT * FROM containers ORDER BY inspected_at DESC');
    return rows.map(mapContainer);
  }

  get(id: string): ContainerRecord | undefined {
    const row = this.db.get('SELECT * FROM containers WHERE id=?', [id]);
    return row ? mapContainer(row) : undefined;
  }

  /** Records a container inspection, keyed by position so re-inspecting updates the same record. */
  save(input: Omit<ContainerRecord, 'id'>): ContainerRecord {
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM containers WHERE worker_id=? AND x=? AND y=? AND z=? AND dimension=?',
      [input.workerId, input.x, input.y, input.z, input.dimension],
    );
    const id = existing?.id ?? randomUUID();
    if (existing) {
      this.db.run('UPDATE containers SET label=?, items=?, inspected_at=? WHERE id=?', [
        input.label, JSON.stringify(input.items), input.inspectedAt, id,
      ]);
    } else {
      this.db.run(
        `INSERT INTO containers (id, worker_id, label, x, y, z, dimension, items, inspected_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, input.workerId, input.label, input.x, input.y, input.z, input.dimension,
          JSON.stringify(input.items), input.inspectedAt],
      );
    }
    return this.get(id)!;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM containers WHERE id=?', [id]).changes > 0;
  }
}

// ------------------------------------------------------------------------- audit log

export class AuditRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 200): AuditEntry[] {
    return this.db.all('SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?', [limit]).map(mapAudit);
  }

  record(input: { actor?: string; action: string; target?: string; detail?: string }): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      at: now(),
      actor: input.actor ?? 'operator',
      action: input.action,
      target: input.target ?? '',
      detail: input.detail ?? '',
    };
    this.db.run('INSERT INTO audit_log (id, at, actor, action, target, detail) VALUES (?,?,?,?,?,?)', [
      entry.id, entry.at, entry.actor, entry.action, entry.target, entry.detail,
    ]);
    return entry;
  }

  prune(keep: number): void {
    this.db.run(
      'DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY at DESC LIMIT ?)',
      [keep],
    );
  }
}
