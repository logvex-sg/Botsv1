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
import type { RegearPreset, WorkerInventorySnapshot } from '../../shared/types';
import type { TaskKind } from '../../shared/workers';

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
  handle('host:pairing:create', () => {
    const code = context.createPairingCode();
    context.emitEvent('SYSTEM', 'Pairing code created; it admits one worker and expires shortly.');
    return code;
  });
  handle('host:pairing:clear', () => {
    context.clearPairingCode();
    return true;
  });

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
}

function exportConfig(context: AppContext, win: BrowserWindow | null): { path: string } | null {
  const path = context.exportBundlePath();
  writeFileSync(path, JSON.stringify(context.exportBundle(), null, 2));
  return { path };
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
