/**
 * Local HTTP + WebSocket API.
 *
 * Exposes the host over a small, versioned REST surface and a WebSocket event stream so another
 * authenticated client (a script, a phone, or a second tool) can read worker state and dispatch
 * tasks. The server binds to loopback by default and requires a bearer token on every route except
 * `/health`. It is intentionally thin: all logic lives in the worker service it delegates to.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppContext } from '../context';
import { CONTROL_ACTIONS, isControlAction } from '../../shared/workers';
import { ApiAuth, RateLimiter } from './auth';
import { buildStatistics } from '../packages/statistics';

export interface ApiServerOptions {
  host: string;
  port: number;
}

export class ApiServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly limiter = new RateLimiter();
  private readonly sockets = new Set<WebSocket>();

  constructor(
    private readonly context: AppContext,
    private readonly auth: ApiAuth,
  ) {}

  get token(): string {
    return this.auth.getToken();
  }

  regenerateToken(): string {
    return this.auth.regenerate();
  }

  async start(options: ApiServerOptions): Promise<number> {
    if (this.server) return this.boundPort;
    this.server = createServer((req, res) => void this.handle(req, res));
    this.wss = new WebSocketServer({ server: this.server, path: '/events' });
    this.wss.on('connection', (socket, req) => this.onSocket(socket, req));

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(options.port, options.host, () => resolve());
    });
    this.boundPort = (this.server.address() as { port: number }).port;
    return this.boundPort;
  }

  private boundPort = 0;

  get port(): number {
    return this.boundPort;
  }

  async stop(): Promise<void> {
    this.sockets.forEach((socket) => socket.close());
    this.sockets.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }

  private onSocket(socket: WebSocket, req: IncomingMessage): void {
    const token = ApiAuth.extract(req.headers.authorization, req.url);
    if (!this.auth.verify(token)) {
      socket.close(4401, 'unauthorized');
      return;
    }
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.send(JSON.stringify({ type: 'HELLO', schemaVersion: 1, timestamp: Date.now() }));
  }

  /** Broadcasts an event to all connected WebSocket clients. */
  broadcast(event: { type: string; message: string; payload?: Record<string, unknown> }): void {
    const frame = JSON.stringify({
      schemaVersion: 1,
      type: event.type,
      message: event.message,
      payload: event.payload ?? {},
      timestamp: Date.now(),
    });
    for (const socket of this.sockets) {
      if (socket.readyState === 1) socket.send(frame);
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (url === '/health' || url.startsWith('/health?')) {
      return this.json(res, 200, await this.context.healthReport());
    }

    const token = ApiAuth.extract(req.headers.authorization, url);
    if (!this.auth.verify(token)) {
      return this.json(res, 401, { error: 'unauthorized' });
    }
    if (!this.limiter.allow(token ?? 'anon')) {
      return this.json(res, 429, { error: 'rate limited' });
    }

    try {
      const body = await this.readBody(req);
      const [path, queryString] = url.split('?');
      const result = await this.route(method, path, body, new URLSearchParams(queryString ?? ''));
      if (result === undefined) return this.json(res, 404, { error: 'not found' });
      return this.json(res, result.status ?? 200, result.body);
    } catch (error) {
      return this.json(res, 500, { error: (error as Error).message });
    }
  }

  private async route(
    method: string,
    path: string,
    body: Record<string, unknown>,
    query: URLSearchParams,
  ): Promise<{ status?: number; body: unknown } | undefined> {
    const ctx = this.context;

    if (path === '/api/v1/status' && method === 'GET') return { body: await ctx.healthReport() };
    if (path === '/api/v1/settings' && method === 'GET') return { body: ctx.getSettings() };
    if (path === '/api/v1/events' && method === 'GET') return { body: { events: ctx.bus.recentEvents(100) } };

    // ---------------------------------------------------------------- workers
    if (path === '/api/v1/workers' && method === 'GET') return { body: { workers: ctx.workers.list() } };
    if (path === '/api/v1/workers/overview' && method === 'GET') return { body: ctx.workers.overview() };
    if (path === '/api/v1/workers/groups' && method === 'GET') return { body: { groups: ctx.workers.listGroups() } };
    if (path === '/api/v1/workers/tasks' && method === 'GET') return { body: { tasks: ctx.workers.listTasks(100) } };
    if (path === '/api/v1/workers/commands' && method === 'GET') return { body: { commands: ctx.workers.listCommands(100) } };
    if (path === '/api/v1/workers/presets' && method === 'GET') return { body: { presets: ctx.workers.listPresets() } };
    if (path === '/api/v1/workers/count' && method === 'GET') {
      return { body: ctx.workers.countItem(query.get('item') ?? '') };
    }
    if (path === '/api/v1/workers/console' && method === 'GET') {
      // Every worker's console in one call, keyed by worker id.
      const consoles: Record<string, unknown> = {};
      for (const worker of ctx.workers.list()) consoles[worker.id] = ctx.workers.console(worker.id);
      return { body: { consoles } };
    }

    const workerMatch = /^\/api\/v1\/workers\/([^/]+)(?:\/(inventory|console|task|line|control))?$/.exec(path);
    if (workerMatch) {
      const workerId = decodeURIComponent(workerMatch[1]);
      const action = workerMatch[2];

      if (!action && method === 'GET') {
        const worker = ctx.workers.get(workerId);
        return worker ? { body: worker } : { status: 404, body: { error: 'unknown worker' } };
      }
      if (action === 'inventory' && method === 'GET') {
        const inventory = ctx.workers.inventory(workerId);
        return inventory ? { body: inventory } : { status: 404, body: { error: 'no reported inventory' } };
      }
      if (action === 'console' && method === 'GET') return { body: { lines: ctx.workers.console(workerId) } };
      if (action === 'console' && method === 'DELETE') {
        ctx.workers.clearConsole(workerId);
        return { body: { ok: true } };
      }
      if (action === 'task' && method === 'POST') {
        const kind = typeof body.kind === 'string' ? body.kind : '';
        const params = typeof body.params === 'object' && body.params !== null ? (body.params as Record<string, unknown>) : {};
        const result = await ctx.workers.runTask(workerId, kind as never, params);
        return { body: result };
      }
      if (action === 'line' && method === 'POST') {
        const kind = body.kind === 'chat' ? 'chat' : 'command';
        const line = typeof body.line === 'string' ? body.line : '';
        return { body: ctx.workers.sendLine(workerId, kind, line) };
      }
      if (action === 'control' && method === 'POST') {
        const requested = typeof body.action === 'string' ? body.action : '';
        if (!isControlAction(requested)) {
          return { status: 400, body: { error: `unknown control action '${requested}'; use ${CONTROL_ACTIONS.join(', ')}` } };
        }
        const sent = ctx.workers.sendControl(workerId, requested);
        return sent ? { body: { ok: true, action: requested } } : { status: 409, body: { error: 'worker is not connected' } };
      }
    }

    // ---------------------------------------------------------------- pairing
    if (path === '/api/v1/pairing' && method === 'GET') return { body: ctx.pairingStatus() };
    if (path === '/api/v1/pairing/code' && method === 'POST') return { body: ctx.createPairingCode() };
    if (path === '/api/v1/pairing/code' && method === 'DELETE') {
      ctx.clearPairingCode();
      return { body: { ok: true } };
    }
    const pairingMatch = /^\/api\/v1\/pairing\/workers\/([^/]+)(?:\/(revoke|allow))?$/.exec(path);
    if (pairingMatch) {
      const workerId = decodeURIComponent(pairingMatch[1]);
      const action = pairingMatch[2];
      if (action === 'revoke' && method === 'POST') {
        return ctx.revokeWorker(workerId) ? { body: { ok: true } } : { status: 404, body: { error: 'unknown worker' } };
      }
      if (action === 'allow' && method === 'POST') {
        return ctx.allowWorker(workerId) ? { body: { ok: true } } : { status: 404, body: { error: 'unknown worker' } };
      }
    }

    // ------------------------------------------------------------- multiverse
    if (path === '/api/v1/servers' && method === 'GET') {
      return { body: { servers: ctx.multiverse.listServers(query.get('archived') === 'true') } };
    }
    if (path === '/api/v1/templates' && method === 'GET') return { body: { templates: ctx.multiverse.listGroupTemplates() } };
    if (path === '/api/v1/presets' && method === 'GET') return { body: { presets: ctx.multiverse.listTaskPresets() } };
    if (path === '/api/v1/schedules' && method === 'GET') {
      return { body: { schedules: ctx.multiverse.listSchedules().map((s) => ({ ...s, missed: ctx.multiverse.missedFor(s) })) } };
    }
    if (path === '/api/v1/rules' && method === 'GET') return { body: { rules: ctx.multiverse.listRules() } };
    if (path === '/api/v1/containers' && method === 'GET') {
      return { body: { containers: ctx.multiverse.listContainers(query.get('workerId') ?? undefined) } };
    }
    if (path === '/api/v1/audit' && method === 'GET') {
      const limit = Number.parseInt(query.get('limit') ?? '', 10);
      return { body: { entries: ctx.multiverse.listAudit(Number.isFinite(limit) ? limit : 200) } };
    }
    if (path === '/api/v1/tags' && method === 'GET') return { body: { tags: ctx.workers.allTags() } };

    const presetRun = /^\/api\/v1\/presets\/([^/]+)\/run$/.exec(path);
    if (presetRun && method === 'POST') {
      return { body: await ctx.multiverse.runTaskPreset(decodeURIComponent(presetRun[1])) };
    }

    // ------------------------------------------------------------- statistics
    if (path === '/api/v1/statistics' && method === 'GET') {
      return { body: buildStatistics({
        workers: ctx.workers.list(),
        tasks: ctx.workers.listTasks(1000),
        commands: ctx.workers.listCommands(1000),
        events: ctx.events.list(1000),
        inventory: ctx.workerInventory.all(),
        schedules: ctx.multiverse.listSchedules(),
        rules: ctx.multiverse.listRules(),
        containers: ctx.multiverse.listContainers(),
        audit: ctx.multiverse.listAudit(1000),
      }) };
    }

    // --------------------------------------------- autonomous storage & maintenance
    const storage = ctx.storage;
    if (path === '/api/v1/storage/overview' && method === 'GET') return { body: storage.overview() };
    if (path === '/api/v1/storage/report' && method === 'GET') return { body: storage.maintenanceReport() };

    if (path === '/api/v1/storage/networks' && method === 'GET') return { body: { networks: storage.listNetworks() } };
    if (path === '/api/v1/storage/networks' && method === 'POST') {
      return { body: storage.createNetwork(body as Parameters<typeof storage.createNetwork>[0]) };
    }
    if (path === '/api/v1/storage/categories' && method === 'GET') return { body: { categories: storage.listCategories() } };
    if (path === '/api/v1/storage/categories' && method === 'POST') {
      return { body: storage.createCategory(body as Parameters<typeof storage.createCategory>[0]) };
    }
    if (path === '/api/v1/storage/containers' && method === 'GET') {
      return { body: { containers: storage.listContainers(query.get('networkId') ?? undefined) } };
    }
    if (path === '/api/v1/storage/containers' && method === 'POST') {
      return { body: storage.createContainer(body as Parameters<typeof storage.createContainer>[0]) };
    }
    if (path === '/api/v1/storage/restock-rules' && method === 'GET') {
      return { body: { rules: storage.listRestockRules(query.get('networkId') ?? undefined) } };
    }
    if (path === '/api/v1/storage/restock-rules' && method === 'POST') {
      return { body: storage.createRestockRule(body as Parameters<typeof storage.createRestockRule>[0]) };
    }
    if (path === '/api/v1/storage/disposal-rules' && method === 'GET') return { body: { rules: storage.listDisposalRules() } };
    if (path === '/api/v1/storage/disposal-rules' && method === 'POST') {
      return { body: storage.createDisposalRule(body as Parameters<typeof storage.createDisposalRule>[0]) };
    }
    if (path === '/api/v1/storage/portals' && method === 'GET') return { body: { portals: storage.listPortals() } };
    if (path === '/api/v1/storage/portals' && method === 'POST') {
      return { body: storage.createPortal(body as Parameters<typeof storage.createPortal>[0]) };
    }
    if (path === '/api/v1/storage/portals/flagged' && method === 'GET') return { body: { flagged: storage.flaggedPortals() } };
    if (path === '/api/v1/storage/structures' && method === 'GET') return { body: { structures: storage.listStructures() } };
    if (path === '/api/v1/storage/structures' && method === 'POST') {
      return { body: storage.createStructure(body as Parameters<typeof storage.createStructure>[0]) };
    }
    if (path === '/api/v1/storage/structures/issues' && method === 'GET') return { body: { issues: storage.structureIssues() } };
    if (path === '/api/v1/storage/structures/counts' && method === 'GET') return { body: { counts: storage.structureCounts() } };
    if (path === '/api/v1/storage/structures/preview-change' && method === 'POST') {
      const region = body.region as Parameters<typeof storage.previewStructureChange>[0];
      const options = body.options as Parameters<typeof storage.previewStructureChange>[1];
      return { body: { preview: storage.previewStructureChange(region, options) } };
    }
    if (path === '/api/v1/storage/shulkers' && method === 'GET') {
      return { body: { shulkers: storage.listShulkers(query.get('workerId') ?? undefined) } };
    }
    if (path === '/api/v1/storage/workflows' && method === 'GET') return { body: { workflows: storage.listWorkflows() } };
    if (path === '/api/v1/storage/workflows' && method === 'POST') {
      return { body: storage.createWorkflow(body as Parameters<typeof storage.createWorkflow>[0]) };
    }
    if (path === '/api/v1/storage/operations' && method === 'GET') return { body: { operations: storage.operations() } };
    if (path === '/api/v1/storage/plans' && method === 'GET') return { body: { plans: storage.listPlans() } };
    if (path === '/api/v1/storage/plans' && method === 'POST') {
      const operation = typeof body.operation === 'string' ? body.operation : '';
      const networkId = typeof body.networkId === 'string' ? body.networkId : null;
      return { body: storage.plan(operation, networkId, { workerId: typeof body.workerId === 'string' ? body.workerId : undefined }) };
    }
    if (path === '/api/v1/storage/activity' && method === 'GET') {
      const limit = Number.parseInt(query.get('limit') ?? '', 10);
      return { body: { activity: storage.listActivity(Number.isFinite(limit) ? limit : 200, query.get('workerId') ?? undefined) } };
    }
    if (path === '/api/v1/storage/profiles' && method === 'GET') return { body: { profiles: storage.listProfiles() } };
    if (path === '/api/v1/storage/ask' && method === 'POST') {
      return { body: storage.ask(typeof body.request === 'string' ? body.request : '') };
    }

    const storageMatch = /^\/api\/v1\/storage\/(networks|categories|containers|restock-rules|disposal-rules|portals|structures|workflows|plans)\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
    if (storageMatch) {
      const [, collection, rawId, action] = storageMatch;
      const id = decodeURIComponent(rawId);
      const patch = body as never;
      switch (collection) {
        case 'networks':
          if (method === 'PATCH') return { body: storage.updateNetwork(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeNetwork(id) } };
          if (action === 'pause' && method === 'POST') return { body: storage.setNetworkPaused(id, body.paused !== false) };
          break;
        case 'categories':
          if (method === 'PATCH') return { body: storage.updateCategory(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeCategory(id) } };
          break;
        case 'containers':
          if (method === 'PATCH') return { body: storage.updateContainer(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeContainer(id) } };
          break;
        case 'restock-rules':
          if (method === 'PATCH') return { body: storage.updateRestockRule(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeRestockRule(id) } };
          break;
        case 'disposal-rules':
          if (method === 'PATCH') return { body: storage.updateDisposalRule(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeDisposalRule(id) } };
          break;
        case 'portals':
          if (method === 'PATCH') return { body: storage.updatePortal(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removePortal(id) } };
          break;
        case 'structures':
          if (method === 'PATCH') return { body: storage.updateStructure(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeStructure(id) } };
          break;
        case 'workflows':
          if (method === 'PATCH') return { body: storage.updateWorkflow(id, patch) };
          if (method === 'DELETE') return { body: { ok: storage.removeWorkflow(id) } };
          break;
        case 'plans':
          if (action === 'approve' && method === 'POST') return { body: { ok: storage.approvePlan(id) } };
          if (action === 'execute' && method === 'POST') return { body: await storage.executePlan(id) };
          if (method === 'DELETE') return { body: { ok: storage.discardPlan(id) } };
          break;
      }
    }

    // ------------------------------------------------------------------ hive mode
    if (path === '/api/v1/hive' && method === 'GET') return { body: ctx.hive.overview() };
    if (path === '/api/v1/hive/overview' && method === 'GET') return { body: ctx.hive.overview() };
    if (path === '/api/v1/hive/map' && method === 'GET') return { body: ctx.hive.map() };
    if (path === '/api/v1/hive/roles' && method === 'GET') return { body: { roles: ctx.hive.listRoles() } };
    if (path === '/api/v1/hive/objectives' && method === 'GET') {
      return { body: { objectives: ctx.hive.overview().objectives } };
    }
    if (path === '/api/v1/hive/observations' && method === 'GET') {
      return { body: { observations: ctx.hive.overview().recentObservations } };
    }
    if (path === '/api/v1/hive/commands' && method === 'GET') {
      const limit = Number.parseInt(query.get('limit') ?? '', 10);
      return { body: { commands: ctx.hive.listCommands(Number.isFinite(limit) ? limit : 100) } };
    }
    if (path === '/api/v1/hive/state' && method === 'POST') {
      const enabled = body.enabled === true;
      ctx.hive.setEnabled(enabled);
      return { body: { ok: true, enabled } };
    }
    if (path === '/api/v1/hive/formation' && method === 'POST') {
      const formation = ctx.hive.setFormation(body as Parameters<typeof ctx.hive.setFormation>[0]);
      return { body: { ok: true, formation } };
    }
    if (path === '/api/v1/hive/command' && method === 'POST') {
      const instruction = typeof body.instruction === 'string' ? body.instruction : '';
      if (!instruction.trim()) return { status: 400, body: { error: 'instruction is required' } };
      return { body: ctx.hive.runCommand(instruction) };
    }
    if (path === '/api/v1/hive/emergency-stop' && method === 'POST') {
      ctx.hive.emergencyStop(typeof body.reason === 'string' ? body.reason : 'operator request');
      return { body: { ok: true } };
    }
    if (path === '/api/v1/hive/observation' && method === 'POST') {
      const observation = body as unknown as Parameters<typeof ctx.hive.recordObservation>[0];
      if (!observation || typeof observation !== 'object' || typeof observation.id !== 'string') {
        return { status: 400, body: { error: 'a full observation object is required' } };
      }
      ctx.hive.recordObservation(observation);
      return { body: { ok: true } };
    }
    if (path === '/api/v1/hive/commander' && method === 'POST') {
      const workerId = typeof body.workerId === 'string' ? body.workerId : '';
      if (!workerId) return { status: 400, body: { error: 'workerId is required' } };
      ctx.hive.setCommander(workerId);
      return { body: { ok: true, commanderId: workerId } };
    }
    const hiveRoleMatch = /^\/api\/v1\/hive\/roles\/([^/]+)$/.exec(path);
    if (hiveRoleMatch) {
      const workerId = decodeURIComponent(hiveRoleMatch[1]);
      if (method === 'PUT' || method === 'POST') {
        const role = typeof body.role === 'string' ? (body.role as Parameters<typeof ctx.hive.assignRole>[1]) : 'GENERALIST';
        const row = ctx.hive.assignRole(workerId, role, {
          commander: body.commander === true,
          extraCapabilities: Array.isArray(body.extraCapabilities) ? (body.extraCapabilities as string[]) : undefined,
        });
        return { body: row };
      }
      if (method === 'DELETE') return { body: { ok: true } };
    }
    const hiveObjectiveMatch = /^\/api\/v1\/hive\/objectives\/([^/]+)$/.exec(path);
    if (hiveObjectiveMatch && method === 'DELETE') {
      return { body: { ok: true, id: decodeURIComponent(hiveObjectiveMatch[1]) } };
    }

    return undefined;
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (chunks.length === 0) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body ?? {});
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }
}
