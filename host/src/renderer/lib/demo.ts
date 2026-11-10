/**
 * Development demo data.
 *
 * Served only when the renderer runs under the Vite dev server with `?demo` (used by the screenshot
 * script and for UI work without Electron). It implements the whole {@link FleetApi} over in-memory
 * data so every screen renders with realistic values and every button has something to act on. It
 * is never shipped in the production bundle.
 */
import type { BulkResult, FleetApi, WorkerServerStatus } from '../../shared/ipc';
import type {
  AppSettings, AuditEntry, AutomationRule, ContainerRecord, FleetEvent, GroupTemplate, ItemCountReport,
  PairingCode, RegearComparison, RegearPreset, ScheduleRecord, ServerProfile, TaskPreset,
  WorkerCommandRecord, WorkerConsoleLine, WorkerGroup, WorkerInventorySnapshot, WorkerOverview,
  WorkerTaskRecord, WorkerView,
} from '../../shared/types';
import { emptySnapshot, TASK_KINDS, type TaskKind, type WorkerItem, type WorkerTaskResult } from '../../shared/workers';
import { buildStatistics } from '../../main/packages/statistics';

const now = Date.now();

function item(id: string, name: string, count: number, slot: number): WorkerItem {
  return { id: `minecraft:${id}`, name, count, slot, damage: 0, maxDamage: 0, damageable: false };
}

function makeWorker(index: number, username: string, online: boolean, groupId: string | null): WorkerView {
  const snapshot = emptySnapshot(`w${index}`);
  Object.assign(snapshot, {
    workerId: `w${index}`,
    username,
    minecraftVersion: '1.21.11',
    serverAddress: 'play.example.net',
    dimension: 'minecraft:overworld',
    gameMode: 'survival',
    inWorld: online,
    x: 124.5 + index * 12,
    y: 64,
    z: -302.2 - index * 30,
    health: online ? 20 : 0,
    maxHealth: 20,
    food: online ? 18 : 0,
    armorPieces: online ? 4 : 0,
    totems: online ? 2 : 0,
    foodItems: online ? 12 : 0,
    heldItem: 'minecraft:netherite_sword',
    offhandItem: 'minecraft:totem_of_undying',
    capabilities: [...TASK_KINDS],
    totalItems: 210,
    distinctItems: 24,
    freeSlots: 6,
    lastActivity: 'Idle',
  });
  return {
    id: `w${index}`,
    label: username,
    username,
    minecraftVersion: '1.21.11',
    serverAddress: 'play.example.net',
    protocolVersion: 3,
    modVersion: '2.0.0',
    groupId,
    notes: '',
    firstSeen: now - 86_400_000,
    lastSeen: now - (online ? 2_000 : 600_000),
    lastAddress: '192.168.1.' + (10 + index),
    status: online ? 'ONLINE' : 'OFFLINE',
    online,
    lastHeartbeatAgeSeconds: online ? 2 : null,
    connectedAt: online ? now - 3_600_000 : null,
    snapshot,
    currentTask: '',
    capabilities: [...TASK_KINDS],
    busy: false,
    paused: false,
    stopped: false,
    tags: index % 2 === 0 ? ['farmer'] : ['miner'],
    serverProfileId: index === 1 ? 's1' : null,
    fabricVersion: '0.16.9',
    meteorVersion: '1.21.11-SNAPSHOT',
    archived: false,
  };
}

const groups: WorkerGroup[] = [
  { id: 'g1', name: 'Farmers', description: 'Farming crew', color: '#3fb950', createdAt: now, defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [], archived: false },
  { id: 'g2', name: 'Miners', description: 'Mining crew', color: '#6d5efc', createdAt: now, defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [], archived: false },
];

let workers: WorkerView[] = [
  makeWorker(1, 'LogvexOne', true, 'g1'),
  makeWorker(2, 'LogvexTwo', true, 'g2'),
  makeWorker(3, 'LogvexThree', false, null),
];

