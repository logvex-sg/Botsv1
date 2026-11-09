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
  Account,
  AuthMode,
  BotRole,
  DeploymentConfig,
  DeploymentEntry,
  DeploymentQueueItem,
  EquipmentProfileRecord,
  FleetEvent,
  Group,
  InstanceRecord,
  NotificationItem,
  ServerProfile,
  StasisLocation,
  StasisState,
  TargetEntry,
  WorkerCommandRecord,
  WorkerGroup,
  WorkerInventorySnapshot,
  WorkerRecord,
  WorkerStatus,
  WorkerTaskRecord,
  WorkerTaskStatus,
  RegearPreset,
  RegearItem,
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

export class GroupRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): Group[] {
    return this.db.all('SELECT * FROM groups ORDER BY name COLLATE NOCASE').map(mapGroup);
  }

  create(name: string, description = '', color = '#6d5efc'): Group {
    const group: Group = { id: randomUUID(), name, description, color, createdAt: now() };
    this.db.run('INSERT INTO groups (id, name, description, color, created_at) VALUES (?,?,?,?,?)', [
      group.id, group.name, group.description, group.color, group.createdAt,
    ]);
    return group;
  }

  rename(id: string, name: string, description?: string, color?: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    this.db.run('UPDATE groups SET name=?, description=?, color=? WHERE id=?', [
      name, description ?? existing.description, color ?? existing.color, id,
    ]);
    return true;
  }

  get(id: string): Group | undefined {
    const row = this.db.get('SELECT * FROM groups WHERE id=?', [id]);
    return row ? mapGroup(row) : undefined;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM groups WHERE id=?', [id]).changes > 0;
  }
}

function mapGroup(row: Record<string, unknown>): Group {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#6d5efc'),
    createdAt: Number(row.created_at),
  };
}

export class ServerProfileRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): ServerProfile[] {
    return this.db.all('SELECT * FROM server_profiles ORDER BY name COLLATE NOCASE').map(mapServerProfile);
  }

  get(id: string): ServerProfile | undefined {
    const row = this.db.get('SELECT * FROM server_profiles WHERE id=?', [id]);
    return row ? mapServerProfile(row) : undefined;
  }

  create(input: Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'>): ServerProfile {
    const ts = now();
    const profile: ServerProfile = { ...input, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.db.run(
      `INSERT INTO server_profiles
       (id, name, host, port, version, auth_mode, connection_timeout_ms, options, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [profile.id, profile.name, profile.host, profile.port, profile.version, profile.authMode,
        profile.connectionTimeoutMs, JSON.stringify(profile.options ?? {}), profile.createdAt, profile.updatedAt],
    );
    return profile;
  }

  update(id: string, patch: Partial<ServerProfile>): ServerProfile | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged: ServerProfile = { ...existing, ...patch, id, updatedAt: now() };
    this.db.run(
      `UPDATE server_profiles SET name=?, host=?, port=?, version=?, auth_mode=?,
       connection_timeout_ms=?, options=?, updated_at=? WHERE id=?`,
      [merged.name, merged.host, merged.port, merged.version, merged.authMode,
        merged.connectionTimeoutMs, JSON.stringify(merged.options ?? {}), merged.updatedAt, id],
    );
    return merged;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM server_profiles WHERE id=?', [id]).changes > 0;
  }
}

function mapServerProfile(row: Record<string, unknown>): ServerProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    host: String(row.host),
    port: Number(row.port),
    version: String(row.version ?? ''),
    authMode: String(row.auth_mode) as AuthMode,
    connectionTimeoutMs: Number(row.connection_timeout_ms),
    options: parseJson<Record<string, unknown>>(row.options, {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class AccountRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): Account[] {
    return this.db.all('SELECT * FROM accounts ORDER BY username COLLATE NOCASE').map(mapAccount);
  }

  get(id: string): Account | undefined {
    const row = this.db.get('SELECT * FROM accounts WHERE id=?', [id]);
    return row ? mapAccount(row) : undefined;
  }

  findByUsername(username: string): Account | undefined {
    const row = this.db.get('SELECT * FROM accounts WHERE lower(username)=lower(?)', [username]);
    return row ? mapAccount(row) : undefined;
  }

  create(input: Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'hasCredential'>): Account {
    const ts = now();
    const account: Account = { ...input, id: randomUUID(), hasCredential: false, createdAt: ts, updatedAt: ts };
    this.db.run(
      `INSERT INTO accounts
       (id, username, display_name, auth_mode, role, group_id, last_login, last_login_ok,
        server_profile_id, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [account.id, account.username, account.displayName, account.authMode, account.role,
        account.groupId, account.lastLogin, account.lastLoginOk ? 1 : 0, account.serverProfileId,
        account.notes, account.createdAt, account.updatedAt],
    );
    return account;
  }

  update(id: string, patch: Partial<Account>): Account | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged: Account = { ...existing, ...patch, id, updatedAt: now() };
    this.db.run(
      `UPDATE accounts SET username=?, display_name=?, auth_mode=?, role=?, group_id=?, last_login=?,
       last_login_ok=?, server_profile_id=?, notes=?, updated_at=? WHERE id=?`,
      [merged.username, merged.displayName, merged.authMode, merged.role, merged.groupId,
        merged.lastLogin, merged.lastLoginOk ? 1 : 0, merged.serverProfileId, merged.notes,
        merged.updatedAt, id],
    );
    return merged;
  }

  markLogin(id: string, ok: boolean): void {
    this.db.run('UPDATE accounts SET last_login=?, last_login_ok=?, updated_at=? WHERE id=?', [
      now(), ok ? 1 : 0, now(), id,
    ]);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM accounts WHERE id=?', [id]).changes > 0;
  }
}

