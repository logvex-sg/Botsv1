/**
 * Local HTTP API integration tests.
 *
 * The API is a real HTTP server over a real loopback socket, so these tests exercise routing, auth
 * and JSON encoding the way a script or a phone would. They are deliberately independent of the
 * worker server: the API reads the host's state and dispatches to it, but the two are separate
 * listeners.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ApiServer } from '../../src/main/api/server';
import { ApiAuth } from '../../src/main/api/auth';
import { createTestContext, type TestContext } from '../helpers';
import { FakeWorker, waitFor } from '../support/fake-worker';

let ctx: TestContext;
let api: ApiServer;
let base = '';
let token = '';

beforeAll(async () => {
  ctx = await createTestContext({ startWorkerServer: false });
  token = ctx.context.getApiToken();
  api = new ApiServer(ctx.context, new ApiAuth(token));
  const port = await api.start({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await api.stop();
  await ctx.context.shutdown();
});

async function get(path: string, withAuth = true): Promise<Response> {
  return fetch(`${base}${path}`, withAuth ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HTTP API', () => {
  it('serves /health without a token', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    const response = await fetch(`${base}/api/v1/workers`);
    expect(response.status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const response = await fetch(`${base}/api/v1/workers`, { headers: { Authorization: 'Bearer nope' } });
    expect(response.status).toBe(401);
  });

  it('accepts a token via the query parameter', async () => {
    const response = await fetch(`${base}/api/v1/status?token=${token}`);
    expect(response.status).toBe(200);
  });

  it('lists workers (empty at first)', async () => {
    const response = await get('/api/v1/workers');
    expect(response.status).toBe(200);
    const body = await response.json() as { workers: unknown[] };
    expect(Array.isArray(body.workers)).toBe(true);
    expect(body.workers).toHaveLength(0);
  });

  it('returns 404 for an unknown route', async () => {
    const response = await get('/api/v1/nonsense');
    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown worker', async () => {
    const response = await get('/api/v1/workers/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('reports the worker server state in the overview route', async () => {
    const response = await get('/api/v1/workers/overview');
    expect(response.status).toBe(200);
    const body = await response.json() as { total: number; online: number };
    expect(body.total).toBe(0);
    expect(body.online).toBe(0);
  });
});

describe('multiverse and statistics routes', () => {
  it('lists the multiverse collections', async () => {
    for (const path of ['/api/v1/servers', '/api/v1/templates', '/api/v1/presets', '/api/v1/schedules', '/api/v1/rules', '/api/v1/containers', '/api/v1/audit', '/api/v1/tags']) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
    }
  });

  it('serves a statistics report shaped like the renderer expects', async () => {
    const response = await get('/api/v1/statistics');
    expect(response.status).toBe(200);
    const body = await response.json() as { workers: { total: number }; tasks: { completion: { value: unknown } }; activity: { buckets: unknown[] } };
    expect(body.workers.total).toBe(0);
    expect(body.tasks.completion.value).toBeNull();
    expect(body.activity.buckets).toHaveLength(24);
  });
});

describe('worker control route', () => {
  it('forwards a control action to a connected worker and validates the action', async () => {
    const port = await ctx.context.workers.server.start();
    const worker = new FakeWorker({ workerId: 'api-worker', token: ctx.context.getWorkerToken() });
    await worker.connect(port);
    await waitFor(() => worker.accepted);
    worker.register();
    await waitFor(() => ctx.context.workers.server.isOnline('api-worker'));

    const ok = await post('/api/v1/workers/api-worker/control', { action: 'pause' });
    expect(ok.status).toBe(200);
    await waitFor(() => worker.controls.includes('pause'));

    const bad = await post('/api/v1/workers/api-worker/control', { action: 'self-destruct' });
    expect(bad.status).toBe(400);

    const missing = await post('/api/v1/workers/nobody/control', { action: 'pause' });
    expect(missing.status).toBe(409);

    worker.close();
    await ctx.context.workers.server.stop();
  });
});
