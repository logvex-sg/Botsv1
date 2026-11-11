/**
 * Persistent registries.
 *
 * Everything the worker knows about the world it works in — containers, categories, storage
 * networks, structures, portals, restock rules and logistics routes — lives here, on disk, in the
 * worker's own state directory. The host reads them and may ask the worker to change them; the
 * worker owns the file.
 *
 * Every registry tolerates a corrupt file by falling back to its defaults, because a worker that
 * refuses to start because one JSON file is damaged is worse than one that starts with defaults.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BUILTIN_CATEGORIES } from './engine/categories';
import type {
  ContainerRecord,
  ItemCategory,
  PortalRecord,
  RegisteredStructure,
  StorageNetwork,
  Vec3,
} from './types';
import type { LogisticsRoute } from './engine/logistics-engine';
import type { RestockRule } from './engine/restock-engine';

interface Envelope<T> {
  version: number;
  items: T[];
}

/** A JSON-backed list of records with atomic writes. */
export class JsonStore<T extends { id: string }> {
  private items = new Map<string, T>();
  private readonly path: string;
  private readonly version: number;
  private writing: Promise<void> = Promise.resolve();

  constructor(stateDir: string, filename: string, version = 1) {
    this.path = resolve(stateDir, filename);
    this.version = version;
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Envelope<T>;
      if (!parsed || !Array.isArray(parsed.items)) return;
      for (const item of parsed.items) {
        if (item && typeof item.id === 'string') this.items.set(item.id, item);
      }
    } catch {
      // Leave the damaged file in place for inspection; start with an empty registry.
    }
  }

  private async persist(): Promise<void> {
    const envelope: Envelope<T> = { version: this.version, items: [...this.items.values()] };
    const payload = `${JSON.stringify(envelope, null, 2)}\n`;
    this.writing = this.writing.then(async () => {
      await fs.mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await fs.writeFile(temporary, payload, 'utf8');
      await fs.rename(temporary, this.path);
    });
    await this.writing;
  }

  list(): T[] {
    return [...this.items.values()];
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  async put(item: T): Promise<T> {
    this.items.set(item.id, item);
    await this.persist();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    const removed = this.items.delete(id);
    if (removed) await this.persist();
    return removed;
  }

  async replaceAll(items: readonly T[]): Promise<void> {
    this.items = new Map(items.map((item) => [item.id, item]));
    await this.persist();
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get size(): number {
    return this.items.size;
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  async flush(): Promise<void> {
    await this.writing;
  }
}

/** The whole registry set for one worker. */
export class Registries {
  readonly containers: JsonStore<ContainerRecord>;
  readonly categories: JsonStore<ItemCategory>;
  readonly networks: JsonStore<StorageNetwork>;
  readonly structures: JsonStore<RegisteredStructure>;
  readonly portals: JsonStore<PortalRecord>;
  readonly restockRules: JsonStore<RestockRule>;
  readonly routes: JsonStore<LogisticsRoute>;

  constructor(stateDir: string) {
    this.containers = new JsonStore<ContainerRecord>(stateDir, 'containers.json');
    this.categories = new JsonStore<ItemCategory>(stateDir, 'categories.json');
    this.networks = new JsonStore<StorageNetwork>(stateDir, 'storage-networks.json');
    this.structures = new JsonStore<RegisteredStructure>(stateDir, 'structures.json');
    this.portals = new JsonStore<PortalRecord>(stateDir, 'portals.json');
    this.restockRules = new JsonStore<RestockRule>(stateDir, 'restock-rules.json');
    this.routes = new JsonStore<LogisticsRoute>(stateDir, 'logistics-routes.json');
  }

  async load(): Promise<void> {
    await Promise.all([
      this.containers.load(),
      this.categories.load(),
      this.networks.load(),
      this.structures.load(),
      this.portals.load(),
      this.restockRules.load(),
      this.routes.load(),
    ]);
    // Seed the built-in categories on first run so a fresh install classifies honestly.
    if (this.categories.size === 0) {
      await this.categories.replaceAll(BUILTIN_CATEGORIES);
    }
  }

  containerById = (id: string): ContainerRecord | undefined => this.containers.get(id);

  /** Containers in a network, or every container when no network is given. */
  containersIn(networkId?: string): ContainerRecord[] {
    const all = this.containers.list();
    if (!networkId) return all;
    const network = this.networks.get(networkId);
    if (!network) return all.filter((container) => container.networkId === networkId);
    return all.filter((container) => network.containers.includes(container.id));
  }

  /** Registers a container, deriving an id from its position when none is supplied. */
  async registerContainer(input: {
    id?: string;
    label: string;
    position: Vec3;
    dimension?: string;
    networkId?: string;
    categories?: string[];
    protected?: boolean;
  }): Promise<ContainerRecord> {
    const id = input.id ?? `container-${input.position.x}-${input.position.y}-${input.position.z}`;
    const existing = this.containers.get(id);
    const record: ContainerRecord = {
      id,
      networkId: input.networkId ?? existing?.networkId ?? 'default',
      label: input.label,
      position: input.position,
      dimension: input.dimension ?? existing?.dimension ?? 'overworld',
      categories: input.categories ?? existing?.categories ?? [],
      protected: input.protected ?? existing?.protected ?? false,
      registeredAt: existing?.registeredAt ?? Date.now(),
      lastSeenAt: existing?.lastSeenAt,
      lastCapacity: existing?.lastCapacity,
    };
    await this.containers.put(record);

    // Keep the network's member list in step with the containers that claim it.
    const network = this.networks.get(record.networkId);
    if (network && !network.containers.includes(id)) {
      await this.networks.put({ ...network, containers: [...network.containers, id] });
    } else if (!network) {
      await this.networks.put({
        id: record.networkId,
        name: record.networkId === 'default' ? 'Default' : record.networkId,
        dimension: record.dimension,
        containers: [id],
        paused: false,
        createdAt: Date.now(),
      });
    }
    return record;
  }

  /** Records what a container last held, so capacity reports are honest about their age. */
  async noteContainerRead(id: string, capacity: number): Promise<void> {
    const existing = this.containers.get(id);
    if (!existing) return;
    await this.containers.put({ ...existing, lastSeenAt: Date.now(), lastCapacity: capacity });
  }

  async registerStructure(input: {
    id?: string;
    name: string;
    kind?: RegisteredStructure['kind'];
    min: Vec3;
    max: Vec3;
    dimension?: string;
    protected?: boolean;
    maintenanceIntervalDays?: number;
    notes?: string;
  }): Promise<RegisteredStructure> {
    const id = input.id ?? `structure-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const existing = this.structures.get(id);
    const record: RegisteredStructure = {
      id,
      name: input.name,
      kind: input.kind ?? 'other',
      region: {
        min: { x: Math.min(input.min.x, input.max.x), y: Math.min(input.min.y, input.max.y), z: Math.min(input.min.z, input.max.z) },
        max: { x: Math.max(input.min.x, input.max.x), y: Math.max(input.min.y, input.max.y), z: Math.max(input.min.z, input.max.z) },
        dimension: input.dimension ?? existing?.region.dimension ?? 'overworld',
      },
      protected: input.protected ?? existing?.protected ?? false,
      maintenance: existing?.maintenance ?? 'ok',
      lastMaintainedAt: existing?.lastMaintainedAt,
      maintenanceIntervalDays: input.maintenanceIntervalDays ?? existing?.maintenanceIntervalDays,
      notes: input.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await this.structures.put(record);
    return record;
  }

  async noteMaintenance(id: string): Promise<void> {
    const existing = this.structures.get(id);
    if (!existing) return;
    await this.structures.put({ ...existing, lastMaintainedAt: Date.now(), maintenance: 'ok' });
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.containers.flush(),
      this.categories.flush(),
      this.networks.flush(),
      this.structures.flush(),
      this.portals.flush(),
      this.restockRules.flush(),
      this.routes.flush(),
    ]);
  }
}

export function emptyRegistries(stateDir: string): Registries {
  return new Registries(stateDir);
}
