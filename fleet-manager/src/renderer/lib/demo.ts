/**
 * Development-only demo bridge.
 *
 * When the renderer runs in a plain browser (Vite dev server without Electron) and the URL carries
 * `?demo`, this module supplies a fully populated, in-memory {@link FleetApi}. It exists so the UI
 * can be developed and screenshotted without the Electron main process. It is loaded through a
 * dynamic import guarded by `import.meta.env.DEV`, so it is tree-shaken out of production builds.
 */
import type { FleetApi, DeploymentPreview, DeploymentMonitor } from '../../shared/ipc';
import type {
  Account, AppSettings, DeploymentConfig, DeploymentQueueItem, EquipmentProfileRecord, FleetEvent,
  Group, HealthReport, ItemCountReport, NotificationItem, RegearComparison, RegearPreset, ServerProfile,
  StasisLocation, TargetEntry, WorkerCommandRecord, WorkerGroup, WorkerInventorySnapshot, WorkerOverview,
  WorkerTaskRecord, WorkerView,
} from '../../shared/types';
import type { AccountView } from '../../main/services/accounts/account-manager';
import type { RuntimeInstance } from '../../main/services/instances/instance-manager';
import type { RoleDefinition } from '../../main/services/roles/roles';

const now = Date.now();

const settings: AppSettings = {
  apiEnabled: true, apiHost: '127.0.0.1', apiPort: 8791, hunterAddonUrl: 'http://127.0.0.1:8720',
  hunterAddonToken: '', autosave: true, notify: true, maxMemoryMb: 4096, backupIntervalMinutes: 60,
  logLevel: 'info', theme: 'dark', uiMode: 'beginner',
  workerServerEnabled: true, workerServerPort: 8721, workerServerHost: '127.0.0.1',
};

const health: HealthReport = {
  ok: true, version: '1.0.0', uptimeMs: 3_720_000,
  instances: { total: 6, running: 4, failed: 1 },
  database: { ok: true, path: '/home/user/.config/logvex/fleet.sqlite' },
  hunter: { connected: true, url: 'http://127.0.0.1:8080', lastSync: now - 42_000 },
};

const servers: ServerProfile[] = [
  { id: 'srv-1', name: '6b6t.org', host: '6b6t.org', port: 25565, version: '1.21.11', authMode: 'offline', connectionTimeoutMs: 15000, options: {}, createdAt: now, updatedAt: now },
  { id: 'srv-2', name: 'Private Test', host: '127.0.0.1', port: 25566, version: '1.21.11', authMode: 'offline', connectionTimeoutMs: 10000, options: {}, createdAt: now, updatedAt: now },
];

const groups: Group[] = [
  { id: 'grp-1', name: 'Raiders', description: 'Primary offensive group', color: '#f56565', createdAt: now },
  { id: 'grp-2', name: 'Support', description: 'Gear + stasis support', color: '#4fd1c5', createdAt: now },
];

const accounts: AccountView[] = [
  { id: 'acc-1', username: 'logvex_hunter', displayName: 'Hunter One', authMode: 'offline', role: 'HUNTER', groupId: 'grp-1', hasCredential: false, lastLogin: now - 60_000, lastLoginOk: true, serverProfileId: 'srv-1', notes: '', createdAt: now, updatedAt: now, deployable: true, blockedReason: null },
  { id: 'acc-2', username: 'logvex_gearer', displayName: 'Gearer One', authMode: 'offline', role: 'GEARER', groupId: 'grp-2', hasCredential: false, lastLogin: now - 120_000, lastLoginOk: true, serverProfileId: 'srv-1', notes: '', createdAt: now, updatedAt: now, deployable: true, blockedReason: null },
  { id: 'acc-3', username: 'logvex_stasis', displayName: 'Stasis One', authMode: 'offline', role: 'STASIS', groupId: 'grp-2', hasCredential: false, lastLogin: now - 200_000, lastLoginOk: true, serverProfileId: 'srv-1', notes: '', createdAt: now, updatedAt: now, deployable: true, blockedReason: null },
  { id: 'acc-4', username: 'logvex_alt2', displayName: 'Alt Two', authMode: 'microsoft', role: 'HUNTER', groupId: 'grp-1', hasCredential: false, lastLogin: null, lastLoginOk: false, serverProfileId: 'srv-1', notes: '', createdAt: now, updatedAt: now, deployable: false, blockedReason: 'No stored credential. Add one before deploying.' },
];

function instance(over: Partial<RuntimeInstance>): RuntimeInstance {
  return {
    id: 'inst', name: 'BOT', accountId: 'acc-1', role: 'HUNTER', groupId: null, serverProfileId: 'srv-1',
    config: {}, priority: 1, state: 'STOPPED', connection: 'OFFLINE', health: 100, uptimeMs: 0,
    startedAt: null, stoppedAt: null, lastError: null, lastEvent: null,
    metrics: { memoryBytes: 0, cpuPercent: 0, ping: 0, dimension: '', health: 20, food: 20 },
    logs: [], accountUsername: 'unknown', ...over,
  };
}