// ------------------------------------------------------------ multiverse seed data
let servers: ServerProfile[] = [
  { id: 's1', name: '6b6t', host: 'mc.6b6t.org', port: 25565, version: '1.21.11', environment: 'production', notes: 'Anarchy main', tags: ['anarchy', 'pvp'], archived: false, createdAt: now, updatedAt: now },
  { id: 's2', name: 'Test sandbox', host: '127.0.0.1', port: 25566, version: '1.21.11', environment: 'testing', notes: 'Local dev server', tags: ['local'], archived: false, createdAt: now, updatedAt: now },
];

let templates: GroupTemplate[] = [
  { id: 'tpl1', name: 'Mining crew', description: 'Dig and store', color: '#6d5efc', defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: ['run-task'], createdAt: now },
];

let taskPresets: TaskPreset[] = [
  { id: 'tp1', name: 'Inventory sweep', description: 'Report inventory from every farmer', kind: 'inventory', params: {}, targetWorkerIds: ['w1'], targetGroupIds: [], createdAt: now, updatedAt: now },
  { id: 'tp2', name: 'Position ping', description: 'Ask each miner for its coordinates', kind: 'position', params: {}, targetWorkerIds: [], targetGroupIds: ['g2'], createdAt: now, updatedAt: now },
];

let schedules: ScheduleRecord[] = [
  { id: 'sc1', name: 'Hourly inventory', presetId: 'tp1', kind: 'inventory', params: {}, targetWorkerIds: ['w1'], targetGroupIds: [], scheduleKind: 'interval', startAt: now, intervalMs: 3_600_000, timeOfDay: null, stopAt: null, enabled: true, lastFiredAt: now - 1_800_000, fireCount: 12, createdAt: now, updatedAt: now },
  { id: 'sc2', name: 'Nightly position check', presetId: 'tp2', kind: 'position', params: {}, targetWorkerIds: [], targetGroupIds: ['g2'], scheduleKind: 'daily', startAt: now, intervalMs: null, timeOfDay: '02:00', stopAt: null, enabled: false, lastFiredAt: null, fireCount: 0, createdAt: now, updatedAt: now },
];

let rules: AutomationRule[] = [
  { id: 'r1', name: 'Inventory on join', event: 'WORKER_REGISTERED', conditions: [], action: 'inventory', cooldownMs: 60_000, maxRuns: null, enabled: true, runCount: 4, lastRunAt: now - 900_000, createdAt: now, updatedAt: now },
  { id: 'r2', name: 'Regear when low on totems', event: 'WORKER_INVENTORY', conditions: [{ field: 'totems', operator: 'lt', value: '2' }], action: 'regear', cooldownMs: 300_000, maxRuns: null, enabled: false, runCount: 0, lastRunAt: null, createdAt: now, updatedAt: now },
];

let containers: ContainerRecord[] = [
  { id: 'ct1', workerId: 'w1', label: 'Base chest', x: 120, y: 64, z: -300, dimension: 'minecraft:overworld', items: [item('diamond', 'Diamond', 64, 0), item('iron_ingot', 'Iron Ingot', 128, 1)], inspectedAt: now - 600_000 },
];

const audit: AuditEntry[] = [
  { id: 'a1', at: now - 900_000, actor: 'operator', action: 'server.create', target: 's1', detail: 'created server profile "6b6t"' },
  { id: 'a2', at: now - 800_000, actor: 'operator', action: 'rule.create', target: 'r1', detail: 'created rule "Inventory on join"' },
];

