/**
 * Worker Mode integration tests.
 *
 * These prove the headline feature is real: the desktop app's {@link WorkerClient} — the code that
 * backs the "Connect to a host" button — connects to the *real* host {@link WorkerServer} over a
 * loopback socket, pairs, registers, and then obeys remote control. Nothing here is mocked below the
 * protocol boundary: the same handshake, envelope and control messages the Fabric mod speaks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers';
import { WorkerClient } from '../../src/main/worker-mode/worker-client';
import { waitFor } from '../support/fake-worker';

let ctx: TestContext;
let port: number;
const clients: WorkerClient[] = [];

function client(options: Partial<ConstructorParameters<typeof WorkerClient>[0]> = {}): WorkerClient {
  const created = new WorkerClient({
    host: '127.0.0.1',
    port,
    token: 'test-worker-token',
    username: 'HostAppWorker',
    heartbeatSeconds: 1,
    stayConnected: true,
    ...options,
  });
  clients.push(created);
  return created;
}

beforeEach(async () => {
  ctx = await createTestContext({ startWorkerServer: false, workerToken: 'test-worker-token' });
  port = await ctx.context.workers.server.start();
});

afterEach(async () => {
  for (const created of clients.splice(0)) created.disconnect();
  await ctx.context.workers.server.stop();
  await ctx.context.shutdown();
});

describe('worker mode client', () => {
  it('pairs with the host and appears in the roster', async () => {
    const worker = client({ workerId: 'app-1' });
    const status = await worker.connect();
    expect(status.state).toBe('registered');
    expect(status.workerId).toBe('app-1');

    await waitFor(() => ctx.context.workers.list().length === 1);
    const view = ctx.context.workers.get('app-1');
    expect(view?.online).toBe(true);
    expect(view?.username).toBe('HostAppWorker');
    // The host-app worker is honest: it reports that it has no game client attached.
    expect(view?.snapshot.dimension).toBe('host-app');
  });

  it('is refused with a wrong token, and reports why', async () => {
    const worker = client({ token: 'not-the-token' });
    const status = await worker.connect();
    expect(status.state).toBe('refused');
    expect(status.lastError).toContain('token');
  });

  it('pairs with a one-time code and stores the granted token', async () => {
    const code = ctx.context.createPairingCode();
    const worker = client({ token: '', pairingCode: code.code, workerId: 'app-2' });
    const status = await worker.connect();
    expect(status.state).toBe('registered');
    expect(status.grantedToken).toBe('test-worker-token');
  });

  it('reports itself paused and stopped when the host drives it', async () => {
    const worker = client({ workerId: 'app-3' });
    await worker.connect();
    await waitFor(() => ctx.context.workers.server.isOnline('app-3'));

    ctx.context.workers.pause('app-3');
    await waitFor(() => ctx.context.workers.get('app-3')?.status === 'DEGRADED');
    expect(worker.status().paused).toBe(true);

    ctx.context.workers.resume('app-3');
    await waitFor(() => worker.status().paused === false);

    ctx.context.workers.disconnect('app-3');
    await waitFor(() => ctx.context.workers.get('app-3')?.stopped === true);
    expect(worker.status().stopped).toBe(true);

    ctx.context.workers.connect('app-3');
    await waitFor(() => worker.status().stopped === false);
  });

  it('answers a status task but refuses a game task explicitly', async () => {
    const worker = client({ workerId: 'app-4' });
    await worker.connect();
    await waitFor(() => ctx.context.workers.server.isOnline('app-4'));

    const status = await ctx.context.workers.runTask('app-4', 'status', {});
    expect(status.ok).toBe(true);

    const count = await ctx.context.workers.runTask('app-4', 'count', { query: 'diamond' });
    expect(count.ok).toBe(false);
    expect(count.message).toContain('cannot run');
  });

  it('disconnects when the host kicks it', async () => {
    const worker = client({ workerId: 'app-5' });
    await worker.connect();
    await waitFor(() => ctx.context.workers.server.isOnline('app-5'));

    ctx.context.workers.server.kick('app-5', 'removed for testing');
    await waitFor(() => !ctx.context.workers.server.isOnline('app-5'));
    expect(worker.status().registered).toBe(false);
  });

  it('a one-shot test connects, reports the handshake, and does not stay registered', async () => {
    const probe = client({ workerId: 'app-6', stayConnected: false });
    const status = await probe.connect();
    expect(status.state).toBe('registered');
    // A connection test must not leave a phantom worker behind on the host.
    await waitFor(() => !ctx.context.workers.server.isOnline('app-6'));
  });
});
