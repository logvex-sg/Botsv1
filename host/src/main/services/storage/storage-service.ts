/**
 * Storage service: the Host-side orchestrator for the Autonomous Storage & World Maintenance
 * subsystem.
 *
 * This is where the pure engines meet the database and the worker task path. It owns storage
 * networks, their registered containers, categories, restock and disposal rules, the portal and
 * shulker registries, workflows, stored plans and the storage activity log, and it exposes them to
 * the IPC and HTTP layers as one coherent API.
 *
 * Two rules are enforced here rather than left to callers:
 *  - a plan never moves anything until it is executed, and execution only ever asks a worker to
 *    perform a *supported* inventory interaction and then records what the worker reported back;
 *  - two workers are never allowed to modify the same container at once, because a reservation is
 *    taken for every container a plan touches before any task is dispatched.
 */
import { randomUUID } from 'node:crypto';
import type {
  AiPlanView,
  AutomationMode,
  AutomationPlan,
  AutomationStep,
  ContainerKind,
  DisposalRule,
  MaintenanceAnswer,
  PlanExecutionResult,
  PortalRecord,
  RestockRule,
  ShulkerRecord,
  StorageActivityEntry,
  StorageBottleneck,
  StorageCategory,
  StorageContainer,
  StorageNetwork,
  StorageNetworkReport,
  StorageOverview,
  StorageProfile,
  StructureRecord,
  WorkflowRecord,
} from '../../../shared/types';
import type {
  DisposalRuleRepository,
  PortalRepository,
  RestockRuleRepository,
  ShulkerRepository,
  StorageActivityRepository,
  StorageCategoryRepository,
  StorageContainerRepository,
  StorageNetworkRepository,
  StoragePlanRepository,
  StorageProfileRepository,
  StructureRepository,
  WorkflowRepository,
} from '../../db/storage-repositories';
import type { WorkerItem } from '../../../shared/workers';
import {
  bottlenecks,
  categoryFor,
  chooseDestination,
  classifierFor,
  consolidationGroups,
  isFull,
  isProtected,
  kindLabel,
  reportNetwork,
  unsortableItems,
} from '../../packages/storage-engine';
import { BUILTIN_CATEGORIES, type ItemClassifier } from '../../packages/item-classifier';
import {
  assessRemoval,
  assessUnpack,
  classify as classifyShulker,
  emptyShulkers,
  fillOf,
  mixedShulkers,
  suggestOrganisation,
  surplusEmptyShulkers,
} from '../../packages/shulker-engine';
import {
  AuthorisedArea,
  flagged as flagPortals,
  groupConnected,
  isObsolete,
  parseArea,
  previewRemoval,
  RemovalPreview,
} from '../../packages/portal-engine';
import { LogisticsRoute, planRoute, reservationConflict } from '../../packages/logistics-engine';
import { RestockNeed, evaluateRules, findSources, planRestock } from '../../packages/restock-engine';
import { DisposalPlan, planDisposal, preview as disposalPreview } from '../../packages/disposal-engine';
import { BUILTIN_WORKFLOWS, OPERATIONS, operationById, validate as validateWorkflow } from '../../packages/workflow-engine';
import { answer as assistantAnswer, classify as classifyIntent } from '../../packages/maintenance-assistant';
import { assess as assessRecipe, Recipe } from '../../packages/crafting-engine';
import { plan as planWithAi } from '../../packages/ai-planner';
import type { Grant } from '../../packages/permissions';
import {
  STRUCTURE_KINDS,
  countByKind,
  fromPortal,
  issues as structureIssues,
  maintenanceDue,
  previewChange,
  type StructureChangePreview,
  type StructureIssue,
} from '../../packages/structure-registry';

/** The desktop operator already controls this host, so the planner checks against full authority. */
const OPERATOR_GRANT: Grant = { subject: 'operator', level: 'administer' };

export interface StorageServiceDeps {
  networks: StorageNetworkRepository;
  categories: StorageCategoryRepository;
  containers: StorageContainerRepository;
  restockRules: RestockRuleRepository;
  disposalRules: DisposalRuleRepository;
  portals: PortalRepository;
  shulkers: ShulkerRepository;
  structures: StructureRepository;
  workflows: WorkflowRepository;
  plans: StoragePlanRepository;
  activity: StorageActivityRepository;
  profiles: StorageProfileRepository;
  emit: (type: string, message: string, payload?: Record<string, unknown>) => void;
  /** Dispatches a task to one worker; injected so this service never imports the socket layer. */
  runTask: (workerId: string, kind: string, params: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>;
  /** A live predicate: is this worker currently connected? */
  isOnline: (workerId: string) => boolean;
  /** The last reported carried items for a worker, or [] when none. */
  carriedFor: (workerId: string) => WorkerItem[];
  /** Every known worker id, for fleet-wide operations. */
  workerIds: () => string[];
}

/** How long a container reservation is held before it expires (a stuck task cannot lock forever). */
const RESERVATION_TTL_MS = 60_000;

export class StorageService {
  /** In-memory container reservations: container id -> {workerId, at}. Never persisted. */
  private readonly reservations = new Map<string, { workerId: string; at: number }>();
  /** Routes are configuration without their own table; kept on the service and in a profile. */
  private routes: LogisticsRoute[] = [];

  constructor(private readonly deps: StorageServiceDeps) {}

  // --------------------------------------------------------------- networks

  listNetworks(): StorageNetwork[] {
    return this.deps.networks.list();
  }

  getNetwork(id: string): StorageNetwork | undefined {
    return this.deps.networks.get(id);
  }

  createNetwork(input: {
    name: string; description?: string; mode?: AutomationMode; workerIds?: string[];
    protectedItems?: string[]; reservations?: { query: string; count: number }[]; exclusionAreas?: string[];
  }): StorageNetwork {
    const name = input.name.trim();
    if (!name) throw new Error('A storage network needs a name.');
    if (this.deps.networks.findByName(name)) throw new Error(`A storage network named "${name}" already exists.`);
    const network = this.deps.networks.create({
      name,
      description: input.description ?? '',
      mode: input.mode ?? 'supervised',
      paused: false,
      workerIds: input.workerIds ?? [],
      protectedItems: input.protectedItems ?? [],
      reservations: input.reservations ?? [],
      exclusionAreas: input.exclusionAreas ?? [],
    });
    this.audit('network.create', network.id, `created storage network "${name}"`);
    this.deps.emit('STORAGE_NETWORK_CHANGED', `Storage network "${name}" created`, { id: network.id });
    return network;
  }

