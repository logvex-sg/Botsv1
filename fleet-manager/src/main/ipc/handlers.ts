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
import type { Account, DeploymentConfig, EquipmentProfileRecord, InstanceRecord, ServerProfile, StasisLocation, TargetEntry } from '../../shared/types';
import type { InventorySnapshot } from '../services/equipment/equipment-manager';

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
  handle('system:diagnostics', async (serverProfileId: string) => {
    const { runDiagnostics } = await import('../services/network/network-diagnostics');
    const server = context.servers.get(serverProfileId);
    if (!server) throw new Error('Server profile not found.');
    return runDiagnostics(server.host, server.port);
  });
  handle('system:export', async () => exportConfig(context));
  handle('system:import', async () => importConfig(context, getWindow()));
  handle('system:setup', () => context.setupReport());
  handle('system:quick-setup', (input: import('../../shared/types').QuickSetupInput) => context.quickSetup(input));
  handle('system:quick-deploy', (input: import('../../shared/types').QuickDeployInput) => context.quickDeploy(input));
  handle('system:backup', async () => {
    const win = getWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: `logvex-backup-${Date.now()}.sqlite` })
      : { canceled: false, filePath: `logvex-backup-${Date.now()}.sqlite` };
    if (result.canceled || !result.filePath) return null;
    await context.db.backup(result.filePath);
    return { path: result.filePath };
  });

  // -------------------------------------------------------------- accounts
  handle('accounts:list', () => context.accounts.listWithStatus());
  handle('accounts:create', (input: Partial<Account>) => context.accounts.create(input as never));
  handle('accounts:update', (id: string, patch: Partial<Account>) => context.accounts.update(id, patch as never));
  handle('accounts:delete', (id: string) => context.accounts.remove(id));
  handle('accounts:credential:set', async (id: string, secret: string) => {
    await context.accounts.setCredential(id, secret);
    context.emitEvent('SYSTEM', `Credential stored for account`, { accountId: id });
    return { ok: true };
  });
  handle('accounts:credential:clear', async (id: string) => {
    await context.accounts.clearCredential(id);
    return { ok: true };
  });
  handle('accounts:login', (id: string) => loginAccount(context, id));

  // --------------------------------------------------------------- servers
  handle('servers:list', () => context.servers.list());
  handle('servers:create', (input: Partial<ServerProfile>) => context.servers.create(input as never));
  handle('servers:update', (id: string, patch: Partial<ServerProfile>) => context.servers.update(id, patch));
  handle('servers:delete', (id: string) => context.servers.remove(id));
  handle('servers:test', async (id: string) => {
    const { runDiagnostics } = await import('../services/network/network-diagnostics');
    const server = context.servers.get(id);
    if (!server) throw new Error('Server profile not found.');
    return runDiagnostics(server.host, server.port);
  });

  // ---------------------------------------------------------------- groups
  handle('groups:list', () => context.groups.list());
  handle('groups:create', (name: string, description?: string, color?: string) => context.groupManager.create(name, description, color));
  handle('groups:update', (id: string, patch: { name?: string; description?: string; color?: string }) =>
    context.groups.rename(id, patch.name ?? '', patch.description, patch.color));
  handle('groups:delete', (id: string) => context.groups.remove(id));
  handle('groups:assign-instance', (instanceId: string, groupId: string | null) => context.groupManager.assignInstance(instanceId, groupId));
  handle('groups:assign-account', (accountId: string, groupId: string | null) => context.groupManager.assignAccount(accountId, groupId));

  // ------------------------------------------------------------- instances
  handle('instances:list', () => context.instances.list());
  handle('instances:create', (input: Partial<InstanceRecord>) => context.instances.create(input as never));
  handle('instances:update', (id: string, patch: Partial<InstanceRecord>) => context.instances.update(id, patch));
  handle('instances:delete', (id: string) => context.instances.remove(id));
  handle('instances:start', (id: string) => context.instances.start(id));
  handle('instances:stop', (id: string) => context.instances.stop(id));
  handle('instances:restart', (id: string) => context.instances.restart(id));
  handle('instances:command', (id: string, command: string) => context.instances.sendCommand(id, command));
  handle('instances:logs', (id: string) => context.instances.get(id)?.logs ?? []);

  // ----------------------------------------------------------------- roles
  handle('roles:catalog', () => context.roleCatalog());
  handle('roles:validate', async (role: string, config: Record<string, unknown>) => {
    const { validateRoleConfig } = await import('../services/roles/roles');
    return validateRoleConfig(role as never, config);
  });

  // ------------------------------------------------------------ deployment
  handle('deployments:list', () => context.deployments.list());
  handle('deployments:get', (id: string) => context.deployments.get(id));
  handle('deployments:create', (input: Partial<DeploymentConfig>) => context.deployments.create(input as never));
  handle('deployments:update', (id: string, patch: Partial<DeploymentConfig>) => context.deployments.update(id, patch));
  handle('deployments:delete', (id: string) => context.deployments.remove(id));
  handle('deployments:validate', async (id: string) => {
    const config = context.deployments.get(id);
    if (!config) throw new Error('Deployment not found.');
    return context.engine.validate(config);
  });
  handle('deployments:preview', (id: string) => buildPreview(context, id));
  handle('deployments:start', async (id: string) => {
    const config = context.deployments.get(id);
    if (!config) throw new Error('Deployment not found.');
    return context.engine.start(config);
  });
  handle('deployments:pause', () => {
    context.engine.pause();
    return true;
  });
  handle('deployments:resume', () => {
    context.engine.resume();
    return true;
  });
  handle('deployments:cancel', () => {
    context.engine.cancel();
    return true;
  });
  handle('deployments:approve', () => {
    context.engine.approve();
    return true;
  });
  handle('deployments:retry-item', (itemId: string) => context.engine.retryItem(itemId));
  handle('deployments:monitor', () => ({
    state: context.engine.getState(),
    deployment: context.engine.getCurrent(),
    items: context.engine.getItems(),
  }));
  handle('deployments:export', async (id: string) => {
    const config = context.deployments.get(id);
    if (!config) return null;
    const win = getWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: `${config.name.replace(/\s+/g, '-').toLowerCase()}.preset.json` })
      : { canceled: false, filePath: `${config.id}.preset.json` };
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, JSON.stringify(config, null, 2));
    return { path: result.filePath };
  });
  handle('deployments:import', async () => importPreset(context, getWindow()));
  handle('deployments:duplicate', (id: string) => duplicateDeployment(context, id));

  // --------------------------------------------------------------- targets
  handle('targets:list', () => context.targets.list());
  handle('targets:upsert', (input: Partial<TargetEntry> & { username: string }) => context.targets.upsert(input));
  handle('targets:update', (id: string, patch: Partial<TargetEntry>) => context.targets.update(id, patch));
  handle('targets:delete', (id: string) => context.targets.remove(id));
  handle('targets:sync', () => context.targetSync.pull());
  handle('targets:hunter-status', async () => {
    const health = await context.hunter.health();
    return { connected: health.ok, url: context.hunter.baseUrl, lastSync: context.hunter.lastSyncAt() };
  });

  // ---------------------------------------------------------------- stasis
  handle('stasis:list', () => context.stasisManager.list());
  handle('stasis:create', (input: Partial<StasisLocation>) => context.stasisManager.create(input as never));
  handle('stasis:update', (id: string, patch: Partial<StasisLocation>) => context.stasisManager.update(id, patch));
  handle('stasis:delete', (id: string) => context.stasisManager.remove(id));
  handle('stasis:history', (id: string) => context.stasisManager.historyFor(id));
  handle('stasis:set-state', (id: string, state: string, reason: string) => {
    const change = context.stasisManager.setState(id, state as never, reason);
    if (change) context.emitEvent('STASIS_STATE_CHANGED', `Stasis ${id} ${change.from} -> ${change.to}`, { locationId: id });
    return change;
  });

  // ------------------------------------------------------------- equipment
  handle('equipment:list', () => context.equipmentManager.list());
  handle('equipment:create', (input: Partial<EquipmentProfileRecord>) => context.equipmentManager.create(input as never));
  handle('equipment:update', (id: string, patch: Partial<EquipmentProfileRecord>) => context.equipmentManager.update(id, patch));
  handle('equipment:delete', (id: string) => context.equipmentManager.remove(id));
  handle('equipment:evaluate', (id: string, snapshot: InventorySnapshot) => {
    const profile = context.equipmentManager.get(id);
    if (!profile) throw new Error('Equipment profile not found.');
    return context.equipmentManager.evaluate(profile, snapshot);
  });

  // ---------------------------------------------------------- events/notes
  handle('events:list', (limit?: number) => context.bus.recentEvents(limit ?? 200));
  handle('events:submit', (input: { type: string; role: string; instanceId?: string | null; targetUuid?: string | null; payload?: Record<string, unknown> }) =>
    context.coordinator.submit(input));
  handle('notifications:list', () => context.notifications.list());
  handle('notifications:read', (id: string) => context.notifications.markRead(id));
  handle('notifications:read-all', () => {
    context.notifications.markAllRead();
    return true;
  });

  // -------------------------------------------------------------- emergency
  handle('emergency:stop', () => {
    context.coordinator.setEmergencyStop(true);
    context.instances.stopAll();
    context.engine.cancel();
    context.emitEvent('SYSTEM', 'EMERGENCY STOP engaged: all instances halted', { severity: 'error' });
    return true;
  });
  handle('emergency:clear', () => {
    context.coordinator.setEmergencyStop(false);
    context.emitEvent('SYSTEM', 'Emergency stop cleared');
    return true;
  });
}

