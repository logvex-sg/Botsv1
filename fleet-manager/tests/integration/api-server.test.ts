import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { ApiServer } from '../../src/main/api/server';
import { ApiAuth } from '../../src/main/api/auth';
import { createTestContext, seed, type TestContext } from '../helpers';

let hunter: Server;
let hunterPort = 0;
let ctx: TestContext;
let api: ApiServer;
let apiPort = 0;
let token = '';

beforeAll(async () => {
  // Mock Logvex Hunter companion.
  hunter = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ version: '1.0.0' })); return; }
    if (req.headers.authorization !== 'Bearer hunter-token') { res.writeHead(401); res.end('{}'); return; }
    if (url === '/api/v1/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ targets: [{ username: 'RemoteEnemy', uuid: 'r1', encounters: 5 }], players: [] }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise<void>((resolve) => hunter.listen(0, '127.0.0.1', () => resolve()));
  hunterPort = (hunter.address() as { port: number }).port;

  ctx = await createTestContext();
  ctx.context.saveSettings({ hunterAddonUrl: `http://127.0.0.1:${hunterPort}`, hunterAddonToken: 'hunter-token' });
  token = ctx.context.getApiToken();
  api = new ApiServer(ctx.context, new ApiAuth(token));
  apiPort = await api.start({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await api.stop();
  await ctx.context.shutdown();
  await new Promise<void>((resolve) => hunter.close(() => resolve()));
});

const url = (path: string): string => `http://127.0.0.1:${apiPort}${path}`;
const authHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${token}` });

describe('API server', () => {
  it('serves health without authentication', async () => {
    const response = await fetch(url('/health'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it('rejects requests without a token', async () => {
    const response = await fetch(url('/api/v1/status'));
    expect(response.status).toBe(401);
  });

  it('rejects requests with a wrong token', async () => {
    const response = await fetch(url('/api/v1/status'), { headers: { Authorization: 'Bearer nope' } });
    expect(response.status).toBe(401);
  });

  it('accepts a token via query parameter', async () => {
    const response = await fetch(url(`/api/v1/status?token=${token}`));
    expect(response.status).toBe(200);
  });

  it('returns status, instances, accounts, servers and targets', async () => {
    const { account } = await seed(ctx.context, ctx.vault, { username: 'ApiBot' });
    const status = await (await fetch(url('/api/v1/status'), { headers: authHeaders() })).json();
    expect(status.ok).toBe(true);
    const accounts = await (await fetch(url('/api/v1/accounts'), { headers: authHeaders() })).json();
    expect(accounts.accounts.some((a: { username: string }) => a.username === 'ApiBot')).toBe(true);
    const servers = await (await fetch(url('/api/v1/servers'), { headers: authHeaders() })).json();
    expect(servers.servers.length).toBeGreaterThan(0);
    expect(account.id).toBeTruthy();
  });

  it('creates a target over the API', async () => {
    const response = await fetch(url('/api/v1/targets'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ApiTarget', category: 'PRIORITY' }),
    });
    expect(response.status).toBe(201);
    const list = await (await fetch(url('/api/v1/targets'), { headers: authHeaders() })).json();
    expect(list.targets.some((t: { username: string }) => t.username === 'ApiTarget')).toBe(true);
  });

  it('accepts a submitted event and rejects a forbidden one', async () => {
    const accepted = await fetch(url('/api/v1/events'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TARGET_DETECTED', role: 'meteor', payload: { username: 'X' } }),
    });
    expect(accepted.status).toBe(202);

    const rejected = await fetch(url('/api/v1/events'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'EQUIPMENT_READY', role: 'HUNTER' }),
    });
    expect(rejected.status).toBe(400);
  });

  it('pulls targets from the Hunter companion', async () => {
    const response = await fetch(url('/api/v1/targets/sync'), { method: 'POST', headers: authHeaders() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pulled).toBeGreaterThanOrEqual(1);
    const list = await (await fetch(url('/api/v1/targets'), { headers: authHeaders() })).json();
    expect(list.targets.some((t: { username: string }) => t.username === 'RemoteEnemy')).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await fetch(url('/api/v1/nonsense'), { headers: authHeaders() });
    expect(response.status).toBe(404);
  });

  it('broadcasts events over the websocket', async () => {
    // Uses a manual WebSocket upgrade via the ws client bundled with the server dependency.
    const { WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${apiPort}/events?token=${token}`);
    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
      setTimeout(() => reject(new Error('ws timeout')), 2000);
    });
    socket.on('message', (data) => received.push(JSON.parse(String(data))));
    api.broadcast({ type: 'TEST_EVENT', message: 'hello' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    socket.close();
    expect(received.some((m) => (m as { type: string }).type === 'TEST_EVENT')).toBe(true);
  });
});
