/**
 * Preload bridge.
 *
 * Exposes a narrow, typed `window.fleet` API to the renderer using contextBridge. No Node APIs are
 * exposed; every method is an allow-listed IPC channel. The renderer therefore cannot reach the
 * filesystem or the database directly.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { ControlAction } from '../shared/workers';
import type { WorkerModePatch } from '../shared/types';

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
  controlWorker: (workerId: string, action: ControlAction) => invoke('workers:control', workerId, action),
  connectWorker: (workerId: string) => invoke('workers:connect', workerId),
  disconnectWorker: (workerId: string) => invoke('workers:disconnect', workerId),
  restartWorker: (workerId: string) => invoke('workers:restart', workerId),
  pauseWorker: (workerId: string) => invoke('workers:pause', workerId),
  resumeWorker: (workerId: string) => invoke('workers:resume', workerId),

  getWorkerModeSettings: () => invoke('worker-mode:settings'),
  saveWorkerModeSettings: (patch: WorkerModePatch) => invoke('worker-mode:save', patch),
  getWorkerModeStatus: () => invoke('worker-mode:status'),
  getWorkerModeLogs: () => invoke('worker-mode:logs'),
  connectWorkerMode: () => invoke('worker-mode:connect'),
  disconnectWorkerMode: () => invoke('worker-mode:disconnect'),
  testWorkerModeConnection: (overrides?: WorkerModePatch) => invoke('worker-mode:test', overrides),
  provisionWorkerConfig: (directory: string) => invoke('worker-mode:provision', directory),

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

  // multiverse: server profiles
  listServers: (includeArchived?: boolean) => invoke('mv:servers:list', includeArchived),
  getServer: (id: string) => invoke('mv:servers:get', id),
  createServer: (input: unknown) => invoke('mv:servers:create', input),
  updateServer: (id: string, patch: unknown) => invoke('mv:servers:update', id, patch),
  deleteServer: (id: string) => invoke('mv:servers:delete', id),
  assignServer: (workerIds: string[], profileId: string | null) => invoke('mv:servers:assign', workerIds, profileId),

  // multiverse: group templates
  listGroupTemplates: () => invoke('mv:templates:list'),
  createGroupTemplate: (input: unknown) => invoke('mv:templates:create', input),
  deleteGroupTemplate: (id: string) => invoke('mv:templates:delete', id),
  applyGroupTemplate: (templateId: string, groupName: string) => invoke('mv:templates:apply', templateId, groupName),

  // multiverse: task presets
  listTaskPresets: () => invoke('mv:presets:list'),
  createTaskPreset: (input: unknown) => invoke('mv:presets:create', input),
  updateTaskPreset: (id: string, patch: unknown) => invoke('mv:presets:update', id, patch),
  deleteTaskPreset: (id: string) => invoke('mv:presets:delete', id),
  runTaskPreset: (id: string) => invoke('mv:presets:run', id),

  // multiverse: schedules
  listSchedules: () => invoke('mv:schedules:list'),
  createSchedule: (input: unknown) => invoke('mv:schedules:create', input),
  updateSchedule: (id: string, patch: unknown) => invoke('mv:schedules:update', id, patch),
  deleteSchedule: (id: string) => invoke('mv:schedules:delete', id),
  tickSchedules: () => invoke('mv:schedules:tick'),

  // multiverse: automation rules
  listRules: () => invoke('mv:rules:list'),
  createRule: (input: unknown) => invoke('mv:rules:create', input),
  updateRule: (id: string, patch: unknown) => invoke('mv:rules:update', id, patch),
  deleteRule: (id: string) => invoke('mv:rules:delete', id),

  // multiverse: containers, history, tags, audit
  listContainers: (workerId?: string) => invoke('mv:containers:list', workerId),
  deleteContainer: (id: string) => invoke('mv:containers:delete', id),
  inventoryTrend: (workerId: string, itemId: string, limit?: number) => invoke('mv:history:trend', workerId, itemId, limit),
  inventoryCaptures: (workerId: string, limit?: number) => invoke('mv:history:captures', workerId, limit),
  addWorkerTag: (workerId: string, tag: string) => invoke('mv:tags:add', workerId, tag),
  removeWorkerTag: (workerId: string, tag: string) => invoke('mv:tags:remove', workerId, tag),
  setWorkerTags: (workerId: string, tags: string[]) => invoke('mv:tags:set', workerId, tags),
  listAllTags: () => invoke('mv:tags:all'),
  listAudit: (limit?: number) => invoke('mv:audit:list', limit),

  getStatistics: () => invoke('stats:get'),
  exportStatistics: (format: 'json' | 'csv') => invoke('stats:export', format),

  // live events
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown): void => callback(payload);
    ipcRenderer.on('fleet:event', listener);
    return () => ipcRenderer.removeListener('fleet:event', listener);
  },
};

contextBridge.exposeInMainWorld('fleet', api);

export type FleetBridge = typeof api;
