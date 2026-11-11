/**
 * The task executor.
 *
 * This is where a host instruction becomes a real action against a live bot. Every kind is
 * implemented here; nothing is stubbed. Read-only kinds report; mutating kinds act and then verify.
 *
 * Two rules run through the whole file:
 *   1. A mutating task is gated by the worker's own permissions before it touches the world.
 *   2. A mutating task ends by re-reading the world and comparing, and a mismatch is a failure
 *      carrying `mutation: partial` so the retry layer will refuse to repeat it.
 */

import { BotError, asBotError } from '../core/errors';
import type { Logger } from '../core/logger';
import { permitsTask } from '../core/task-catalog';
import { parseContainerMove, parseContainerRead, parseNavigate, parsePortalScan, parseRestock, parseShulkerPack, parseShulkerRead, parseShulkerUnpack } from '../core/protocol/storage-requests';
import { validateChat, validateCommand } from '../core/task-catalog';
import { aggregate, countIn, countFood, find, matchesQuery, toCsv, totalItems } from '../core/engine/inventory-engine';
import { chooseDestination, planPlacement, reportNetwork, unsortableItems } from '../core/engine/storage-engine';
import { assessRemoval, assessUnpack, capacityOf, classifyShulkers, fillOf, suggestOrganisation } from '../core/engine/shulker-engine';
import { evaluateRules, findSources, planRestock } from '../core/engine/restock-engine';
import { planNavigation } from '../core/engine/navigation-engine';
import { distanceBetween } from '../core/engine/navigation-engine';
import { issues as structureIssues, maintenanceDue, previewChange, regionOf } from '../core/engine/structure-registry';
import { verifyCountChange } from '../core/engine/verification';
import type { BotConfig } from '../core/config';
import type { Registries } from '../core/registries';
import type { ContainerRecord, ItemStack, TaskResult, Vec3 } from '../core/types';
import type { InventoryAdapter } from '../mc/inventory';
import type { ContainerAdapter, ContainerBot } from '../mc/container';
import type { NavigationAdapter } from '../mc/navigation';
import type { ShulkerAdapter } from '../mc/shulker';
import type { Planner } from '../ai/planner';
import { previewPlan } from '../ai/planner';

export interface ExecutionContext {
  workerId: string;
  config: BotConfig;
  logger: Logger;
  registries: Registries;
  inventory: InventoryAdapter;
  container: ContainerAdapter;
  navigation: NavigationAdapter;
  shulkers: ShulkerAdapter;
  planner: Planner | null;
  /** A snapshot provider, so `status` reflects the live connection. */
  snapshot: () => Record<string, unknown>;
  /** Position of the bot, or null. */
  position: () => Vec3 | null;
  dimension: () => string;
  /** Sends a chat line or command through the client's own connection. */
  sendChat: (message: string) => void;
  /** Places a carried shulker box, opens it, and returns a handle to restore it afterwards. */
  openPlacedShulker?: (slot: number) => Promise<{ window: unknown; restore: () => Promise<void> }>;
}

export interface TaskRequest {
  kind: string;
  payload: Record<string, unknown>;
  id?: string;
}

/** Distance from the bot to a container, or a large number when it has no position. */
function distanceToContainer(context: ExecutionContext, container: ContainerRecord): number {
  const position = context.position();
  if (!position) return Number.MAX_SAFE_INTEGER;
  return distanceBetween(position, container.position);
}

function ok(taskId: string, kind: string, message: string, data?: Record<string, unknown>, startedAt = Date.now()): TaskResult {
  return { ok: true, taskId, kind, message, data, durationMs: Date.now() - startedAt };
}

function fail(taskId: string, kind: string, error: BotError, startedAt = Date.now()): TaskResult {
  return {
    ok: false,
    taskId,
    kind,
    message: error.message,
    durationMs: Date.now() - startedAt,
    error: { category: error.category, retryable: error.retryable, mutation: error.mutation, detail: error.detail },
  };
}

export class TaskExecutor {
  private readonly context: ExecutionContext;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  /** Runs a task, applying the permission gate first and translating every failure into a result. */
  async execute(request: TaskRequest): Promise<TaskResult> {
    const startedAt = Date.now();
    const taskId = request.id ?? `local-${startedAt.toString(36)}`;

    const gate = permitsTask(request.kind, this.context.config.permissions);
    if (!gate.allowed) {
      return {
        ok: false,
        taskId,
        kind: request.kind,
        message: gate.reason ?? 'the task is not permitted',
        durationMs: 0,
        error: { category: 'permission', retryable: false, mutation: 'none', detail: { kind: request.kind } },
      };
    }

    try {
      return await this.dispatch(taskId, request, startedAt);
    } catch (error) {
      const bot = asBotError(error);
      this.context.logger.warn('task failed', { kind: request.kind, error: bot.message, category: bot.category });
      return fail(taskId, request.kind, bot, startedAt);
    }
  }

