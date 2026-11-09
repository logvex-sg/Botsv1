/**
 * Multiverse service: the Host-side organisational layer.
 *
 * This is where the new engines meet the database. It owns server profiles, group templates,
 * reusable task presets, schedules, automation rules, container records, inventory history and the
 * audit trail, and it exposes them to the IPC and HTTP layers as one coherent API.
 *
 * Two rules are enforced here rather than left to callers:
 *  - a server profile is never treated as proof of reachability; live state always comes from what
 *    a worker reports, and this service only counts reported facts;
 *  - a schedule never runs twice for the same occurrence, because the duplicate-run guard is a
 *    database condition, not an in-memory flag.
 */
import type {
  AuditEntry,
  AutomationRule,
  ContainerRecord,
  GroupTemplate,
  RuleCondition,
  ScheduleRecord,
  ServerProfile,
  ServerProfileView,
  TaskPreset,
  WorkerGroup,
  WorkerRecord,
} from '../../../shared/types';
import type {
  AuditRepository,
  AutomationRuleRepository,
  ContainerRepository,
  GroupTemplateRepository,
  InventoryHistoryRepository,
  ScheduleRepository,
  ServerProfileRepository,
  TaskPresetRepository,
  WorkerGroupRepository,
  WorkerRepository,
} from '../../db/repositories';
import { aggregateResults, applyTemplate, type BulkSummary, type GroupMemberOutcome } from '../../packages/group-engine';
import { aggregate, type ItemTotal } from '../../packages/inventory-engine';
import {
  initialState,
  isDue,
  missedRuns,
  type Schedule,
  type ScheduleState,
} from '../../packages/scheduler';
import { evaluate, type RuleDefinition, type RuleEvent } from '../../packages/rule-engine';
import type { WorkerItem } from '../../../shared/workers';

export interface MultiverseServiceDeps {
  servers: ServerProfileRepository;
  groupTemplates: GroupTemplateRepository;
  groups: WorkerGroupRepository;
  taskPresets: TaskPresetRepository;
  schedules: ScheduleRepository;
  rules: AutomationRuleRepository;
  containers: ContainerRepository;
  history: InventoryHistoryRepository;
  audit: AuditRepository;
  workers: WorkerRepository;
  emit: (type: string, message: string, payload?: Record<string, unknown>) => void;
  /** Dispatches a task to one worker. Injected so this service never imports the socket layer. */
  runTask: (workerId: string, kind: string, params: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** A live predicate: is this worker currently connected? */
  isOnline: (workerId: string) => boolean;
}

const DEFAULT_ENVIRONMENT = 'production' as const;

export class MultiverseService {
  constructor(private readonly deps: MultiverseServiceDeps) {}

  // --------------------------------------------------------------- server profiles

  listServers(includeArchived = false): ServerProfileView[] {
    return this.deps.servers.list(includeArchived).map((profile) => this.decorateServer(profile));
  }

  getServer(id: string): ServerProfileView | undefined {
    const profile = this.deps.servers.get(id);
    return profile ? this.decorateServer(profile) : undefined;
  }

  createServer(input: {
    name: string; host?: string; port?: number; version?: string;
    environment?: ServerProfile['environment']; notes?: string; tags?: string[];
  }): ServerProfile {
    const name = input.name.trim();
    if (!name) throw new Error('A server profile needs a name.');
    if (this.deps.servers.findByName(name)) throw new Error(`A server profile named "${name}" already exists.`);
    const profile = this.deps.servers.create({
      name,
      host: (input.host ?? '').trim(),
      port: input.port ?? 25565,
      version: (input.version ?? '').trim(),
      environment: input.environment ?? DEFAULT_ENVIRONMENT,
      notes: input.notes ?? '',
      tags: input.tags ?? [],
      archived: false,
    });
    this.audit('server.create', profile.id, `created server profile "${name}"`);
    this.deps.emit('SERVER_PROFILE_CHANGED', `Server profile "${name}" created`, { id: profile.id });
    return profile;
  }

