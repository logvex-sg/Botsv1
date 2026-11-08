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
  Group, HealthReport, NotificationItem, ServerProfile, StasisLocation, TargetEntry,
} from '../../shared/types';
import type { AccountView } from '../../main/services/accounts/account-manager';
import type { RuntimeInstance } from '../../main/services/instances/instance-manager';
import type { RoleDefinition } from '../../main/services/roles/roles';

const now = Date.now();

const settings: AppSettings = {
  apiEnabled: true, apiHost: '127.0.0.1', apiPort: 8791, hunterAddonUrl: 'http://127.0.0.1:8080',
  hunterAddonToken: '', autosave: true, notify: true, maxMemoryMb: 4096, backupIntervalMinutes: 60,
  logLevel: 'info', theme: 'dark',
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
    saveSettings: async (patch: Partial<AppSettings>) => ({ ...clone(settings), ...patch }),
    getApiToken: async () => 'demo-token-0123456789abcdef',
    regenerateApiToken: async () => 'demo-token-fedcba9876543210',
    getDiagnostics: async () => ({ host: '6b6t.org', dns: { host: '6b6t.org', addresses: ['1.2.3.4'], durationMs: 12, error: null }, latency: { reachable: true, latencyMs: 38, error: null }, interfaces: [{ name: 'eth0', address: '10.0.0.5', family: 'IPv4', internal: false }], timestamp: now }),
    exportConfig: async () => ({ path: '/tmp/logvex-config.json' }),
    importConfig: async () => ({ imported: 0 }),
    backupDatabase: async () => ({ path: '/tmp/logvex-backup.sqlite' }),

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

    emergencyStop: async () => { for (const l of listeners) l({ id: `e-${Date.now()}`, type: 'SYSTEM', source: 'fleet', severity: 'error', instanceId: null, accountId: null, targetUuid: null, message: 'EMERGENCY STOP engaged', payload: {}, timestamp: Date.now() }); return true; },
    clearEmergencyStop: async () => true,

    onEvent: (callback: (event: FleetEvent) => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  return api as unknown as FleetApi;
}
