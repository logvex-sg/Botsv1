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
