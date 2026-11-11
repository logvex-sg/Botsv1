/**
 * IPC handler registration.
 *
 * Every renderer action is a thin wrapper over the application context. Handlers are registered
 * once at startup; the renderer never reaches into the main process directly. Errors are returned
 * as rejected promises so the UI can surface them.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import type { AppContext } from '../context';
import type { ApiServer } from '../api/server';
import type { RegearPreset, WorkerInventorySnapshot, WorkerModePatch } from '../../shared/types';
import type { ControlAction, TaskKind } from '../../shared/workers';
import { buildStatistics, statisticsToCsv, type StatisticsInput } from '../packages/statistics';

export function registerIpc(context: AppContext, api: ApiServer, getWindow: () => BrowserWindow | null): void {
  const handle = <T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as never[])));
  };

  // --------------------------------------------------------------- system
  handle('system:health', () => context.healthReport());
  handle('system:settings:get', () => context.getSettings());
  handle('system:settings:save', (patch: Partial<import('../../shared/types').AppSettings>) => context.saveSettings(patch));
  handle('system:api-token', () => api.token);
  handle('system:api-token:regenerate', () => {
    const token = api.regenerateToken();
    context.regenerateApiToken();
    context.emitEvent('SYSTEM', 'API token regenerated');
    return token;
  });
  handle('system:export', () => exportConfig(context, getWindow()));
  handle('system:import', () => importConfig(context, getWindow()));

  // ---------------------------------------------------------- host pairing
  handle('host:pairing:get', () => context.currentPairingCode());
  handle('host:pairing:status', () => context.pairingStatus());
  handle('host:pairing:create', () => context.createPairingCode());
  handle('host:pairing:clear', () => {
    context.clearPairingCode();
    return true;
  });
  handle('host:pairing:revoke', (workerId: string) => context.revokeWorker(workerId));
  handle('host:pairing:allow', (workerId: string) => context.allowWorker(workerId));

  // --------------------------------------------------------- worker server
  handle('workers:server:get', () => ({
    enabled: context.getSettings().workerServerEnabled,
    host: context.getSettings().workerServerHost,
    port: context.workers.server.port || context.getSettings().workerServerPort,
    bound: context.workers.server.running,
    token: context.getWorkerToken(),
  }));
  handle('workers:server:token', () => context.regenerateWorkerToken());

  // ---------------------------------------------------------------- workers
  handle('workers:list', () => context.workers.list());
  handle('workers:get', (workerId: string) => context.workers.get(workerId));
  handle('workers:overview', () => context.workers.overview());
  handle('workers:label', (workerId: string, label: string) => context.workers.setLabel(workerId, label));
  handle('workers:notes', (workerId: string, notes: string) => context.workers.setNotes(workerId, notes));
  handle('workers:forget', (workerId: string) => context.workers.forget(workerId));
  handle('workers:ping', (workerId: string) => context.workers.server.ping(workerId));
  handle('workers:kick', (workerId: string, reason: string) => context.workers.server.kick(workerId, reason || 'removed by the operator'));
  handle('workers:control', (workerId: string, action: ControlAction) => context.workers.sendControl(workerId, action));
  handle('workers:connect', (workerId: string) => context.workers.connect(workerId));
  handle('workers:disconnect', (workerId: string) => context.workers.disconnect(workerId));
  handle('workers:restart', (workerId: string) => context.workers.restart(workerId));
  handle('workers:pause', (workerId: string) => context.workers.pause(workerId));
  handle('workers:resume', (workerId: string) => context.workers.resume(workerId));

  // Worker Mode: this machine acting as a worker. Separate from the host handlers above.
  handle('worker-mode:settings', () => context.workerMode.getSettings());
  handle('worker-mode:save', (patch: WorkerModePatch) => context.workerMode.saveSettings(patch));
  handle('worker-mode:status', () => context.workerMode.status());
  handle('worker-mode:logs', () => context.workerMode.recentLogs());
  handle('worker-mode:connect', () => context.workerMode.connect());
  handle('worker-mode:disconnect', () => context.workerMode.disconnect());
  handle('worker-mode:test', (overrides?: WorkerModePatch) => context.workerMode.test(overrides));
  handle('worker-mode:provision', (directory: string) => context.workerMode.provision(directory));

  // ----------------------------------------------------------- worker groups
  handle('worker-groups:list', () => context.workers.listGroups());
  handle('worker-groups:create', (name: string, description?: string, color?: string) =>
    context.workers.createGroup(name, description ?? '', color ?? '#6d5efc'));
  handle('worker-groups:update', (id: string, patch: { name?: string; description?: string; color?: string }) =>
    context.workers.updateGroup(id, patch));
  handle('worker-groups:delete', (id: string) => context.workers.removeGroup(id));
  handle('worker-groups:assign', (workerId: string, groupId: string | null) => context.workers.assignGroup(workerId, groupId));
  handle('worker-groups:assign-bulk', (workerIds: string[], groupId: string | null) =>
    context.workers.assignGroupBulk(workerIds, groupId));

  // ------------------------------------------------------------------ tasks
  handle('worker-tasks:run', (workerId: string, kind: string, params?: Record<string, unknown>) =>
    context.workers.runTask(workerId, kind as TaskKind, params ?? {}));
  handle('worker-tasks:run-many', (workerIds: string[], kind: string, params?: Record<string, unknown>) =>
    context.workers.runTaskMany(workerIds, kind as TaskKind, params ?? {}));
  handle('worker-tasks:list', (limit?: number, workerId?: string) => context.workers.listTasks(limit ?? 200, workerId));
  handle('worker-tasks:kinds', () => [...context.workers.taskKinds()]);

  // ---------------------------------------------------------------- console
  handle('worker-console:get', (workerId: string) => context.workers.console(workerId));
  handle('worker-console:clear', (workerId: string) => { context.workers.clearConsole(workerId); });
  handle('worker-console:capabilities', (workerId: string) => context.workers.get(workerId)?.capabilities ?? []);

  // ------------------------------------------------------ commands / chat
  handle('worker-commands:send', (workerId: string, kind: 'command' | 'chat', line: string) =>
    context.workers.sendLine(workerId, kind, line));
  handle('worker-commands:send-many', (workerIds: string[], kind: 'command' | 'chat', line: string) =>
    context.workers.sendLineMany(workerIds, kind, line));
  handle('worker-commands:list', (limit?: number, workerId?: string) => context.workers.listCommands(limit ?? 200, workerId));

  // -------------------------------------------------------------- inventory
  handle('worker-inventory:get', (workerId: string) => context.workers.inventory(workerId));
  handle('worker-inventory:count', (query: string, workerIds?: string[]) => context.workers.countItem(query, workerIds));
  handle('worker-inventory:totals', (workerIds?: string[]) => context.workers.combinedTotals(workerIds));
  handle('worker-inventory:export', (format: 'json' | 'csv') => exportWorkerReport(context, getWindow(), format));

  // ----------------------------------------------------------------- regear
  handle('regear:list', () => context.workers.listPresets());
  handle('regear:create', (input: RegearPreset) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = input;
    return context.workers.createPreset(rest);
  });
  handle('regear:update', (id: string, patch: Partial<RegearPreset>) => context.workers.updatePreset(id, patch));
  handle('regear:delete', (id: string) => context.workers.removePreset(id));
  handle('regear:compare', (workerId: string, presetId: string) => context.workers.comparePreset(workerId, presetId));
  handle('regear:run', (workerId: string, presetId: string, allowMoves?: boolean) =>
    context.workers.regear(workerId, presetId, allowMoves === true));
  handle('regear:run-many', (workerIds: string[], presetId: string, allowMoves?: boolean) =>
    context.workers.regearMany(workerIds, presetId, allowMoves === true));

  // ------------------------------------------------------ events / notes
  handle('events:list', (limit?: number) => context.bus.recentEvents(limit ?? 200));
  handle('notifications:list', () => context.notifications.list());
  handle('notifications:read', (id: string) => context.notifications.markRead(id));
  handle('notifications:read-all', () => {
    context.notifications.markAllRead();
    return true;
  });

  // ------------------------------------------------------------ multiverse
  const mv = context.multiverse;

  // server profiles
  handle('mv:servers:list', (includeArchived?: boolean) => mv.listServers(includeArchived === true));
  handle('mv:servers:get', (id: string) => mv.getServer(id));
  handle('mv:servers:create', (input: Parameters<typeof mv.createServer>[0]) => mv.createServer(input));
  handle('mv:servers:update', (id: string, patch: Parameters<typeof mv.updateServer>[1]) => mv.updateServer(id, patch));
  handle('mv:servers:delete', (id: string) => mv.removeServer(id));
  handle('mv:servers:assign', (workerIds: string[], profileId: string | null) => mv.assignServer(workerIds, profileId));

  // group templates
  handle('mv:templates:list', () => mv.listGroupTemplates());
  handle('mv:templates:create', (input: Parameters<typeof mv.createGroupTemplate>[0]) => mv.createGroupTemplate(input));
  handle('mv:templates:delete', (id: string) => mv.removeGroupTemplate(id));
  handle('mv:templates:apply', (templateId: string, groupName: string) => mv.createGroupFromTemplate(templateId, groupName));

  // task presets
  handle('mv:presets:list', () => mv.listTaskPresets());
  handle('mv:presets:create', (input: Parameters<typeof mv.createTaskPreset>[0]) => mv.createTaskPreset(input));
  handle('mv:presets:update', (id: string, patch: Parameters<typeof mv.updateTaskPreset>[1]) => mv.updateTaskPreset(id, patch));
  handle('mv:presets:delete', (id: string) => mv.removeTaskPreset(id));
  handle('mv:presets:run', (id: string) => mv.runTaskPreset(id));

  // schedules
  handle('mv:schedules:list', () => mv.listSchedules().map((schedule) => ({ ...schedule, missed: mv.missedFor(schedule) })));
  handle('mv:schedules:create', (input: Parameters<typeof mv.createSchedule>[0]) => mv.createSchedule(input));
  handle('mv:schedules:update', (id: string, patch: Parameters<typeof mv.updateSchedule>[1]) => mv.updateSchedule(id, patch));
  handle('mv:schedules:delete', (id: string) => mv.removeSchedule(id));
  handle('mv:schedules:tick', () => mv.tick());

  // automation rules
  handle('mv:rules:list', () => mv.listRules());
  handle('mv:rules:create', (input: Parameters<typeof mv.createRule>[0]) => mv.createRule(input));
  handle('mv:rules:update', (id: string, patch: Parameters<typeof mv.updateRule>[1]) => mv.updateRule(id, patch));
  handle('mv:rules:delete', (id: string) => mv.removeRule(id));

  // containers
  handle('mv:containers:list', (workerId?: string) => mv.listContainers(workerId));
  handle('mv:containers:delete', (id: string) => mv.removeContainer(id));

  // inventory history
  handle('mv:history:trend', (workerId: string, itemId: string, limit?: number) => mv.inventoryTrend(workerId, itemId, limit));
  handle('mv:history:captures', (workerId: string, limit?: number) => mv.inventoryCaptures(workerId, limit));

  // worker tags
  handle('mv:tags:add', (workerId: string, tag: string) => context.workers.addTag(workerId, tag));
  handle('mv:tags:remove', (workerId: string, tag: string) => context.workers.removeTag(workerId, tag));
  handle('mv:tags:set', (workerId: string, tags: string[]) => context.workers.setTags(workerId, tags));
  handle('mv:tags:all', () => context.workers.allTags());

  // audit
  handle('mv:audit:list', (limit?: number) => mv.listAudit(limit ?? 200));

  // --------------------------------------------------------------- statistics
  handle('stats:get', () => buildStatistics(statisticsInput(context)));
  handle('stats:export', (format: 'json' | 'csv') => exportStatistics(context, getWindow(), format));

  // -------------------------------------------- autonomous storage & maintenance
  const storage = context.storage;
  handle('storage:overview', () => storage.overview());
  handle('storage:report', () => storage.maintenanceReport());

  handle('storage:networks:list', () => storage.listNetworks());
  handle('storage:networks:create', (input: Parameters<typeof storage.createNetwork>[0]) => storage.createNetwork(input));
  handle('storage:networks:update', (id: string, patch: Parameters<typeof storage.updateNetwork>[1]) => storage.updateNetwork(id, patch));
  handle('storage:networks:delete', (id: string) => storage.removeNetwork(id));
  handle('storage:networks:pause', (id: string, paused: boolean) => storage.setNetworkPaused(id, paused));

  handle('storage:categories:list', () => storage.listCategories());
  handle('storage:categories:create', (input: Parameters<typeof storage.createCategory>[0]) => storage.createCategory(input));
  handle('storage:categories:update', (id: string, patch: Parameters<typeof storage.updateCategory>[1]) => storage.updateCategory(id, patch));
  handle('storage:categories:delete', (id: string) => storage.removeCategory(id));

  handle('storage:containers:list', (networkId?: string) => storage.listContainers(networkId));
  handle('storage:containers:create', (input: Parameters<typeof storage.createContainer>[0]) => storage.createContainer(input));
  handle('storage:containers:update', (id: string, patch: Parameters<typeof storage.updateContainer>[1]) => storage.updateContainer(id, patch));
  handle('storage:containers:delete', (id: string) => storage.removeContainer(id));

  handle('storage:restock:list', (networkId?: string) => storage.listRestockRules(networkId));
  handle('storage:restock:create', (input: Parameters<typeof storage.createRestockRule>[0]) => storage.createRestockRule(input));
  handle('storage:restock:update', (id: string, patch: Parameters<typeof storage.updateRestockRule>[1]) => storage.updateRestockRule(id, patch));
  handle('storage:restock:delete', (id: string) => storage.removeRestockRule(id));

  handle('storage:disposal:list', () => storage.listDisposalRules());
  handle('storage:disposal:create', (input: Parameters<typeof storage.createDisposalRule>[0]) => storage.createDisposalRule(input));
  handle('storage:disposal:update', (id: string, patch: Parameters<typeof storage.updateDisposalRule>[1]) => storage.updateDisposalRule(id, patch));
  handle('storage:disposal:delete', (id: string) => storage.removeDisposalRule(id));

  handle('storage:portals:list', () => storage.listPortals());
  handle('storage:portals:groups', () => storage.portalGroups());
  handle('storage:portals:flagged', () => storage.flaggedPortals());
  handle('storage:portals:preview-removal', (ids: string[]) => storage.previewPortalRemoval(ids));
  handle('storage:portals:create', (input: Parameters<typeof storage.createPortal>[0]) => storage.createPortal(input));
  handle('storage:portals:update', (id: string, patch: Parameters<typeof storage.updatePortal>[1]) => storage.updatePortal(id, patch));
  handle('storage:portals:delete', (id: string) => storage.removePortal(id));

  handle('storage:structures:list', () => storage.listStructures());
  handle('storage:structures:issues', () => storage.structureIssues());
  handle('storage:structures:counts', () => storage.structureCounts());
  handle('storage:structures:preview-change', (region: Parameters<typeof storage.previewStructureChange>[0], options?: Parameters<typeof storage.previewStructureChange>[1]) => storage.previewStructureChange(region, options));
  handle('storage:structures:create', (input: Parameters<typeof storage.createStructure>[0]) => storage.createStructure(input));
  handle('storage:structures:update', (id: string, patch: Parameters<typeof storage.updateStructure>[1]) => storage.updateStructure(id, patch));
  handle('storage:structures:delete', (id: string) => storage.removeStructure(id));

  handle('storage:shulkers:list', (workerId?: string) => storage.listShulkers(workerId));
  handle('storage:shulkers:suggestions', () => storage.shulkerSuggestions());
  handle('storage:shulkers:update', (id: string, patch: Parameters<typeof storage.updateShulker>[1]) => storage.updateShulker(id, patch));

  handle('storage:workflows:list', () => storage.listWorkflows());
  handle('storage:workflows:operations', () => storage.operations());
  handle('storage:workflows:create', (input: Parameters<typeof storage.createWorkflow>[0]) => storage.createWorkflow(input));
  handle('storage:workflows:update', (id: string, patch: Parameters<typeof storage.updateWorkflow>[1]) => storage.updateWorkflow(id, patch));
  handle('storage:workflows:delete', (id: string) => storage.removeWorkflow(id));

  handle('storage:plan', (operation: string, networkId?: string | null, options?: { workerId?: string; portalIds?: string[] }) => storage.plan(operation, networkId, options));
  handle('storage:plans:list', () => storage.listPlans());
  handle('storage:plans:approve', (id: string) => storage.approvePlan(id));
  handle('storage:plans:execute', (id: string) => storage.executePlan(id));
  handle('storage:plans:discard', (id: string) => storage.discardPlan(id));

  handle('storage:restock:needs', (workerId: string, networkId?: string | null) => storage.restockNeeds(workerId, networkId));
  handle('storage:restock:plan', (workerId: string, networkId?: string | null) => storage.restockPlan(workerId, networkId));
  handle('storage:disposal:preview', (workerId: string, networkId?: string | null) => storage.disposalPreview(workerId, networkId));

  handle('storage:activity', (limit?: number, workerId?: string) => storage.listActivity(limit ?? 200, workerId));
  handle('storage:ask', (request: string) => storage.ask(request));

  handle('storage:profiles:list', () => storage.listProfiles());
  handle('storage:profiles:save', (name: string, description?: string) => storage.saveProfile(name, description));
  handle('storage:profiles:delete', (id: string) => storage.removeProfile(id));

  // --------------------------------------------------------------- hive mode
  const hive = context.hive;
  handle('hive:overview', () => hive.overview());
  handle('hive:map', () => hive.map());
  handle('hive:state', (enabled: boolean) => {
    hive.setEnabled(enabled);
    return { ok: true, enabled };
  });
  handle('hive:formation', (formation: Parameters<typeof hive.setFormation>[0]) => ({ ok: true, formation: hive.setFormation(formation) }));
  handle('hive:command', (instruction: string) => hive.runCommand(instruction));
  handle('hive:roles:set', (workerId: string, role: Parameters<typeof hive.assignRole>[1], options?: Parameters<typeof hive.assignRole>[2]) => hive.assignRole(workerId, role, options));
  handle('hive:commander', (workerId: string) => {
    hive.setCommander(workerId);
    return { ok: true, commanderId: workerId };
  });
  handle('hive:emergency-stop', (reason?: string) => {
    hive.emergencyStop(reason || 'operator request');
    return { ok: true };
  });
  handle('hive:export', (format: 'json' | 'csv') => exportHive(context, getWindow(), format));
}

function statisticsInput(context: AppContext): StatisticsInput {
  return {
    workers: context.workers.list(),
    tasks: context.workers.listTasks(1000),
    commands: context.workers.listCommands(1000),
    events: context.events.list(1000),
    inventory: context.workerInventory.all(),
    schedules: context.multiverse.listSchedules(),
    rules: context.multiverse.listRules(),
    containers: context.multiverse.listContainers(),
    audit: context.multiverse.listAudit(1000),
  };
}

async function exportStatistics(
  context: AppContext,
  win: BrowserWindow | null,
  format: 'json' | 'csv',
): Promise<{ path: string } | null> {
  const report = buildStatistics(statisticsInput(context));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: `logvex-statistics-${stamp}.${format}`,
        filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }],
      })
    : { canceled: false, filePath: `logvex-statistics-${stamp}.${format}` };
  if (result.canceled || !result.filePath) return null;

  const body = format === 'csv' ? statisticsToCsv(report) : JSON.stringify(report, null, 2);
  writeFileSync(result.filePath, body);
  return { path: result.filePath };
}

function exportConfig(context: AppContext, win: BrowserWindow | null): { path: string } | null {
  const path = context.exportBundlePath();
  writeFileSync(path, JSON.stringify(context.exportBundle(), null, 2));
  return { path };
}

/**
 * Writes the hive's shared state (members, roles, objectives, exploration, observations, command
 * history) to a file. JSON is the full record; CSV flattens to one row per member so an operator can
 * open the roster in a spreadsheet.
 */
