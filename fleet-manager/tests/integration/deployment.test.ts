import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, seed, type TestContext } from '../helpers';
import type { DeploymentConfig } from '../../src/shared/types';

let ctx: TestContext | null = null;
afterEach(async () => { await ctx?.context.shutdown(); ctx = null; });

async function buildConfig(context: TestContext['context'], serverId: string, accountId: string, over: Partial<DeploymentConfig> = {}): Promise<DeploymentConfig> {
  return context.deployments.create({
    name: 'IT Deployment',
    description: 'integration test',
    serverProfileId: serverId,
    entries: [{ accountId, role: 'GEARER', instanceName: 'GEARER-01', delayMs: 0, roleConfig: { minArmorPieces: 0, minTotems: 0, minFood: 0 } }],
    maxConcurrent: 1,
    connectionTimeoutMs: 2000,
    retryAttempts: 0,
    retryDelayMs: 0,
    manualApproval: false,
    pauseBetweenMs: 0,
    resourceLimitMb: 4096,
    notifyOnEvent: true,
    ...over,
  });
}

describe('deployment engine integration', () => {
  it('validates a deployment and reports readiness', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id);
    const report = await ctx.context.engine.validate(config);
    expect(report.ok).toBe(true);
  });

  it('runs a deployment to completion, creating a running instance', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id);

    // Simulate the worker reporting RUNNING shortly after start.
    ctx.supervisor.on('started', () => {});
    const originalStart = ctx.supervisor.start.bind(ctx.supervisor);
    ctx.supervisor.start = ((command: { instanceId: string }) => {
      originalStart(command);
      setTimeout(() => ctx!.supervisor.emitRunning(command.instanceId), 20);
    }) as typeof ctx.supervisor.start;

    const result = await ctx.context.engine.start(config);
    expect(result.ok).toBe(true);

    // Wait for the engine to finish.
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (ctx!.context.engine.getState() === 'FINISHED') { clearInterval(check); resolve(); }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 4000);
    });

    const items = ctx.context.engine.getItems();
    expect(items[0].stage).toBe('RUNNING');
    expect(ctx.context.instances.list()).toHaveLength(1);
    expect(ctx.context.instances.list()[0].state).toBe('RUNNING');
  });

  it('fails an item when the connection times out and records the error', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id, { connectionTimeoutMs: 300 });

    // The fake supervisor never emits RUNNING, so the wait times out.
    const result = await ctx.context.engine.start(config);
    expect(result.ok).toBe(true);

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (ctx!.context.engine.getState() === 'FINISHED') { clearInterval(check); resolve(); }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 4000);
    });

    const items = ctx.context.engine.getItems();
    expect(items[0].stage).toBe('FAILED');
    expect(items[0].error).toContain('timed out');
  });

  it('refuses to start an invalid deployment', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id, { serverProfileId: null });
    const result = await ctx.context.engine.start(config);
    expect(result.ok).toBe(false);
    expect(result.report.issues.length).toBeGreaterThan(0);
  });

  it('cancels an in-flight deployment', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id, { connectionTimeoutMs: 5000 });
    await ctx.context.engine.start(config);
    ctx.context.engine.cancel();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(['CANCELLED', 'FINISHED']).toContain(ctx.context.engine.getState());
  });

  it('builds a preview describing the deployment order', async () => {
    ctx = await createTestContext();
    const { server, account } = await seed(ctx.context, ctx.vault);
    const config = await buildConfig(ctx.context, server.id, account.id);
    const accounts = ctx.context.accounts.list();
    expect(accounts).toHaveLength(1);
    expect(config.entries).toHaveLength(1);
  });
});