  updateNetwork(id: string, patch: Partial<Omit<StorageNetwork, 'id' | 'createdAt'>>): StorageNetwork | undefined {
    const updated = this.deps.networks.update(id, patch);
    if (updated) {
      this.audit('network.update', id, `updated storage network "${updated.name}"`);
      this.deps.emit('STORAGE_NETWORK_CHANGED', `Storage network "${updated.name}" updated`, { id });
    }
    return updated;
  }

  removeNetwork(id: string): boolean {
    const network = this.deps.networks.get(id);
    if (!network) return false;
    this.deps.containers.removeByNetwork(id);
    const removed = this.deps.networks.remove(id);
    if (removed) {
      this.audit('network.remove', id, `removed storage network "${network.name}"`);
      this.deps.emit('STORAGE_NETWORK_CHANGED', `Storage network "${network.name}" removed`, { id });
    }
    return removed;
  }

  /** Pauses or resumes one network's automation. */
  setNetworkPaused(id: string, paused: boolean): StorageNetwork | undefined {
    const updated = this.deps.networks.update(id, { paused });
    if (updated) {
      this.audit(paused ? 'network.pause' : 'network.resume', id, `${paused ? 'paused' : 'resumed'} "${updated.name}"`);
      this.deps.emit('STORAGE_NETWORK_CHANGED', `Storage network "${updated.name}" ${paused ? 'paused' : 'resumed'}`, { id });
    }
    return updated;
  }

  // --------------------------------------------------------------- categories

  listCategories(): StorageCategory[] {
    return this.deps.categories.list();
  }

  /** Ensures the default categories exist, so a fresh install has something to route by. */
  ensureDefaultCategories(): StorageCategory[] {
    const existing = this.deps.categories.list();
    if (existing.length > 0) return existing;
    // Seeded from the classifier's own built-ins, so a fresh install classifies on real tags,
    // enchantments and components from the first run rather than only on name fragments. Each
    // built-in category keeps its rules; the operator can edit them like any other category.
    for (const category of BUILTIN_CATEGORIES) {
      this.deps.categories.create({
        name: category.name,
        itemMatches: [],
        rules: [...category.rules],
        priority: category.priority,
        color: category.color,
        protected: category.exclusive,
      });
    }
    return this.deps.categories.list();
  }

  createCategory(input: Omit<StorageCategory, 'id' | 'createdAt' | 'updatedAt'>): StorageCategory {
    const name = input.name.trim();
    if (!name) throw new Error('A category needs a name.');
    if (this.deps.categories.findByName(name)) throw new Error(`A category named "${name}" already exists.`);
    return this.deps.categories.create({ ...input, name });
  }

  updateCategory(id: string, patch: Partial<Omit<StorageCategory, 'id' | 'createdAt'>>): StorageCategory | undefined {
    return this.deps.categories.update(id, patch);
  }

  removeCategory(id: string): boolean {
    // Clear any container that referenced it, so no container points at a missing category.
    for (const container of this.deps.containers.list()) {
      if (container.categoryId === id) this.deps.containers.update(container.id, { categoryId: null });
    }
    return this.deps.categories.remove(id);
  }

  // --------------------------------------------------------------- containers

  listContainers(networkId?: string): StorageContainer[] {
    return this.deps.containers.list(networkId);
  }

  getContainer(id: string): StorageContainer | undefined {
    return this.deps.containers.get(id);
  }

  createContainer(input: {
    networkId: string; workerId: string; label?: string; kind?: ContainerKind;
    x?: number; y?: number; z?: number; dimension?: string; categoryId?: string | null;
    locked?: boolean; permanent?: boolean;
  }): StorageContainer {
    if (!this.deps.networks.get(input.networkId)) throw new Error('That storage network no longer exists.');
    if (!this.deps.workerIds().includes(input.workerId)) throw new Error('That worker is not known.');
    if (input.categoryId && !this.deps.categories.get(input.categoryId)) throw new Error('That category no longer exists.');
    const container = this.deps.containers.create({
      networkId: input.networkId,
      workerId: input.workerId,
      label: input.label?.trim() || 'container',
      kind: input.kind ?? 'general',
      x: input.x ?? 0,
      y: input.y ?? 0,
      z: input.z ?? 0,
      dimension: input.dimension ?? '',
      categoryId: input.categoryId ?? null,
      locked: input.locked ?? false,
      permanent: input.permanent ?? false,
      capacity: null,
      freeSlots: null,
      full: false,
      items: [],
      inspectedAt: 0,
    });
    this.audit('container.create', container.id, `registered container "${container.label}" on ${container.workerId}`);
    this.deps.emit('STORAGE_CONTAINER_CHANGED', `Container "${container.label}" registered`, { id: container.id });
    return container;
  }

  updateContainer(id: string, patch: Partial<Omit<StorageContainer, 'id' | 'createdAt'>>): StorageContainer | undefined {
    return this.deps.containers.update(id, patch);
  }

  removeContainer(id: string): boolean {
    return this.deps.containers.remove(id);
  }

  /**
   * Records a container observation reported by a worker.
   *
   * This is the only way container contents change: a worker reads what it can see and the Host
   * stores it with the time it was read. Nothing here guesses at what a container holds.
   */
  recordObservation(containerId: string, items: WorkerItem[], options: { freeSlots?: number; capacity?: number } = {}): StorageContainer | undefined {
    const container = this.deps.containers.get(containerId);
    if (!container) return undefined;
    const freeSlots = options.freeSlots ?? container.freeSlots;
    return this.deps.containers.update(containerId, {
      items,
      freeSlots,
      capacity: options.capacity ?? container.capacity,
      full: freeSlots !== null && freeSlots <= 0,
      inspectedAt: Date.now(),
    });
  }

  // --------------------------------------------------------------- rules

  listRestockRules(networkId?: string): RestockRule[] {
    return this.deps.restockRules.list(networkId);
  }

  createRestockRule(input: Omit<RestockRule, 'id' | 'createdAt' | 'updatedAt'>): RestockRule {
    const name = input.name.trim();
    if (!name) throw new Error('A restock rule needs a name.');
    if (!input.query.trim()) throw new Error('A restock rule needs an item to keep stocked.');
    if (input.min < 0 || input.max < input.min) throw new Error('A restock rule needs min >= 0 and max >= min.');
    return this.deps.restockRules.create({ ...input, name });
  }

  updateRestockRule(id: string, patch: Partial<Omit<RestockRule, 'id' | 'createdAt'>>): RestockRule | undefined {
    return this.deps.restockRules.update(id, patch);
  }

  removeRestockRule(id: string): boolean {
    return this.deps.restockRules.remove(id);
  }

  listDisposalRules(): DisposalRule[] {
    return this.deps.disposalRules.list();
  }

  createDisposalRule(input: Omit<DisposalRule, 'id' | 'createdAt' | 'updatedAt'>): DisposalRule {
    const name = input.name.trim();
    if (!name) throw new Error('A disposal rule needs a name.');
    if (!input.query.trim()) throw new Error('A disposal rule needs an item to match.');
    return this.deps.disposalRules.create({ ...input, name });
  }