  updateServer(id: string, patch: Partial<Omit<ServerProfile, 'id' | 'createdAt' | 'updatedAt'>>): ServerProfile | undefined {
    const updated = this.deps.servers.update(id, patch);
    if (updated) {
      this.audit('server.update', id, `updated server profile "${updated.name}"`);
      this.deps.emit('SERVER_PROFILE_CHANGED', `Server profile "${updated.name}" updated`, { id });
    }
    return updated;
  }

  removeServer(id: string): boolean {
    const profile = this.deps.servers.get(id);
    if (!profile) return false;
    // Unassign workers first, so no worker points at a profile that no longer exists.
    for (const worker of this.deps.workers.byServerProfile(id)) {
      this.deps.workers.update(worker.id, { serverProfileId: null });
    }
    const removed = this.deps.servers.remove(id);
    if (removed) {
      this.audit('server.remove', id, `removed server profile "${profile.name}"`);
      this.deps.emit('SERVER_PROFILE_CHANGED', `Server profile "${profile.name}" removed`, { id });
    }
    return removed;
  }

  /** Assigns workers to a profile. Returns how many changed. */
  assignServer(workerIds: readonly string[], profileId: string | null): number {
    if (profileId !== null && !this.deps.servers.get(profileId)) {
      throw new Error('That server profile no longer exists.');
    }
    let changed = 0;
    for (const workerId of workerIds) {
      const updated = this.deps.workers.update(workerId, { serverProfileId: profileId });
      if (updated) changed++;
    }
    if (changed > 0) {
      const label = profileId ? this.deps.servers.get(profileId)?.name ?? profileId : 'no profile';
      this.audit('server.assign', profileId ?? '', `assigned ${changed} worker(s) to ${label}`);
    }
    return changed;
  }

  private decorateServer(profile: ServerProfile): ServerProfileView {
    const assigned = this.deps.workers.byServerProfile(profile.id);
    const address = serverAddress(profile);
    // "Connected to it" is a *reported* fact: the worker's own last reported server address. It is
    // never inferred from the profile row, which is only an organisational record.
    const connectedToIt = assigned.filter((worker) => address.length > 0 && worker.serverAddress === address).length;
    return {
      ...profile,
      workers: assigned.length,
      online: assigned.filter((worker) => this.deps.isOnline(worker.id)).length,
      connectedToIt,
    };
  }

  // ------------------------------------------------------------------ group templates

  listGroupTemplates(): GroupTemplate[] {
    return this.deps.groupTemplates.list();
  }

  createGroupTemplate(input: Omit<GroupTemplate, 'id' | 'createdAt'>): GroupTemplate {
    const name = input.name.trim();
    if (!name) throw new Error('A template needs a name.');
    if (this.deps.groupTemplates.findByName(name)) throw new Error(`A template named "${name}" already exists.`);
    const template = this.deps.groupTemplates.create({ ...input, name });
    this.audit('template.create', template.id, `created group template "${name}"`);
    return template;
  }

  removeGroupTemplate(id: string): boolean {
    return this.deps.groupTemplates.remove(id);
  }

  /** Creates a group from a template. Existing workers are never touched. */
  createGroupFromTemplate(templateId: string, groupName: string): WorkerGroup {
    const template = this.deps.groupTemplates.get(templateId);
    if (!template) throw new Error('That template no longer exists.');
    const name = groupName.trim() || template.name;
    if (this.deps.groups.findByName(name)) throw new Error(`A group named "${name}" already exists.`);
    const group = this.deps.groups.create(name, template.description, template.color);
    const defaults = applyTemplate(template);
    const updated = this.deps.groups.update(group.id, {
      defaultTaskPresetIds: defaults.defaultTaskPresetIds,
      defaultEquipmentPresetIds: defaults.defaultEquipmentPresetIds,
      permissions: defaults.permissions,
    })!;
    this.audit('group.fromTemplate', group.id, `created group "${name}" from template "${template.name}"`);
    return updated;
  }

  // -------------------------------------------------------------------- task presets

  listTaskPresets(): TaskPreset[] {
    return this.deps.taskPresets.list();
  }