const instances: RuntimeInstance[] = [
  instance({ id: 'inst-1', name: 'HUNTER-01', accountId: 'acc-1', accountUsername: 'logvex_hunter', role: 'HUNTER', state: 'RUNNING', connection: 'ONLINE', health: 96, uptimeMs: 3_600_000, startedAt: now - 3_600_000, metrics: { memoryBytes: 268_000_000, cpuPercent: 18, ping: 42, position: { x: 128, y: 71, z: -340 }, dimension: 'minecraft:overworld', health: 19, food: 18 }, lastEvent: 'Target Steve detected (24m)', logs: ['[INFO] connecting to 6b6t.org', '[INFO] spawned as logvex_hunter', '[INFO] target Steve detected (24m)'] }),
  instance({ id: 'inst-2', name: 'GEARER-01', accountId: 'acc-2', accountUsername: 'logvex_gearer', role: 'GEARER', state: 'RUNNING', connection: 'ONLINE', health: 88, uptimeMs: 3_540_000, startedAt: now - 3_540_000, metrics: { memoryBytes: 241_000_000, cpuPercent: 14, ping: 51, position: { x: 120, y: 64, z: -350 }, dimension: 'minecraft:overworld', health: 20, food: 20 }, lastEvent: 'Equipment warning: totems low', logs: ['[INFO] spawned as logvex_gearer', '[WARN] equipment warning: totems 0/1'] }),
  instance({ id: 'inst-3', name: 'STASIS-01', accountId: 'acc-3', accountUsername: 'logvex_stasis', role: 'STASIS', state: 'RUNNING', connection: 'ONLINE', health: 100, uptimeMs: 3_480_000, startedAt: now - 3_480_000, metrics: { memoryBytes: 232_000_000, cpuPercent: 9, ping: 48, position: { x: 96, y: 12, z: -410 }, dimension: 'minecraft:overworld', health: 20, food: 20 }, lastEvent: 'Stasis ready', logs: ['[INFO] stasis ready'] }),
  instance({ id: 'inst-4', name: 'HUNTER-02', accountId: 'acc-1', accountUsername: 'logvex_hunter', role: 'HUNTER', state: 'RUNNING', connection: 'ONLINE', health: 74, uptimeMs: 1_800_000, startedAt: now - 1_800_000, metrics: { memoryBytes: 210_000_000, cpuPercent: 22, ping: 190, position: { x: 300, y: 64, z: 20 }, dimension: 'minecraft:nether', health: 12, food: 9 }, lastEvent: 'Ping high (190ms)', logs: ['[WARN] ping high (190ms)'] }),
  instance({ id: 'inst-5', name: 'GEARER-02', accountId: 'acc-2', accountUsername: 'logvex_gearer', role: 'GEARER', state: 'FAILED', connection: 'ERROR', health: 0, uptimeMs: 0, lastError: 'connection timed out after 15000ms', logs: ['[ERROR] connection timed out after 15000ms'] }),
  instance({ id: 'inst-6', name: 'STASIS-02', accountId: 'acc-3', accountUsername: 'logvex_stasis', role: 'STASIS', state: 'STOPPED', connection: 'OFFLINE', health: 100, uptimeMs: 0, logs: [] }),
];

const targets: TargetEntry[] = [
  { id: 't-1', uuid: 'aaaaaaaa-1111-2222-3333-444444444444', username: 'Steve', displayName: 'Steve', category: 'PRIORITY', priority: 1, notes: 'Griefs spawn', tags: ['griefer'], source: 'hunter', kills: 4, deaths: 1, encounters: 12, lastSeen: now - 24_000, lastPosition: { x: 128, y: 71, z: -340 }, dimension: 'minecraft:overworld', updatedAt: now },
  { id: 't-2', uuid: null, username: 'GrieferKing', displayName: 'GrieferKing', category: 'PRIORITY', priority: 2, notes: '', tags: [], source: 'fleet', kills: 2, deaths: 3, encounters: 9, lastSeen: now - 3_600_000, lastPosition: null, dimension: '', updatedAt: now },
  { id: 't-3', uuid: 'bbbbbbbb-1111-2222-3333-444444444444', username: 'BotFarm99', displayName: 'BotFarm99', category: 'BOT', priority: 4, notes: 'Automated farm bot', tags: ['bot'], source: 'hunter', kills: 18, deaths: 0, encounters: 18, lastSeen: now - 600_000, lastPosition: null, dimension: '', updatedAt: now },
  { id: 't-4', uuid: null, username: 'AllyTom', displayName: 'AllyTom', category: 'FRIEND', priority: 9, notes: 'Do not engage', tags: ['friend'], source: 'fleet', kills: 0, deaths: 0, encounters: 5, lastSeen: now - 90_000, lastPosition: null, dimension: '', updatedAt: now },
  { id: 't-5', uuid: null, username: 'SpamBot', displayName: 'SpamBot', category: 'IGNORE', priority: 10, notes: '', tags: [], source: 'fleet', kills: 0, deaths: 0, encounters: 2, lastSeen: now - 7_200_000, lastPosition: null, dimension: '', updatedAt: now },
];

