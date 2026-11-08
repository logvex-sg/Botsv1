import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, seed, type TestContext } from '../helpers';

let ctx: TestContext | null = null;
afterEach(async () => { await ctx?.context.shutdown(); ctx = null; });

describe('AppContext integration', () => {
  it('creates a fully wired context over an in-memory database', async () => {
    ctx = await createTestContext();
    expect(ctx.context.db.path).toBe(':memory:');
    expect(ctx.context.healthReport()).toBeDefined();
    const health = await ctx.context.healthReport();
    expect(health.ok).toBe(true);
    expect(health.database.ok).toBe(true);
  });

  it('exposes a stable API token and can regenerate it', async () => {
    ctx = await createTestContext();
    const first = ctx.context.getApiToken();
    expect(first.length).toBeGreaterThan(8);
    expect(ctx.context.getApiToken()).toBe(first);
    const second = ctx.context.regenerateApiToken();
    expect(second).not.toBe(first);
  });

  it('round-trips settings and survives corruption', async () => {
    ctx = await createTestContext();
    ctx.context.saveSettings({ apiPort: 9999, logLevel: 'debug' });
    expect(ctx.context.getSettings().apiPort).toBe(9999);
    ctx.context.settingsRepo.set('app', '{not json');
    expect(ctx.context.getSettings().apiPort).toBe(9999);
  });

  it('creates accounts and marks them deployable by auth mode', async () => {
    ctx = await createTestContext();
    const offline = await ctx.context.accounts.create({ username: 'Offline', authMode: 'offline' });
    expect(offline.deployable).toBe(true);
    const online = await ctx.context.accounts.create({ username: 'Online', authMode: 'microsoft' });
    expect(online.deployable).toBe(false);
    await ctx.context.accounts.setCredential(online.id, 'token');
    const views = await ctx.context.accounts.listWithStatus();
    expect(views.find((a) => a.id === online.id)?.deployable).toBe(true);
  });

  it('prevents duplicate accounts', async () => {
    ctx = await createTestContext();
    await ctx.context.accounts.create({ username: 'Dup' });
    await expect(ctx.context.accounts.create({ username: 'dup' })).rejects.toThrow();
  });

  it('exports and imports a configuration bundle without credentials', async () => {
    ctx = await createTestContext();
    const { account } = await seed(ctx.context, ctx.vault, { username: 'ExportBot', authMode: 'microsoft', withCredential: true });
    ctx.context.servers.create({ name: 'S2', host: 'h2', port: 25566, version: '', authMode: 'offline', connectionTimeoutMs: 1000, options: {} });
    ctx.context.targets.upsert({ username: 'Enemy', category: 'PRIORITY' });

    const bundle = ctx.context.exportBundle();
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toContain('secret-token');
    expect(bundle.accounts).toBeDefined();

    const fresh = await createTestContext();
    const imported = fresh.context.importBundle(bundle as Record<string, unknown>);
    expect(imported).toBeGreaterThan(0);
    expect(fresh.context.servers.list().some((s) => s.name === 'S2')).toBe(true);
    expect(fresh.context.targets.list().some((t) => t.username === 'Enemy')).toBe(true);
    await fresh.context.shutdown();
    expect(account.id).toBeTruthy();
  });

  it('records config versions on account edits', async () => {
    ctx = await createTestContext();
    const account = await ctx.context.accounts.create({ username: 'Versioned' });
    ctx.context.configVersions.record('account', account.id, { role: 'HUNTER' });
    ctx.context.configVersions.record('account', account.id, { role: 'GEARER' });
    expect(ctx.context.configVersions.history('account', account.id)).toHaveLength(2);
  });
});