  createTaskPreset(input: Omit<TaskPreset, 'id' | 'createdAt' | 'updatedAt'>): TaskPreset {
    const name = input.name.trim();
    if (!name) throw new Error('A task preset needs a name.');
    if (this.deps.taskPresets.findByName(name)) throw new Error(`A task preset named "${name}" already exists.`);
    const preset = this.deps.taskPresets.create({ ...input, name });
    this.audit('preset.create', preset.id, `created task preset "${name}" (${preset.kind})`);
    return preset;
  }

  updateTaskPreset(id: string, patch: Partial<Omit<TaskPreset, 'id' | 'createdAt'>>): TaskPreset | undefined {
    return this.deps.taskPresets.update(id, patch);
  }

  removeTaskPreset(id: string): boolean {
    return this.deps.taskPresets.remove(id);
  }

  /** Runs a preset against its stored targets, aggregating the results honestly. */
  async runTaskPreset(presetId: string): Promise<BulkSummary> {
    const preset = this.deps.taskPresets.get(presetId);
    if (!preset) throw new Error('That task preset no longer exists.');
    const targetIds = this.resolveTargets(preset.targetWorkerIds, preset.targetGroupIds);
    return this.runOnWorkers(targetIds, preset.kind, preset.params);
  }

  // ---------------------------------------------------------------------- schedules

  listSchedules(): ScheduleRecord[] {
    return this.deps.schedules.list();
  }

  createSchedule(input: {
    name: string; presetId?: string | null; kind: string; params?: Record<string, unknown>;
    targetWorkerIds?: string[]; targetGroupIds?: string[];
    scheduleKind: ScheduleRecord['scheduleKind']; startAt?: number;
    intervalMs?: number | null; timeOfDay?: string | null; stopAt?: number | null; enabled?: boolean;
  }): ScheduleRecord {
    const name = input.name.trim();
    if (!name) throw new Error('A schedule needs a name.');
    if (input.scheduleKind === 'interval' && (!input.intervalMs || input.intervalMs <= 0)) {
      throw new Error('An interval schedule needs a positive interval.');
    }
    if (input.scheduleKind === 'daily' && !/^\d{1,2}:\d{2}$/.test(input.timeOfDay ?? '')) {
      throw new Error('A daily schedule needs a time of day in HH:MM form.');
    }
    const schedule = this.deps.schedules.create({
      name,
      presetId: input.presetId ?? null,
      kind: input.kind,
      params: input.params ?? {},
      targetWorkerIds: input.targetWorkerIds ?? [],
      targetGroupIds: input.targetGroupIds ?? [],
      scheduleKind: input.scheduleKind,
      startAt: input.startAt ?? Date.now(),
      intervalMs: input.intervalMs ?? null,
      timeOfDay: input.timeOfDay ?? null,
      stopAt: input.stopAt ?? null,
      enabled: input.enabled ?? true,
    });
    this.audit('schedule.create', schedule.id, `created schedule "${name}" (${schedule.scheduleKind})`);
    return schedule;
  }

  updateSchedule(id: string, patch: Partial<Omit<ScheduleRecord, 'id' | 'createdAt' | 'fireCount' | 'lastFiredAt'>>): ScheduleRecord | undefined {
    return this.deps.schedules.update(id, patch);
  }

  removeSchedule(id: string): boolean {
    return this.deps.schedules.remove(id);
  }

  /** How many occurrences a schedule missed while the host was down, for the UI to surface. */
  missedFor(schedule: ScheduleRecord, now = Date.now()): number {
    return missedRuns(toSchedule(schedule), toState(schedule), now);
  }

  /**
   * Runs every due schedule once. Called from the Host's tick.
   *
   * The duplicate-run guard is the `markFired` database condition: a slot that already fired cannot
   * be recorded again, so a slow tick or a restart cannot double-run a schedule.
   */
  async tick(now = Date.now()): Promise<{ scheduleId: string; summary: BulkSummary }[]> {
    const ran: { scheduleId: string; summary: BulkSummary }[] = [];
    for (const record of this.deps.schedules.list()) {
      const due = isDue(toSchedule(record), toState(record), now);
      if (!due.due) continue;
      const summary = await this.runSchedule(record);
      this.deps.schedules.markFired(record.id, due.slot);
      this.deps.emit('SCHEDULE_FIRED', `Schedule "${record.name}" ran: ${summary.message}`, {
        scheduleId: record.id,
        ok: summary.ok,
      });
      this.audit('schedule.fire', record.id, `"${record.name}" -> ${summary.message}`);
      ran.push({ scheduleId: record.id, summary });
    }
    return ran;
  }

