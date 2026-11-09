/**
 * Development demo data.
 *
 * Served only when the renderer runs under the Vite dev server with `?demo` (used by the screenshot
 * script and for UI work without Electron). It implements the whole {@link FleetApi} over in-memory
 * data so every screen renders with realistic values and every button has something to act on. It
 * is never shipped in the production bundle.
 */
import type { FleetApi, WorkerServerStatus } from '../../shared/ipc';
import type {
  AppSettings, FleetEvent, ItemCountReport, PairingCode, RegearComparison, RegearPreset,
  WorkerCommandRecord, WorkerConsoleLine, WorkerGroup, WorkerInventorySnapshot, WorkerOverview,
  WorkerTaskRecord, WorkerView,
} from '../../shared/types';
import { emptySnapshot, TASK_KINDS, type TaskKind, type WorkerItem, type WorkerTaskResult } from '../../shared/workers';

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
  };
}

const groups: WorkerGroup[] = [
  { id: 'g1', name: 'Farmers', description: 'Farming crew', color: '#3fb950', createdAt: now },
  { id: 'g2', name: 'Miners', description: 'Mining crew', color: '#6d5efc', createdAt: now },
];

let workers: WorkerView[] = [
  makeWorker(1, 'LogvexOne', true, 'g1'),
  makeWorker(2, 'LogvexTwo', true, 'g2'),
  makeWorker(3, 'LogvexThree', false, null),
];

let tasks: WorkerTaskRecord[] = [];
let commands: WorkerCommandRecord[] = [];
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
      const g: WorkerGroup = { id: `g${groups.length + 1}`, name, description, color, createdAt: Date.now() };
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

    onEvent: () => () => {},
  };
}