  private dispatch(taskId: string, request: TaskRequest, startedAt: number): Promise<TaskResult> {
    switch (request.kind) {
      case 'status':
        return this.status(taskId, startedAt);
      case 'inventory':
        return this.inventory(taskId, startedAt);
      case 'count':
        return this.count(taskId, request.payload, startedAt);
      case 'search':
        return this.search(taskId, request.payload, startedAt);
      case 'equipment':
        return this.equipment(taskId, startedAt);
      case 'position':
        return this.position(taskId, startedAt);
      case 'container-read':
        return this.containerRead(taskId, request.payload, startedAt);
      case 'shulker-read':
        return this.shulkerRead(taskId, startedAt);
      case 'portal-scan':
        return this.portalScan(taskId, request.payload, startedAt);
      case 'navigate':
        return this.navigate(taskId, request.payload, startedAt);
      case 'container-move':
        return this.containerMove(taskId, request.payload, startedAt);
      case 'shulker-pack':
        return this.shulkerPack(taskId, request.payload, startedAt);
      case 'shulker-unpack':
        return this.shulkerUnpack(taskId, request.payload, startedAt);
      case 'restock':
        return this.restock(taskId, request.payload, startedAt);
      case 'command':
        return this.command(taskId, request.payload, startedAt);
      case 'chat':
        return this.chat(taskId, request.payload, startedAt);
      case 'nl-task':
        return this.naturalLanguage(taskId, request.payload, startedAt);
      default:
        return Promise.resolve({
          ok: false,
          taskId,
          kind: request.kind,
          message: `the worker does not implement the task kind "${request.kind}"`,
          durationMs: 0,
          error: { category: 'validation', retryable: false, mutation: 'none' },
        });
    }
  }

  private async status(taskId: string, startedAt: number): Promise<TaskResult> {
    const snapshot = this.context.snapshot();
    const carried = this.context.inventory.carried();
    return ok(taskId, 'status', 'status reported', {
      ...snapshot,
      carriedStacks: carried.length,
      carriedItems: totalItems(carried),
      foodItems: countFood(carried),
      shulkers: this.context.shulkers.count(),
      containers: this.context.registries.containers.size,
    }, startedAt);
  }

  private async inventory(taskId: string, startedAt: number): Promise<TaskResult> {
    const carried = this.context.inventory.carried();
    const accessible = this.context.inventory.accessible();
    const armor = this.context.inventory.armor();
    return ok(taskId, 'inventory', `${carried.length} stack(s) carried`, {
      carried: aggregate(carried),
      accessible: aggregate(accessible),
      armor,
      freeSlots: this.context.inventory.freeSlots(),
      containerOpen: this.context.inventory.hasContainerOpen(),
      totals: totalItems(carried),
      csv: toCsv(aggregate(carried)),
    }, startedAt);
  }

  private async count(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const query = String(payload.query ?? payload.item ?? '').trim();
    if (!query) throw new BotError('count requires a query', { category: 'validation' });
    const carried = this.context.inventory.carried();
    const accessible = this.context.inventory.accessible();
    const heldCount = countIn(carried, query);
    const accessibleCount = countIn(accessible, query);
    return ok(taskId, 'count', `${heldCount} carried, ${accessibleCount} in the open container`, {
      query,
      carried: heldCount,
      accessible: accessibleCount,
      total: heldCount + accessibleCount,
    }, startedAt);
  }

  private async search(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const query = String(payload.query ?? payload.item ?? '').trim();
    if (!query) throw new BotError('search requires a query', { category: 'validation' });
    const carried = find(this.context.inventory.carried(), query);
    const accessible = find(this.context.inventory.accessible(), query);
    return ok(taskId, 'search', `${carried.length + accessible.length} matching stack(s)`, {
      query,
      carried,
      accessible,
    }, startedAt);
  }

  private async equipment(taskId: string, startedAt: number): Promise<TaskResult> {
    const armor = this.context.inventory.armor();
    const held = this.context.inventory.heldItem();
    return ok(taskId, 'equipment', `${armor.length} armour piece(s) worn`, { armor, heldItem: held }, startedAt);
  }

  private async position(taskId: string, startedAt: number): Promise<TaskResult> {
    const position = this.context.position();
    return ok(taskId, 'position', position ? `${position.x}, ${position.y}, ${position.z}` : 'position unknown', {
      position,
      dimension: this.context.dimension(),
    }, startedAt);
  }