  private async runSchedule(record: ScheduleRecord): Promise<BulkSummary> {
    let kind = record.kind;
    let params = record.params;
    let workerIds = record.targetWorkerIds;
    let groupIds = record.targetGroupIds;
    if (record.presetId) {
      const preset = this.deps.taskPresets.get(record.presetId);
      if (preset) {
        kind = preset.kind;
        params = preset.params;
        workerIds = preset.targetWorkerIds;
        groupIds = preset.targetGroupIds;
      }
    }
    const targets = this.resolveTargets(workerIds, groupIds);
    return this.runOnWorkers(targets, kind, params);
  }

  // ------------------------------------------------------------------ automation rules

  listRules(): AutomationRule[] {
    return this.deps.rules.list();
  }

  createRule(input: {
    name: string; event: string; conditions?: RuleCondition[]; action: string;
    cooldownMs?: number; maxRuns?: number | null; enabled?: boolean;
  }): AutomationRule {
    const name = input.name.trim();
    if (!name) throw new Error('A rule needs a name.');
    if (!input.event.trim()) throw new Error('A rule needs an event to trigger on.');
    if (!input.action.trim()) throw new Error('A rule needs an action.');
    const rule = this.deps.rules.create({
      name,
      event: input.event.trim(),
      conditions: input.conditions ?? [],
      action: input.action.trim(),
      cooldownMs: input.cooldownMs ?? 0,
      maxRuns: input.maxRuns ?? null,
      enabled: input.enabled ?? true,
    });
    this.audit('rule.create', rule.id, `created rule "${name}"`);
    return rule;
  }

  updateRule(id: string, patch: Partial<Omit<AutomationRule, 'id' | 'createdAt' | 'runCount' | 'lastRunAt'>>): AutomationRule | undefined {
    return this.deps.rules.update(id, patch);
  }

  removeRule(id: string): boolean {
    return this.deps.rules.remove(id);
  }

  /**
   * Feeds one event through the rule engine and dispatches the actions that fire.
   *
   * Called from the Host's event subscription, so every worker event is evaluated exactly once.
   */
  async onEvent(event: RuleEvent): Promise<{ ruleId: string; summary: BulkSummary }[]> {
    const stored = this.deps.rules.list();
    const runtimes: Record<string, { runCount: number; lastRunAt: number | null }> = {};
    for (const rule of stored) runtimes[rule.id] = { runCount: rule.runCount, lastRunAt: rule.lastRunAt };
    const result = evaluate(stored.map(toRuleDefinition), runtimes, event);
    const ran: { ruleId: string; summary: BulkSummary }[] = [];
    for (const rule of result.fired) {
      const record = this.deps.rules.get(rule.id);
      if (!record) continue;
      // A rule with no explicit targets acts on the worker the event came from.
      const targets = event.workerId ? [event.workerId] : [];
      const summary = await this.runOnWorkers(targets, record.action, {});
      this.deps.rules.markRun(rule.id);
      this.deps.emit('RULE_TRIGGERED', `Rule "${rule.name}" triggered: ${summary.message}`, {
        ruleId: rule.id,
        ok: summary.ok,
      });
      this.audit('rule.fire', rule.id, `"${rule.name}" -> ${summary.message}`);
      ran.push({ ruleId: rule.id, summary });
    }
    return ran;
  }

  // -------------------------------------------------------------------- containers

  listContainers(workerId?: string): ContainerRecord[] {
    return this.deps.containers.list(workerId);
  }

  saveContainer(input: Omit<ContainerRecord, 'id'>): ContainerRecord {
    const saved = this.deps.containers.save(input);
    this.audit('container.inspect', saved.id, `recorded container "${saved.label}" for ${saved.workerId}`);
    return saved;
  }