  updateDisposalRule(id: string, patch: Partial<Omit<DisposalRule, 'id' | 'createdAt'>>): DisposalRule | undefined {
    return this.deps.disposalRules.update(id, patch);
  }

  removeDisposalRule(id: string): boolean {
    return this.deps.disposalRules.remove(id);
  }

  // --------------------------------------------------------------- portals

  listPortals(): PortalRecord[] {
    return this.deps.portals.list();
  }

  getPortal(id: string): PortalRecord | undefined {
    return this.deps.portals.get(id);
  }

  createPortal(input: Omit<PortalRecord, 'id' | 'createdAt' | 'updatedAt'>): PortalRecord {
    const name = input.name.trim();
    if (!name) throw new Error('A portal needs a name.');
    if (this.deps.portals.findByName(name)) throw new Error(`A portal named "${name}" already exists.`);
    const portal = this.deps.portals.create({ ...input, name });
    this.audit('portal.register', portal.id, `registered portal "${name}" at ${portal.dimension} ${portal.x} ${portal.y} ${portal.z}`);
    return portal;
  }

  updatePortal(id: string, patch: Partial<Omit<PortalRecord, 'id' | 'createdAt'>>): PortalRecord | undefined {
    return this.deps.portals.update(id, patch);
  }

  removePortal(id: string): boolean {
    return this.deps.portals.remove(id);
  }

  /** Groups connected portal structures, for the map. */
  portalGroups(): { key: string; dimension: string; portals: PortalRecord[]; x: number; y: number; z: number }[] {
    return groupConnected(this.deps.portals.list());
  }

  /** Every portal that needs attention, with a reason. */
  flaggedPortals(): ReturnType<typeof flagPortals> {
    return flagPortals(this.deps.portals.list());
  }

  /** The authorised areas parsed from a network's exclusion-area strings (used as allow-list). */
  private authorisedAreas(): AuthorisedArea[] {
    const areas: AuthorisedArea[] = [];
    for (const network of this.deps.networks.list()) {
      for (const text of network.exclusionAreas) {
        const area = parseArea(text);
        if (area) areas.push(area);
      }
    }
    return areas;
  }

  /** A removal preview for the given portals, checked against the authorised areas. */
  previewPortalRemoval(portalIds: string[]): RemovalPreview[] {
    const portals = portalIds
      .map((id) => this.deps.portals.get(id))
      .filter((portal): portal is PortalRecord => Boolean(portal));
    return previewRemoval(portals, this.authorisedAreas());
  }

  // --------------------------------------------------------------- structures

  /**
   * Every registered structure: the operator's own records plus the portals, projected in.
   *
   * Portals keep their richer record for the portal workflow; this view lets the structure
   * dashboard show them alongside storage rooms, farms and the rest without duplicating the portal
   * model. A portal whose id already exists as a structure record is skipped, so the list never
   * shows the same region twice.
   */
  listStructures(): StructureRecord[] {
    const own = this.deps.structures.list();
    const ownIds = new Set(own.map((structure) => structure.id));
    const portals = this.deps.portals.list().filter((portal) => !ownIds.has(portal.id)).map(fromPortal);
    return [...own, ...portals].sort((a, b) => a.name.localeCompare(b.name));
  }

  getStructure(id: string): StructureRecord | undefined {
    const own = this.deps.structures.get(id);
    if (own) return own;
    const portal = this.deps.portals.get(id);
    return portal ? fromPortal(portal) : undefined;
  }

  createStructure(input: Omit<StructureRecord, 'id' | 'createdAt' | 'updatedAt'>): StructureRecord {
    const name = input.name.trim();
    if (!name) throw new Error('A structure needs a name.');
    if (this.deps.structures.findByName(name)) throw new Error(`A structure named "${name}" already exists.`);
    if (this.deps.portals.findByName(name)) throw new Error(`A portal named "${name}" already exists.`);
    if (!STRUCTURE_KINDS.includes(input.kind)) throw new Error(`Unknown structure kind "${input.kind}".`);
    const structure = this.deps.structures.create({ ...input, name });
    this.audit('structure.register', structure.id, `registered ${structure.kind} "${name}" at ${structure.dimension} ${structure.x1},${structure.y1},${structure.z1}`);
    return structure;
  }

  updateStructure(id: string, patch: Partial<Omit<StructureRecord, 'id' | 'createdAt'>>): StructureRecord | undefined {
    const updated = this.deps.structures.update(id, patch);
    if (updated) this.audit('structure.edit', id, `updated structure "${updated.name}"`);
    return updated;
  }

  removeStructure(id: string): boolean {
    const removed = this.deps.structures.remove(id);
    if (removed) this.audit('structure.remove', id, 'removed a registered structure');
    return removed;
  }

  /** Every structure that needs attention, with a reason. */
  structureIssues(): StructureIssue[] {
    return structureIssues(this.listStructures());
  }

  /** Structures whose maintenance window has elapsed, for a configurable interval. */
  structuresDueForMaintenance(intervalMs: number): StructureRecord[] {
    return maintenanceDue(this.listStructures(), intervalMs);
  }

  /** What a proposed change in a region would touch, and whether each structure may be changed. */
  previewStructureChange(region: { dimension: string; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }, options?: { allowProtected?: boolean }): StructureChangePreview[] {
    return previewChange(this.listStructures(), region, options);
  }

  /** A count of registered structures by kind, for the dashboard. */
  structureCounts(): ReturnType<typeof countByKind> {
    return countByKind(this.listStructures());
  }

  // --------------------------------------------------------------- shulkers

  listShulkers(workerId?: string): ShulkerRecord[] {
    return this.deps.shulkers.list(workerId);
  }

  /**
   * Asks a worker to report the shulker boxes it is carrying and records what it read.
   *
   * <p>This is how the shulker registry is populated from live workers: the worker decodes each
   * carried box's container component and reports its contents, and {@link recordShulkers} stores
   * and classifies them. A worker that does not advertise the capability, or that reports nothing,
   * simply contributes no rows.
   *
   * @return the number of shulkers recorded
   */
  async reportShulkers(workerId: string): Promise<number> {
    const result = await this.deps.runTask(workerId, 'shulker-read', {});
    if (!result.ok || !result.data) return 0;
    const raw = Array.isArray(result.data.shulkers) ? (result.data.shulkers as Record<string, unknown>[]) : [];
    if (raw.length === 0) return 0;
    const reported = raw
      .filter((entry) => typeof entry.slot === 'number')
      .map((entry) => ({
        slot: entry.slot as number,
        label: typeof entry.label === 'string' ? entry.label : '',
        items: Array.isArray(entry.items) ? (entry.items as WorkerItem[]) : [],
      }));
    return this.recordShulkers(workerId, reported).length;
  }