const stasis: StasisLocation[] = [
  { id: 'st-1', name: 'Main Base', instanceId: 'inst-3', serverProfileId: 'srv-1', dimension: 'minecraft:overworld', x: 96, y: 12, z: -410, state: 'READY', lastActivity: now - 30_000, lastVerified: now - 30_000, lastError: null, config: {}, createdAt: now, updatedAt: now },
  { id: 'st-2', name: 'Nether Portal', instanceId: 'inst-6', serverProfileId: 'srv-1', dimension: 'minecraft:nether', x: 48, y: 64, z: -200, state: 'UNAVAILABLE', lastActivity: now - 1_800_000, lastVerified: now - 1_800_000, lastError: 'missing blocks', config: {}, createdAt: now, updatedAt: now },
];

const equipment: EquipmentProfileRecord[] = [
  { id: 'eq-1', name: 'PvP Standard', serverProfileId: 'srv-1', weapons: ['netherite_sword', 'netherite_axe'], minArmorPieces: 4, minTotems: 1, minFood: 8, lowDurabilityPercent: 15, sortOrder: [], warningThresholds: {}, createdAt: now, updatedAt: now },
  { id: 'eq-2', name: 'Scout Light', serverProfileId: null, weapons: ['iron_sword'], minArmorPieces: 2, minTotems: 0, minFood: 4, lowDurabilityPercent: 25, sortOrder: [], warningThresholds: {}, createdAt: now, updatedAt: now },
];

const deployments: DeploymentConfig[] = [
  {
    id: 'dep-1', name: '6b6t Raid Squad', description: 'Hunter pair + gearer + stasis', serverProfileId: 'srv-1',
    entries: [
      { accountId: 'acc-2', role: 'GEARER', instanceName: 'GEARER-01', delayMs: 0, roleConfig: {} },
      { accountId: 'acc-3', role: 'STASIS', instanceName: 'STASIS-01', delayMs: 2000, roleConfig: {} },
      { accountId: 'acc-1', role: 'HUNTER', instanceName: 'HUNTER-01', delayMs: 4000, roleConfig: {} },
      { accountId: 'acc-1', role: 'HUNTER', instanceName: 'HUNTER-02', delayMs: 6000, roleConfig: {} },
    ],
    maxConcurrent: 1, connectionTimeoutMs: 15000, retryAttempts: 2, retryDelayMs: 5000,
    manualApproval: false, pauseBetweenMs: 5000, resourceLimitMb: 4096, notifyOnEvent: true, createdAt: now, updatedAt: now,
  },
];

const queueItems: DeploymentQueueItem[] = deployments[0].entries.map((entry, index) => ({
  id: `q-${index}`, deploymentId: 'dep-1', accountId: entry.accountId, instanceName: entry.instanceName,
  role: entry.role, roleConfig: {}, position: index,
  stage: (index < 3 ? 'RUNNING' : index === 3 ? 'FAILED' : 'WAITING') as DeploymentQueueItem['stage'],
  attempts: index === 3 ? 3 : 0, error: index === 3 ? 'connection timed out after 15000ms' : null,
  startedAt: now - 100_000 + index * 1000, finishedAt: index < 3 ? now - 60_000 : null,
}));

const workerGroups: WorkerGroup[] = [
  { id: 'wg-1', name: 'miners', description: 'Branch mining crew', color: '#22c55e', createdAt: now - 900_000 },
  { id: 'wg-2', name: 'guards', description: 'Base defence', color: '#ef4444', createdAt: now - 800_000 },
];

const workerSnapshot = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  workerId: id, label: '', username: 'bot', minecraftVersion: '1.21.11', serverAddress: '6b6t.org',
  dimension: 'minecraft:overworld', gameMode: 'survival', inWorld: true, x: 128, y: 64, z: -512,
  health: 20, maxHealth: 20, food: 20, saturation: 5, armorPieces: 4, totems: 3, foodItems: 24,
  heldItem: 'Netherite Sword', offhandItem: 'Shield', currentTask: '', lastActivity: '', lastActivityAt: 0,
  lastError: '', totalItems: 412, distinctItems: 18, freeSlots: 12,
  capabilities: ['status', 'inventory', 'count', 'search', 'equipment', 'regear', 'command', 'chat', 'position'],
  ...over,
});

