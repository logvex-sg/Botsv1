/**
 * Preload bridge.
 *
 * Exposes a narrow, typed `window.fleet` API to the renderer using contextBridge. No Node APIs are
 * exposed; every method is an allow-listed IPC channel. The renderer therefore cannot reach the
 * filesystem or the database directly.
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
  exportConfig: () => invoke('system:export'),
  importConfig: () => invoke('system:import'),

  // host pairing
  getPairingCode: () => invoke('host:pairing:get'),
  createPairingCode: () => invoke('host:pairing:create'),
  clearPairingCode: () => invoke('host:pairing:clear'),

  // worker server
  getWorkerServer: () => invoke('workers:server:get'),
  regenerateWorkerToken: () => invoke('workers:server:token'),

  // workers
  listWorkers: () => invoke('workers:list'),
  getWorker: (workerId: string) => invoke('workers:get', workerId),
  getWorkerOverview: () => invoke('workers:overview'),
  setWorkerLabel: (workerId: string, label: string) => invoke('workers:label', workerId, label),
  setWorkerNotes: (workerId: string, notes: string) => invoke('workers:notes', workerId, notes),
  forgetWorker: (workerId: string) => invoke('workers:forget', workerId),
  pingWorker: (workerId: string) => invoke('workers:ping', workerId),
  kickWorker: (workerId: string, reason: string) => invoke('workers:kick', workerId, reason),

  // worker groups
  listWorkerGroups: () => invoke('worker-groups:list'),
  createWorkerGroup: (name: string, description?: string, color?: string) => invoke('worker-groups:create', name, description, color),
  updateWorkerGroup: (id: string, patch: unknown) => invoke('worker-groups:update', id, patch),
  deleteWorkerGroup: (id: string) => invoke('worker-groups:delete', id),
  assignWorkerGroup: (workerId: string, groupId: string | null) => invoke('worker-groups:assign', workerId, groupId),
  assignWorkerGroupBulk: (workerIds: string[], groupId: string | null) => invoke('worker-groups:assign-bulk', workerIds, groupId),

  // tasks
  runWorkerTask: (workerId: string, kind: string, params?: Record<string, unknown>) => invoke('worker-tasks:run', workerId, kind, params),
  runWorkerTaskMany: (workerIds: string[], kind: string, params?: Record<string, unknown>) => invoke('worker-tasks:run-many', workerIds, kind, params),
  listWorkerTasks: (limit?: number, workerId?: string) => invoke('worker-tasks:list', limit, workerId),
  getWorkerTaskKinds: () => invoke('worker-tasks:kinds'),

  // console
  getWorkerConsole: (workerId: string) => invoke('worker-console:get', workerId),
  clearWorkerConsole: (workerId: string) => invoke('worker-console:clear', workerId),
  getWorkerCapabilities: (workerId: string) => invoke('worker-console:capabilities', workerId),

  // commands / chat
  sendWorkerLine: (workerId: string, kind: string, line: string) => invoke('worker-commands:send', workerId, kind, line),
  sendWorkerLineMany: (workerIds: string[], kind: string, line: string) => invoke('worker-commands:send-many', workerIds, kind, line),
  listWorkerCommands: (limit?: number, workerId?: string) => invoke('worker-commands:list', limit, workerId),

  // inventory
  getWorkerInventory: (workerId: string) => invoke('worker-inventory:get', workerId),
  countWorkerItem: (query: string, workerIds?: string[]) => invoke('worker-inventory:count', query, workerIds),
  getCombinedTotals: (workerIds?: string[]) => invoke('worker-inventory:totals', workerIds),
  exportWorkerReport: (format: 'json' | 'csv') => invoke('worker-inventory:export', format),

  // regear
  listRegearPresets: () => invoke('regear:list'),
  createRegearPreset: (input: unknown) => invoke('regear:create', input),
  updateRegearPreset: (id: string, patch: unknown) => invoke('regear:update', id, patch),
  deleteRegearPreset: (id: string) => invoke('regear:delete', id),
  compareRegearPreset: (workerId: string, presetId: string) => invoke('regear:compare', workerId, presetId),
  regearWorker: (workerId: string, presetId: string, allowMoves?: boolean) => invoke('regear:run', workerId, presetId, allowMoves),
  regearWorkers: (workerIds: string[], presetId: string, allowMoves?: boolean) => invoke('regear:run-many', workerIds, presetId, allowMoves),

  // events / notifications
  listEvents: (limit?: number) => invoke('events:list', limit),
  listNotifications: () => invoke('notifications:list'),
  markNotificationRead: (id: string) => invoke('notifications:read', id),
  markAllNotificationsRead: () => invoke('notifications:read-all'),

  // live events
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on('fleet:event', listener);
    return () => ipcRenderer.removeListener('fleet:event', listener);
  },
};

contextBridge.exposeInMainWorld('fleet', api);

export type FleetBridge = typeof api;