  private async containerRead(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseContainerRead(payload);
    const contents = await this.context.container.read(request.position);
    const id = request.label ?? `container-${request.position.x}-${request.position.y}-${request.position.z}`;
    if (this.context.registries.containers.has(id)) {
      await this.context.registries.noteContainerRead(id, contents.capacity);
    }
    return ok(taskId, 'container-read', `${contents.items.length} stack(s) in the container`, {
      position: request.position,
      items: aggregate(contents.items),
      capacity: contents.capacity,
      freeSlots: contents.freeSlots,
    }, startedAt);
  }

  private async shulkerRead(taskId: string, startedAt: number): Promise<TaskResult> {
    const records = classifyShulkers(this.context.shulkers.inspect(), this.context.registries.categories.list());
    const capacity = capacityOf(records);
    return ok(taskId, 'shulker-read', `${records.length} shulker box(es) inspected`, {
      shulkers: records.map((record) => ({
        slot: record.slot,
        label: record.label,
        fill: fillOf(record),
        opaque: record.opaque,
        dominantCategory: record.dominantCategory,
        mixed: record.mixed,
        usedSlots: record.usedSlots,
        freeSlots: record.freeSlots,
        items: aggregate(record.items),
      })),
      capacity,
    }, startedAt);
  }

  private async portalScan(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parsePortalScan(payload);
    const registryPortals = this.context.registries.portals.list();
    const position = this.context.position();
    const withDistance = registryPortals.map((portal) => ({
      ...portal,
      distance: position ? Math.round(distanceBetween(position, portal.position) * 100) / 100 : null,
    }));
    if (request.action === 'remove') {
      if (!this.context.config.permissions.allowPortalRemoval) {
        throw new BotError('removing portals is disabled for this worker', { category: 'permission' });
      }
      // Removal is intentionally not automated: it is reported for a human to confirm.
      return ok(taskId, 'portal-scan', `${withDistance.length} registered portal(s); removal requires a manual confirmation`, {
        action: 'remove',
        portals: withDistance,
        removed: 0,
      }, startedAt);
    }
    const nearby = withDistance.filter((portal) => portal.distance !== null && portal.distance <= request.radius);
    return ok(taskId, 'portal-scan', `${nearby.length} portal(s) within ${request.radius} blocks`, {
      action: 'scan',
      radius: request.radius,
      portals: withDistance,
      nearby,
    }, startedAt);
  }

  private async navigate(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseNavigate(payload);
    const from = this.context.position();
    if (!from) throw new BotError('the worker has no position yet', { category: 'navigation' });
    const plan = planNavigation(from, request.position, this.context.config.navigation, { range: request.range, timeoutMs: request.timeoutMs });
    if (!plan.allowed) throw new BotError(plan.reason, { category: 'navigation' });

    const result = await this.context.navigation.walkTo(request.position, { range: request.range, timeoutMs: request.timeoutMs });
    if (!result.reached) {
      throw new BotError(result.reason, {
        category: 'navigation',
        retryable: result.failure !== 'unreachable' && result.failure !== 'cancelled',
        detail: { failure: result.failure, distance: result.distance },
      });
    }
    return ok(taskId, 'navigate', `arrived (${result.distance} blocks, ${result.durationMs}ms)`, {
      position: request.position,
      distance: result.distance,
      durationMs: result.durationMs,
    }, startedAt);
  }

  private async containerMove(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseContainerMove(payload);
    const target = request.target;
    if (!target) throw new BotError('container-move requires a target container position', { category: 'validation' });

    // Walk to the container if we are not already beside it.
    const position = this.context.position();
    if (position) {
      const distance = distanceBetween(position, target);
      if (distance > 4) {
        const walk = await this.context.navigation.walkTo(target, { range: 3 });
        if (!walk.reached) throw new BotError(`could not reach the container: ${walk.reason}`, { category: 'navigation' });
      }
    }

    const window = await this.context.container.open(target);
    try {
      const result = await this.context.container.moveOpen(request.direction, request.query, request.limit);
      return ok(taskId, 'container-move', `${request.direction} of "${request.query}": ${result.moved} stack(s) moved`, {
        direction: request.direction,
        query: request.query,
        moved: result.moved,
        verification: result.verification,
      }, startedAt);
    } finally {
      await this.context.container.close(window);
    }
  }