async function exportHive(
  context: AppContext,
  win: BrowserWindow | null,
  format: 'json' | 'csv',
): Promise<{ path: string } | null> {
  const overview = context.hive.overview();
  const map = context.hive.map();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: `logvex-hive-${stamp}.${format}`,
        filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }],
      })
    : { canceled: false, filePath: `logvex-hive-${stamp}.${format}` };
  if (result.canceled || !result.filePath) return null;

  if (format === 'csv') {
    const lines = ['worker_id,label,role,commander,online,x,y,z,dimension,health,current_task,formation_x,formation_z'];
    for (const member of overview.members) {
      lines.push([
        member.workerId, csvCell(member.label), member.role, member.isCommander, member.online,
        member.position.x, member.position.y, member.position.z, member.dimension, member.health,
        csvCell(member.currentTask), member.formationTarget?.x ?? '', member.formationTarget?.z ?? '',
      ].join(','));
    }
    writeFileSync(result.filePath, lines.join('\n'));
    return { path: result.filePath };
  }

  writeFileSync(result.filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    enabled: overview.enabled,
    commanderId: overview.commanderId,
    formation: overview.formation,
    exploration: overview.exploration,
    members: overview.members,
    objectives: overview.objectives,
    observations: overview.recentObservations,
    commands: overview.commands,
    map,
  }, null, 2));
  return { path: result.filePath };
}