function mapAccount(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name ?? ''),
    authMode: String(row.auth_mode) as AuthMode,
    role: String(row.role) as BotRole,
    groupId: row.group_id ? String(row.group_id) : null,
    hasCredential: false,
    lastLogin: row.last_login == null ? null : Number(row.last_login),
    lastLoginOk: Number(row.last_login_ok) === 1,
    serverProfileId: row.server_profile_id ? String(row.server_profile_id) : null,
    notes: String(row.notes ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class InstanceRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): InstanceRecord[] {
    return this.db.all('SELECT * FROM instances ORDER BY priority DESC, name COLLATE NOCASE').map(mapInstance);
  }

  get(id: string): InstanceRecord | undefined {
    const row = this.db.get('SELECT * FROM instances WHERE id=?', [id]);
    return row ? mapInstance(row) : undefined;
  }

  create(input: Pick<InstanceRecord, 'name' | 'accountId' | 'role' | 'groupId' | 'serverProfileId' | 'config' | 'priority'>): InstanceRecord {
    const ts = now();
    const id = randomUUID();
    this.db.run(
      `INSERT INTO instances
       (id, name, account_id, role, group_id, server_profile_id, config, priority, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, input.name, input.accountId, input.role, input.groupId, input.serverProfileId,
        JSON.stringify(input.config ?? {}), input.priority, ts, ts],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<InstanceRecord>): InstanceRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, id };
    this.db.run(
      `UPDATE instances SET name=?, role=?, group_id=?, server_profile_id=?, config=?, priority=?, updated_at=?
       WHERE id=?`,
      [merged.name, merged.role, merged.groupId, merged.serverProfileId,
        JSON.stringify(merged.config ?? {}), merged.priority, now(), id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM instances WHERE id=?', [id]).changes > 0;
  }
}

function mapInstance(row: Record<string, unknown>): InstanceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    accountId: String(row.account_id),
    role: String(row.role) as BotRole,
    groupId: row.group_id ? String(row.group_id) : null,
    serverProfileId: row.server_profile_id ? String(row.server_profile_id) : null,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    priority: Number(row.priority ?? 0),
    state: 'STOPPED',
    connection: 'OFFLINE',
    startedAt: null,
    stoppedAt: null,
    uptimeMs: 0,
    health: 100,
    lastError: null,
    lastEvent: null,
    metrics: { memoryBytes: 0, cpuPercent: 0, ping: 0 },
  };
}

export class TargetRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): TargetEntry[] {
    return this.db.all('SELECT * FROM targets ORDER BY priority ASC, username COLLATE NOCASE').map(mapTarget);
  }

  get(id: string): TargetEntry | undefined {
    const row = this.db.get('SELECT * FROM targets WHERE id=?', [id]);
    return row ? mapTarget(row) : undefined;
  }

  findByIdentity(uuid: string | null, username: string): TargetEntry | undefined {
    const row = uuid
      ? this.db.get('SELECT * FROM targets WHERE uuid=? OR lower(username)=lower(?)', [uuid, username])
      : this.db.get('SELECT * FROM targets WHERE lower(username)=lower(?)', [username]);
    return row ? mapTarget(row) : undefined;
  }

  /** Upsert keyed on UUID when present, else username. Merges counters instead of duplicating. */
  upsert(input: Partial<TargetEntry> & { username: string }): TargetEntry {
    const existing = this.findByIdentity(input.uuid ?? null, input.username);
    if (existing) {
      const merged: TargetEntry = {
        ...existing,
        ...input,
        id: existing.id,
        encounters: (input.encounters ?? 0) + existing.encounters,
        kills: (input.kills ?? 0) + existing.kills,
        deaths: (input.deaths ?? 0) + existing.deaths,
        lastSeen: Math.max(existing.lastSeen ?? 0, input.lastSeen ?? 0) || null,
        updatedAt: now(),
      };
      this.write(merged);
      return merged;
    }
    const entry: TargetEntry = {
      id: randomUUID(),
      uuid: input.uuid ?? null,
      username: input.username,
      displayName: input.displayName ?? '',
      category: input.category ?? 'TEMPORARY',
      priority: input.priority ?? 5,
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      source: input.source ?? 'fleet',
      lastSeen: input.lastSeen ?? null,
      encounters: input.encounters ?? 0,
      kills: input.kills ?? 0,
      deaths: input.deaths ?? 0,
      lastPosition: input.lastPosition ?? null,
      dimension: input.dimension ?? '',
      updatedAt: now(),
    };
    this.write(entry);
    return entry;
  }

  update(id: string, patch: Partial<TargetEntry>): TargetEntry | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, id, updatedAt: now() };
    this.write(merged);
    return merged;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM targets WHERE id=?', [id]).changes > 0;
  }

  private write(entry: TargetEntry): void {
    this.db.run(
      `INSERT INTO targets
       (id, uuid, username, display_name, category, priority, notes, tags, source, last_seen,
        encounters, kills, deaths, last_position, dimension, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        uuid=excluded.uuid, username=excluded.username, display_name=excluded.display_name,
        category=excluded.category, priority=excluded.priority, notes=excluded.notes,
        tags=excluded.tags, source=excluded.source, last_seen=excluded.last_seen,
        encounters=excluded.encounters, kills=excluded.kills, deaths=excluded.deaths,
        last_position=excluded.last_position, dimension=excluded.dimension, updated_at=excluded.updated_at`,
      [entry.id, entry.uuid, entry.username, entry.displayName, entry.category, entry.priority,
        entry.notes, JSON.stringify(entry.tags ?? []), entry.source, entry.lastSeen,
        entry.encounters, entry.kills, entry.deaths,
        entry.lastPosition ? JSON.stringify(entry.lastPosition) : null, entry.dimension, entry.updatedAt],
    );
  }
}

function mapTarget(row: Record<string, unknown>): TargetEntry {
  return {
    id: String(row.id),
    uuid: row.uuid ? String(row.uuid) : null,
    username: String(row.username),
    displayName: String(row.display_name ?? ''),
    category: String(row.category ?? 'TEMPORARY'),
    priority: Number(row.priority ?? 5),
    notes: String(row.notes ?? ''),
    tags: parseJson<string[]>(row.tags, []),
    source: String(row.source ?? 'fleet'),
    lastSeen: row.last_seen == null ? null : Number(row.last_seen),
    encounters: Number(row.encounters ?? 0),
    kills: Number(row.kills ?? 0),
    deaths: Number(row.deaths ?? 0),
    lastPosition: parseJson<{ x: number; y: number; z: number } | null>(row.last_position, null),
    dimension: String(row.dimension ?? ''),
    updatedAt: Number(row.updated_at),
  };
}

export class StasisRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): StasisLocation[] {
    return this.db.all('SELECT * FROM stasis_locations ORDER BY name COLLATE NOCASE').map(mapStasis);
  }

  get(id: string): StasisLocation | undefined {
    const row = this.db.get('SELECT * FROM stasis_locations WHERE id=?', [id]);
    return row ? mapStasis(row) : undefined;
  }

  create(input: Omit<StasisLocation, 'id' | 'createdAt' | 'updatedAt'>): StasisLocation {
    const ts = now();
    const location: StasisLocation = { ...input, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.db.run(
      `INSERT INTO stasis_locations
       (id, name, instance_id, server_profile_id, dimension, x, y, z, state, last_activity,
        last_verified, last_error, config, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [location.id, location.name, location.instanceId, location.serverProfileId, location.dimension,
        location.x, location.y, location.z, location.state, location.lastActivity,
        location.lastVerified, location.lastError, JSON.stringify(location.config ?? {}),
        location.createdAt, location.updatedAt],
    );
    return location;
  }

  update(id: string, patch: Partial<StasisLocation>): StasisLocation | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, id, updatedAt: now() };
    this.db.run(
      `UPDATE stasis_locations SET name=?, instance_id=?, server_profile_id=?, dimension=?, x=?, y=?, z=?,
       state=?, last_activity=?, last_verified=?, last_error=?, config=?, updated_at=? WHERE id=?`,
      [merged.name, merged.instanceId, merged.serverProfileId, merged.dimension, merged.x, merged.y,
        merged.z, merged.state, merged.lastActivity, merged.lastVerified, merged.lastError,
        JSON.stringify(merged.config ?? {}), merged.updatedAt, id],
    );
    return merged;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM stasis_locations WHERE id=?', [id]).changes > 0;
  }
}