const workers: WorkerView[] = [
  {
    id: 'w-1', label: 'miner-1', username: 'Digger', minecraftVersion: '1.21.11', serverAddress: '6b6t.org',
    protocolVersion: 1, modVersion: '1.0.0', groupId: 'wg-1', notes: 'main branch miner',
    firstSeen: now - 3_600_000, lastSeen: now - 2_000, lastAddress: '10.0.0.21', status: 'ONLINE',
    online: true, lastHeartbeatAgeSeconds: 2, connectedAt: now - 1_200_000,
    snapshot: workerSnapshot('w-1', { username: 'Digger', health: 18, totems: 4, x: 128, z: -512 }) as never,
    currentTask: '',
    capabilities: ['status', 'inventory', 'count', 'search', 'equipment', 'regear', 'command', 'chat', 'position'],
  },
  {
    id: 'w-2', label: 'guard-1', username: 'Sentinel', minecraftVersion: '1.21.11', serverAddress: '6b6t.org',
    protocolVersion: 1, modVersion: '1.0.0', groupId: 'wg-2', notes: '',
    firstSeen: now - 2_400_000, lastSeen: now - 1_000, lastAddress: '10.0.0.22', status: 'ONLINE',
    online: true, lastHeartbeatAgeSeconds: 1, connectedAt: now - 900_000,
    snapshot: workerSnapshot('w-2', { username: 'Sentinel', heldItem: 'Netherite Axe', totems: 1 }) as never,
    currentTask: '',
    capabilities: ['status', 'inventory', 'count', 'search', 'equipment', 'regear', 'command', 'chat', 'position'],
  },
  {
    id: 'w-3', label: 'farm-1', username: 'Harvester', minecraftVersion: '1.21.11', serverAddress: '6b6t.org',
    protocolVersion: 1, modVersion: '1.0.0', groupId: null, notes: 'needs regearing',
    firstSeen: now - 7_200_000, lastSeen: now - 480_000, lastAddress: '10.0.0.23', status: 'DEGRADED',
    online: false, lastHeartbeatAgeSeconds: null, connectedAt: null,
    snapshot: workerSnapshot('w-3', { username: 'Harvester', inWorld: false, totems: 0, health: 6, armorPieces: 1, dimension: 'unknown' }) as never,
    currentTask: '',
    capabilities: ['status', 'inventory', 'count'],
  },
];

const workerOverview: WorkerOverview = {
  total: 3, online: 2, offline: 1, degraded: 1, activeTasks: 1, trackedItems: 1234,
  groups: [
    { group: workerGroups[0], workers: 1, online: 1 },
    { group: workerGroups[1], workers: 1, online: 1 },
  ],
  recent: [
    { id: 'we-1', type: 'WORKER_REGISTERED', source: 'fleet', severity: 'info', instanceId: null, accountId: null, targetUuid: null, message: 'Worker Digger connected', payload: {}, timestamp: now - 1_200_000 },
    { id: 'we-2', type: 'WORKER_INVENTORY', source: 'fleet', severity: 'info', instanceId: null, accountId: null, targetUuid: null, message: 'Inventory reported by w-2', payload: {}, timestamp: now - 40_000 },
    { id: 'we-3', type: 'WORKER_TASK_FINISHED', source: 'fleet', severity: 'success', instanceId: null, accountId: null, targetUuid: null, message: 'count finished on w-1: 64 diamond', payload: {}, timestamp: now - 20_000 },
  ],
};

const workerInventory: WorkerInventorySnapshot[] = [
  {
    workerId: 'w-1', capturedAt: now - 30_000, containerOpen: false,
    carried: [
      { id: 'minecraft:diamond', name: 'Diamond', count: 64, slot: 0, damage: 0, maxDamage: 0, damageable: false },
      { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 4, slot: 1, damage: 0, maxDamage: 0, damageable: false },
      { id: 'minecraft:golden_apple', name: 'Golden Apple', count: 24, slot: 2, damage: 0, maxDamage: 0, damageable: false },
    ],
    accessible: [],
    armor: [
      { id: 'minecraft:netherite_helmet', name: 'Netherite Helmet', count: 1, slot: 39, damage: 30, maxDamage: 407, damageable: true },
      { id: 'minecraft:netherite_chestplate', name: 'Netherite Chestplate', count: 1, slot: 38, damage: 120, maxDamage: 592, damageable: true },
    ],
  },
  {
    workerId: 'w-2', capturedAt: now - 12_000, containerOpen: false,
    carried: [
      { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 1, slot: 0, damage: 0, maxDamage: 0, damageable: false },
      { id: 'minecraft:ender_pearl', name: 'Ender Pearl', count: 16, slot: 1, damage: 0, maxDamage: 0, damageable: false },
    ],
    accessible: [], armor: [],
  },
];

const workerTasks: WorkerTaskRecord[] = [
  { id: 'wt-1', workerId: 'w-1', kind: 'count', status: 'SUCCEEDED', params: { query: 'diamond' }, result: { message: '64 diamond' }, error: null, createdAt: now - 20_000, dispatchedAt: now - 20_000, completedAt: now - 19_800, durationMs: 180, actor: 'host' },
  { id: 'wt-2', workerId: 'w-2', kind: 'inventory', status: 'SUCCEEDED', params: {}, result: { message: 'inventory reported' }, error: null, createdAt: now - 12_000, dispatchedAt: now - 12_000, completedAt: now - 11_900, durationMs: 110, actor: 'host' },
  { id: 'wt-3', workerId: 'w-3', kind: 'regear', status: 'TIMEOUT', params: { allowMoves: true }, result: null, error: 'no result within 15000ms', createdAt: now - 480_000, dispatchedAt: now - 480_000, completedAt: now - 465_000, durationMs: 15000, actor: 'host' },
];

const workerCommands: WorkerCommandRecord[] = [
  { id: 'wc-1', workerId: 'w-1', kind: 'command', line: '/spawn', ok: true, response: 'Teleported to spawn', createdAt: now - 60_000 },
  { id: 'wc-2', workerId: 'w-3', kind: 'chat', line: 'regearing now', ok: false, response: 'command not on the allow-list', createdAt: now - 120_000 },
];

