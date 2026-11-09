/**
 * Local HTTP + WebSocket API.
 *
 * Exposes the fleet over a small, versioned REST surface and a WebSocket event stream so the
 * Logvex Hunter addon (or any other authenticated client) can read state and submit events.
 * The server binds to loopback by default and requires a bearer token on every route except
 * `/health`. It is intentionally thin: all logic lives in the services it delegates to.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppContext } from '../context';
import { ApiAuth, RateLimiter } from './auth';
import { FleetEventType } from '../../shared/events';

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
    if (path === '/api/v1/instances' && method === 'GET') return { body: { instances: ctx.instances.list() } };
    if (path === '/api/v1/accounts' && method === 'GET') return { body: { accounts: await ctx.accounts.listWithStatus() } };
    if (path === '/api/v1/servers' && method === 'GET') return { body: { servers: ctx.servers.list() } };
    if (path === '/api/v1/targets' && method === 'GET') return { body: { targets: ctx.targets.list() } };
    if (path === '/api/v1/events' && method === 'GET') return { body: { events: ctx.bus.recentEvents(100) } };
    if (path === '/api/v1/deployments' && method === 'GET') return { body: { deployments: ctx.deployments.list() } };
    if (path === '/api/v1/groups' && method === 'GET') return { body: { groups: ctx.groups.list() } };
    if (path === '/api/v1/roles' && method === 'GET') return { body: { roles: ctx.roleCatalog() } };
    if (path === '/api/v1/settings' && method === 'GET') return { body: ctx.getSettings() };
    if (path === '/api/v1/stasis' && method === 'GET') return { body: { locations: ctx.stasisManager.list() } };
    if (path === '/api/v1/equipment' && method === 'GET') return { body: { profiles: ctx.equipmentManager.list() } };

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

    const workerInventoryMatch = /^\/api\/v1\/workers\/([^/]+)\/inventory$/.exec(path);
    if (workerInventoryMatch && method === 'GET') {
      const snapshot = ctx.workers.inventory(workerInventoryMatch[1]);
      if (!snapshot) return { status: 404, body: { error: 'no inventory reported for that worker' } };
      return { body: snapshot };
    }

    const workerConsoleMatch = /^\/api\/v1\/workers\/([^/]+)\/console$/.exec(path);
    if (workerConsoleMatch) {
      const workerId = workerConsoleMatch[1];
      if (method === 'GET') return { body: { lines: ctx.workers.console(workerId) } };
      if (method === 'DELETE') {
        ctx.workers.clearConsole(workerId);
        return { body: { ok: true } };
      }
    }

    const workerTaskMatch = /^\/api\/v1\/workers\/([^/]+)\/task$/.exec(path);
    if (workerTaskMatch && method === 'POST') {
      const workerId = workerTaskMatch[1];
      const kind = String(body.kind ?? '');
      const params = (body.params as Record<string, unknown>) ?? {};
      const result = await ctx.workers.runTask(workerId, kind as never, params);
      return { status: result.ok ? 200 : 400, body: result };
    }

    const workerCommandMatch = /^\/api\/v1\/workers\/([^/]+)\/line$/.exec(path);
    if (workerCommandMatch && method === 'POST') {
      const record = await ctx.workers.sendLine(
        workerCommandMatch[1],
        body.kind === 'chat' ? 'chat' : 'command',
        String(body.line ?? ''),
      );
      return { status: record.ok ? 200 : 400, body: record };
    }

    if (path === '/api/v1/targets' && method === 'POST') {
      const target = ctx.targets.upsert(body as { username: string });
      ctx.emitEvent(FleetEventType.TARGET_UPDATED, `Target ${target.username} upserted via API`, {
        username: target.username, uuid: target.uuid,
      });
      return { status: 201, body: { target } };
    }

    if (path === '/api/v1/events' && method === 'POST') {
      const result = ctx.coordinator.submit({
        type: String(body.type ?? ''),
        role: String(body.role ?? 'meteor'),
        source: 'meteor',
        instanceId: (body.instanceId as string) ?? null,
        targetUuid: (body.targetUuid as string) ?? null,
        payload: (body.payload as Record<string, unknown>) ?? {},
        severity: (body.severity as 'info' | 'warning' | 'error' | 'success') ?? 'info',
      });
      return { status: result.accepted ? 202 : 400, body: result };
    }

    if (path === '/api/v1/command' && method === 'POST') {
      const command = String(body.command ?? '');
      const instanceId = body.instanceId as string | undefined;
      if (instanceId) {
        const ok = ctx.instances.sendCommand(instanceId, command);
        return { body: { ok } };
      }
      // Without an instance id the command is a Hunter companion command.
      try {
        await ctx.hunter.command(command);
        return { body: { ok: true } };
      } catch (error) {
        return { status: 502, body: { ok: false, error: (error as Error).message } };
      }
    }

    if (path === '/api/v1/notify' && method === 'POST') {
      ctx.emitEvent('NOTIFICATION', String(body.message ?? 'Notification'), { source: 'api' });
      return { body: { ok: true } };
    }

    if (path === '/api/v1/targets/sync' && method === 'POST') {
      const result = await ctx.targetSync.pull();
      return { body: result };
    }

    const instanceMatch = /^\/api\/v1\/instances\/([^/]+)\/(start|stop|restart)$/.exec(path);
    if (instanceMatch && method === 'POST') {
      const [, id, action] = instanceMatch;
      if (action === 'start') return { body: { instance: ctx.instances.start(id) } };
      if (action === 'stop') return { body: { instance: ctx.instances.stop(id) } };
      return { body: { instance: ctx.instances.restart(id) } };
    }

    return undefined;
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
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
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }
}
