/**
 * Repository layer for the Autonomous Storage & World Maintenance subsystem.
 *
 * Kept separate from {@link ./repositories} because it is a large, self-contained aggregate group.
 * Every container/portal/shulker row records when it was last *inspected*; these repositories only
 * store what a worker or the operator reported and never invent state. The storage service is the
 * only caller.
 */
import { randomUUID } from 'node:crypto';
import type { FleetDatabase } from './database';
import type {
  AutomationPlan,
  ClassifierRule,
  DisposalRule,
  PortalRecord,
  RestockRule,
  ShulkerRecord,
  StorageActivityEntry,
  StorageCategory,
  StorageContainer,
  StorageNetwork,
  StorageProfile,
  StructureRecord,
  WorkflowRecord,
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

function mapStorageNetwork(row: Record<string, unknown>): StorageNetwork {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    mode: String(row.mode ?? 'supervised') as StorageNetwork['mode'],
    paused: Number(row.paused ?? 0) !== 0,
    workerIds: parseJson<string[]>(row.worker_ids, []),
    protectedItems: parseJson<string[]>(row.protected_items, []),
    reservations: parseJson<StorageNetwork['reservations']>(row.reservations, []),
    exclusionAreas: parseJson<string[]>(row.exclusion_areas, []),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class StorageNetworkRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): StorageNetwork[] {
    return this.db.all('SELECT * FROM storage_networks ORDER BY name').map((row) => mapStorageNetwork(row));
  }

  get(id: string): StorageNetwork | undefined {
    const row = this.db.get('SELECT * FROM storage_networks WHERE id=?', [id]);
    return row ? mapStorageNetwork(row) : undefined;
  }

  findByName(name: string): StorageNetwork | undefined {
    const row = this.db.get('SELECT * FROM storage_networks WHERE name=?', [name]);
    return row ? mapStorageNetwork(row) : undefined;
  }

  create(input: Omit<StorageNetwork, 'id' | 'createdAt' | 'updatedAt'>): StorageNetwork {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO storage_networks (id, name, description, mode, paused, worker_ids, protected_items, reservations, exclusion_areas, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.name, input.description, input.mode, input.paused ? 1 : 0,
        JSON.stringify(input.workerIds), JSON.stringify(input.protectedItems),
        JSON.stringify(input.reservations), JSON.stringify(input.exclusionAreas), at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<StorageNetwork, 'id' | 'createdAt'>>): StorageNetwork | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE storage_networks SET name=?, description=?, mode=?, paused=?, worker_ids=?, protected_items=?, reservations=?, exclusion_areas=?, updated_at=? WHERE id=?`,
      [merged.name, merged.description, merged.mode, merged.paused ? 1 : 0,
        JSON.stringify(merged.workerIds), JSON.stringify(merged.protectedItems),
        JSON.stringify(merged.reservations), JSON.stringify(merged.exclusionAreas), merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_networks WHERE id=?', [id]).changes > 0;
  }
}

function mapStorageCategory(row: Record<string, unknown>): StorageCategory {
  const rules = parseJson<ClassifierRule[]>(row.rules, []);
  return {
    id: String(row.id),
    name: String(row.name),
    itemMatches: parseJson<string[]>(row.item_matches, []),
    // Absent (rather than empty) when the category has no rules, so the classifier falls back to
    // the substrings rather than treating the category as matching nothing.
    ...(rules.length > 0 ? { rules } : {}),
    priority: Number(row.priority ?? 0),
    color: String(row.color ?? '#6d5efc'),
    protected: Number(row.protected ?? 0) !== 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class StorageCategoryRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): StorageCategory[] {
    return this.db.all('SELECT * FROM storage_categories ORDER BY priority DESC, name').map((row) => mapStorageCategory(row));
  }

  get(id: string): StorageCategory | undefined {
    const row = this.db.get('SELECT * FROM storage_categories WHERE id=?', [id]);
    return row ? mapStorageCategory(row) : undefined;
  }

  findByName(name: string): StorageCategory | undefined {
    const row = this.db.get('SELECT * FROM storage_categories WHERE name=?', [name]);
    return row ? mapStorageCategory(row) : undefined;
  }

  create(input: Omit<StorageCategory, 'id' | 'createdAt' | 'updatedAt'>): StorageCategory {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO storage_categories (id, name, item_matches, rules, priority, color, protected, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, input.name, JSON.stringify(input.itemMatches), JSON.stringify(input.rules ?? []), input.priority, input.color, input.protected ? 1 : 0, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<StorageCategory, 'id' | 'createdAt'>>): StorageCategory | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    // `rules` absent from the patch means "leave them alone"; an explicit empty list clears them.
    const rules = patch.rules === undefined ? existing.rules : patch.rules.length > 0 ? patch.rules : undefined;
    const merged = { ...existing, ...patch, rules, updatedAt: now() };
    this.db.run(
      `UPDATE storage_categories SET name=?, item_matches=?, rules=?, priority=?, color=?, protected=?, updated_at=? WHERE id=?`,
      [merged.name, JSON.stringify(merged.itemMatches), JSON.stringify(merged.rules ?? []), merged.priority, merged.color, merged.protected ? 1 : 0, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_categories WHERE id=?', [id]).changes > 0;
  }
}

function mapStorageContainer(row: Record<string, unknown>): StorageContainer {
  return {
    id: String(row.id),
    networkId: String(row.network_id),
    workerId: String(row.worker_id),
    label: String(row.label ?? ''),
    kind: String(row.kind ?? 'general') as StorageContainer['kind'],
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    dimension: String(row.dimension ?? ''),
    categoryId: row.category_id == null ? null : String(row.category_id),
    locked: Number(row.locked ?? 0) !== 0,
    permanent: Number(row.permanent ?? 0) !== 0,
    capacity: row.capacity == null ? null : Number(row.capacity),
    freeSlots: row.free_slots == null ? null : Number(row.free_slots),
    full: Number(row.full ?? 0) !== 0,
    items: parseJson<StorageContainer['items']>(row.items, []),
    inspectedAt: Number(row.inspected_at ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class StorageContainerRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(networkId?: string): StorageContainer[] {
    const rows = networkId
      ? this.db.all('SELECT * FROM storage_containers WHERE network_id=? ORDER BY label', [networkId])
      : this.db.all('SELECT * FROM storage_containers ORDER BY label');
    return rows.map((row) => mapStorageContainer(row));
  }

  get(id: string): StorageContainer | undefined {
    const row = this.db.get('SELECT * FROM storage_containers WHERE id=?', [id]);
    return row ? mapStorageContainer(row) : undefined;
  }

  create(input: Omit<StorageContainer, 'id' | 'createdAt' | 'updatedAt'>): StorageContainer {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO storage_containers (id, network_id, worker_id, label, kind, x, y, z, dimension, category_id, locked, permanent, capacity, free_slots, full, items, inspected_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.networkId, input.workerId, input.label, input.kind, input.x, input.y, input.z, input.dimension,
        input.categoryId, input.locked ? 1 : 0, input.permanent ? 1 : 0, input.capacity, input.freeSlots,
        input.full ? 1 : 0, JSON.stringify(input.items), input.inspectedAt, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<StorageContainer, 'id' | 'createdAt'>>): StorageContainer | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE storage_containers SET network_id=?, worker_id=?, label=?, kind=?, x=?, y=?, z=?, dimension=?, category_id=?, locked=?, permanent=?, capacity=?, free_slots=?, full=?, items=?, inspected_at=?, updated_at=? WHERE id=?`,
      [merged.networkId, merged.workerId, merged.label, merged.kind, merged.x, merged.y, merged.z, merged.dimension,
        merged.categoryId, merged.locked ? 1 : 0, merged.permanent ? 1 : 0, merged.capacity, merged.freeSlots,
        merged.full ? 1 : 0, JSON.stringify(merged.items), merged.inspectedAt, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_containers WHERE id=?', [id]).changes > 0;
  }

  removeByNetwork(networkId: string): number {
    return this.db.run('DELETE FROM storage_containers WHERE network_id=?', [networkId]).changes;
  }
}

function mapRestockRule(row: Record<string, unknown>): RestockRule {
  return {
    id: String(row.id),
    networkId: row.network_id == null ? null : String(row.network_id),
    name: String(row.name),
    query: String(row.query),
    label: String(row.label ?? ''),
    min: Number(row.min_count ?? 0),
    max: Number(row.max_count ?? 0),
    batch: Number(row.batch ?? 0),
    workerIds: parseJson<string[]>(row.worker_ids, []),
    enabled: Number(row.enabled ?? 1) !== 0,
    priority: Number(row.priority ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class RestockRuleRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(networkId?: string): RestockRule[] {
    const rows = networkId
      ? this.db.all('SELECT * FROM restock_rules WHERE network_id=? ORDER BY priority DESC, name', [networkId])
      : this.db.all('SELECT * FROM restock_rules ORDER BY priority DESC, name');
    return rows.map((row) => mapRestockRule(row));
  }

  get(id: string): RestockRule | undefined {
    const row = this.db.get('SELECT * FROM restock_rules WHERE id=?', [id]);
    return row ? mapRestockRule(row) : undefined;
  }

  create(input: Omit<RestockRule, 'id' | 'createdAt' | 'updatedAt'>): RestockRule {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO restock_rules (id, network_id, name, query, label, min_count, max_count, batch, worker_ids, enabled, priority, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.networkId, input.name, input.query, input.label, input.min, input.max, input.batch,
        JSON.stringify(input.workerIds), input.enabled ? 1 : 0, input.priority, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<RestockRule, 'id' | 'createdAt'>>): RestockRule | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE restock_rules SET network_id=?, name=?, query=?, label=?, min_count=?, max_count=?, batch=?, worker_ids=?, enabled=?, priority=?, updated_at=? WHERE id=?`,
      [merged.networkId, merged.name, merged.query, merged.label, merged.min, merged.max, merged.batch,
        JSON.stringify(merged.workerIds), merged.enabled ? 1 : 0, merged.priority, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM restock_rules WHERE id=?', [id]).changes > 0;
  }
}

function mapDisposalRule(row: Record<string, unknown>): DisposalRule {
  return {
    id: String(row.id),
    name: String(row.name),
    query: String(row.query),
    label: String(row.label ?? ''),
    targetContainerId: row.target_container_id == null ? null : String(row.target_container_id),
    enabled: Number(row.enabled ?? 0) !== 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class DisposalRuleRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): DisposalRule[] {
    return this.db.all('SELECT * FROM disposal_rules ORDER BY name').map((row) => mapDisposalRule(row));
  }

  get(id: string): DisposalRule | undefined {
    const row = this.db.get('SELECT * FROM disposal_rules WHERE id=?', [id]);
    return row ? mapDisposalRule(row) : undefined;
  }

  create(input: Omit<DisposalRule, 'id' | 'createdAt' | 'updatedAt'>): DisposalRule {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO disposal_rules (id, name, query, label, target_container_id, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, input.name, input.query, input.label, input.targetContainerId, input.enabled ? 1 : 0, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<DisposalRule, 'id' | 'createdAt'>>): DisposalRule | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE disposal_rules SET name=?, query=?, label=?, target_container_id=?, enabled=?, updated_at=? WHERE id=?`,
      [merged.name, merged.query, merged.label, merged.targetContainerId, merged.enabled ? 1 : 0, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM disposal_rules WHERE id=?', [id]).changes > 0;
  }
}

function mapPortal(row: Record<string, unknown>): PortalRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    category: String(row.category ?? ''),
    dimension: String(row.dimension ?? ''),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    permanent: Number(row.permanent ?? 0) !== 0,
    temporary: Number(row.temporary ?? 0) !== 0,
    needsMaintenance: Number(row.needs_maintenance ?? 0) !== 0,
    tracking: Number(row.tracking ?? 1) !== 0,
    lastSeenBy: row.last_seen_by == null ? null : String(row.last_seen_by),
    lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    obsolete: Number(row.obsolete ?? 0) !== 0,
    notes: String(row.notes ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class PortalRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): PortalRecord[] {
    return this.db.all('SELECT * FROM portal_records ORDER BY name').map((row) => mapPortal(row));
  }

  get(id: string): PortalRecord | undefined {
    const row = this.db.get('SELECT * FROM portal_records WHERE id=?', [id]);
    return row ? mapPortal(row) : undefined;
  }

  findByName(name: string): PortalRecord | undefined {
    const row = this.db.get('SELECT * FROM portal_records WHERE name=?', [name]);
    return row ? mapPortal(row) : undefined;
  }

  create(input: Omit<PortalRecord, 'id' | 'createdAt' | 'updatedAt'>): PortalRecord {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO portal_records (id, name, category, dimension, x, y, z, permanent, temporary, needs_maintenance, tracking, last_seen_by, last_seen_at, obsolete, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.name, input.category, input.dimension, input.x, input.y, input.z,
        input.permanent ? 1 : 0, input.temporary ? 1 : 0, input.needsMaintenance ? 1 : 0, input.tracking ? 1 : 0,
        input.lastSeenBy, input.lastSeenAt, input.obsolete ? 1 : 0, input.notes, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<PortalRecord, 'id' | 'createdAt'>>): PortalRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE portal_records SET name=?, category=?, dimension=?, x=?, y=?, z=?, permanent=?, temporary=?, needs_maintenance=?, tracking=?, last_seen_by=?, last_seen_at=?, obsolete=?, notes=?, updated_at=? WHERE id=?`,
      [merged.name, merged.category, merged.dimension, merged.x, merged.y, merged.z,
        merged.permanent ? 1 : 0, merged.temporary ? 1 : 0, merged.needsMaintenance ? 1 : 0, merged.tracking ? 1 : 0,
        merged.lastSeenBy, merged.lastSeenAt, merged.obsolete ? 1 : 0, merged.notes, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM portal_records WHERE id=?', [id]).changes > 0;
  }
}

function mapStructure(row: Record<string, unknown>): StructureRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind ?? 'other') as StructureRecord['kind'],
    dimension: String(row.dimension ?? ''),
    x1: Number(row.x1 ?? 0),
    y1: Number(row.y1 ?? 0),
    z1: Number(row.z1 ?? 0),
    x2: Number(row.x2 ?? 0),
    y2: Number(row.y2 ?? 0),
    z2: Number(row.z2 ?? 0),
    ownership: String(row.ownership ?? ''),
    protected: Number(row.protected ?? 0) !== 0,
    maintenance: String(row.maintenance ?? 'ok') as StructureRecord['maintenance'],
    lastSeenBy: row.last_seen_by == null ? null : String(row.last_seen_by),
    lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    notes: String(row.notes ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Persistence for the general structure registry. It stores only what the operator reported. */
export class StructureRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): StructureRecord[] {
    return this.db.all('SELECT * FROM structures ORDER BY name').map((row) => mapStructure(row));
  }

  get(id: string): StructureRecord | undefined {
    const row = this.db.get('SELECT * FROM structures WHERE id=?', [id]);
    return row ? mapStructure(row) : undefined;
  }

  findByName(name: string): StructureRecord | undefined {
    const row = this.db.get('SELECT * FROM structures WHERE name=?', [name]);
    return row ? mapStructure(row) : undefined;
  }

  create(input: Omit<StructureRecord, 'id' | 'createdAt' | 'updatedAt'>): StructureRecord {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO structures (id, name, kind, dimension, x1, y1, z1, x2, y2, z2, ownership, protected, maintenance, last_seen_by, last_seen_at, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.name, input.kind, input.dimension, input.x1, input.y1, input.z1, input.x2, input.y2, input.z2,
        input.ownership, input.protected ? 1 : 0, input.maintenance, input.lastSeenBy, input.lastSeenAt, input.notes, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<StructureRecord, 'id' | 'createdAt'>>): StructureRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE structures SET name=?, kind=?, dimension=?, x1=?, y1=?, z1=?, x2=?, y2=?, z2=?, ownership=?, protected=?, maintenance=?, last_seen_by=?, last_seen_at=?, notes=?, updated_at=? WHERE id=?`,
      [merged.name, merged.kind, merged.dimension, merged.x1, merged.y1, merged.z1, merged.x2, merged.y2, merged.z2,
        merged.ownership, merged.protected ? 1 : 0, merged.maintenance, merged.lastSeenBy, merged.lastSeenAt, merged.notes, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM structures WHERE id=?', [id]).changes > 0;
  }
}

function mapShulker(row: Record<string, unknown>): ShulkerRecord {
  return {
    id: String(row.id),
    workerId: String(row.worker_id),
    slot: Number(row.slot ?? -1),
    label: String(row.label ?? ''),
    categoryId: row.category_id == null ? null : String(row.category_id),
    mixed: Number(row.mixed ?? 0) !== 0,
    empty: Number(row.empty ?? 1) !== 0,
    items: parseJson<ShulkerRecord['items']>(row.items, []),
    itemCount: Number(row.item_count ?? 0),
    freeSlots: row.free_slots == null ? null : Number(row.free_slots),
    reserved: Number(row.reserved ?? 0) !== 0,
    markedForRemoval: Number(row.marked_for_removal ?? 0) !== 0,
    inspectedAt: Number(row.inspected_at ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class ShulkerRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(workerId?: string): ShulkerRecord[] {
    const rows = workerId
      ? this.db.all('SELECT * FROM shulker_records WHERE worker_id=? ORDER BY label', [workerId])
      : this.db.all('SELECT * FROM shulker_records ORDER BY worker_id, slot');
    return rows.map((row) => mapShulker(row));
  }

  get(id: string): ShulkerRecord | undefined {
    const row = this.db.get('SELECT * FROM shulker_records WHERE id=?', [id]);
    return row ? mapShulker(row) : undefined;
  }

  /** Inserts or replaces the row for a (worker, slot) pair, so repeated inspections update in place. */
  upsert(input: Omit<ShulkerRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): ShulkerRecord {
    const existing = this.db.get(
      'SELECT * FROM shulker_records WHERE worker_id=? AND slot=?',
      [input.workerId, input.slot],
    );
    const id = input.id ?? (existing ? String(existing.id) : randomUUID());
    const at = now();
    const createdAt = existing ? Number(existing.created_at) : at;
    this.db.run(
      `INSERT INTO shulker_records (id, worker_id, slot, label, category_id, mixed, empty, items, item_count, free_slots, reserved, marked_for_removal, inspected_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         worker_id=excluded.worker_id, slot=excluded.slot, label=excluded.label, category_id=excluded.category_id,
         mixed=excluded.mixed, empty=excluded.empty, items=excluded.items, item_count=excluded.item_count,
         free_slots=excluded.free_slots, reserved=excluded.reserved, marked_for_removal=excluded.marked_for_removal,
         inspected_at=excluded.inspected_at, updated_at=excluded.updated_at`,
      [id, input.workerId, input.slot, input.label, input.categoryId, input.mixed ? 1 : 0, input.empty ? 1 : 0,
        JSON.stringify(input.items), input.itemCount, input.freeSlots, input.reserved ? 1 : 0,
        input.markedForRemoval ? 1 : 0, input.inspectedAt, createdAt, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<ShulkerRecord, 'id' | 'createdAt'>>): ShulkerRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE shulker_records SET worker_id=?, slot=?, label=?, category_id=?, mixed=?, empty=?, items=?, item_count=?, free_slots=?, reserved=?, marked_for_removal=?, inspected_at=?, updated_at=? WHERE id=?`,
      [merged.workerId, merged.slot, merged.label, merged.categoryId, merged.mixed ? 1 : 0, merged.empty ? 1 : 0,
        JSON.stringify(merged.items), merged.itemCount, merged.freeSlots, merged.reserved ? 1 : 0,
        merged.markedForRemoval ? 1 : 0, merged.inspectedAt, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM shulker_records WHERE id=?', [id]).changes > 0;
  }
}

function mapWorkflow(row: Record<string, unknown>): WorkflowRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    operations: parseJson<string[]>(row.operations, []),
    networkId: row.network_id == null ? null : String(row.network_id),
    mode: String(row.mode ?? 'supervised') as WorkflowRecord['mode'],
    enabled: Number(row.enabled ?? 1) !== 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class WorkflowRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): WorkflowRecord[] {
    return this.db.all('SELECT * FROM storage_workflows ORDER BY name').map((row) => mapWorkflow(row));
  }

  get(id: string): WorkflowRecord | undefined {
    const row = this.db.get('SELECT * FROM storage_workflows WHERE id=?', [id]);
    return row ? mapWorkflow(row) : undefined;
  }

  findByName(name: string): WorkflowRecord | undefined {
    const row = this.db.get('SELECT * FROM storage_workflows WHERE name=?', [name]);
    return row ? mapWorkflow(row) : undefined;
  }

  create(input: Omit<WorkflowRecord, 'id' | 'createdAt' | 'updatedAt'>): WorkflowRecord {
    const id = randomUUID();
    const at = now();
    this.db.run(
      `INSERT INTO storage_workflows (id, name, description, operations, network_id, mode, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, input.name, input.description, JSON.stringify(input.operations), input.networkId, input.mode, input.enabled ? 1 : 0, at, at],
    );
    return this.get(id)!;
  }

  update(id: string, patch: Partial<Omit<WorkflowRecord, 'id' | 'createdAt'>>): WorkflowRecord | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: now() };
    this.db.run(
      `UPDATE storage_workflows SET name=?, description=?, operations=?, network_id=?, mode=?, enabled=?, updated_at=? WHERE id=?`,
      [merged.name, merged.description, JSON.stringify(merged.operations), merged.networkId, merged.mode, merged.enabled ? 1 : 0, merged.updatedAt, id],
    );
    return this.get(id);
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_workflows WHERE id=?', [id]).changes > 0;
  }
}

export type StoredPlan = AutomationPlan & { approved: boolean; executed: boolean };

function mapPlan(row: Record<string, unknown>): StoredPlan {
  return {
    id: String(row.id),
    operation: String(row.operation),
    networkId: row.network_id == null ? null : String(row.network_id),
    createdAt: Number(row.created_at),
    steps: parseJson<AutomationPlan['steps']>(row.steps, []),
    notes: parseJson<string[]>(row.notes, []),
    actionable: Number(row.actionable ?? 0) !== 0,
    approved: Number(row.approved ?? 0) !== 0,
    executed: Number(row.executed ?? 0) !== 0,
  };
}

export class StoragePlanRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 100): StoredPlan[] {
    return this.db.all('SELECT * FROM storage_plans ORDER BY created_at DESC LIMIT ?', [limit]).map((row) => mapPlan(row));
  }

  get(id: string): StoredPlan | undefined {
    const row = this.db.get('SELECT * FROM storage_plans WHERE id=?', [id]);
    return row ? mapPlan(row) : undefined;
  }

  save(plan: AutomationPlan): StoredPlan {
    this.db.run(
      `INSERT INTO storage_plans (id, operation, network_id, steps, notes, actionable, approved, executed, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET steps=excluded.steps, notes=excluded.notes, actionable=excluded.actionable`,
      [plan.id, plan.operation, plan.networkId, JSON.stringify(plan.steps), JSON.stringify(plan.notes), plan.actionable ? 1 : 0, 0, 0, plan.createdAt],
    );
    return this.get(plan.id)!;
  }

  setApproved(id: string, approved = true): boolean {
    return this.db.run('UPDATE storage_plans SET approved=? WHERE id=?', [approved ? 1 : 0, id]).changes > 0;
  }

  setExecuted(id: string, executed = true): boolean {
    return this.db.run('UPDATE storage_plans SET executed=? WHERE id=?', [executed ? 1 : 0, id]).changes > 0;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_plans WHERE id=?', [id]).changes > 0;
  }

  prune(keep: number): void {
    this.db.run(
      'DELETE FROM storage_plans WHERE id NOT IN (SELECT id FROM storage_plans ORDER BY created_at DESC LIMIT ?)',
      [keep],
    );
  }
}

function mapActivity(row: Record<string, unknown>): StorageActivityEntry {
  return {
    id: String(row.id),
    at: Number(row.at),
    operation: String(row.operation),
    workerId: String(row.worker_id ?? ''),
    target: String(row.target ?? ''),
    query: String(row.query ?? ''),
    count: Number(row.count ?? 0),
    ok: Number(row.ok ?? 0) !== 0,
    detail: String(row.detail ?? ''),
    beforeAfter: String(row.before_after ?? ''),
    source: String(row.source ?? ''),
  };
}

export class StorageActivityRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(limit = 200, workerId?: string): StorageActivityEntry[] {
    const rows = workerId
      ? this.db.all('SELECT * FROM storage_activity WHERE worker_id=? ORDER BY at DESC LIMIT ?', [workerId, limit])
      : this.db.all('SELECT * FROM storage_activity ORDER BY at DESC LIMIT ?', [limit]);
    return rows.map((row) => mapActivity(row));
  }

  record(input: Omit<StorageActivityEntry, 'id' | 'at'> & { at?: number }): StorageActivityEntry {
    const id = randomUUID();
    const at = input.at ?? now();
    this.db.run(
      `INSERT INTO storage_activity (id, at, operation, worker_id, target, query, count, ok, detail, before_after, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, at, input.operation, input.workerId, input.target, input.query, input.count, input.ok ? 1 : 0,
        input.detail, input.beforeAfter, input.source],
    );
    const row = this.db.get('SELECT * FROM storage_activity WHERE id=?', [id]);
    return row ? mapActivity(row) : { id, at, ...input };
  }

  prune(keep: number): void {
    this.db.run(
      'DELETE FROM storage_activity WHERE id NOT IN (SELECT id FROM storage_activity ORDER BY at DESC LIMIT ?)',
      [keep],
    );
  }
}

function mapStorageProfile(row: Record<string, unknown>): StorageProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: Number(row.created_at),
  };
}

export class StorageProfileRepository {
  constructor(private readonly db: FleetDatabase) {}

  list(): StorageProfile[] {
    return this.db.all('SELECT * FROM storage_profiles ORDER BY name').map((row) => mapStorageProfile(row));
  }

  get(id: string): StorageProfile | undefined {
    const row = this.db.get('SELECT * FROM storage_profiles WHERE id=?', [id]);
    return row ? mapStorageProfile(row) : undefined;
  }

  findByName(name: string): StorageProfile | undefined {
    const row = this.db.get('SELECT * FROM storage_profiles WHERE name=?', [name]);
    return row ? mapStorageProfile(row) : undefined;
  }

  create(input: Omit<StorageProfile, 'id' | 'createdAt'>): StorageProfile {
    const id = randomUUID();
    const at = now();
    this.db.run(
      'INSERT INTO storage_profiles (id, name, description, data, created_at) VALUES (?,?,?,?,?)',
      [id, input.name, input.description, JSON.stringify(input.data), at],
    );
    return this.get(id)!;
  }

  remove(id: string): boolean {
    return this.db.run('DELETE FROM storage_profiles WHERE id=?', [id]).changes > 0;
  }
}