  /**
   * Records the shulkers a worker reported.
   *
   * Each reported shulker is classified against the current categories, so "mixed" and its dominant
   * category are always consistent with the contents actually read.
   */
  recordShulkers(workerId: string, reported: { slot: number; label?: string; items: WorkerItem[] }[]): ShulkerRecord[] {
    const categories = this.deps.categories.list();
    const out: ShulkerRecord[] = [];
    for (const entry of reported) {
      const base: ShulkerRecord = {
        id: '',
        workerId,
        slot: entry.slot,
        label: entry.label ?? '',
        categoryId: null,
        mixed: false,
        empty: true,
        items: entry.items,
        itemCount: 0,
        freeSlots: null,
        reserved: false,
        markedForRemoval: false,
        inspectedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const classified = classifyShulker(base, categories);
      const saved = this.deps.shulkers.upsert({
        workerId: classified.workerId,
        slot: classified.slot,
        label: classified.label,
        categoryId: classified.categoryId,
        mixed: classified.mixed,
        empty: classified.empty,
        items: classified.items,
        itemCount: classified.itemCount,
        freeSlots: classified.freeSlots,
        reserved: classified.reserved,
        markedForRemoval: classified.markedForRemoval,
        inspectedAt: classified.inspectedAt,
      });
      out.push(saved);
    }
    return out;
  }

  updateShulker(id: string, patch: Partial<Omit<ShulkerRecord, 'id' | 'createdAt'>>): ShulkerRecord | undefined {
    return this.deps.shulkers.update(id, patch);
  }

  removeShulker(id: string): boolean {
    return this.deps.shulkers.remove(id);
  }

  /** Organisation suggestions for every reported shulker. */
  shulkerSuggestions(): ReturnType<typeof suggestOrganisation> {
    return suggestOrganisation(this.deps.shulkers.list(), this.deps.categories.list());
  }

  // --------------------------------------------------------------- workflows

  listWorkflows(): WorkflowRecord[] {
    return this.deps.workflows.list();
  }

  /** Ensures the built-in workflows exist. */
  ensureBuiltinWorkflows(): WorkflowRecord[] {
    for (const builtin of BUILTIN_WORKFLOWS) {
      if (this.deps.workflows.findByName(builtin.name)) continue;
      this.deps.workflows.create({
        name: builtin.name,
        description: builtin.description,
        operations: builtin.operations,
        networkId: null,
        mode: builtin.mode,
        enabled: true,
      });
    }
    return this.deps.workflows.list();
  }

  createWorkflow(input: Omit<WorkflowRecord, 'id' | 'createdAt' | 'updatedAt'>): WorkflowRecord {
    const problems = validateWorkflow({ name: input.name, operations: input.operations });
    if (problems.length > 0) throw new Error(problems.join('; '));
    if (this.deps.workflows.findByName(input.name.trim())) throw new Error(`A workflow named "${input.name.trim()}" already exists.`);
    return this.deps.workflows.create({ ...input, name: input.name.trim() });
  }

  updateWorkflow(id: string, patch: Partial<Omit<WorkflowRecord, 'id' | 'createdAt'>>): WorkflowRecord | undefined {
    if (patch.operations) {
      const problems = validateWorkflow({ name: patch.name ?? 'x', operations: patch.operations });
      if (problems.length > 0) throw new Error(problems.join('; '));
    }
    return this.deps.workflows.update(id, patch);
  }

  removeWorkflow(id: string): boolean {
    return this.deps.workflows.remove(id);
  }

  /** The operation catalogue, for the workflow builder. */
  operations(): typeof OPERATIONS {
    return OPERATIONS;
  }

  // --------------------------------------------------------------- planning

  /**
   * Builds an automation plan for one operation over one network (or the whole fleet).
   *
   * A plan is pure description: it lists the steps that *would* run and the safety refusals. The
   * caller shows it (supervised) or executes it (automatic). Nothing moves until {@link execute}.
   */
  plan(operation: string, networkId?: string | null, options: { workerId?: string; query?: string; portalIds?: string[]; recipe?: Recipe } = {}): AutomationPlan {
    const descriptor = operationById(operation);
    if (!descriptor) throw new Error(`unknown operation "${operation}"`);
    const network = networkId ? this.deps.networks.get(networkId) : undefined;
    if (networkId && !network) throw new Error('That storage network no longer exists.');
    const containers = this.deps.containers.list(networkId ?? undefined);
    const categories = this.deps.categories.list();

    const steps: AutomationStep[] = [];
    const notes: string[] = [];

    switch (operation) {
      case 'inspect':
        this.planInspect(steps, notes, containers, options.workerId);
        break;
      case 'sort':
      case 'distribute':
        this.planSort(steps, notes, containers, categories, network ?? null, options.workerId);
        break;
      case 'consolidate':
        this.planConsolidate(steps, notes, containers, options.workerId);
        break;
      case 'shulker-organise':
        this.planShulkerOrganise(steps, notes, containers, options.workerId);
        break;
      case 'shulker-unpack':
        this.planShulkerUnpack(steps, notes, containers, categories, options.workerId);
        break;
      case 'shulker-cleanup':
        this.planShulkerCleanup(steps, notes, network ?? null, options.workerId);
        break;
      case 'portal-cleanup':
        this.planPortalCleanup(steps, notes, options.portalIds);
        break;
      case 'restock':
        this.planRestock(steps, notes, containers, network ?? null, options.workerId);
        break;
      case 'dispose':
        this.planDispose(steps, notes, containers, network ?? null, options.workerId);
        break;
      case 'maintain':
        this.planMaintain(steps, notes, containers, categories);
        break;
      default:
        throw new Error(`operation "${operation}" has no planner`);
    }

    const plan: AutomationPlan = {
      id: randomUUID(),
      operation,
      networkId: networkId ?? null,
      createdAt: Date.now(),
      steps,
      notes,
      actionable: steps.some((step) => !step.blocked),
    };
    this.deps.plans.save(plan);
    this.deps.plans.prune(200);
    if (plan.actionable) this.deps.emit('STORAGE_PLAN', `Planned ${descriptor.label}: ${steps.length} step(s)`, { planId: plan.id, operation });
    return plan;
  }

  private planInspect(steps: AutomationStep[], notes: string[], containers: StorageContainer[], workerId?: string): void {
    const targets = workerId ? containers.filter((c) => c.workerId === workerId) : containers;
    const byWorker = new Map<string, StorageContainer[]>();
    for (const container of targets) {
      const list = byWorker.get(container.workerId) ?? [];
      list.push(container);
      byWorker.set(container.workerId, list);
    }
    if (byWorker.size === 0) notes.push('no registered containers to inspect');
    for (const [worker, list] of byWorker) {
      steps.push(this.step('inspect', `read ${list.length} container(s) on ${worker}`, worker, {
        query: '', count: list.length, requiresApproval: false,
      }));
    }
  }

  private planSort(steps: AutomationStep[], notes: string[], containers: StorageContainer[], categories: StorageCategory[], network: StorageNetwork | null, workerId?: string): void {
    const inputs = containers.filter((c) => c.kind === 'input' && !c.locked && (!workerId || c.workerId === workerId));
    if (inputs.length === 0) notes.push('no unlocked input containers are registered');
    // Built once per plan rather than per item: the categories do not change mid-plan, and a plan can
    // carry thousands of items.
    const classifier = classifierFor(categories);
    for (const input of inputs) {
      for (const item of input.items) {
        if (item.count <= 0) continue;
        if (network && isProtected(network, item.id, { id: item.id, name: item.name })) {
          notes.push(`${item.name} is protected and will not be moved`);
          continue;
        }
        const destination = this.chooseDestinationFor(item, containers, classifier, input.workerId);
        if (!destination || destination.id === input.id) {
          notes.push(`no destination for ${item.name} (${item.count})`);
          continue;
        }
        const category = categoryFor(item, categories);
        steps.push(this.step('move', `move ${item.count}x ${item.name} to ${destination.label || destination.id}${category ? ` (${category.name})` : ''}`, input.workerId, {
          query: item.id, count: item.count, sourceContainerId: input.id, targetContainerId: destination.id,
        }));
      }
    }
  }

  /**
   * Picks a destination, classifying the item from whatever metadata it reported.
   *
   * Routing is one code path now: the classifier decides the item's category from its tags,
   * enchantments, components and namespace when the worker reported them, and from the category's own
   * substring fallback when it did not. A worker that reports no metadata still routes by id, because
   * the category it falls back to is the same one the plain match would have chosen — the difference
   * is that an item that *does* report metadata is no longer assumed interchangeable with one that
   * merely shares a name.
   */
  private chooseDestinationFor(item: WorkerItem, containers: StorageContainer[], classifier: ItemClassifier, workerId: string): StorageContainer | null {
    return chooseDestination(item, containers, [], { sameWorkerOnly: workerId, classifier });
  }

  private planConsolidate(steps: AutomationStep[], notes: string[], containers: StorageContainer[], workerId?: string): void {
    const scoped = workerId ? containers.filter((c) => c.workerId === workerId) : containers;
    const groups = consolidationGroups(scoped);
    if (groups.length === 0) notes.push('no item is spread across multiple containers');
    for (const group of groups) {
      const destination = scoped.find((c) => c.id === group.containerIds[0]);
      if (!destination) continue;
      steps.push(this.step('consolidate', `consolidate ${group.movable}x ${group.itemName} into ${destination.label || destination.id}`, destination.workerId, {
        query: group.itemId, count: group.movable, targetContainerId: destination.id,
      }));
    }
  }

  private planShulkerOrganise(steps: AutomationStep[], notes: string[], containers: StorageContainer[], workerId?: string): void {
    const shulkers = this.deps.shulkers.list(workerId);
    if (shulkers.length === 0) notes.push('no shulkers have been reported');
    for (const shulker of mixedShulkers(shulkers)) {
      const destination = containers.find((c) => c.workerId === shulker.workerId && !c.locked && c.freeSlots !== 0);
      if (!destination) {
        notes.push(`no destination to split mixed shulker at slot ${shulker.slot}`);
        continue;
      }
      steps.push(this.step('shulker-organise', `split mixed shulker (${shulker.itemCount} items) at slot ${shulker.slot}`, shulker.workerId, {
        query: '', count: shulker.itemCount, targetContainerId: destination.id,
      }));
    }
  }

  private planShulkerUnpack(steps: AutomationStep[], notes: string[], containers: StorageContainer[], categories: StorageCategory[], workerId?: string): void {
    const shulkers = this.deps.shulkers.list(workerId);
    for (const shulker of shulkers) {
      if (shulker.empty) continue;
      const assessment = assessUnpack(shulker, categories, containers);
      if (!assessment.unpackable) {
        notes.push(`shulker at slot ${shulker.slot} cannot be unpacked: ${assessment.reasons.join('; ')}`);
        continue;
      }
      steps.push(this.step('unpack-shulker', `unpack ${shulker.itemCount} item(s) from shulker at slot ${shulker.slot}`, shulker.workerId, {
        query: '', count: shulker.itemCount, slot: shulker.slot, requiresApproval: true,
      }));
    }
  }

  private planShulkerCleanup(steps: AutomationStep[], notes: string[], network: StorageNetwork | null, workerId?: string): void {
    const shulkers = this.deps.shulkers.list(workerId);
    const keep = 5;
    const surplus = surplusEmptyShulkers(shulkers, keep);
    if (surplus.length === 0) notes.push(`no surplus empty shulkers (keeping ${keep} as reserve)`);
    for (const shulker of surplus) {
      const assessment = assessRemoval(shulker, {
        allowDestruction: false,
        reserved: shulker.reserved,
        protected: network ? isProtected(network, shulker.label, { id: shulker.label, name: shulker.label }) : false,
      });
      steps.push(this.step('shulker-cleanup', `move surplus empty shulker at slot ${shulker.slot} to storage`, shulker.workerId, {
        query: '', count: 1, requiresApproval: true,
        note: assessment.removable ? 'safe to remove' : assessment.reasons.join('; '),
      }));
    }
  }

  private planPortalCleanup(steps: AutomationStep[], notes: string[], portalIds?: string[]): void {
    const portals = portalIds && portalIds.length > 0
      ? portalIds.map((id) => this.deps.portals.get(id)).filter((p): p is PortalRecord => Boolean(p))
      : this.deps.portals.list().filter((p) => isObsolete(p));
    if (portals.length === 0) notes.push('no obsolete or selected portals');
    const previews = previewRemoval(portals, this.authorisedAreas());
    for (const preview of previews) {
      steps.push(this.step('portal-remove', `remove ${preview.estimatedBlocks} blocks of portal "${preview.name}" at ${preview.dimension} ${preview.x} ${preview.y} ${preview.z}`, '', {
        query: '', count: preview.estimatedBlocks, requiresApproval: true,
        blocked: !preview.authorised, note: preview.reasons.join('; '),
      }));
    }
  }

  private planRestock(steps: AutomationStep[], notes: string[], containers: StorageContainer[], network: StorageNetwork | null, workerId?: string): void {
    const rules = this.deps.restockRules.list(network?.id);
    const workers = workerId ? [workerId] : (network && network.workerIds.length > 0 ? network.workerIds : this.deps.workerIds());
    let planned = 0;
    for (const worker of workers) {
      const needs = evaluateRules(rules, network, worker, this.deps.carriedFor(worker));
      const plan = planRestock(needs, (query, w) => findSources(query, w, containers, network));
      for (const step of plan.steps) {
        steps.push(this.step('restock', step.detail, worker, {
          query: step.query, count: step.count, sourceContainerId: step.fromContainerId,
        }));
        planned++;
      }
      for (const missing of plan.unsatisfied) {
        notes.push(`${worker}: cannot restock ${missing.missing}x ${missing.query} (${missing.reason})`);
      }
    }
    if (planned === 0 && notes.length === 0) notes.push('every restock rule is already satisfied');
  }

  private planDispose(steps: AutomationStep[], notes: string[], containers: StorageContainer[], network: StorageNetwork | null, workerId?: string): void {
    const rules = this.deps.disposalRules.list();
    if (rules.filter((rule) => rule.enabled).length === 0) {
      notes.push('no enabled disposal rules; nothing may be disposed of');
      return;
    }
    const workers = workerId ? [workerId] : this.deps.workerIds();
    for (const worker of workers) {
      const plan = planDisposal(this.deps.carriedFor(worker), rules, network, containers, worker);
      for (const step of plan.steps) {
        steps.push(this.step('dispose', step.detail, worker, {
          query: step.itemId, count: step.count, targetContainerId: step.toContainerId, requiresApproval: true,
        }));
      }
      for (const refused of plan.refused) {
        notes.push(`${worker}: refused to dispose ${refused.count}x ${refused.itemName} (${refused.reasons.join('; ')})`);
      }
    }
  }

  private planMaintain(steps: AutomationStep[], notes: string[], containers: StorageContainer[], categories: StorageCategory[]): void {
    const full = containers.filter(isFull);
    for (const container of full) {
      steps.push(this.step('maintain', `container "${container.label}" is full; find an alternative destination`, container.workerId, {
        query: '', count: 0, targetContainerId: container.id, requiresApproval: false,
      }));
    }
    const unsortable = unsortableItems(containers, categories);
    for (const item of unsortable.slice(0, 25)) {
      notes.push(`${item.count}x ${item.name} matches no category`);
    }
    if (full.length === 0 && unsortable.length === 0) notes.push('storage room looks healthy: no full containers and every item has a category');
  }

  private step(action: string, detail: string, workerId: string, options: Partial<AutomationStep> & { note?: string } = {}): AutomationStep {
    return {
      id: randomUUID(),
      action,
      detail,
      workerId: workerId || '',
      sourceContainerId: options.sourceContainerId ?? null,
      targetContainerId: options.targetContainerId ?? null,
      query: options.query ?? '',
      count: options.count ?? 0,
      slot: options.slot ?? null,
      requiresApproval: options.requiresApproval ?? false,
      blocked: options.blocked ?? false,
      blockedReason: options.note ?? '',
    };
  }

  // --------------------------------------------------------------- plans store

  listPlans(limit = 100): (AutomationPlan & { approved: boolean; executed: boolean })[] {
    return this.deps.plans.list(limit);
  }

  getPlan(id: string): (AutomationPlan & { approved: boolean; executed: boolean }) | undefined {
    return this.deps.plans.get(id);
  }

  approvePlan(id: string): boolean {
    const plan = this.deps.plans.get(id);
    if (!plan) return false;
    this.audit('plan.approve', id, `approved plan "${plan.operation}"`);
    return this.deps.plans.setApproved(id, true);
  }

  discardPlan(id: string): boolean {
    return this.deps.plans.remove(id);
  }

  /**
   * Executes a stored plan.
   *
   * Every executable step is dispatched through the injected task path, one at a time, with a
   * container reservation held for the containers it touches so a second plan cannot modify the same
   * container at once. The result reflects what the workers actually reported, never an assumption.
   */
  async executePlan(planId: string, options: { force?: boolean } = {}): Promise<PlanExecutionResult> {
    const stored = this.deps.plans.get(planId);
    if (!stored) throw new Error('That plan no longer exists.');
    const outcomes: PlanExecutionResult['outcomes'] = [];
    let executed = 0;
    let failed = 0;
    let skipped = 0;

    for (const step of stored.steps) {
      if (step.blocked) {
        skipped++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: false, detail: `blocked: ${step.blockedReason}` });
        continue;
      }
      if (step.requiresApproval && !stored.approved && !options.force) {
        skipped++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: false, detail: 'needs approval' });
        continue;
      }
      if (step.workerId && !this.deps.isOnline(step.workerId)) {
        skipped++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: false, detail: 'worker is offline' });
        continue;
      }
      // Hold a reservation for the containers the step touches, so two plans cannot collide.
      const touched = [step.sourceContainerId, step.targetContainerId].filter((id): id is string => Boolean(id));
      if (this.conflictingReservation(touched)) {
        skipped++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: false, detail: 'container is reserved by another operation' });
        continue;
      }
      this.reserve(touched, step.workerId);
      try {
        const result = await this.executeStep(step, stored.operation);
        if (result.ok) executed++;
        else failed++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: result.ok, detail: result.detail });
        this.recordActivity({
          operation: stored.operation,
          workerId: step.workerId,
          target: step.targetContainerId ?? step.sourceContainerId ?? '',
          query: step.query,
          count: step.count,
          ok: result.ok,
          detail: result.detail,
          beforeAfter: '',
          source: planId,
        });
      } catch (error) {
        failed++;
        outcomes.push({ stepId: step.id, workerId: step.workerId, ok: false, detail: (error as Error).message });
        this.recordActivity({
          operation: stored.operation,
          workerId: step.workerId,
          target: step.targetContainerId ?? step.sourceContainerId ?? '',
          query: step.query,
          count: step.count,
          ok: false,
          detail: (error as Error).message,
          beforeAfter: '',
          source: planId,
        });
      } finally {
        this.release(touched);
      }
    }

    this.deps.plans.setExecuted(planId, true);
    const message = executed === 0 && failed === 0
      ? `nothing ran: ${skipped} step(s) skipped`
      : `${executed} executed, ${failed} failed, ${skipped} skipped`;
    this.audit('plan.execute', planId, `${stored.operation}: ${message}`);
    return { planId, operation: stored.operation, ok: failed === 0 && executed > 0, executed, failed, skipped, message, outcomes };
  }

  /** Turns one plan step into the worker task that performs it. */
  private async executeStep(step: AutomationStep, operation: string): Promise<{ ok: boolean; detail: string }> {
    switch (step.action) {
      case 'inspect': {
        const containers = this.deps.containers.list().filter((c) => c.workerId === step.workerId);
        let inspected = 0;
        for (const container of containers) {
          const result = await this.deps.runTask(step.workerId, 'container-read', {
            x: container.x, y: container.y, z: container.z, dimension: container.dimension, label: container.label,
          });
          if (result.ok && result.data) {
            const items = Array.isArray(result.data.items) ? (result.data.items as WorkerItem[]) : [];
            this.recordObservation(container.id, items, {
              freeSlots: typeof result.data.freeSlots === 'number' ? result.data.freeSlots : undefined,
              capacity: typeof result.data.capacity === 'number' ? result.data.capacity : undefined,
            });
            inspected++;
          }
        }
        // The same sweep asks the worker to report the shulker boxes it is carrying, so the shulker
        // registry reflects what is actually in the fleet rather than only what was registered by hand.
        const shulkers = await this.reportShulkers(step.workerId);
        return {
          ok: inspected > 0 || shulkers > 0,
          detail: `inspected ${inspected}/${containers.length} container(s), reported ${shulkers} shulker(s)`,
        };
      }
      case 'move':
      case 'restock':
      case 'consolidate':
      case 'shulker-organise': {
        // The worker opens the source container and quick-moves matching items; the Host verifies
        // by re-reading the container afterwards.
        const source = step.sourceContainerId ? this.deps.containers.get(step.sourceContainerId) : undefined;
        const params: Record<string, unknown> = { query: step.query, limit: step.count, direction: 'withdraw' };
        if (source) Object.assign(params, { x: source.x, y: source.y, z: source.z, dimension: source.dimension, label: source.label });
        const result = await this.deps.runTask(step.workerId, 'container-move', params);
        if (result.ok && source && result.data) {
          const moved = typeof result.data.moved === 'number' ? result.data.moved : 0;
          return { ok: moved > 0, detail: moved > 0 ? `moved ${moved} item(s)` : 'the worker moved nothing' };
        }
        return { ok: result.ok, detail: result.ok ? 'move issued' : result.error ?? 'move failed' };
      }
      case 'unpack-shulker': {
        const result = await this.deps.runTask(step.workerId, 'shulker-unpack', {
          ...(step.slot !== null && step.slot !== undefined ? { slot: step.slot } : {}),
        });
        return { ok: result.ok, detail: result.ok ? 'shulker unpacked' : result.error ?? 'unpack failed' };
      }
      case 'shulker-cleanup': {
        // Moving a shulker is a supported inventory interaction: quick-move it into the reserve.
        const result = await this.deps.runTask(step.workerId, 'container-move', { query: 'shulker_box', limit: 1, direction: 'withdraw' });
        return { ok: result.ok, detail: result.ok ? 'shulker relocated' : result.error ?? 'relocation failed' };
      }
      case 'dispose': {
        const result = await this.deps.runTask(step.workerId, 'container-move', { query: step.query, limit: step.count, direction: 'deposit' });
        return { ok: result.ok, detail: result.ok ? 'items moved to disposal' : result.error ?? 'disposal failed' };
      }
      case 'portal-remove': {
        // A controlled block-interaction removal, gated by the worker's portal capability.
        const result = await this.deps.runTask(step.workerId, 'portal-scan', { action: 'remove' });
        return { ok: result.ok, detail: result.ok ? 'portal blocks removed' : result.error ?? 'removal refused' };
      }
      case 'maintain':
        return { ok: true, detail: 'reported as a bottleneck; no automatic move' };
      default:
        return { ok: false, detail: `no executor for action "${step.action}"` };
    }
  }

  // --------------------------------------------------------------- reservations

  private pruneReservations(now = Date.now()): void {
    for (const [containerId, reservation] of this.reservations) {
      if (now - reservation.at > RESERVATION_TTL_MS) this.reservations.delete(containerId);
    }
  }

  private conflictingReservation(containerIds: readonly string[]): boolean {
    this.pruneReservations();
    return containerIds.some((id) => this.reservations.has(id));
  }

  private reserve(containerIds: readonly string[], workerId: string): void {
    for (const id of containerIds) this.reservations.set(id, { workerId, at: Date.now() });
  }

  private release(containerIds: readonly string[]): void {
    for (const id of containerIds) this.reservations.delete(id);
  }

  // --------------------------------------------------------------- activity & audit

  listActivity(limit = 200, workerId?: string): StorageActivityEntry[] {
    return this.deps.activity.list(limit, workerId);
  }

  /** Records an automation action; the one place activity rows are written. */
  recordActivity(input: Omit<StorageActivityEntry, 'id' | 'at'> & { at?: number }): StorageActivityEntry {
    const entry = this.deps.activity.record(input);
    this.deps.activity.prune(2000);
    return entry;
  }

  private audit(action: string, target: string, detail: string): void {
    this.deps.emit('STORAGE_AUDIT', `${action}: ${detail}`, { action, target, detail });
  }

  // --------------------------------------------------------------- reports & overview

  /** A network's health, computed only from reported container rows. */
  networkReport(networkId: string): StorageNetworkReport {
    const network = this.deps.networks.get(networkId);
    if (!network) throw new Error('That storage network no longer exists.');
    const containers = this.deps.containers.list(networkId);
    return reportNetwork(network, containers, this.deps.categories.list(), this.deps.isOnline);
  }

  /** The whole subsystem's headline state, for the dashboard. */
  overview(): StorageOverview {
    const networks = this.deps.networks.list();
    const containers = this.deps.containers.list();
    const shulkers = this.deps.shulkers.list();
    const portals = this.deps.portals.list();
    const bottlenecks = this.allBottlenecks();
    const plans = this.deps.plans.list(200).filter((plan) => !plan.executed);
    const activity = this.deps.activity.list(20);
    const paused = networks.length > 0 && networks.every((network) => network.paused);
    return {
      networks: networks.length,
      containers: containers.length,
      shulkers: shulkers.length,
      portals: portals.length,
      fullContainers: containers.filter(isFull).length,
      bottlenecks: bottlenecks.length,
      pendingPlans: plans.length,
      pendingSteps: plans.reduce((sum, plan) => sum + plan.steps.length, 0),
      globalPaused: paused,
      lastActivityAt: activity[0]?.at ?? null,
      recent: activity,
    };
  }

  private allBottlenecks(): StorageBottleneck[] {
    const out: StorageBottleneck[] = [];
    for (const network of this.deps.networks.list()) {
      out.push(...bottlenecks(network, this.deps.containers.list(network.id), this.deps.isOnline));
    }
    return out;
  }

  /** A complete storage maintenance report, in one object, for the export and the dashboard. */
  maintenanceReport(): {
    generatedAt: number;
    networks: StorageNetworkReport[];
    bottlenecks: StorageBottleneck[];
    emptyShulkers: number;
    mixedShulkers: number;
    obsoletePortals: number;
    unsortable: { id: string; name: string; count: number }[];
    activity: StorageActivityEntry[];
  } {
    const networks = this.deps.networks.list().map((network) => this.networkReport(network.id));
    const containers = this.deps.containers.list();
    const shulkers = this.deps.shulkers.list();
    return {
      generatedAt: Date.now(),
      networks,
      bottlenecks: this.allBottlenecks(),
      emptyShulkers: emptyShulkers(shulkers).length,
      mixedShulkers: mixedShulkers(shulkers).length,
      obsoletePortals: this.deps.portals.list().filter((portal) => isObsolete(portal)).length,
      unsortable: unsortableItems(containers, this.deps.categories.list()),
      activity: this.deps.activity.list(50),
    };
  }

  // --------------------------------------------------------------- assistant

  /**
   * Answers a plain-language request.
   *
   * Two engines read the same sentence. The maintenance assistant maps it to a storage operation
   * and, when it matches, attaches the executable {@link AutomationPlan}. The AI planner (spec §13)
   * independently recognises the intent and returns a checked plan: ordered steps, which are
   * authorised, which are destructive. Both are returned so the operator sees the operation and the
   * reasoning behind it. The planner is run with an administrator grant because the desktop operator
   * already holds full control of this host; per-object protection is still surfaced as a blocked
   * step, not silently allowed.
   */
  ask(request: string): MaintenanceAnswer {
    const intent = classifyIntent(request);
    const response = assistantAnswer(request);
    const ai = planWithAi(request, { grant: OPERATOR_GRANT });
    const aiView: AiPlanView | null = ai.intent
      ? {
          intent: ai.intent,
          confidence: ai.confidence,
          executable: ai.executable,
          needsConfirmation: ai.needsConfirmation,
          note: ai.note,
          steps: ai.steps.map((step) => ({
            id: step.id,
            system: step.system,
            summary: step.summary,
            authorised: step.authorised,
            blockedReason: step.blockedReason,
            destructive: step.destructive,
          })),
        }
      : null;
    if (!intent.operation) {
      return { request, operation: null, answer: response.text, plan: null, ai: aiView };
    }
    const plan_ = this.plan(intent.operation, null, {});
    return { request, operation: intent.operation, answer: response.text, plan: plan_, ai: aiView };
  }

  // --------------------------------------------------------------- profiles

  listProfiles(): StorageProfile[] {
    return this.deps.profiles.list();
  }

  /** Saves the current subsystem configuration as a named profile. */
  saveProfile(name: string, description = ''): StorageProfile {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('A profile needs a name.');
    if (this.deps.profiles.findByName(trimmed)) throw new Error(`A profile named "${trimmed}" already exists.`);
    const data = {
      networks: this.deps.networks.list(),
      categories: this.deps.categories.list(),
      restockRules: this.deps.restockRules.list(),
      disposalRules: this.deps.disposalRules.list(),
      workflows: this.deps.workflows.list(),
      routes: this.routes,
    };
    return this.deps.profiles.create({ name: trimmed, description, data: data as unknown as Record<string, unknown> });
  }

  removeProfile(id: string): boolean {
    return this.deps.profiles.remove(id);
  }

  // --------------------------------------------------------------- logistics routes

  listRoutes(): LogisticsRoute[] {
    return this.routes;
  }

  setRoutes(routes: LogisticsRoute[]): LogisticsRoute[] {
    this.routes = routes;
    return this.routes;
  }

  /** Plans the transfers the current routes imply, for the logistics view. */
  planLogistics(networkId: string): ReturnType<typeof planRoute> {
    const containers = this.deps.containers.list(networkId);
    const categories = this.deps.categories.list();
    const steps = [];
    const refusals = [];
    for (const route of this.routes) {
      const planned = planRoute(route, containers, categories);
      steps.push(...planned.steps);
      refusals.push(...planned.refusals);
    }
    return { steps, refusals };
  }

  /** Whether a proposed transfer would collide with a held reservation. */
  hasReservationConflict(fromContainerId: string, toContainerId: string): boolean {
    return reservationConflict({ fromContainerId, toContainerId }, this.heldReservations());
  }

  private heldReservations(): { containerId: string; workerId: string }[] {
    this.pruneReservations();
    return [...this.reservations.entries()].map(([containerId, reservation]) => ({ containerId, workerId: reservation.workerId }));
  }

  // --------------------------------------------------------------- crafting

  /** Assesses a recipe against a worker's reported inventory. */
  assessRecipe(recipe: Recipe, workerId: string): ReturnType<typeof assessRecipe> {
    return assessRecipe(recipe, this.deps.carriedFor(workerId));
  }

  /** A disposal preview for one worker, without doing anything. */
  disposalPreview(workerId: string, networkId?: string | null): ReturnType<typeof disposalPreview> {
    const network = networkId ? this.deps.networks.get(networkId) ?? null : null;
    return disposalPreview(this.deps.carriedFor(workerId), this.deps.disposalRules.list(), network);
  }

  /** The container kind labels, for the UI. */
  kindLabels(): Record<ContainerKind, string> {
    return {
      input: kindLabel('input'),
      output: kindLabel('output'),
      intermediate: kindLabel('intermediate'),
      disposal: kindLabel('disposal'),
      shulker_reserve: kindLabel('shulker_reserve'),
      general: kindLabel('general'),
    };
  }

  /** Shulker fill classification for one shulker, for the UI. */
  shulkerFill(id: string): 'empty' | 'partial' | 'full' | null {
    const shulker = this.deps.shulkers.get(id);
    return shulker ? fillOf(shulker) : null;
  }

  /** The restock needs for one worker, without planning moves. */
  restockNeeds(workerId: string, networkId?: string | null): RestockNeed[] {
    const network = networkId ? this.deps.networks.get(networkId) ?? null : null;
    const rules = this.deps.restockRules.list(network?.id);
    return evaluateRules(rules, network, workerId, this.deps.carriedFor(workerId));
  }

  /** The restock plan for one worker, for the preview. */
  restockPlan(workerId: string, networkId?: string | null): ReturnType<typeof planRestock> {
    const network = networkId ? this.deps.networks.get(networkId) ?? null : null;
    const containers = this.deps.containers.list(network?.id);
    const needs = this.restockNeeds(workerId, networkId);
    return planRestock(needs, (query, worker) => findSources(query, worker, containers, network));
  }

  /** A disposal plan for one worker, for the preview. */
  disposalPlan(workerId: string, networkId?: string | null): DisposalPlan {
    const network = networkId ? this.deps.networks.get(networkId) ?? null : null;
    const containers = this.deps.containers.list(network?.id);
    return planDisposal(this.deps.carriedFor(workerId), this.deps.disposalRules.list(), network, containers, workerId);
  }
}