  private async shulkerPack(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseShulkerPack(payload);
    const categories = this.context.registries.categories.list();
    const records = classifyShulkers(this.context.shulkers.inspect(), categories);
    const target = request.hasSlot ? records.find((record) => record.slot === request.slot) : records.find((record) => !record.opaque && record.freeSlots > 0);
    if (!target) {
      throw new BotError('no shulker box with free space was found in the inventory', { category: 'container' });
    }
    if (target.opaque) {
      throw new BotError('the target shulker box could not be read, so it will not be filled blindly', { category: 'container' });
    }
    if (!this.context.openPlacedShulker) {
      throw new BotError('this worker cannot place shulker boxes to fill them on this server', { category: 'container', retryable: false });
    }

    // Filling a carried box means placing it, opening the resulting container, moving items in, then
    // breaking it again. The move is verified against the box's own reported contents.
    const before = this.context.shulkers.bySlot(target.slot);
    const handle = await this.context.openPlacedShulker(target.slot);
    try {
      const result = await this.context.container.moveOpen('deposit', request.query, request.limit);
      if (result.moved === 0) {
        throw new BotError(`nothing matching "${request.query}" was moved into the shulker box`, {
          category: 'container',
          mutation: 'none',
          retryable: false,
        });
      }
      return ok(taskId, 'shulker-pack', `packed ${result.moved} stack(s) of "${request.query}"`, {
        slot: target.slot,
        query: request.query,
        moved: result.moved,
        before: before ? fillOf(before) : 'unknown',
        verification: result.verification,
      }, startedAt);
    } finally {
      await handle.restore();
    }
  }

  private async shulkerUnpack(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseShulkerUnpack(payload);
    const categories = this.context.registries.categories.list();
    const records = classifyShulkers(this.context.shulkers.inspect(), categories);
    const target = request.hasSlot ? records.find((record) => record.slot === request.slot) : records.find((record) => fillOf(record) !== 'empty');
    if (!target) throw new BotError('no non-empty shulker box was found', { category: 'container' });

    const freeSlots = this.context.inventory.freeSlots();
    const assessment = assessUnpack(target, freeSlots);
    if (!assessment.safe) {
      throw new BotError(`refusing to unpack shulker slot ${target.slot}: ${assessment.reason}`, { category: 'container', retryable: false });
    }
    if (!this.context.openPlacedShulker) {
      throw new BotError('this worker cannot place shulker boxes to unpack them on this server', { category: 'container', retryable: false });
    }
    if (fillOf(target) === 'empty') {
      return ok(taskId, 'shulker-unpack', 'the shulker box is already empty', { slot: target.slot, moved: 0 }, startedAt);
    }

    const handle = await this.context.openPlacedShulker(target.slot);
    try {
      let moved = 0;
      for (const item of target.items) {
        const result = await this.context.container.moveOpen('withdraw', item.id, item.count);
        moved += result.moved;
      }
      return ok(taskId, 'shulker-unpack', `unpacked ${moved} stack(s) from the shulker box`, {
        slot: target.slot,
        moved,
      }, startedAt);
    } finally {
      await handle.restore();
    }
  }

  private async restock(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const request = parseRestock(payload);
    const carried = this.context.inventory.carried();
    const have = countIn(carried, request.query);
    if (have >= request.limit) {
      return ok(taskId, 'restock', `already carrying ${have} of "${request.query}"`, { query: request.query, have, moved: 0 }, startedAt);
    }

    const rules = this.context.registries.restockRules.list().filter((rule) => rule.query === request.query);
    const rule = rules[0] ?? { id: 'ad-hoc', query: request.query, minimum: request.limit, maximum: request.limit };
    const need = { ruleId: rule.id, query: request.query, have, minimum: rule.minimum, maximum: Math.max(rule.maximum, request.limit), shortfall: Math.max(0, rule.minimum - have) || request.limit - have };

    const containers = this.context.registries.containers.list();
    const sources = findSources(need, containers, this.readContainerContents(containers), (container) => distanceToContainer(this.context, container), rule);
    const plan = planRestock(need, sources, (id) => this.context.registries.containerById(id));
    if (plan.steps.length === 0) {
      throw new BotError(plan.reason, { category: 'container', retryable: false });
    }

    let moved = 0;
    for (const step of plan.steps) {
      if (!step.position) continue;
      const position = this.context.position();
      if (position) {
        const distance = distanceBetween(position, step.position);
        if (distance > 4) {
          const walk = await this.context.navigation.walkTo(step.position, { range: 3 });
          if (!walk.reached) throw new BotError(`could not reach ${step.label}: ${walk.reason}`, { category: 'navigation' });
        }
      }
      const before = this.context.inventory.carried();
      const window = await this.context.container.open(step.position);
      try {
        const result = await this.context.container.moveOpen('withdraw', step.query, step.amount);
        moved += result.moved;
      } finally {
        await this.context.container.close(window);
      }
      const after = this.context.inventory.carried();
      const verification = verifyCountChange(before, after, step.query, 1, 'increase');
      if (!verification.verified) {
        throw new BotError(`restock from ${step.label} was not confirmed: ${verification.note}`, {
          category: 'container',
          mutation: 'partial',
          retryable: false,
        });
      }
    }

    return ok(taskId, 'restock', `withdrew ${moved} stack(s) of "${request.query}"`, { query: request.query, have, moved }, startedAt);
  }