/** Authenticates an account and marks the result. Uses the stored credential only for offline accounts. */
async function loginAccount(context: AppContext, id: string): Promise<{ ok: boolean; error?: string }> {
  const account = context.accountRepo.get(id);
  if (!account) return { ok: false, error: 'Account not found.' };
  if (account.authMode !== 'offline') {
    const has = await context.accounts.hasCredential(id);
    if (!has) {
      await context.accounts.markLogin(id, false);
      return { ok: false, error: 'No stored credential. Add one first.' };
    }
    await context.accounts.markLogin(id, true);
    context.emitEvent('SYSTEM', `Login prepared for ${account.username}`);
    return { ok: true };
  }
  await context.accounts.markLogin(id, true);
  context.emitEvent('SYSTEM', `Offline login prepared for ${account.username}`);
  return { ok: true };
}

async function buildPreview(context: AppContext, id: string) {
  const config = context.deployments.get(id);
  if (!config) throw new Error('Deployment not found.');
  const accounts = context.accountRepo.list();
  const server = config.serverProfileId ? context.servers.get(config.serverProfileId) : undefined;
  const byRole: Record<string, number> = { GEARER: 0, STASIS: 0, HUNTER: 0 };
  const order = config.entries.map((entry) => {
    byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
    return {
      instanceName: entry.instanceName,
      role: entry.role,
      account: accounts.find((a) => a.id === entry.accountId)?.username ?? 'unknown',
      delayMs: entry.delayMs,
    };
  });
  return {
    totalAccounts: config.entries.length,
    byRole,
    serverName: server?.name ?? null,
    order,
    maxConcurrent: config.maxConcurrent,
    estimatedMemoryMb: config.entries.length * 256,
    report: await context.engine.validate(config),
  };
}