const regearPresets: RegearPreset[] = [
  {
    id: 'rp-1', name: 'standard pvp', description: 'Front-line loadout',
    items: [
      { query: 'totem', count: 2, label: 'Totem of Undying' },
      { query: 'gapple', count: 16, label: 'Golden apples' },
      { query: 'diamond_sword', count: 1, label: 'Sword' },
    ],
    minArmorPieces: 4, minFood: 8, lowDurabilityPercent: 15, createdAt: now - 600_000, updatedAt: now - 600_000,
  },
];

const itemCountReport: ItemCountReport = {
  query: 'diamond', total: 64, stale: false, oldestCapture: now - 30_000,
  rows: [
    { workerId: 'w-1', label: 'miner-1', username: 'Digger', online: true, count: 64, capturedAt: now - 30_000 },
    { workerId: 'w-2', label: 'guard-1', username: 'Sentinel', online: true, count: 0, capturedAt: now - 12_000 },
    { workerId: 'w-3', label: 'farm-1', username: 'Harvester', online: false, count: 0, capturedAt: 0 },
  ],
};

const regearComparison: RegearComparison = {
  workerId: 'w-1', presetId: 'rp-1', presetName: 'standard pvp', ready: false,
  gaps: [
    { query: 'totem', label: 'Totem of Undying', required: 2, found: 4, missing: 0 },
    { query: 'gapple', label: 'Golden apples', required: 16, found: 24, missing: 0 },
    { query: 'diamond_sword', label: 'Sword', required: 1, found: 0, missing: 1 },
  ],
  armorPieces: 4, minArmorPieces: 4, food: 24, minFood: 8, damaged: [], capturedAt: now - 30_000,
};

const events: FleetEvent[] = [
  { id: 'e-1', type: 'TARGET_DETECTED', source: 'meteor', severity: 'info', instanceId: 'inst-1', accountId: 'acc-1', targetUuid: 'aaaaaaaa-1111-2222-3333-444444444444', message: 'Target Steve detected (24m)', payload: {}, timestamp: now - 24_000 },
  { id: 'e-2', type: 'EQUIPMENT_WARNING', source: 'fleet', severity: 'warning', instanceId: 'inst-2', accountId: 'acc-2', targetUuid: null, message: 'GEARER-01 totems low: 0/1', payload: {}, timestamp: now - 120_000 },
  { id: 'e-3', type: 'STASIS_STATE_CHANGED', source: 'fleet', severity: 'success', instanceId: 'inst-3', accountId: 'acc-3', targetUuid: null, message: 'Stasis Main Base READY', payload: {}, timestamp: now - 300_000 },
  { id: 'e-4', type: 'INSTANCE_ERROR', source: 'fleet', severity: 'error', instanceId: 'inst-5', accountId: 'acc-2', targetUuid: null, message: 'GEARER-02 failed: connection timed out after 15000ms', payload: {}, timestamp: now - 600_000 },
  { id: 'e-5', type: 'DEPLOYMENT_STARTED', source: 'fleet', severity: 'info', instanceId: null, accountId: null, targetUuid: null, message: 'Deployment "6b6t Raid Squad" started', payload: {}, timestamp: now - 900_000 },
  { id: 'e-6', type: 'TARGET_DISAPPEARED', source: 'meteor', severity: 'info', instanceId: 'inst-4', accountId: 'acc-1', targetUuid: null, message: 'Target GrieferKing left render distance', payload: {}, timestamp: now - 1_200_000 },
  { id: 'e-7', type: 'INSTANCE_CONNECTED', source: 'fleet', severity: 'success', instanceId: 'inst-1', accountId: 'acc-1', targetUuid: null, message: 'HUNTER-01 connected', payload: {}, timestamp: now - 3_600_000 },
];

const notifications: NotificationItem[] = [
  { id: 'n-1', eventId: 'e-4', type: 'INSTANCE_ERROR', severity: 'error', title: 'Instance failed', body: 'GEARER-02 could not connect.', timestamp: now - 600_000, read: false },
  { id: 'n-2', eventId: 'e-2', type: 'EQUIPMENT_WARNING', severity: 'warning', title: 'Equipment warning', body: 'GEARER-01 is low on totems.', timestamp: now - 120_000, read: false },
  { id: 'n-3', eventId: 'e-3', type: 'STASIS_STATE_CHANGED', severity: 'success', title: 'Stasis ready', body: 'Main Base verified.', timestamp: now - 300_000, read: true },
];