function importConfig(context: AppContext, win: BrowserWindow | null): { imported: number } | null {
  if (!win) return null;
  const paths = dialog.showOpenDialogSync(win, { filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!paths || paths.length === 0) return null;
  const data = JSON.parse(readFileSync(paths[0], 'utf8')) as Record<string, unknown>;
  return { imported: context.importBundle(data) };
}

/**
 * Writes a worker report (the roster, each worker's last reported inventory and recent tasks) to a
 * file. JSON is the full record; CSV is flattened to one row per worker per item so it opens in a
 * spreadsheet, with a `captured_at` column so a reader can tell how old the numbers are.
 */
async function exportWorkerReport(
  context: AppContext,
  win: BrowserWindow | null,
  format: 'json' | 'csv',
): Promise<{ path: string } | null> {
  const workers = context.workers.list();
  const inventory = context.workerInventory.all();
  const tasks = context.workers.listTasks(500);
  const commands = context.workers.listCommands(500);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: `logvex-workers-${stamp}.${format}`,
        filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'JSON', extensions: ['json'] }],
      })
    : { canceled: false, filePath: `logvex-workers-${stamp}.${format}` };
  if (result.canceled || !result.filePath) return null;

  if (format === 'csv') {
    const lines = ['worker_id,label,username,online,status,item_id,item_name,count,captured_at'];
    for (const worker of workers) {
      const snapshot: WorkerInventorySnapshot | undefined = inventory.find((row) => row.workerId === worker.id);
      const items = snapshot?.carried ?? [];
      if (items.length === 0) {
        lines.push([worker.id, worker.label, worker.username, worker.online, worker.status, '', '', '0', snapshot?.capturedAt ?? 0].join(','));
        continue;
      }
      for (const item of items) {
        lines.push([
          worker.id, csvCell(worker.label), csvCell(worker.username), worker.online, worker.status,
          csvCell(item.id), csvCell(item.name), item.count, snapshot?.capturedAt ?? 0,
        ].join(','));
      }
    }
    writeFileSync(result.filePath, lines.join('\n'));
    return { path: result.filePath };
  }

  writeFileSync(result.filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    workers,
    inventory,
    tasks,
    commands,
  }, null, 2));
  return { path: result.filePath };
}

/** Quotes a CSV cell only when it needs it, so the output stays readable. */
function csvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
