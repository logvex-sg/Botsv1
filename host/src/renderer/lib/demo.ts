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
  PairingCode, PairingStatus, PairedWorkerView, RegearComparison, RegearPreset, ScheduleRecord, ServerProfile, TaskPreset,
  WorkerCommandRecord, WorkerConsoleLine, WorkerGroup, WorkerInventorySnapshot, WorkerOverview,
  WorkerTaskRecord, WorkerView,
  AutomationPlan, DisposalRule, PortalRecord, RestockRule, ShulkerRecord, StorageActivityEntry,
  StorageCategory, StorageContainer, StorageNetwork, StorageOverview, StorageProfile, StructureRecord, WorkflowRecord,
} from '../../shared/types';
import { emptySnapshot, TASK_KINDS, type TaskKind, type WorkerItem, type WorkerTaskResult } from '../../shared/workers';
import { buildStatistics } from '../../main/packages/statistics';
import { plan as planWithAi } from '../../main/packages/ai-planner';
import { countByKind, fromPortal, issues as structureIssues, previewChange } from '../../main/packages/structure-registry';
import type { FormationSpec } from '../../main/packages/hive';
import type { HiveMapData, HiveOverview } from '../../main/hive/hive-service';

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

/** The demo's paired-worker roster, so the Dashboard's revoke/allow buttons have something to act on. */
const pairedWorkers: PairedWorkerView[] = [
  { workerId: 'w1', installationId: 'demo-install-1', label: 'LogvexOne', username: 'LogvexOne', createdAt: now - 900_000, lastPairedAt: now - 900_000, lastSeenAt: now - 5_000, revoked: false },
  { workerId: 'w2', installationId: 'demo-install-2', label: 'LogvexTwo', username: 'LogvexTwo', createdAt: now - 600_000, lastPairedAt: now - 600_000, lastSeenAt: now - 8_000, revoked: false },
];

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

let demoHiveEnabled = true;
let demoFormation: FormationSpec = { kind: 'circle', spacing: 2, radius: 6 };

/** A small static swarm for the demo Hive page. */
function demoHiveOverview(): HiveOverview {
  const members = [
    { workerId: 'w1', label: 'Commander', role: 'COMMANDER' as const, isCommander: true, online: true, x: 124, z: 64 },
    { workerId: 'w2', label: 'Scout Alpha', role: 'SCOUT' as const, isCommander: false, online: true, x: 132, z: 70 },
    { workerId: 'w3', label: 'Scout Beta', role: 'SCOUT' as const, isCommander: false, online: true, x: 116, z: 70 },
    { workerId: 'w4', label: 'Hauler', role: 'LOGISTICS' as const, isCommander: false, online: false, x: 120, z: 60 },
  ].map((m) => ({
    workerId: m.workerId,
    label: m.label,
    username: m.label,
    role: m.role,
    isCommander: m.isCommander,
    online: m.online,
    position: { x: m.x, y: 64, z: m.z },
    dimension: 'minecraft:overworld',
    health: 20,
    maxHealth: 20,
    currentTask: m.online ? (m.isCommander ? '' : 'Scout sector 2,1') : '',
    busy: !m.isCommander && m.online,
    formationTarget: m.isCommander ? null : { x: m.x, y: 64, z: m.z },
    distanceToCommander: m.isCommander ? null : 12,
    capabilities: ['navigate'],
  }));
  return {
    enabled: demoHiveEnabled,
    commanderId: 'w1',
    formation: demoFormation,
    activeObjective: 'Scout the surrounding area',
    members,
    online: members.filter((m) => m.online).length,
    total: members.length,
    objectives: [
      { id: 'sector-0-0', kind: 'scout', needs: ['navigate'], position: { x: 124, y: 64, z: 64 }, priority: 20, label: 'Scout sector 0,0', assignedTo: 'w2', state: 'assigned', progress: 0.4, detail: {}, createdAt: now, updatedAt: now },
      { id: 'sector-1-0', kind: 'scout', needs: ['navigate'], position: { x: 140, y: 64, z: 64 }, priority: 20, label: 'Scout sector 1,0', assignedTo: 'w3', state: 'assigned', progress: 0.1, detail: {}, createdAt: now, updatedAt: now },
    ],
    exploration: { total: 16, explored: 5, assigned: 2, unexplored: 9, percentComplete: 31, observations: 4 },
    recentObservations: [
      { id: 'obs-1', kind: 'structure', workerId: 'w2', x: 150, y: 64, z: 80, dimension: 'minecraft:overworld', at: now - 20_000, label: 'stone hut', detail: {} },
      { id: 'obs-2', kind: 'player', workerId: 'w3', x: 110, y: 64, z: 40, dimension: 'minecraft:overworld', at: now - 5_000, label: 'Griefer99', detail: { name: 'Griefer99', distance: 22 } },
    ],
    commands: [
      { id: 'c1', at: now - 60_000, instruction: 'Scout the surrounding area', kind: 'scout', accepted: true, payload: {}, result: 'Scouting 16 sectors (64 block radius).' },
      { id: 'c2', at: now - 30_000, instruction: 'Circle around me', kind: 'circle', accepted: true, payload: {}, result: 'Everyone will circle the commander.' },
    ],
  };
}