const roleCatalog: RoleDefinition[] = [
  { role: 'GEARER', title: 'Gearer', color: '#4fd1c5', description: 'Keeps the squad equipped and warns about shortfalls.', emits: ['EQUIPMENT_READY', 'EQUIPMENT_WARNING'], permissions: { mayAttack: false, mayMove: false, mayChat: true, mayUseItems: false, mayManageStasis: false, mayReadTargets: true, mayEmitCombatEvents: false } as never, fields: [
    { key: 'equipmentProfileId', label: 'Equipment profile', type: 'string', default: '', description: 'Profile to evaluate against.' },
    { key: 'minTotems', label: 'Min totems', type: 'number', default: 1, description: 'Warn below this many totems.' },
    { key: 'autoSort', label: 'Auto sort inventory', type: 'boolean', default: false, description: 'Reorganise inventory (off by default).' },
  ] },
  { role: 'STASIS', title: 'Stasis Controller', color: '#9f7aea', description: 'Monitors a stasis location and reports readiness.', emits: ['STASIS_READY', 'STASIS_UNAVAILABLE'], permissions: { mayAttack: false, mayMove: false, mayChat: true, mayUseItems: false, mayManageStasis: true, mayReadTargets: false, mayEmitCombatEvents: false } as never, fields: [
    { key: 'requiredItems', label: 'Required components', type: 'stringList', default: ['obsidian', 'crystal'], description: 'Items that must be present.' },
    { key: 'dangerHealth', label: 'Danger health', type: 'number', default: 8, description: 'Report danger below this health.' },
    { key: 'notifyOnLoss', label: 'Notify on connection loss', type: 'boolean', default: true, description: 'Raise an alert on disconnect.' },
  ] },
  { role: 'HUNTER', title: 'Hunter', color: '#f56565', description: 'Tracks allow-listed targets; combat is delegated to Logvex Hunter.', emits: ['TARGET_DETECTED', 'TARGET_DISAPPEARED'], permissions: { mayAttack: false, mayMove: false, mayChat: true, mayUseItems: false, mayManageStasis: false, mayReadTargets: true, mayEmitCombatEvents: true } as never, fields: [
    { key: 'allowlist', label: 'Target allow-list', type: 'stringList', default: [], description: 'Only these players are ever observed/engaged.' },
    { key: 'authorizedCombat', label: 'Authorise combat testing', type: 'boolean', default: false, description: 'Required before any combat testing.' },
    { key: 'combatEnabled', label: 'Combat testing enabled', type: 'boolean', default: false, description: 'Arms allow-listed combat testing.' },
  ] },
];

const preview: DeploymentPreview = {
  totalAccounts: 4,
  byRole: { GEARER: 1, STASIS: 1, HUNTER: 2 },
  serverName: '6b6t.org',
  order: deployments[0].entries.map((e) => ({ instanceName: e.instanceName, role: e.role, account: accounts.find((a) => a.id === e.accountId)?.username ?? '?', delayMs: e.delayMs })),
  maxConcurrent: 1,
  estimatedMemoryMb: 1024,
  report: { ok: true, issues: [{ level: 'warning', code: 'delay', message: 'Instance starts are 2s apart; consider a longer delay for stability.', subject: 'STASIS-01' }] },
};

const monitor: DeploymentMonitor = { state: 'RUNNING', deployment: deployments[0], items: queueItems };