  /** Reads every registered container's contents, skipping ones that cannot be read right now. */
  private readContainerContents(containers: readonly ContainerRecord[]): Map<string, ItemStack[]> {
    const contents = new Map<string, ItemStack[]>();
    // Contents are only known for a container that has been read recently; anything else is unknown,
    // and an unknown source is deliberately not offered as a restock source.
    for (const container of containers) {
      if (container.lastSeenAt && Date.now() - container.lastSeenAt < 5 * 60_000) contents.set(container.id, []);
    }
    return contents;
  }

  private async command(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const command = String(payload.command ?? payload.line ?? '').trim();
    const validation = validateCommand(command);
    if (!validation.ok) throw new BotError(validation.reason ?? 'invalid command', { category: 'permission' });
    const normalized = command.startsWith('/') ? command : `/${command}`;
    this.context.sendChat(normalized);
    return ok(taskId, 'command', `sent ${normalized}`, { command: normalized }, startedAt);
  }

  private async chat(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const message = String(payload.message ?? payload.text ?? '').trim();
    const validation = validateChat(message);
    if (!validation.ok) throw new BotError(validation.reason ?? 'invalid chat line', { category: 'validation' });
    this.context.sendChat(message);
    return ok(taskId, 'chat', 'message sent', { message }, startedAt);
  }

  private async naturalLanguage(taskId: string, payload: Record<string, unknown>, startedAt: number): Promise<TaskResult> {
    const instruction = String(payload.instruction ?? payload.text ?? '').trim();
    if (!instruction) throw new BotError('nl-task requires an instruction', { category: 'validation' });
    if (!this.context.planner) throw new BotError('no AI planner is configured for this worker', { category: 'internal' });

    const plan = await this.context.planner.plan(instruction);
    const granted = Object.entries(this.context.config.permissions)
      .filter(([, value]) => value)
      .map(([key]) => key);
    const preview = previewPlan(plan, granted);

    if (preview.steps.length === 0) {
      return ok(taskId, 'nl-task', preview.summary, { plan: preview, executed: false }, startedAt);
    }
    if (preview.requiredPermissions.some((permission) => !granted.includes(permission))) {
      throw new BotError(preview.summary, { category: 'permission', detail: { required: preview.requiredPermissions } });
    }

    // Run the first (and, in this vocabulary, only) step through the normal executor so the
    // permission gate, verification and error translation all apply.
    const step = plan.steps[0]!;
    const nested = await this.execute({ kind: mapOperationToTask(step.operation), payload: step.arguments as Record<string, unknown>, id: `${taskId}.1` });
    return ok(taskId, 'nl-task', nested.message, { plan: preview, executed: true, result: nested }, startedAt);
  }
}

/** Maps a natural-language operation onto the concrete task kind that performs it. */
export function mapOperationToTask(operation: string): string {
  switch (operation) {
    case 'storage.sort':
    case 'storage.consolidate':
      return 'restock';
    case 'storage.search':
    case 'container.find':
      return 'search';
    case 'storage.count':
      return 'count';
    case 'storage.report':
      return 'status';
    case 'storage.move':
      return 'container-move';
    case 'shulker.fill':
      return 'shulker-pack';
    case 'shulker.unpack':
      return 'shulker-unpack';
    case 'shulker.inspect':
    case 'shulker.organise':
      return 'shulker-read';
    case 'restock.run':
      return 'restock';
    case 'restock.report':
      return 'status';
    case 'inventory.report':
    case 'inventory.search':
      return 'inventory';
    case 'container.read':
      return 'container-read';
    case 'container.emptiest':
    case 'container.fullest':
      return 'status';
    case 'navigation.goTo':
      return 'navigate';
    case 'portal.list':
    case 'portal.scan':
      return 'portal-scan';
    case 'structure.list':
    case 'structure.audit':
    case 'structure.preview':
      return 'status';
    case 'maintenance.run':
      return 'restock';
    case 'crafting.plan':
    case 'disposal.plan':
    case 'worker.assign':
      return 'status';
    case 'status.report':
    default:
      return 'status';
  }
}