function demoHiveMap(): HiveMapData {
  const overview = demoHiveOverview();
  return {
    commander: { workerId: 'w1', position: { x: 124, y: 64, z: 64 }, dimension: 'minecraft:overworld' },
    members: overview.members.map((m) => ({ workerId: m.workerId, label: m.label, role: m.role, position: m.position, target: m.formationTarget, dimension: m.dimension, online: m.online, busy: m.busy, color: '#4fc3f7' })),
    sectors: Array.from({ length: 16 }, (_, i) => ({ id: `sector-${i % 4}-${Math.floor(i / 4)}`, minX: 100 + (i % 4) * 16, minZ: 40 + Math.floor(i / 4) * 16, maxX: 115 + (i % 4) * 16, maxZ: 55 + Math.floor(i / 4) * 16, state: i < 5 ? 'explored' : i < 7 ? 'assigned' : 'unexplored', assignedTo: i === 5 ? 'w2' : i === 6 ? 'w3' : null })),
    landmarks: [{ id: 'obs-1', kind: 'structure', label: 'stone hut', position: { x: 150, y: 64, z: 80 }, at: now - 20_000 }],
    players: [{ name: 'Griefer99', position: { x: 110, y: 64, z: 40 }, at: now - 5_000, distance: 22 }],
  };
}