let tasks: WorkerTaskRecord[] = [
  { id: 't1', workerId: 'w1', kind: 'inventory', status: 'SUCCEEDED', params: {}, result: {}, error: null, createdAt: now - 3_600_000, dispatchedAt: now - 3_600_000, completedAt: now - 3_599_000, durationMs: 1000, actor: 'operator' },
  { id: 't2', workerId: 'w2', kind: 'position', status: 'SUCCEEDED', params: {}, result: {}, error: null, createdAt: now - 1_800_000, dispatchedAt: now - 1_800_000, completedAt: now - 1_799_400, durationMs: 600, actor: 'schedule:sc1' },
  { id: 't3', workerId: 'w1', kind: 'regear', status: 'FAILED', params: {}, result: null, error: 'missing totems', createdAt: now - 900_000, dispatchedAt: now - 900_000, completedAt: now - 899_200, durationMs: 800, actor: 'rule:r1' },
  { id: 't4', workerId: 'w2', kind: 'inventory', status: 'PENDING', params: {}, result: null, error: null, createdAt: now - 60_000, dispatchedAt: null, completedAt: null, durationMs: null, actor: 'operator' },
];
let commands: WorkerCommandRecord[] = [
  { id: 'c1', workerId: 'w1', kind: 'chat', line: 'hello', ok: true, response: 'sent', createdAt: now - 2_400_000 },
  { id: 'c2', workerId: 'w2', kind: 'command', line: '/home', ok: true, response: 'sent', createdAt: now - 1_200_000 },
  { id: 'c3', workerId: 'w1', kind: 'command', line: '/spawn', ok: false, response: 'worker offline', createdAt: now - 600_000 },
];
let presets: RegearPreset[] = [
  {
    id: 'p1', name: 'Standard PvP', description: 'Diamond kit',
    items: [
      { query: 'diamond_sword', count: 1, label: 'Sword' },
      { query: 'totem', count: 3, label: 'Totems' },
      { query: 'golden_apple', count: 16, label: 'Gapples' },
    ],
    minArmorPieces: 4, minFood: 8, lowDurabilityPercent: 10, createdAt: now, updatedAt: now,
  },
];
const inventories = new Map<string, WorkerInventorySnapshot>();
for (const w of workers) {
  inventories.set(w.id, {
    workerId: w.id,
    capturedAt: now - 30_000,
    carried: [item('diamond_sword', 'Diamond Sword', 1, 0), item('totem_of_undying', 'Totem of Undying', 2, 1), item('golden_apple', 'Golden Apple', 20, 2)],
    accessible: [],
    armor: [item('netherite_helmet', 'Netherite Helmet', 1, 39)],
    containerOpen: false,
  });
}

const consoles = new Map<string, WorkerConsoleLine[]>();
for (const w of workers) {
  consoles.set(w.id, [
    { at: now - 5000, message: `${w.username} connected to play.example.net` },
    { at: now - 4000, message: `${w.username} registered with the host` },
  ]);
}

const events: FleetEvent[] = [
  { id: 'e1', type: 'WORKER_REGISTERED', source: 'host', severity: 'success', workerId: 'w1', message: 'Worker LogvexOne connected', payload: {}, timestamp: now - 5000 },
  { id: 'e2', type: 'WORKER_INVENTORY', source: 'host', severity: 'info', workerId: 'w2', message: 'Inventory reported by LogvexTwo', payload: {}, timestamp: now - 8000 },
];

let pairing: PairingCode | null = null;

function fakeResult(workerId: string, kind: string, message = 'done'): WorkerTaskResult {
  return { ok: true, taskId: `demo-${kind}`, kind, message: `${workerId}: ${message}`, data: {} };
}

const settings: AppSettings = {
  mode: 'host', onboarded: true, apiPort: 8787, apiHost: '127.0.0.1', apiEnabled: true, theme: 'dark', uiMode: 'beginner',
  logLevel: 'info', notify: true, workerServerEnabled: true, workerServerPort: 8721,
  workerServerHost: '127.0.0.1', pairingCodeTtlSeconds: 600,
};

const server: WorkerServerStatus = { enabled: true, host: '127.0.0.1', port: 8721, bound: true, token: 'demo-token-abcdef' };

const workerMode = {
  hostAddress: '127.0.0.1', hostPort: 8721, token: '', pairingCode: '', workerId: '', workerName: '',
  groupName: 'default', autoConnect: false, heartbeatSeconds: 5,
  modules: { StatusReporter: true, InventoryReporter: true, RegearTask: true, CommandTask: true, ChatTask: true, PositionTask: true, EflyTask: true, CountTask: true, SearchTask: true },
  permissions: { regear: true, command: true, chat: true, efly: true },
};
import type { WorkerClientStatus } from '../../shared/types';
let workerModeStatus: WorkerClientStatus = {
  state: 'idle', connected: false, registered: false, workerId: '', username: '',
  protocolVersion: 3, grantedToken: '', lastError: '', paused: false, stopped: false, detail: 'Not connected',
};

