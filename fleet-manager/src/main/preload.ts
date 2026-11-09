/**
 * Preload bridge.
 *
 * Exposes a narrow, typed `window.fleet` API to the renderer using contextBridge. No Node APIs are
 * exposed; every method is an allow-listed IPC channel. The renderer therefore cannot reach the
 * filesystem, the database or the credential vault directly.
 */
import { contextBridge, ipcRenderer } from 'electron';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api = {
  // system
  getHealth: () => invoke('system:health'),
  getSettings: () => invoke('system:settings:get'),
  saveSettings: (patch: unknown) => invoke('system:settings:save', patch),
  getApiToken: () => invoke('system:api-token'),
  regenerateApiToken: () => invoke('system:api-token:regenerate'),
  getDiagnostics: (serverProfileId: string) => invoke('system:diagnostics', serverProfileId),
  exportConfig: () => invoke('system:export'),
  importConfig: () => invoke('system:import'),
  backupDatabase: () => invoke('system:backup'),

  // guided setup
  getSetupReport: () => invoke('system:setup'),
  quickSetup: (input: unknown) => invoke('system:quick-setup', input),
  quickDeploy: (input: unknown) => invoke('system:quick-deploy', input),

  // accounts
  listAccounts: () => invoke('accounts:list'),
  createAccount: (input: unknown) => invoke('accounts:create', input),
  updateAccount: (id: string, patch: unknown) => invoke('accounts:update', id, patch),
  deleteAccount: (id: string) => invoke('accounts:delete', id),
  setCredential: (id: string, secret: string) => invoke('accounts:credential:set', id, secret),
  clearCredential: (id: string) => invoke('accounts:credential:clear', id),
  loginAccount: (id: string) => invoke('accounts:login', id),

  // servers
  listServers: () => invoke('servers:list'),
  createServer: (input: unknown) => invoke('servers:create', input),
  updateServer: (id: string, patch: unknown) => invoke('servers:update', id, patch),
  deleteServer: (id: string) => invoke('servers:delete', id),
  testServer: (id: string) => invoke('servers:test', id),

  // groups
  listGroups: () => invoke('groups:list'),
  createGroup: (name: string, description?: string, color?: string) => invoke('groups:create', name, description, color),
  updateGroup: (id: string, patch: unknown) => invoke('groups:update', id, patch),
  deleteGroup: (id: string) => invoke('groups:delete', id),
  assignInstanceGroup: (instanceId: string, groupId: string | null) => invoke('groups:assign-instance', instanceId, groupId),
  assignAccountGroup: (accountId: string, groupId: string | null) => invoke('groups:assign-account', accountId, groupId),

  // instances
  listInstances: () => invoke('instances:list'),
  createInstance: (input: unknown) => invoke('instances:create', input),
  updateInstance: (id: string, patch: unknown) => invoke('instances:update', id, patch),
  deleteInstance: (id: string) => invoke('instances:delete', id),
  startInstance: (id: string) => invoke('instances:start', id),
  stopInstance: (id: string) => invoke('instances:stop', id),
  restartInstance: (id: string) => invoke('instances:restart', id),
  sendInstanceCommand: (id: string, command: string) => invoke('instances:command', id, command),
  getInstanceLogs: (id: string) => invoke('instances:logs', id),

  // roles
  getRoleCatalog: () => invoke('roles:catalog'),
  validateRoleConfig: (role: string, config: unknown) => invoke('roles:validate', role, config),

  // deployment
  listDeployments: () => invoke('deployments:list'),
  getDeployment: (id: string) => invoke('deployments:get', id),
  createDeployment: (input: unknown) => invoke('deployments:create', input),
  updateDeployment: (id: string, patch: unknown) => invoke('deployments:update', id, patch),
  deleteDeployment: (id: string) => invoke('deployments:delete', id),
  validateDeployment: (id: string) => invoke('deployments:validate', id),
  previewDeployment: (id: string) => invoke('deployments:preview', id),
  startDeployment: (id: string) => invoke('deployments:start', id),
  pauseDeployment: () => invoke('deployments:pause'),
  resumeDeployment: () => invoke('deployments:resume'),
  cancelDeployment: () => invoke('deployments:cancel'),
  approveDeployment: () => invoke('deployments:approve'),
  retryDeploymentItem: (itemId: string) => invoke('deployments:retry-item', itemId),
  getDeploymentMonitor: () => invoke('deployments:monitor'),
  exportPreset: (id: string) => invoke('deployments:export', id),
  importPreset: () => invoke('deployments:import'),
  duplicateDeployment: (id: string) => invoke('deployments:duplicate', id),

  // targets
  listTargets: () => invoke('targets:list'),
  upsertTarget: (input: unknown) => invoke('targets:upsert', input),
  updateTarget: (id: string, patch: unknown) => invoke('targets:update', id, patch),
  deleteTarget: (id: string) => invoke('targets:delete', id),
  syncTargets: () => invoke('targets:sync'),
  hunterStatus: () => invoke('targets:hunter-status'),

  // stasis
  listStasis: () => invoke('stasis:list'),
  createStasis: (input: unknown) => invoke('stasis:create', input),
  updateStasis: (id: string, patch: unknown) => invoke('stasis:update', id, patch),
  deleteStasis: (id: string) => invoke('stasis:delete', id),
  getStasisHistory: (id: string) => invoke('stasis:history', id),
  setStasisState: (id: string, state: string, reason: string) => invoke('stasis:set-state', id, state, reason),

  // equipment
  listEquipment: () => invoke('equipment:list'),
  createEquipment: (input: unknown) => invoke('equipment:create', input),
  updateEquipment: (id: string, patch: unknown) => invoke('equipment:update', id, patch),
  deleteEquipment: (id: string) => invoke('equipment:delete', id),
  evaluateEquipment: (id: string, snapshot: unknown) => invoke('equipment:evaluate', id, snapshot),

  // events / notifications
  listEvents: (limit?: number) => invoke('events:list', limit),
  submitEvent: (input: unknown) => invoke('events:submit', input),
  listNotifications: () => invoke('notifications:list'),
  markNotificationRead: (id: string) => invoke('notifications:read', id),
  markAllNotificationsRead: () => invoke('notifications:read-all'),

  // workers
  listWorkers: () => invoke('workers:list'),
  getWorker: (workerId: string) => invoke('workers:get', workerId),
  getWorkerOverview: () => invoke('workers:overview'),
  resolveWorkers: (selector: string) => invoke('workers:resolve', selector),
  setWorkerLabel: (workerId: string, label: string) => invoke('workers:label', workerId, label),
  setWorkerNotes: (workerId: string, notes: string) => invoke('workers:notes', workerId, notes),
  forgetWorker: (workerId: string) => invoke('workers:forget', workerId),
  pingWorker: (workerId: string) => invoke('workers:ping', workerId),
  kickWorker: (workerId: string, reason: string) => invoke('workers:kick', workerId, reason),
  getWorkerServer: () => invoke('workers:server:get'),
  regenerateWorkerToken: () => invoke('workers:server:token'),

  listWorkerGroups: () => invoke('worker-groups:list'),
  createWorkerGroup: (name: string, description?: string, color?: string) => invoke('worker-groups:create', name, description, color),
  updateWorkerGroup: (id: string, patch: unknown) => invoke('worker-groups:update', id, patch),
  deleteWorkerGroup: (id: string) => invoke('worker-groups:delete', id),
  assignWorkerGroup: (workerId: string, groupId: string | null) => invoke('worker-groups:assign', workerId, groupId),
  assignWorkerGroupBulk: (workerIds: string[], groupId: string | null) => invoke('worker-groups:assign-bulk', workerIds, groupId),

  runWorkerTask: (workerId: string, kind: string, params?: unknown) => invoke('worker-tasks:run', workerId, kind, params),
  runWorkerTaskMany: (workerIds: string[], kind: string, params?: unknown) => invoke('worker-tasks:run-many', workerIds, kind, params),
  listWorkerTasks: (limit?: number, workerId?: string) => invoke('worker-tasks:list', limit, workerId),
  getWorkerTaskKinds: () => invoke('worker-tasks:kinds'),

  sendWorkerLine: (workerId: string, kind: string, line: string) => invoke('worker-commands:send', workerId, kind, line),
  sendWorkerLineMany: (workerIds: string[], kind: string, line: string) => invoke('worker-commands:send-many', workerIds, kind, line),
  listWorkerCommands: (limit?: number, workerId?: string) => invoke('worker-commands:list', limit, workerId),

  getWorkerInventory: (workerId: string) => invoke('worker-inventory:get', workerId),
  countWorkerItem: (query: string, workerIds?: string[]) => invoke('worker-inventory:count', query, workerIds),
  getCombinedTotals: (workerIds?: string[]) => invoke('worker-inventory:totals', workerIds),
  exportWorkerReport: (format: string) => invoke('worker-inventory:export', format),

  listRegearPresets: () => invoke('regear:list'),
  createRegearPreset: (input: unknown) => invoke('regear:create', input),
  updateRegearPreset: (id: string, patch: unknown) => invoke('regear:update', id, patch),
  deleteRegearPreset: (id: string) => invoke('regear:delete', id),
  compareRegearPreset: (workerId: string, presetId: string) => invoke('regear:compare', workerId, presetId),
  regearWorker: (workerId: string, presetId: string, allowMoves?: boolean) => invoke('regear:run', workerId, presetId, allowMoves),
  regearWorkers: (workerIds: string[], presetId: string, allowMoves?: boolean) => invoke('regear:run-many', workerIds, presetId, allowMoves),

  // emergency
  emergencyStop: () => invoke('emergency:stop'),
  clearEmergencyStop: () => invoke('emergency:clear'),

  // live events
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on('fleet:event', listener);
    return () => ipcRenderer.removeListener('fleet:event', listener);
  },
};

contextBridge.exposeInMainWorld('fleet', api);

export type FleetBridge = typeof api;