export function createDemoApi(): FleetApi {
  // In-memory storage subsystem, so the Storage page renders with realistic values under ?demo.
  let storageNetworks: StorageNetwork[] = [
    { id: 'net-main', name: 'Main storage room', description: 'Overworld base sorting hall', mode: 'supervised', paused: false, workerIds: [], protectedItems: ['shulker_box', 'diamond'], reservations: [{ query: 'totem_of_undying', count: 4 }], exclusionAreas: ['minecraft:overworld 100 60 -400 200 80 -200'], createdAt: now, updatedAt: now },
  ];
  const storageCategories: StorageCategory[] = [
    { id: 'cat-building', name: 'Building blocks', itemMatches: ['stone', 'cobble', 'plank'], rules: [{ kind: 'tag', tag: 'minecraft:planks' }, { kind: 'tag', tag: 'minecraft:stone_bricks' }], priority: 0, color: '#8b8b8b', protected: false, createdAt: now, updatedAt: now },
    { id: 'cat-ores', name: 'Ores & ingots', itemMatches: ['iron_ingot', 'diamond', 'gold_ingot'], rules: [{ kind: 'tag', tag: 'c:ingots' }, { kind: 'tag', tag: 'c:ores' }], priority: 0, color: '#d4a24a', protected: false, createdAt: now, updatedAt: now },
    { id: 'cat-valuables', name: 'Valuables', itemMatches: ['diamond', 'netherite', 'totem_of_undying'], rules: [{ kind: 'id-contains', contains: 'netherite' }, { kind: 'component', id: 'minecraft:enchantments' }], priority: 5, color: '#f0c419', protected: true, createdAt: now, updatedAt: now },
  ];
  const containerItem = (id: string, name: string, count: number, slot: number): WorkerItem => ({ id: `minecraft:${id}`, name, count, slot, damage: 0, maxDamage: 0, damageable: false });
  let storageContainers: StorageContainer[] = [
    { id: 'c-in', networkId: 'net-main', workerId: 'w1', label: 'Input chest', kind: 'input', x: 120, y: 64, z: -300, dimension: 'minecraft:overworld', categoryId: null, locked: false, permanent: false, capacity: 27, freeSlots: 0, full: true, items: [containerItem('cobblestone', 'Cobblestone', 64, 0), containerItem('oak_planks', 'Oak Planks', 12, 1)], inspectedAt: now - 30_000, createdAt: now, updatedAt: now },
    { id: 'c-build', networkId: 'net-main', workerId: 'w1', label: 'Building blocks chest', kind: 'general', x: 121, y: 64, z: -300, dimension: 'minecraft:overworld', categoryId: 'cat-building', locked: false, permanent: true, capacity: 27, freeSlots: 14, full: false, items: [containerItem('stone', 'Stone', 40, 0)], inspectedAt: now - 45_000, createdAt: now, updatedAt: now },
    { id: 'c-ore', networkId: 'net-main', workerId: 'w1', label: 'Ore chest', kind: 'general', x: 122, y: 64, z: -300, dimension: 'minecraft:overworld', categoryId: 'cat-ores', locked: false, permanent: true, capacity: 27, freeSlots: 20, full: false, items: [containerItem('iron_ingot', 'Iron Ingot', 128, 0)], inspectedAt: now - 60_000, createdAt: now, updatedAt: now },
    { id: 'c-disposal', networkId: 'net-main', workerId: 'w2', label: 'Disposal chest', kind: 'disposal', x: 140, y: 64, z: -320, dimension: 'minecraft:overworld', categoryId: null, locked: false, permanent: true, capacity: 27, freeSlots: 26, full: false, items: [containerItem('gravel', 'Gravel', 5, 0)], inspectedAt: now - 120_000, createdAt: now, updatedAt: now },
  ];
  let restockRules: RestockRule[] = [
    { id: 'rr-food', networkId: 'net-main', name: 'Keep food', query: 'cooked_beef', label: 'Cooked Beef', min: 16, max: 64, batch: 16, workerIds: [], enabled: true, priority: 0, createdAt: now, updatedAt: now },
    { id: 'rr-blocks', networkId: 'net-main', name: 'Keep blocks', query: 'cobblestone', label: 'Cobblestone', min: 64, max: 192, batch: 64, workerIds: [], enabled: true, priority: 0, createdAt: now, updatedAt: now },
  ];
  let disposalRules: DisposalRule[] = [
    { id: 'dr-cobble', name: 'Excess cobblestone', query: 'cobblestone', label: 'Cobblestone', targetContainerId: 'c-disposal', enabled: false, createdAt: now, updatedAt: now },
    { id: 'dr-gravel', name: 'Gravel', query: 'gravel', label: 'Gravel', targetContainerId: 'c-disposal', enabled: true, createdAt: now, updatedAt: now },
  ];
  let portals: PortalRecord[] = [
    { id: 'p-nether', name: 'Base nether portal', category: 'nether', dimension: 'minecraft:overworld', x: 128, y: 65, z: -300, permanent: true, temporary: false, needsMaintenance: false, tracking: true, lastSeenBy: 'w1', lastSeenAt: now - 3600_000, obsolete: false, notes: '', createdAt: now, updatedAt: now },
    { id: 'p-farm', name: 'Farm temp portal', category: 'nether', dimension: 'minecraft:overworld', x: 800, y: 70, z: 1200, permanent: false, temporary: true, needsMaintenance: true, tracking: true, lastSeenBy: 'w3', lastSeenAt: now - 12 * 24 * 3600_000, obsolete: true, notes: 'scouting portal', createdAt: now, updatedAt: now },
  ];
  let structures: StructureRecord[] = [
    { id: 'st-main', name: 'Main storage room', kind: 'storage_room', dimension: 'minecraft:overworld', x1: 100, y1: 60, z1: 200, x2: 140, y2: 75, z2: 240, ownership: 'base team', protected: true, maintenance: 'ok', lastSeenBy: 'w1', lastSeenAt: now - 3600_000, notes: 'chest wall and shulker wall', createdAt: now, updatedAt: now },
    { id: 'st-farm', name: 'Wheat farm', kind: 'farm', dimension: 'minecraft:overworld', x1: 300, y1: 63, z1: 300, x2: 340, y2: 68, z2: 340, ownership: 'base team', protected: false, maintenance: 'due', lastSeenBy: 'w2', lastSeenAt: now - 3 * 24 * 3600_000, notes: '', createdAt: now, updatedAt: now },
    { id: 'st-workshop', name: 'Enchanting workshop', kind: 'workshop', dimension: 'minecraft:overworld', x1: 150, y1: 60, z1: 260, x2: 165, y2: 70, z2: 275, ownership: '', protected: false, maintenance: 'ok', lastSeenBy: null, lastSeenAt: null, notes: 'needs confirming', createdAt: now, updatedAt: now },
  ];
  let shulkers: ShulkerRecord[] = [
    { id: 's1', workerId: 'w1', slot: 9, label: 'Iron shulker', categoryId: 'cat-ores', mixed: false, empty: false, items: [containerItem('iron_ingot', 'Iron Ingot', 512, 0)], itemCount: 512, freeSlots: 19, reserved: false, markedForRemoval: false, inspectedAt: now - 90_000, createdAt: now, updatedAt: now },
    { id: 's2', workerId: 'w1', slot: 10, label: '', categoryId: null, mixed: true, empty: false, items: [containerItem('cobblestone', 'Cobblestone', 64, 0), containerItem('iron_ingot', 'Iron Ingot', 32, 1)], itemCount: 96, freeSlots: 25, reserved: false, markedForRemoval: false, inspectedAt: now - 90_000, createdAt: now, updatedAt: now },
    { id: 's3', workerId: 'w2', slot: 11, label: 'Empty reserve', categoryId: null, mixed: false, empty: true, items: [], itemCount: 0, freeSlots: 27, reserved: true, markedForRemoval: false, inspectedAt: now - 90_000, createdAt: now, updatedAt: now },
  ];
  let workflows: WorkflowRecord[] = [
    { id: 'wf1', name: 'Empty shulker cleanup', description: 'Find empty shulkers, keep the reserve, move the rest to storage.', operations: ['inspect', 'shulker-cleanup'], networkId: null, mode: 'supervised', enabled: true, createdAt: now, updatedAt: now },
    { id: 'wf2', name: 'Storage consolidation', description: 'Merge partial stacks while keeping categories separate.', operations: ['inspect', 'consolidate'], networkId: null, mode: 'supervised', enabled: true, createdAt: now, updatedAt: now },
    { id: 'wf3', name: 'Inventory restock', description: 'Top every worker up to its configured minimums.', operations: ['inspect', 'restock'], networkId: null, mode: 'automatic', enabled: true, createdAt: now, updatedAt: now },
  ];
  let storagePlans: (AutomationPlan & { approved: boolean; executed: boolean })[] = [];
  let storageActivity: StorageActivityEntry[] = [
    { id: 'sa1', at: now - 300_000, operation: 'consolidate', workerId: 'w1', target: 'c-build', query: 'minecraft:stone', count: 40, ok: true, detail: 'merged 40x Stone', beforeAfter: '2 -> 1 stacks', source: 'workflow:Storage consolidation' },
    { id: 'sa2', at: now - 600_000, operation: 'restock', workerId: 'w2', target: 'c-ore', query: 'minecraft:iron_ingot', count: 32, ok: true, detail: 'restocked 32x Iron Ingot', beforeAfter: '', source: 'workflow:Inventory restock' },
    { id: 'sa3', at: now - 900_000, operation: 'dispose', workerId: 'w1', target: 'c-disposal', query: 'minecraft:gravel', count: 12, ok: false, detail: 'no unlocked disposal container on this worker', beforeAfter: '', source: 'plan' },
  ];
  let storageProfiles: StorageProfile[] = [
    { id: 'sp1', name: 'Default', description: 'Seeded categories and built-in workflows', data: {}, createdAt: now },
  ];
  let portalRemovalRequested: string[] = [];

  const buildDemoPlan = (operation: string, networkId: string | null): AutomationPlan => {
    const steps = storageContainers.filter((c) => !c.locked).slice(0, 3).map((c, index) => ({
      id: `step-${operation}-${index}`,
      action: operation === 'dispose' ? 'dispose' : operation === 'shulker-cleanup' ? 'shulker-cleanup' : 'move',
      detail: `${operation} step for ${c.label}`,
      workerId: c.workerId,
      sourceContainerId: c.id,
      targetContainerId: null,
      query: c.items[0]?.id ?? '',
      count: c.items[0]?.count ?? 0,
      slot: null,
      requiresApproval: operation !== 'consolidate',
      blocked: false,
      blockedReason: '',
    }));
    const plan: AutomationPlan = { id: `plan-${Date.now()}`, operation, networkId, createdAt: Date.now(), steps, notes: steps.length === 0 ? ['nothing to do'] : [], actionable: steps.length > 0 };
    storagePlans = [{ ...plan, approved: false, executed: false }, ...storagePlans].slice(0, 50);
    return plan;
  };

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
    getPairingStatus: async (): Promise<PairingStatus> => ({
      code: pairing,
      secondsRemaining: pairing ? Math.max(0, Math.round((pairing.expiresAt - Date.now()) / 1000)) : 0,
      workers: pairedWorkers,
    }),
    createPairingCode: async () => { pairing = { code: 'DEMO2345', createdAt: now, expiresAt: now + 600_000 }; return pairing; },
    clearPairingCode: async () => { pairing = null; return true; },
    revokePairedWorker: async (id) => { const w = pairedWorkers.find((p) => p.workerId === id); if (!w) return false; w.revoked = true; return true; },
    allowPairedWorker: async (id) => { const w = pairedWorkers.find((p) => p.workerId === id); if (!w) return false; w.revoked = false; return true; },

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

    storageOverview: async (): Promise<StorageOverview> => ({
      networks: storageNetworks.length,
      containers: storageContainers.length,
      shulkers: shulkers.length,
      portals: portals.length,
      fullContainers: storageContainers.filter((c) => c.full).length,
      bottlenecks: storageContainers.filter((c) => c.full || !workers.find((w) => w.id === c.workerId)?.online).length,
      pendingPlans: storagePlans.filter((p) => !p.executed).length,
      pendingSteps: storagePlans.filter((p) => !p.executed).reduce((sum, p) => sum + p.steps.length, 0),
      globalPaused: storageNetworks.every((n) => n.paused),
      lastActivityAt: storageActivity[0]?.at ?? null,
      recent: storageActivity.slice(0, 20),
    }),
    storageMaintenanceReport: async () => ({
      generatedAt: Date.now(),
      networks: storageNetworks.map((n) => ({
        networkId: n.id, name: n.name, containers: storageContainers.filter((c) => c.networkId === n.id).length,
        workers: new Set(storageContainers.filter((c) => c.networkId === n.id).map((c) => c.workerId)).size,
        fullContainers: storageContainers.filter((c) => c.networkId === n.id && c.full).length,
        missingContainers: 0, unusedContainers: 0, totalItems: 100, distinctItems: 5, bottlenecks: [],
        unassignedCategories: [], unsortable: [], generatedAt: Date.now(),
      })),
      bottlenecks: [],
      emptyShulkers: shulkers.filter((s) => s.empty).length,
      mixedShulkers: shulkers.filter((s) => s.mixed).length,
      obsoletePortals: portals.filter((p) => p.obsolete).length,
      unsortable: [],
      activity: storageActivity,
    }),
    listStorageNetworks: async () => storageNetworks,
    createStorageNetwork: async (input) => {
      const network: StorageNetwork = { id: `net-${Date.now()}`, name: input.name, description: input.description ?? '', mode: input.mode ?? 'supervised', paused: false, workerIds: input.workerIds ?? [], protectedItems: input.protectedItems ?? [], reservations: input.reservations ?? [], exclusionAreas: input.exclusionAreas ?? [], createdAt: Date.now(), updatedAt: Date.now() };
      storageNetworks = [...storageNetworks, network];
      return network;
    },
    updateStorageNetwork: async (id, patch) => { const n = storageNetworks.find((x) => x.id === id); if (n) Object.assign(n, patch, { updatedAt: Date.now() }); return n; },
    deleteStorageNetwork: async (id) => { storageNetworks = storageNetworks.filter((n) => n.id !== id); return true; },
    pauseStorageNetwork: async (id, paused) => { const n = storageNetworks.find((x) => x.id === id); if (n) { n.paused = paused; n.updatedAt = Date.now(); } return n; },
    listStorageCategories: async () => storageCategories,
    createStorageCategory: async (input) => { const c: StorageCategory = { id: `cat-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; storageCategories.push(c); return c; },
    updateStorageCategory: async (id, patch) => { const c = storageCategories.find((x) => x.id === id); if (c) Object.assign(c, patch, { updatedAt: Date.now() }); return c; },
    deleteStorageCategory: async (id) => { const i = storageCategories.findIndex((c) => c.id === id); if (i >= 0) storageCategories.splice(i, 1); return true; },
    listStorageContainers: async (networkId) => (networkId ? storageContainers.filter((c) => c.networkId === networkId) : storageContainers),
    createStorageContainer: async (input) => { const c: StorageContainer = { id: `c-${Date.now()}`, networkId: input.networkId, workerId: input.workerId, label: input.label ?? 'container', kind: input.kind ?? 'general', x: input.x ?? 0, y: input.y ?? 0, z: input.z ?? 0, dimension: input.dimension ?? '', categoryId: input.categoryId ?? null, locked: input.locked ?? false, permanent: input.permanent ?? false, capacity: null, freeSlots: null, full: false, items: [], inspectedAt: 0, createdAt: Date.now(), updatedAt: Date.now() }; storageContainers.push(c); return c; },
    updateStorageContainer: async (id, patch) => { const c = storageContainers.find((x) => x.id === id); if (c) Object.assign(c, patch, { updatedAt: Date.now() }); return c; },
    deleteStorageContainer: async (id) => { storageContainers = storageContainers.filter((c) => c.id !== id); return true; },
    listRestockRules: async (networkId) => (networkId ? restockRules.filter((r) => r.networkId === networkId) : restockRules),
    createRestockRule: async (input) => { const r: RestockRule = { id: `rr-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; restockRules.push(r); return r; },
    updateRestockRule: async (id, patch) => { const r = restockRules.find((x) => x.id === id); if (r) Object.assign(r, patch, { updatedAt: Date.now() }); return r; },
    deleteRestockRule: async (id) => { restockRules = restockRules.filter((r) => r.id !== id); return true; },
    listDisposalRules: async () => disposalRules,
    createDisposalRule: async (input) => { const r: DisposalRule = { id: `dr-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; disposalRules.push(r); return r; },
    updateDisposalRule: async (id, patch) => { const r = disposalRules.find((x) => x.id === id); if (r) Object.assign(r, patch, { updatedAt: Date.now() }); return r; },
    deleteDisposalRule: async (id) => { disposalRules = disposalRules.filter((r) => r.id !== id); return true; },
    listPortals: async () => portals,
    portalGroups: async () => portals.map((p) => ({ key: p.id, dimension: p.dimension, portals: [p], x: p.x, y: p.y, z: p.z })),
    flaggedPortals: async () => portals.filter((p) => p.obsolete || p.needsMaintenance).map((p) => ({ portalId: p.id, name: p.name, reason: p.obsolete ? 'obsolete' : 'maintenance', detail: p.obsolete ? 'temporary portal has not been seen recently' : 'marked for maintenance' })),
    previewPortalRemoval: async (ids) => ids.map((id) => portals.find((p) => p.id === id)).filter((p): p is PortalRecord => Boolean(p)).map((p) => ({ portalId: p.id, name: p.name, dimension: p.dimension, x: p.x, y: p.y, z: p.z, authorised: !p.permanent, reasons: p.permanent ? ['portal is marked permanent'] : [], estimatedBlocks: 10 })),
    createPortal: async (input) => { const p: PortalRecord = { id: `p-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; portals.push(p); return p; },
    updatePortal: async (id, patch) => { const p = portals.find((x) => x.id === id); if (p) Object.assign(p, patch, { updatedAt: Date.now() }); return p; },
    deletePortal: async (id) => { portals = portals.filter((p) => p.id !== id); return true; },
    listStructures: async () => [...structures, ...portals.map(fromPortal)],
    structureIssues: async () => structureIssues([...structures, ...portals.map(fromPortal)]).map((issue) => ({ structureId: issue.structureId, name: issue.name, reason: issue.reason, detail: issue.detail })),
    structureCounts: async () => countByKind([...structures, ...portals.map(fromPortal)]) as unknown as Record<string, number>,
    previewStructureChange: async (region) => previewChange([...structures, ...portals.map(fromPortal)], region).map((preview) => ({ structureId: preview.structureId, name: preview.name, kind: preview.kind, actionable: preview.actionable, reasons: preview.reasons, estimatedBlocks: preview.estimatedBlocks })),
    createStructure: async (input) => { const s: StructureRecord = { id: `st-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; structures.push(s); return s; },
    updateStructure: async (id, patch) => { const s = structures.find((x) => x.id === id); if (s) Object.assign(s, patch, { updatedAt: Date.now() }); return s; },
    deleteStructure: async (id) => { structures = structures.filter((s) => s.id !== id); return true; },
    listShulkers: async (workerId) => (workerId ? shulkers.filter((s) => s.workerId === workerId) : shulkers),
    shulkerSuggestions: async () => shulkers.map((s) => ({ shulkerId: s.id, label: s.label || s.id, suggestion: s.empty ? 'empty — keep as reserve or assign to a category' : s.mixed ? 'mixed contents — split into single-category shulkers' : 'already organised', categoryId: s.categoryId })),
    updateShulker: async (id, patch) => { const s = shulkers.find((x) => x.id === id); if (s) Object.assign(s, patch, { updatedAt: Date.now() }); return s; },
    listWorkflows: async () => workflows,
    storageOperations: async () => [
      { id: 'inspect', label: 'Inspect containers', description: 'Ask workers to report the contents of registered containers.', mutating: false, autoSafe: true },
      { id: 'sort', label: 'Sort incoming items', description: 'Move unsorted items from input containers into their category containers.', mutating: true, autoSafe: true },
      { id: 'consolidate', label: 'Consolidate stacks', description: 'Merge partial stacks of the same item spread across containers.', mutating: true, autoSafe: true },
      { id: 'restock', label: 'Restock inventories', description: 'Top workers up to their configured minimums.', mutating: true, autoSafe: true },
      { id: 'shulker-cleanup', label: 'Clean up empty shulkers', description: 'Move surplus empty shulkers to the designated storage.', mutating: true, autoSafe: false },
      { id: 'portal-cleanup', label: 'Clean up obsolete portals', description: 'Preview and, with approval, remove obsolete registered portals.', mutating: true, autoSafe: false },
    ],
    createWorkflow: async (input) => { const w: WorkflowRecord = { id: `wf-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now(), ...input }; workflows.push(w); return w; },
    updateWorkflow: async (id, patch) => { const w = workflows.find((x) => x.id === id); if (w) Object.assign(w, patch, { updatedAt: Date.now() }); return w; },
    deleteWorkflow: async (id) => { workflows = workflows.filter((w) => w.id !== id); return true; },
    planStorageOperation: async (operation, networkId) => buildDemoPlan(operation, networkId ?? null),
    listStoragePlans: async () => storagePlans,
    approveStoragePlan: async (id) => { const p = storagePlans.find((x) => x.id === id); if (p) p.approved = true; return Boolean(p); },
    executeStoragePlan: async (id) => {
      const plan = storagePlans.find((x) => x.id === id);
      if (!plan) throw new Error('That plan no longer exists.');
      plan.executed = true;
      const outcomes = plan.steps.map((step) => ({ stepId: step.id, workerId: step.workerId, ok: true, detail: 'done (demo)' }));
      storageActivity = [{ id: `sa-${Date.now()}`, at: Date.now(), operation: plan.operation, workerId: plan.steps[0]?.workerId ?? '', target: '', query: plan.steps[0]?.query ?? '', count: plan.steps.length, ok: true, detail: `${plan.steps.length} step(s) executed (demo)`, beforeAfter: '', source: plan.id }, ...storageActivity];
      return { planId: id, operation: plan.operation, ok: true, executed: plan.steps.length, failed: 0, skipped: 0, message: `${plan.steps.length} executed, 0 failed, 0 skipped`, outcomes };
    },
    discardStoragePlan: async (id) => { storagePlans = storagePlans.filter((p) => p.id !== id); return true; },
    restockNeeds: async (workerId) => restockRules.filter((r) => r.enabled).map((r) => ({ ruleId: r.id, workerId, query: r.query, label: r.label, have: 8, min: r.min, max: r.max, amount: Math.max(0, r.min - 8), direction: 8 < r.min ? 'in' : 'ok' })),
    restockPlan: async (workerId) => ({ steps: restockRules.filter((r) => r.enabled).map((r) => ({ ruleId: r.id, workerId, query: r.query, fromContainerId: 'c-in', count: Math.max(0, r.min - 8), detail: `restock ${Math.max(0, r.min - 8)}x ${r.label} from Input chest` })), unsatisfied: [] }),
    disposalPreview: async () => ({ wouldDispose: [{ itemId: 'minecraft:gravel', itemName: 'Gravel', count: 5 }], refused: [{ itemId: 'minecraft:diamond', itemName: 'Diamond', reasons: ['item is valuable'] }] }),
    storageActivity: async (limit) => storageActivity.slice(0, limit ?? 200),
    storageAsk: async (request) => {
      const text = request.toLowerCase();
      const operation = text.includes('shulker') ? 'shulker-cleanup' : text.includes('consolidate') ? 'consolidate' : text.includes('restock') ? 'restock' : text.includes('portal') ? 'portal-cleanup' : null;
      const ai = planWithAi(request, { grant: { subject: 'operator', level: 'administer' } });
      const aiView = ai.intent
        ? {
            intent: ai.intent,
            confidence: ai.confidence,
            executable: ai.executable,
            needsConfirmation: ai.needsConfirmation,
            note: ai.note,
            steps: ai.steps.map((step) => ({ id: step.id, system: step.system, summary: step.summary, authorised: step.authorised, blockedReason: step.blockedReason, destructive: step.destructive })),
          }
        : null;
      return { request, operation, answer: operation ? `${operation}: planned in demo mode` : 'I did not recognise that request (demo).', plan: operation ? buildDemoPlan(operation, 'net-main') : null, ai: aiView };
    },
    listStorageProfiles: async () => storageProfiles,
    saveStorageProfile: async (name, description) => { const p: StorageProfile = { id: `sp-${Date.now()}`, name, description: description ?? '', data: {}, createdAt: Date.now() }; storageProfiles.push(p); return p; },
    deleteStorageProfile: async (id) => { storageProfiles = storageProfiles.filter((p) => p.id !== id); return true; },

    // hive mode (demo): a small, static swarm so the interface can be explored without a host.
    hiveOverview: async (): Promise<HiveOverview> => demoHiveOverview(),
    hiveMap: async (): Promise<HiveMapData> => demoHiveMap(),
    hiveSetEnabled: async (enabled) => { demoHiveEnabled = enabled; return { ok: true, enabled }; },
    hiveSetFormation: async (formation) => { demoFormation = { ...demoFormation, ...formation }; return { ok: true, formation: demoFormation }; },
    hiveCommand: async (instruction) => ({
      accepted: !instruction.includes('barrel'),
      command: { kind: instruction.includes('barrel') ? 'unknown' : 'follow', instruction, everyone: true, confidence: instruction.includes('barrel') ? 0 : 0.9 },
      message: instruction.includes('barrel') ? 'I did not recognise that instruction.' : 'Everyone will follow the commander.',
      dispatched: [],
    }),
    hiveSetRole: async (workerId, role, options) => ({ workerId, role, extraCapabilities: options?.extraCapabilities ?? [], isCommander: Boolean(options?.commander), updatedAt: Date.now() }),
    hiveSetCommander: async (workerId) => ({ ok: true, commanderId: workerId }),
    hiveEmergencyStop: async () => { demoHiveEnabled = false; return { ok: true }; },
    hiveExport: async () => ({ path: '/demo/logvex-hive.json' }),

    onEvent: () => () => {},
  };
}