function mapStasis(row: Record<string, unknown>): StasisLocation {
  return {
    id: String(row.id),
    name: String(row.name),
    instanceId: row.instance_id ? String(row.instance_id) : null,
    serverProfileId: row.server_profile_id ? String(row.server_profile_id) : null,
    dimension: String(row.dimension ?? ''),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    state: String(row.state ?? 'UNKNOWN') as StasisState,
    lastActivity: row.last_activity == null ? null : Number(row.last_activity),
    lastVerified: row.last_verified == null ? null : Number(row.last_verified),
    lastError: row.last_error ? String(row.last_error) : null,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class EquipmentRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): EquipmentProfileRecord[] {
    return this.db.all('SELECT * FROM equipment_profiles ORDER BY name COLLATE NOCASE').map(mapEquipment);
  }

  get(id: string): EquipmentProfileRecord | undefined {
    const row = this.db.get('SELECT * FROM equipment_profiles WHERE id=?', [id]);
    return row ? mapEquipment(row) : undefined;
  }

  create(input: Omit<EquipmentProfileRecord, 'id' | 'createdAt' | 'updatedAt'>): EquipmentProfileRecord {
    const ts = now();
    const profile: EquipmentProfileRecord = { ...input, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.write(profile);
    return profile;
  }

  update(id: string, patch: Partial<EquipmentProfileRecord>): EquipmentProfileRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, id, updatedAt: now() };
    this.write(merged);
    return merged;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM equipment_profiles WHERE id=?', [id]).changes > 0;
  }

  private write(profile: EquipmentProfileRecord): void {
    this.db.run(
      `INSERT INTO equipment_profiles
       (id, name, server_profile_id, weapons, min_armor_pieces, min_totems, min_food,
        low_durability_percent, sort_order, warning_thresholds, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, server_profile_id=excluded.server_profile_id, weapons=excluded.weapons,
        min_armor_pieces=excluded.min_armor_pieces, min_totems=excluded.min_totems,
        min_food=excluded.min_food, low_durability_percent=excluded.low_durability_percent,
        sort_order=excluded.sort_order, warning_thresholds=excluded.warning_thresholds,
        updated_at=excluded.updated_at`,
      [profile.id, profile.name, profile.serverProfileId, JSON.stringify(profile.weapons ?? []),
        profile.minArmorPieces, profile.minTotems, profile.minFood, profile.lowDurabilityPercent,
        JSON.stringify(profile.sortOrder ?? []), JSON.stringify(profile.warningThresholds ?? {}),
        profile.createdAt, profile.updatedAt],
    );
  }
}