export function createDemoApi(): FleetApi {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  const listeners = new Set<(event: FleetEvent) => void>();
  const api = {
    getHealth: async () => clone(health),
    getSettings: async () => clone(settings),
    saveSettings: async (patch: Partial<AppSettings>) => Object.assign(settings, patch),
    getApiToken: async () => 'demo-token-0123456789abcdef',
    regenerateApiToken: async () => 'demo-token-fedcba9876543210',
    getDiagnostics: async () => ({ host: '6b6t.org', dns: { host: '6b6t.org', addresses: ['1.2.3.4'], durationMs: 12, error: null }, latency: { reachable: true, latencyMs: 38, error: null }, interfaces: [{ name: 'eth0', address: '10.0.0.5', family: 'IPv4', internal: false }], timestamp: now }),
    exportConfig: async () => ({ path: '/tmp/logvex-config.json' }),
    importConfig: async () => ({ imported: 0 }),
    backupDatabase: async () => ({ path: '/tmp/logvex-backup.sqlite' }),

    getSetupReport: async () => ({
      ready: false,
      completion: 0.5,
      nextStepId: 'deploy',
      nextHint: 'Launch a deployment to bring your bots online.',
      steps: [
        { id: 'server', title: 'Add a server', description: 'Tell the app which server your bots should join.', status: 'done', page: 'servers', actionLabel: 'Add server', optional: false },
        { id: 'account', title: 'Add an account', description: 'Each bot needs its own account.', status: 'done', page: 'accounts', actionLabel: 'Add account', optional: false },
        { id: 'credential', title: 'Add a password where needed', description: 'Online servers need a stored password.', status: 'todo', page: 'accounts', actionLabel: 'Fix accounts', optional: false },
        { id: 'deploy', title: 'Start your bots', description: 'Launch a deployment to bring your bots online.', status: 'todo', page: 'tasks', actionLabel: 'Start bots', optional: false },
        { id: 'hunter', title: 'Connect Logvex Hunter (optional)', description: 'Link the Hunter addon.', status: 'done', page: 'settings', actionLabel: 'Connect', optional: true },
      ],
    }),
    quickSetup: async (input: { username: string; host: string }) => ({ serverProfileId: 'srv-1', accountId: 'acc-1', created: { server: false, account: true } }),
    quickDeploy: async () => ({ ok: true, report: clone(preview.report), deploymentId: 'dep-1' }),

    listAccounts: async () => clone(accounts),
    createAccount: async (input: Partial<Account>) => ({ ...clone(accounts[0]), ...input, id: `acc-${Date.now()}`, deployable: true, blockedReason: null } as AccountView),
    updateAccount: async (id: string, patch: Partial<Account>) => ({ ...clone(accounts[0]), id, ...patch } as AccountView),
    deleteAccount: async () => true,
    setCredential: async () => ({ ok: true }),
    clearCredential: async () => ({ ok: true }),
    loginAccount: async () => ({ ok: true }),

    listServers: async () => clone(servers),
    createServer: async (input: Partial<ServerProfile>) => ({ ...clone(servers[0]), ...input, id: `srv-${Date.now()}` } as ServerProfile),
    updateServer: async (id: string, patch: Partial<ServerProfile>) => ({ ...clone(servers[0]), id, ...patch } as ServerProfile),
    deleteServer: async () => true,
    testServer: async () => ({ host: '6b6t.org', dns: { host: '6b6t.org', addresses: ['1.2.3.4'], durationMs: 12, error: null }, latency: { reachable: true, latencyMs: 38, error: null }, interfaces: [], timestamp: now }),

    listGroups: async () => clone(groups),
    createGroup: async (name: string) => ({ ...clone(groups[0]), id: `grp-${Date.now()}`, name } as Group),
    updateGroup: async () => true,
    deleteGroup: async () => true,
    assignInstanceGroup: async () => true,
    assignAccountGroup: async () => true,

    listInstances: async () => clone(instances),
    createInstance: async (input: Partial<import('../../shared/types').InstanceRecord>) => ({ ...clone(instances[0]), ...input, id: `inst-${Date.now()}` } as RuntimeInstance),
    updateInstance: async (id: string, patch: Partial<import('../../shared/types').InstanceRecord>) => ({ ...clone(instances[0]), id, ...patch } as RuntimeInstance),
    deleteInstance: async () => true,
    startInstance: async () => clone(instances[0]),
    stopInstance: async () => clone(instances[0]),
    restartInstance: async () => clone(instances[0]),
    sendInstanceCommand: async () => true,
    getInstanceLogs: async (id: string) => clone(instances.find((i) => i.id === id)?.logs ?? []),

    getRoleCatalog: async () => clone(roleCatalog),
    validateRoleConfig: async (role: string, config: Record<string, unknown>) => (role === 'HUNTER' && !config.authorizedCombat ? [{ field: 'authorizedCombat', message: 'Combat testing requires explicit authorisation.' }] : []),

    listDeployments: async () => clone(deployments),
    getDeployment: async (id: string) => clone(deployments.find((d) => d.id === id)),
    createDeployment: async (input: Partial<DeploymentConfig>) => ({ ...clone(deployments[0]), ...input, id: `dep-${Date.now()}` } as DeploymentConfig),
    updateDeployment: async (id: string, patch: Partial<DeploymentConfig>) => ({ ...clone(deployments[0]), id, ...patch } as DeploymentConfig),
    deleteDeployment: async () => true,
    validateDeployment: async () => clone(preview.report),
    previewDeployment: async () => clone(preview),
    startDeployment: async () => ({ ok: true, report: clone(preview.report) }),
    pauseDeployment: async () => true,
    resumeDeployment: async () => true,
    cancelDeployment: async () => true,
    approveDeployment: async () => true,
    retryDeploymentItem: async () => true,
    getDeploymentMonitor: async () => clone(monitor),
    exportPreset: async () => ({ path: '/tmp/preset.json' }),
    importPreset: async () => clone(deployments[0]),
    duplicateDeployment: async (id: string) => ({ ...clone(deployments[0]), id: `${id}-copy` }),

    listTargets: async () => clone(targets),
    upsertTarget: async (input: Partial<TargetEntry> & { username: string }) => ({ ...clone(targets[0]), ...input, id: `t-${Date.now()}` } as TargetEntry),
    updateTarget: async (id: string, patch: Partial<TargetEntry>) => ({ ...clone(targets[0]), id, ...patch } as TargetEntry),
    deleteTarget: async () => true,
    syncTargets: async () => ({ pulled: 2, pushed: 0, skipped: 0, errors: [] }),
    hunterStatus: async () => ({ connected: true, url: 'http://127.0.0.1:8080', lastSync: now - 42_000 }),

    listStasis: async () => clone(stasis),
    createStasis: async (input: Partial<StasisLocation>) => ({ ...clone(stasis[0]), ...input, id: `st-${Date.now()}` } as StasisLocation),
    updateStasis: async (id: string, patch: Partial<StasisLocation>) => ({ ...clone(stasis[0]), id, ...patch } as StasisLocation),
    deleteStasis: async () => true,
    getStasisHistory: async (id: string) => [{ id: `${id}-h1`, locationId: id, from: 'UNKNOWN', to: 'READY', reason: 'verified', timestamp: now - 300_000 }],
    setStasisState: async (id: string, state: string) => ({ id: `${id}-h2`, locationId: id, from: 'READY', to: state as never, reason: 'manual', timestamp: now }),

    listEquipment: async () => clone(equipment),
    createEquipment: async (input: Partial<EquipmentProfileRecord>) => ({ ...clone(equipment[0]), ...input, id: `eq-${Date.now()}` } as EquipmentProfileRecord),
    updateEquipment: async (id: string, patch: Partial<EquipmentProfileRecord>) => ({ ...clone(equipment[0]), id, ...patch } as EquipmentProfileRecord),
    deleteEquipment: async () => true,
    evaluateEquipment: async () => ({ ready: false, warnings: [{ severity: 'warning', message: 'Totems low: 0/1' }, { severity: 'info', message: 'Duplicate stacks of cooked_beef (96)' }], armorPieces: 4, weapons: ['netherite_sword'], totems: 0, food: 96 }),

    listEvents: async () => clone(events),
    submitEvent: async () => ({ accepted: true }),
    listNotifications: async () => clone(notifications),
    markNotificationRead: async () => true,
    markAllNotificationsRead: async () => true,

    listWorkers: async () => clone(workers),
    getWorker: async (workerId: string) => clone(workers.find((w) => w.id === workerId)),
    getWorkerOverview: async () => clone(workerOverview),
    resolveWorkers: async (selector: string) => clone(workers.filter((w) => w.id === selector || w.username === selector || w.label === selector)),
    setWorkerLabel: async () => true,
    setWorkerNotes: async () => true,
    forgetWorker: async () => true,
    pingWorker: async () => true,
    kickWorker: async () => true,
    getWorkerServer: async () => ({ enabled: true, host: '127.0.0.1', port: 8721, bound: true, token: 'demo-worker-token' }),
    regenerateWorkerToken: async () => 'demo-worker-token-new',

    listWorkerGroups: async () => clone(workerGroups),
    createWorkerGroup: async (name: string, description?: string, color?: string) => ({ id: `wg-${Date.now()}`, name, description: description ?? '', color: color ?? '#6d5efc', createdAt: Date.now() }),
    updateWorkerGroup: async (id: string, patch: Partial<WorkerGroup>) => ({ ...clone(workerGroups[0]), id, ...patch } as WorkerGroup),
    deleteWorkerGroup: async () => true,
    assignWorkerGroup: async () => true,
    assignWorkerGroupBulk: async (ids: string[]) => ids.length,

    runWorkerTask: async (workerId: string, kind: string) => ({ ok: true, taskId: `wt-${Date.now()}`, kind, message: `did ${kind}`, data: {} }),
    runWorkerTaskMany: async (ids: string[], kind: string) => ids.map((workerId) => ({ workerId, ok: true, result: { ok: true, taskId: `wt-${Date.now()}`, kind, message: `did ${kind}`, data: {} } })),
    listWorkerTasks: async () => clone(workerTasks),
    getWorkerTaskKinds: async () => ['status', 'inventory', 'count', 'search', 'equipment', 'regear', 'command', 'chat', 'position'],

    sendWorkerLine: async (workerId: string, kind: 'command' | 'chat', line: string) => ({ id: `wc-${Date.now()}`, workerId, kind, line, ok: true, response: 'ok', createdAt: Date.now() }),
    sendWorkerLineMany: async (ids: string[], _kind: 'command' | 'chat', _line: string) => ids.map((workerId) => ({ workerId, ok: true, response: 'ok' })),
    listWorkerCommands: async () => clone(workerCommands),

    getWorkerInventory: async (workerId: string) => clone(workerInventory.find((s) => s.workerId === workerId)),
    countWorkerItem: async (query: string) => ({ ...clone(itemCountReport), query }),
    getCombinedTotals: async () => [
      { id: 'minecraft:diamond', name: 'Diamond', count: 64 },
      { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 5 },
      { id: 'minecraft:golden_apple', name: 'Golden Apple', count: 24 },
    ],
    exportWorkerReport: async () => ({ path: '/tmp/logvex-workers.json' }),

    listRegearPresets: async () => clone(regearPresets),
    createRegearPreset: async (input: Omit<RegearPreset, 'id' | 'createdAt' | 'updatedAt'>) => ({ ...input, id: `rp-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() }),
    updateRegearPreset: async (id: string, patch: Partial<RegearPreset>) => ({ ...clone(regearPresets[0]), id, ...patch } as RegearPreset),
    deleteRegearPreset: async () => true,
    compareRegearPreset: async (workerId: string, presetId: string) => ({ ...clone(regearComparison), workerId, presetId }),
    regearWorker: async (_workerId: string, _presetId: string, allowMoves?: boolean) => ({ ok: true, taskId: `wt-${Date.now()}`, kind: 'regear', message: allowMoves ? 'withdrew 1 item' : 'dry run: 1 item missing', data: {} }),
    regearWorkers: async (ids: string[]) => ids.map((workerId) => ({ workerId, ok: true, message: 'dry run complete' })),

    emergencyStop: async () => { for (const l of listeners) l({ id: `e-${Date.now()}`, type: 'SYSTEM', source: 'fleet', severity: 'error', instanceId: null, accountId: null, targetUuid: null, message: 'EMERGENCY STOP engaged', payload: {}, timestamp: Date.now() }); return true; },
    clearEmergencyStop: async () => true,

    onEvent: (callback: (event: FleetEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return api as unknown as FleetApi;
}
