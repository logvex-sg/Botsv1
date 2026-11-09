/**
 * Setup advisor + one-click setup/deploy tests.
 *
 * The advisor is pure so its branches are covered directly; quickSetup/quickDeploy run against a
 * real AppContext over an in-memory database to prove the beginner path actually creates and starts
 * what it promises.
 */
import { describe, expect, it } from 'vitest';
import { buildSetupReport, type SetupSnapshot } from '../../src/main/services/setup/setup-advisor';
import { createTestContext, seed } from '../helpers';

const base: SetupSnapshot = {
  servers: 0,
  accounts: 0,
  deployableAccounts: 0,
  instances: 0,
  runningInstances: 0,
  hunterConnected: false,
};

describe('buildSetupReport', () => {
  it('points a brand-new user at adding a server first', () => {
    const report = buildSetupReport(base);
    expect(report.ready).toBe(false);
    expect(report.completion).toBe(0);
    expect(report.nextStepId).toBe('server');
    expect(report.nextHint).toMatch(/server/i);
    expect(report.steps.find((s) => s.id === 'server')?.status).toBe('todo');
    expect(report.steps.find((s) => s.id === 'deploy')?.status).toBe('blocked');
  });

  it('moves the next step forward as required items are completed', () => {
    const withServer = buildSetupReport({ ...base, servers: 1 });
    expect(withServer.nextStepId).toBe('account');

    const withAccount = buildSetupReport({ ...base, servers: 1, accounts: 1, deployableAccounts: 1 });
    expect(withAccount.nextStepId).toBe('deploy');
    expect(withAccount.completion).toBeCloseTo(0.75);
  });

  it('is ready once every required step is done, even without Hunter', () => {
    const report = buildSetupReport({ ...base, servers: 1, accounts: 1, deployableAccounts: 1, instances: 2, runningInstances: 2 });
    expect(report.ready).toBe(true);
    expect(report.completion).toBe(1);
    // Hunter stays a recommendation, not a blocker.
    expect(report.steps.find((s) => s.id === 'hunter')?.optional).toBe(true);
    expect(report.nextStepId).toBe('hunter');
  });

  it('blocks the credential step until an account exists', () => {
    const report = buildSetupReport({ ...base, servers: 1 });
    expect(report.steps.find((s) => s.id === 'credential')?.status).toBe('blocked');
  });
});

describe('AppContext guided setup', () => {
  it('reports a fresh context as not ready and asking for a server', async () => {
    const { context } = await createTestContext();
    const report = await context.setupReport();
    expect(report.ready).toBe(false);
    expect(report.nextStepId).toBe('server');
    await context.shutdown();
  });

  it('quickSetup creates a server and account in one step', async () => {
    const { context } = await createTestContext();
    const result = await context.quickSetup({ username: 'BotOne', host: 'play.example.net' });

    expect(result.created.server).toBe(true);
    expect(result.created.account).toBe(true);
    expect(context.servers.list()).toHaveLength(1);
    expect(context.accountRepo.findByUsername('BotOne')).toBeTruthy();

    const report = await context.setupReport();
    expect(report.steps.find((s) => s.id === 'server')?.status).toBe('done');
    expect(report.steps.find((s) => s.id === 'account')?.status).toBe('done');
    await context.shutdown();
  });

  it('quickSetup reuses an existing server and account instead of duplicating', async () => {
    const { context } = await createTestContext();
    await context.quickSetup({ username: 'BotOne', host: 'play.example.net' });
    const second = await context.quickSetup({ username: 'BotOne', host: 'play.example.net' });
    expect(second.created.server).toBe(false);
    expect(second.created.account).toBe(false);
    expect(context.servers.list()).toHaveLength(1);
    expect(context.accountRepo.list()).toHaveLength(1);
    await context.shutdown();
  });

  it('quickSetup rejects missing input with a friendly message', async () => {
    const { context } = await createTestContext();
    await expect(context.quickSetup({ username: '', host: 'x' })).rejects.toThrow(/username/i);
    await expect(context.quickSetup({ username: 'a', host: '' })).rejects.toThrow(/server address/i);
    await context.shutdown();
  });

  it('quickDeploy starts a deployment that creates an instance', async () => {
    const { context, supervisor, vault } = await createTestContext();
    const { account } = await seed(context, vault, { username: 'DeployBot' });

    const result = await context.quickDeploy({ accountIds: [account.id], authorizeCombat: true });
    expect(result.ok).toBe(true);
    expect(result.deploymentId).toBeTruthy();
    // The engine creates the instance and starts its worker.
    expect(context.instances.list().length).toBe(1);
    expect(supervisor.started.length).toBe(1);
    await context.shutdown();
  });

  it('quickDeploy never arms HUNTER combat without explicit authorisation', async () => {
    const { context, vault } = await createTestContext();
    const { account } = await seed(context, vault, { username: 'SafeBot' });

    const result = await context.quickDeploy({ accountIds: [account.id] });
    // HUNTER requires explicit authorisation, so the one-click path refuses rather than guessing.
    expect(result.ok).toBe(false);
    expect(result.report.issues.some((i) => /authoris|authoriz/i.test(i.message))).toBe(true);
    await context.shutdown();
  });

  it('quickDeploy refuses an empty selection', async () => {
    const { context } = await createTestContext();
    const result = await context.quickDeploy({ accountIds: [] });
    expect(result.ok).toBe(false);
    expect(result.report.issues[0].message).toMatch(/at least one account/i);
    await context.shutdown();
  });
});
