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

describe('structure registry routes', () => {
  it('registers a structure, lists it, and reports its counts and issues', async () => {
    const created = await post('/api/v1/storage/structures', {
      name: 'API storage room', kind: 'storage_room', dimension: 'minecraft:overworld',
      x1: 0, y1: 60, z1: 0, x2: 8, y2: 68, z2: 8,
      ownership: 'ops', protected: true, maintenance: 'ok',
      lastSeenBy: null, lastSeenAt: null, notes: '',
    });
    expect(created.status).toBe(200);
    const structure = await created.json() as { id: string; name: string };
    expect(structure.name).toBe('API storage room');

    const list = await get('/api/v1/storage/structures');
    const listed = await list.json() as { structures: { id: string }[] };
    expect(listed.structures.some((s) => s.id === structure.id)).toBe(true);

    const counts = await get('/api/v1/storage/structures/counts');
    const countsBody = await counts.json() as { counts: Record<string, number> };
    expect(countsBody.counts.storage_room).toBeGreaterThanOrEqual(1);

    const issues = await get('/api/v1/storage/structures/issues');
    const issuesBody = await issues.json() as { issues: { reason: string }[] };
    expect(issuesBody.issues.map((i) => i.reason)).toContain('protected');
  });

  it('previews a change against a region', async () => {
    const response = await post('/api/v1/storage/structures/preview-change', {
      region: { dimension: 'minecraft:overworld', minX: 0, minY: 60, minZ: 0, maxX: 4, maxY: 64, maxZ: 4 },
    });
    const body = await response.json() as { preview: { structureId: string; actionable: boolean }[] };
    expect(body.preview.some((entry) => entry.actionable === false)).toBe(true);
  });

  it('edits and removes a structure through the collection route', async () => {
    const created = await post('/api/v1/storage/structures', {
      name: 'API removable', kind: 'farm', dimension: 'minecraft:overworld',
      x1: 100, y1: 60, z1: 100, x2: 108, y2: 68, z2: 108,
      ownership: '', protected: false, maintenance: 'ok',
      lastSeenBy: null, lastSeenAt: null, notes: '',
    });
    const structure = await created.json() as { id: string };

    const patched = await fetch(`${base}/api/v1/storage/structures/${structure.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maintenance: 'overdue' }),
    });
    const updated = await patched.json() as { maintenance: string };
    expect(updated.maintenance).toBe('overdue');

    const removed = await fetch(`${base}/api/v1/storage/structures/${structure.id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
    const removedBody = await removed.json() as { ok: boolean };
    expect(removedBody.ok).toBe(true);
  });
});

describe('hive routes', () => {
  it('reports the hive state and map', async () => {
    const overview = await get('/api/v1/hive/overview');
    expect(overview.status).toBe(200);
    const body = await overview.json() as { enabled: boolean; formation: { kind: string }; members: unknown[] };
    expect(body.formation.kind).toBeTruthy();
    expect(Array.isArray(body.members)).toBe(true);

    const map = await get('/api/v1/hive/map');
    const mapBody = await map.json() as { sectors: unknown[]; members: unknown[] };
    expect(Array.isArray(mapBody.sectors)).toBe(true);
  });

  it('enables the hive, sets a formation and refuses an unknown command', async () => {
    const enable = await post('/api/v1/hive/state', { enabled: true });
    expect((await enable.json() as { enabled: boolean }).enabled).toBe(true);

    const formation = await post('/api/v1/hive/formation', { kind: 'diamond', spacing: 3 });
    const formationBody = await formation.json() as { formation: { kind: string } };
    expect(formationBody.formation.kind).toBe('diamond');

    const refused = await post('/api/v1/hive/command', { instruction: 'make me a sandwich' });
    const refusedBody = await refused.json() as { accepted: boolean; message: string };
    expect(refusedBody.accepted).toBe(false);
    expect(refusedBody.message).toMatch(/recognise/i);
  });

  it('assigns a role and elects a commander', async () => {
    const role = await fetch(`${base}/api/v1/hive/roles/route-worker`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'SCOUT' }),
    });
    const roleBody = await role.json() as { workerId: string; role: string };
    expect(roleBody.workerId).toBe('route-worker');
    expect(roleBody.role).toBe('SCOUT');

    const commander = await post('/api/v1/hive/commander', { workerId: 'route-worker' });
    expect((await commander.json() as { commanderId: string }).commanderId).toBe('route-worker');
  });

  it('validates the required fields', async () => {
    const noInstruction = await post('/api/v1/hive/command', {});
    expect(noInstruction.status).toBe(400);
    const noWorker = await post('/api/v1/hive/commander', {});
    expect(noWorker.status).toBe(400);
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

describe('pairing routes', () => {
  it('creates a code, pairs a worker with it, and revokes that worker', async () => {
    const created = await post('/api/v1/pairing/code', {});
    expect(created.status).toBe(200);
    const code = (await created.json() as { code: string }).code;
    expect(code).toHaveLength(8);

    const port = await ctx.context.workers.server.start();
    const worker = new FakeWorker({ workerId: 'pair-api', token: '', pairingCode: code });
    await worker.connect(port);
    await waitFor(() => worker.accepted);
    expect(worker.grantedToken).toBeTruthy();
    await ctx.context.workers.server.stop();
    worker.close();

    const status = await get('/api/v1/pairing');
    const body = await status.json() as { code: unknown; workers: { workerId: string; revoked: boolean }[] };
    // The code was consumed by the pairing, and the worker now shows in the roster.
    expect(body.code).toBeNull();
    expect(body.workers.some((w) => w.workerId === 'pair-api')).toBe(true);

    const revoke = await post('/api/v1/pairing/workers/pair-api/revoke', {});
    expect(revoke.status).toBe(200);
    const after = await get('/api/v1/pairing');
    const afterBody = await after.json() as { workers: { workerId: string; revoked: boolean }[] };
    expect(afterBody.workers.find((w) => w.workerId === 'pair-api')?.revoked).toBe(true);

    const allow = await post('/api/v1/pairing/workers/pair-api/allow', {});
    expect(allow.status).toBe(200);
  });

  it('clears the active code on request', async () => {
    await post('/api/v1/pairing/code', {});
    const cleared = await fetch(`${base}/api/v1/pairing/code`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    expect(cleared.status).toBe(200);
    const status = await get('/api/v1/pairing');
    expect((await status.json() as { code: unknown }).code).toBeNull();
  });

  it('returns 404 when revoking a worker that was never paired', async () => {
    const missing = await post('/api/v1/pairing/workers/ghost/revoke', {});
    expect(missing.status).toBe(404);
  });
});