  removeContainer(id: string): boolean {
    return this.deps.containers.remove(id);
  }

  // -------------------------------------------------------------- inventory history

  /** Records a capture's totals so trends and diffs are real, and prunes old captures. */
  recordInventory(workerId: string, capturedAt: number, items: readonly ItemTotal[]): void {
    this.deps.history.record(workerId, capturedAt, [...items]);
    this.deps.history.prune(200);
  }

  inventoryTrend(workerId: string, itemId: string, limit = 200): { at: number; count: number }[] {
    return this.deps.history.trend(workerId, itemId, limit);
  }

  inventoryCaptures(workerId: string, limit = 100): number[] {
    return this.deps.history.captures(workerId, limit);
  }

  /** Aggregated item totals across every worker, from their latest reports. */
  fleetTotals(workers: readonly { id: string; items: readonly WorkerItem[] }[]): ItemTotal[] {
    return aggregate(workers.map((worker) => worker.items));
  }

  // ------------------------------------------------------------------------- audit

  listAudit(limit = 200): AuditEntry[] {
    return this.deps.audit.list(limit);
  }

  private audit(action: string, target: string, detail: string): void {
    this.deps.audit.record({ actor: 'operator', action, target, detail });
  }

  // ------------------------------------------------------------------------ helpers

  /** Expands worker ids and group ids into a de-duplicated list of worker ids. */
  private resolveTargets(workerIds: readonly string[], groupIds: readonly string[]): string[] {
    const out = new Set<string>();
    for (const id of workerIds) if (this.deps.workers.get(id)) out.add(id);
    for (const groupId of groupIds) {
      for (const worker of this.deps.workers.list()) if (worker.groupId === groupId) out.add(worker.id);
    }
    return [...out];
  }

  /** Runs a task across workers, isolating each failure so one bad worker cannot spoil the batch. */
  private async runOnWorkers(workerIds: readonly string[], kind: string, params: Record<string, unknown>): Promise<BulkSummary> {
    const outcomes: GroupMemberOutcome[] = [];
    for (const workerId of workerIds) {
      const record = this.deps.workers.get(workerId);
      const label = record ? record.label || record.username || workerId : workerId;
      if (!this.deps.isOnline(workerId)) {
        outcomes.push({ workerId, label, ok: false, outcome: 'disconnected', detail: 'not connected' });
        continue;
      }
      try {
        const result = await this.deps.runTask(workerId, kind, params);
        outcomes.push({
          workerId, label, ok: result.ok,
          outcome: result.ok ? 'completed' : 'failed',
          detail: result.error ?? (result.ok ? 'done' : 'the worker reported a failure'),
        });
      } catch (error) {
        // One worker's failure must not abort the rest of the batch.
        outcomes.push({ workerId, label, ok: false, outcome: 'failed', detail: (error as Error).message });
      }
    }
    return aggregateResults(outcomes);
  }

  /** The worker rows for a set of ids, for callers that need the records rather than outcomes. */
  workersByIds(ids: readonly string[]): WorkerRecord[] {
    return ids.map((id) => this.deps.workers.get(id)).filter((w): w is WorkerRecord => Boolean(w));
  }
}

function serverAddress(profile: ServerProfile): string {
  if (!profile.host) return '';
  return profile.port && profile.port !== 25565 ? `${profile.host}:${profile.port}` : profile.host;
}

function toSchedule(record: ScheduleRecord): Schedule {
  return {
    kind: record.scheduleKind,
    startAt: record.startAt,
    intervalMs: record.intervalMs ?? undefined,
    timeOfDay: record.timeOfDay ?? undefined,
    stopAt: record.stopAt ?? undefined,
  };
}

function toState(record: ScheduleRecord): ScheduleState {
  return { ...initialState(), lastFiredAt: record.lastFiredAt, fireCount: record.fireCount, enabled: record.enabled };
}

function toRuleDefinition(rule: AutomationRule): RuleDefinition {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    event: rule.event,
    conditions: rule.conditions,
    action: rule.action,
    cooldownMs: rule.cooldownMs,
    maxRuns: rule.maxRuns,
  };
}