function mapEquipment(row: Record<string, unknown>): EquipmentProfileRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    serverProfileId: row.server_profile_id ? String(row.server_profile_id) : null,
    weapons: parseJson<string[]>(row.weapons, []),
    minArmorPieces: Number(row.min_armor_pieces ?? 4),
    minTotems: Number(row.min_totems ?? 1),
    minFood: Number(row.min_food ?? 8),
    lowDurabilityPercent: Number(row.low_durability_percent ?? 15),
    sortOrder: parseJson<string[]>(row.sort_order, []),
    warningThresholds: parseJson<Record<string, number>>(row.warning_thresholds, {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class EventRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 200, filter?: { type?: string; source?: string; instanceId?: string }): FleetEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.type) { clauses.push('type=?'); params.push(filter.type); }
    if (filter?.source) { clauses.push('source=?'); params.push(filter.source); }
    if (filter?.instanceId) { clauses.push('instance_id=?'); params.push(filter.instanceId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    return this.db.all(`SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ?`, params).map(mapEvent);
  }

  insert(event: FleetEvent): void {
    this.db.run(
      `INSERT INTO events (id, type, source, severity, instance_id, account_id, target_uuid, message, payload, timestamp)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [event.id, event.type, event.source, event.severity, event.instanceId, event.accountId,
        event.targetUuid, event.message, JSON.stringify(event.payload ?? {}), event.timestamp],
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
    severity: String(row.severity ?? 'info') as FleetEvent['severity'],
    instanceId: row.instance_id ? String(row.instance_id) : null,
    accountId: row.account_id ? String(row.account_id) : null,
    targetUuid: row.target_uuid ? String(row.target_uuid) : null,
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

export class DeploymentRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): DeploymentConfig[] {
    return this.db.all('SELECT * FROM deployment_configs ORDER BY name COLLATE NOCASE').map(mapDeployment);
  }

  get(id: string): DeploymentConfig | undefined {
    const row = this.db.get('SELECT * FROM deployment_configs WHERE id=?', [id]);
    return row ? mapDeployment(row) : undefined;
  }

  create(input: Omit<DeploymentConfig, 'id' | 'createdAt' | 'updatedAt'>): DeploymentConfig {
    const ts = now();
    const config: DeploymentConfig = { ...input, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.write(config);
    return config;
  }

  update(id: string, patch: Partial<DeploymentConfig>): DeploymentConfig | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, id, updatedAt: now() };
    this.write(merged);
    return merged;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM deployment_configs WHERE id=?', [id]).changes > 0;
  }

  private write(config: DeploymentConfig): void {
    this.db.run(
      `INSERT INTO deployment_configs
       (id, name, description, server_profile_id, entries, max_concurrent, connection_timeout_ms,
        retry_attempts, retry_delay_ms, manual_approval, pause_between_ms, resource_limit_mb,
        notify_on_event, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, server_profile_id=excluded.server_profile_id,
        entries=excluded.entries, max_concurrent=excluded.max_concurrent,
        connection_timeout_ms=excluded.connection_timeout_ms, retry_attempts=excluded.retry_attempts,
        retry_delay_ms=excluded.retry_delay_ms, manual_approval=excluded.manual_approval,
        pause_between_ms=excluded.pause_between_ms, resource_limit_mb=excluded.resource_limit_mb,
        notify_on_event=excluded.notify_on_event, updated_at=excluded.updated_at`,
      [config.id, config.name, config.description, config.serverProfileId,
        JSON.stringify(config.entries ?? []), config.maxConcurrent, config.connectionTimeoutMs,
        config.retryAttempts, config.retryDelayMs, config.manualApproval ? 1 : 0,
        config.pauseBetweenMs, config.resourceLimitMb, config.notifyOnEvent ? 1 : 0,
        config.createdAt, config.updatedAt],
    );
  }
}

function mapDeployment(row: Record<string, unknown>): DeploymentConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    serverProfileId: row.server_profile_id ? String(row.server_profile_id) : null,
    entries: parseJson<DeploymentEntry[]>(row.entries, []),
    maxConcurrent: Number(row.max_concurrent ?? 1),
    connectionTimeoutMs: Number(row.connection_timeout_ms ?? 15000),
    retryAttempts: Number(row.retry_attempts ?? 2),
    retryDelayMs: Number(row.retry_delay_ms ?? 5000),
    manualApproval: Number(row.manual_approval) === 1,
    pauseBetweenMs: Number(row.pause_between_ms ?? 5000),
    resourceLimitMb: Number(row.resource_limit_mb ?? 4096),
    notifyOnEvent: Number(row.notify_on_event) === 1,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class QueueRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(deploymentId: string): DeploymentQueueItem[] {
    return this.db
      .all('SELECT * FROM deployment_queue WHERE deployment_id=? ORDER BY position ASC', [deploymentId])
      .map(mapQueueItem);
  }

  replace(deploymentId: string, items: Omit<DeploymentQueueItem, 'id'>[]): DeploymentQueueItem[] {
    this.db.run('DELETE FROM deployment_queue WHERE deployment_id=?', [deploymentId]);
    const out: DeploymentQueueItem[] = [];
    for (const item of items) {
      const id = randomUUID();
      this.db.run(
        `INSERT INTO deployment_queue
         (id, deployment_id, account_id, instance_name, role, role_config, position, stage, attempts, error,
          started_at, finished_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, deploymentId, item.accountId, item.instanceName, item.role,
          JSON.stringify(item.roleConfig ?? {}), item.position, item.stage,
          item.attempts, item.error, item.startedAt, item.finishedAt, now()],
      );
      out.push({ ...item, id });
    }
    return out;
  }

  updateStage(id: string, stage: DeploymentQueueItem['stage'], patch: Partial<DeploymentQueueItem> = {}): void {
    this.db.run(
      `UPDATE deployment_queue SET stage=?, attempts=COALESCE(?, attempts), error=COALESCE(?, error),
       started_at=COALESCE(?, started_at), finished_at=COALESCE(?, finished_at) WHERE id=?`,
      [stage, patch.attempts ?? null, patch.error ?? null, patch.startedAt ?? null, patch.finishedAt ?? null, id],
    );
  }
}

function mapQueueItem(row: Record<string, unknown>): DeploymentQueueItem {
  return {
    id: String(row.id),
    deploymentId: String(row.deployment_id),
    accountId: String(row.account_id),
    instanceName: String(row.instance_name),
    role: String(row.role) as BotRole,
    roleConfig: parseJson<Record<string, unknown>>(row.role_config, {}),
    position: Number(row.position),
    stage: String(row.stage) as DeploymentQueueItem['stage'],
    attempts: Number(row.attempts ?? 0),
    error: row.error ? String(row.error) : null,
    startedAt: row.started_at == null ? null : Number(row.started_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
  };
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