export function createDemoApi(): FleetApi {
  return {
    getHealth: async () => ({
      ok: true, version: '2.0.0', uptimeMs: 123_456,
      database: { ok: true, path: 'demo' },
      workerServer: { enabled: true, running: true, host: '127.0.0.1', port: 8721 },
      workers: { total: workers.length, online: workers.filter((w) => w.online).length },
    }),
    getSettings: async () => settings,
    saveSettings: async (patch) => Object.assign(settings, patch),
    getApiToken: async () => 'demo-api-token',
    regenerateApiToken: async () => 'demo-api-token-2',
    exportConfig: async () => ({ path: 'demo-config.json' }),
    importConfig: async () => ({ imported: 2 }),

    getPairingCode: async () => pairing,
    createPairingCode: async () => { pairing = { code: 'DEMO2345', createdAt: now, expiresAt: now + 600_000 }; return pairing; },
    clearPairingCode: async () => { pairing = null; return true; },

    getWorkerServer: async () => server,
    regenerateWorkerToken: async () => server.token,

    listWorkers: async () => workers,
    getWorker: async (id) => workers.find((w) => w.id === id),
    getWorkerOverview: async (): Promise<WorkerOverview> => ({
      total: workers.length, online: workers.filter((w) => w.online).length,
      offline: workers.filter((w) => !w.online).length,
      busy: workers.filter((w) => w.busy).length,
      unresponsive: 0,
      degraded: workers.filter((w) => w.paused || w.stopped).length,
      activeTasks: tasks.filter((t) => t.status === 'PENDING' || t.status === 'DISPATCHED').length,
      trackedItems: 42,
      groups: groups.map((g) => ({ group: g, workers: workers.filter((w) => w.groupId === g.id).length, online: workers.filter((w) => w.groupId === g.id && w.online).length })),
      recent: events.slice(0, 8),
    }),
    setWorkerLabel: async (id, label) => { const w = workers.find((x) => x.id === id); if (w) w.label = label; return true; },
    setWorkerNotes: async (id, notes) => { const w = workers.find((x) => x.id === id); if (w) w.notes = notes; return true; },
    forgetWorker: async (id) => { workers = workers.filter((w) => w.id !== id); return true; },
    pingWorker: async () => true,
    kickWorker: async () => true,
    controlWorker: async () => true,
    connectWorker: async (id) => { const w = workers.find((x) => x.id === id); if (w) { w.stopped = false; w.paused = false; w.status = 'ONLINE'; } return true; },
    disconnectWorker: async (id) => { const w = workers.find((x) => x.id === id); if (w) { w.stopped = true; w.status = 'DEGRADED'; } return true; },
    restartWorker: async (id) => { const w = workers.find((x) => x.id === id); if (w) { w.stopped = false; w.paused = false; w.status = 'ONLINE'; } return true; },
    pauseWorker: async (id) => { const w = workers.find((x) => x.id === id); if (w) { w.paused = true; w.status = 'DEGRADED'; } return true; },
    resumeWorker: async (id) => { const w = workers.find((x) => x.id === id); if (w) { w.paused = false; w.status = 'ONLINE'; } return true; },

    getWorkerModeSettings: async () => workerMode,
    saveWorkerModeSettings: async (patch) => Object.assign(workerMode, patch),
    getWorkerModeStatus: async () => workerModeStatus,
    getWorkerModeLogs: async () => [{ at: now - 3000, message: 'Worker Mode ready (demo)' }],
    connectWorkerMode: async () => { workerModeStatus = { ...workerModeStatus, state: 'registered', connected: true, registered: true, detail: 'Registered with the host' }; return workerModeStatus; },
    disconnectWorkerMode: async () => { workerModeStatus = { ...workerModeStatus, state: 'idle', connected: false, registered: false, detail: 'Not connected' }; return workerModeStatus; },
    testWorkerModeConnection: async () => ({ ...workerModeStatus, state: 'registered', connected: false, registered: false, detail: 'The host accepted the handshake' }),
    provisionWorkerConfig: async (dir) => ({ ok: true, path: `${dir}/logvex-worker.json`, workerId: 'demo-worker' }),

    listWorkerGroups: async () => groups,
    createWorkerGroup: async (name, description = '', color = '#6d5efc') => {
      const g: WorkerGroup = { id: `g${groups.length + 1}`, name, description, color, createdAt: Date.now(), defaultTaskPresetIds: [], defaultEquipmentPresetIds: [], permissions: [], archived: false };
      groups.push(g);
      return g;
    },
    updateWorkerGroup: async (id, patch) => { const g = groups.find((x) => x.id === id); if (g) Object.assign(g, patch); return g; },
    deleteWorkerGroup: async (id) => { const i = groups.findIndex((g) => g.id === id); if (i >= 0) groups.splice(i, 1); return true; },
    assignWorkerGroup: async (id, groupId) => { const w = workers.find((x) => x.id === id); if (w) w.groupId = groupId; return true; },
    assignWorkerGroupBulk: async (ids, groupId) => { for (const id of ids) { const w = workers.find((x) => x.id === id); if (w) w.groupId = groupId; } return ids.length; },

    runWorkerTask: async (workerId, kind: TaskKind) => {
      const record: WorkerTaskRecord = {
        id: `t${tasks.length + 1}`, workerId, kind, status: 'SUCCEEDED', params: {}, result: {},
        error: null, createdAt: Date.now(), dispatchedAt: Date.now(), completedAt: Date.now(), durationMs: 40, actor: 'host',
      };
      tasks = [record, ...tasks];
      return fakeResult(workerId, kind);
    },
    runWorkerTaskMany: async (ids, kind) => ids.map((workerId) => ({ workerId, ok: true, result: fakeResult(workerId, kind) })),
    listWorkerTasks: async () => tasks,
    getWorkerTaskKinds: async () => [...TASK_KINDS],

    getWorkerConsole: async (id) => consoles.get(id) ?? [],
    clearWorkerConsole: async (id) => { consoles.set(id, []); },
    getWorkerCapabilities: async () => [...TASK_KINDS],

    sendWorkerLine: async (workerId, kind, line) => {
      const record: WorkerCommandRecord = { id: `c${commands.length + 1}`, workerId, kind, line, ok: true, response: 'sent', createdAt: Date.now() };
      commands = [record, ...commands];
      return record;
    },
    sendWorkerLineMany: async (ids, _kind, _line) => ids.map((workerId) => ({ workerId, ok: true, response: 'sent' })),
    listWorkerCommands: async () => commands,

    getWorkerInventory: async (id) => inventories.get(id),
    countWorkerItem: async (query): Promise<ItemCountReport> => ({
      query, total: 22,
      rows: workers.map((w) => ({ workerId: w.id, label: w.label, username: w.username, online: w.online, count: 2, capturedAt: now - 30_000 })),
      stale: false, oldestCapture: now - 30_000,
    }),
    getCombinedTotals: async () => [
      { id: 'minecraft:diamond_sword', name: 'Diamond Sword', count: 3 },
      { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 6 },
      { id: 'minecraft:golden_apple', name: 'Golden Apple', count: 60 },
    ],
    exportWorkerReport: async () => ({ path: 'demo-workers.json' }),

    listRegearPresets: async () => presets,
    createRegearPreset: async (input) => {
      const p: RegearPreset = { ...input, id: `p${presets.length + 1}`, createdAt: Date.now(), updatedAt: Date.now() };
      presets = [...presets, p];
      return p;
    },
    updateRegearPreset: async (id, patch) => { const p = presets.find((x) => x.id === id); if (p) Object.assign(p, patch, { updatedAt: Date.now() }); return p; },
    deleteRegearPreset: async (id) => { presets = presets.filter((p) => p.id !== id); return true; },
    compareRegearPreset: async (workerId, presetId): Promise<RegearComparison> => ({
      workerId, presetId, presetName: presets.find((p) => p.id === presetId)?.name ?? 'Preset',
      ready: false, gaps: [{ query: 'totem', label: 'Totems', required: 3, found: 2, missing: 1 }],
      armorPieces: 4, minArmorPieces: 4, food: 20, minFood: 8, damaged: [], capturedAt: now - 30_000,
    }),
    regearWorker: async (workerId, _presetId) => fakeResult(workerId, 'regear', 'regear compared (dry run)'),
    regearWorkers: async (ids) => ids.map((workerId) => ({ workerId, ok: true, message: 'regear compared (dry run)' })),

    listEvents: async () => events,
    listNotifications: async () => [],
    markNotificationRead: async () => true,
    markAllNotificationsRead: async () => true,

    // ------------------------------------------------------------ multiverse
    listServers: async () => servers.map((s) => ({
      ...s,
      workers: workers.filter((w) => w.serverProfileId === s.id).length,
      online: workers.filter((w) => w.serverProfileId === s.id && w.online).length,
      connectedToIt: workers.filter((w) => w.serverProfileId === s.id && w.online).length,
    })),
    getServer: async (id) => {
      const s = servers.find((x) => x.id === id);
      if (!s) return undefined;
      return {
        ...s,
        workers: workers.filter((w) => w.serverProfileId === s.id).length,
        online: workers.filter((w) => w.serverProfileId === s.id && w.online).length,
        connectedToIt: workers.filter((w) => w.serverProfileId === s.id && w.online).length,
      };
    },
    createServer: async (input) => {
      const profile: ServerProfile = {
        id: `s${servers.length + 1}`, name: input.name, host: input.host ?? '', port: input.port ?? 25565,
        version: input.version ?? '', environment: input.environment ?? 'production', notes: input.notes ?? '',
        tags: input.tags ?? [], archived: false, createdAt: Date.now(), updatedAt: Date.now(),
      };
      servers = [...servers, profile];
      return profile;
    },
    updateServer: async (id, patch) => {
      const s = servers.find((x) => x.id === id);
      if (s) Object.assign(s, patch, { updatedAt: Date.now() });
      return s;
    },
    deleteServer: async (id) => {
      servers = servers.filter((s) => s.id !== id);
      for (const w of workers) if (w.serverProfileId === id) w.serverProfileId = null;
      return true;
    },
    assignServer: async (ids, profileId) => {
      for (const id of ids) { const w = workers.find((x) => x.id === id); if (w) w.serverProfileId = profileId; }
      return ids.length;
    },

    listGroupTemplates: async () => templates,
    createGroupTemplate: async (input) => {
      const t: GroupTemplate = { ...input, id: `tpl${templates.length + 1}`, createdAt: Date.now() };
      templates = [...templates, t];
      return t;
    },
    deleteGroupTemplate: async (id) => { templates = templates.filter((t) => t.id !== id); return true; },
    applyGroupTemplate: async (templateId, groupName) => {
      const t = templates.find((x) => x.id === templateId);
      const g: WorkerGroup = {
        id: `g${groups.length + 1}`, name: groupName || t?.name || 'New group',
        description: t?.description ?? '', color: t?.color ?? '#6d5efc', createdAt: Date.now(),
        defaultTaskPresetIds: t?.defaultTaskPresetIds ?? [], defaultEquipmentPresetIds: t?.defaultEquipmentPresetIds ?? [],
        permissions: t?.permissions ?? [], archived: false,
      };
      groups.push(g);
      return g;
    },

    listTaskPresets: async () => taskPresets,
    createTaskPreset: async (input) => {
      const p: TaskPreset = { ...input, id: `tp${taskPresets.length + 1}`, createdAt: Date.now(), updatedAt: Date.now() };
      taskPresets = [...taskPresets, p];
      return p;
    },
    updateTaskPreset: async (id, patch) => { const p = taskPresets.find((x) => x.id === id); if (p) Object.assign(p, patch, { updatedAt: Date.now() }); return p; },
    deleteTaskPreset: async (id) => { taskPresets = taskPresets.filter((p) => p.id !== id); return true; },
    runTaskPreset: async (id): Promise<BulkResult> => {
      const preset = taskPresets.find((p) => p.id === id);
      const targets = workers.filter((w) => preset?.targetWorkerIds.includes(w.id));
      const outcomes = targets.map((w) => ({ workerId: w.id, label: w.label || w.username, ok: w.online, outcome: w.online ? 'completed' : 'disconnected', detail: w.online ? 'done' : 'not connected' }));
      const completed = outcomes.filter((o) => o.outcome === 'completed').length;
      return {
        ok: outcomes.length > 0 && completed === outcomes.length, total: outcomes.length, completed,
        failed: 0, disconnected: outcomes.length - completed, skipped: 0,
        message: `${completed} completed, ${outcomes.length - completed} disconnected`, outcomes,
      };
    },

    listSchedules: async () => schedules.map((s) => ({ ...s, missed: 0 })),
    createSchedule: async (input) => {
      const record: ScheduleRecord = {
        id: `sc${schedules.length + 1}`, name: input.name, presetId: input.presetId ?? null, kind: input.kind,
        params: input.params ?? {}, targetWorkerIds: input.targetWorkerIds ?? [], targetGroupIds: input.targetGroupIds ?? [],
        scheduleKind: input.scheduleKind, startAt: input.startAt ?? Date.now(), intervalMs: input.intervalMs ?? null,
        timeOfDay: input.timeOfDay ?? null, stopAt: input.stopAt ?? null, enabled: input.enabled ?? true,
        lastFiredAt: null, fireCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
      };
      schedules = [...schedules, record];
      return record;
    },
    updateSchedule: async (id, patch) => { const s = schedules.find((x) => x.id === id); if (s) Object.assign(s, patch, { updatedAt: Date.now() }); return s; },
    deleteSchedule: async (id) => { schedules = schedules.filter((s) => s.id !== id); return true; },
    tickSchedules: async () => [],

    listRules: async () => rules,
    createRule: async (input) => {
      const rule: AutomationRule = {
        id: `r${rules.length + 1}`, name: input.name, event: input.event, conditions: input.conditions ?? [],
        action: input.action, cooldownMs: input.cooldownMs ?? 0, maxRuns: input.maxRuns ?? null,
        enabled: input.enabled ?? true, runCount: 0, lastRunAt: null, createdAt: Date.now(), updatedAt: Date.now(),
      };
      rules = [...rules, rule];
      return rule;
    },
    updateRule: async (id, patch) => { const r = rules.find((x) => x.id === id); if (r) Object.assign(r, patch, { updatedAt: Date.now() }); return r; },
    deleteRule: async (id) => { rules = rules.filter((r) => r.id !== id); return true; },

    listContainers: async (workerId) => (workerId ? containers.filter((c) => c.workerId === workerId) : containers),
    deleteContainer: async (id) => { containers = containers.filter((c) => c.id !== id); return true; },
    inventoryTrend: async () => [
      { at: now - 3 * 3600_000, count: 12 }, { at: now - 2 * 3600_000, count: 20 },
      { at: now - 3600_000, count: 18 }, { at: now, count: 30 },
    ],
    inventoryCaptures: async () => [now, now - 3600_000, now - 2 * 3600_000],
    addWorkerTag: async (id, tag) => { const w = workers.find((x) => x.id === id); if (w && !w.tags.includes(tag)) w.tags.push(tag); return true; },
    removeWorkerTag: async (id, tag) => { const w = workers.find((x) => x.id === id); if (w) w.tags = w.tags.filter((t) => t !== tag); return true; },
    setWorkerTags: async (id, tags) => { const w = workers.find((x) => x.id === id); if (w) w.tags = tags; return true; },
    listAllTags: async () => [...new Set(workers.flatMap((w) => w.tags))].sort(),
    listAudit: async () => audit,

    getStatistics: async () => buildStatistics({
      workers,
      tasks,
      commands,
      events,
      inventory: [...inventories.values()],
      schedules,
      rules,
      containers,
      audit,
    }),
    exportStatistics: async () => ({ path: '/demo/logvex-statistics.json' }),

    onEvent: () => () => {},
  };
}