async function duplicateDeployment(context: AppContext, id: string) {
  const config = context.deployments.get(id);
  if (!config) return undefined;
  const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = config;
  return context.deployments.create({ ...rest, name: `${config.name} (copy)` });
}

function exportConfig(context: AppContext): { path: string } {
  const path = context.exportBundlePath();
  writeFileSync(path, JSON.stringify(context.exportBundle(), null, 2));
  return { path };
}

function importConfig(context: AppContext, win: BrowserWindow | null): { imported: number } | null {
  if (!win) return null;
  // Synchronous dialog is avoided; the caller shows the result asynchronously.
  const paths = dialog.showOpenDialogSync(win, { filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!paths || paths.length === 0) return null;
  const data = JSON.parse(readFileSync(paths[0], 'utf8')) as Record<string, unknown>;
  return { imported: context.importBundle(data) };
}

function importPreset(context: AppContext, win: BrowserWindow | null): DeploymentConfig | null {
  if (!win) return null;
  const paths = dialog.showOpenDialogSync(win, { filters: [{ name: 'Preset', extensions: ['json'] }] });
  if (!paths || paths.length === 0) return null;
  const data = JSON.parse(readFileSync(paths[0], 'utf8')) as DeploymentConfig;
  const { id: _omit, createdAt: _c, updatedAt: _u, ...rest } = data;
  return context.deployments.create({ ...rest, name: `${data.name} (imported)` });
}
