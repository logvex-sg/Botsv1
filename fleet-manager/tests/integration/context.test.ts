import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { AppContext } from '../../src/main/context';
import { createTestContext, type TestContext } from '../helpers';

let ctx: TestContext | null = null;
afterEach(async () => { await ctx?.context.shutdown(); ctx = null; });

describe('AppContext integration', () => {
  it('creates a fully wired context over an in-memory database', async () => {
    ctx = await createTestContext();
    expect(ctx.context.db.path).toBe(':memory:');
    const health = await ctx.context.healthReport();
    expect(health.ok).toBe(true);
    expect(health.database.ok).toBe(true);
    expect(health.workerServer).toBeDefined();
  });

  it('exposes a stable API token and can regenerate it', async () => {
    ctx = await createTestContext();
    const first = ctx.context.getApiToken();
    expect(first.length).toBeGreaterThan(8);
    expect(ctx.context.getApiToken()).toBe(first);
    const second = ctx.context.regenerateApiToken();
    expect(second).not.toBe(first);
  });

  it('exposes a stable worker token and can regenerate it', async () => {
    ctx = await createTestContext();
    const first = ctx.context.getWorkerToken();
    expect(first.length).toBeGreaterThan(8);
    expect(ctx.context.getWorkerToken()).toBe(first);
    expect(ctx.context.regenerateWorkerToken()).not.toBe(first);
  });

  it('round-trips settings', async () => {
    ctx = await createTestContext();
    ctx.context.saveSettings({ apiPort: 9999, logLevel: 'debug' });
    expect(ctx.context.getSettings().apiPort).toBe(9999);
    expect(ctx.context.getSettings().logLevel).toBe('debug');
  });

  it('serves defaults when the stored settings blob is corrupt', async () => {
    const file = join(tmpdir(), `logvex-corrupt-${Date.now()}.sqlite`);
    const first = await AppContext.create({ databasePath: file, startWorkerServer: false });
    first.saveSettings({ apiPort: 9999 });
    first.settingsRepo.set('app', '{not json');
    await first.shutdown();

    const second = await AppContext.create({ databasePath: file, startWorkerServer: false });
    expect(second.getSettings().apiPort).toBe(8787);
    await second.shutdown();
    rmSync(file, { force: true });
  });

  describe('pairing codes', () => {
    it('creates a code that expires in the future and clears it', async () => {
      ctx = await createTestContext();
      const code = ctx.context.createPairingCode();
      expect(code.code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code.expiresAt).toBeGreaterThan(code.createdAt);
      expect(ctx.context.currentPairingCode()?.code).toBe(code.code);
      ctx.context.clearPairingCode();
      expect(ctx.context.currentPairingCode()).toBeNull();
    });

    it('replaces any previous code', async () => {
      ctx = await createTestContext();
      const first = ctx.context.createPairingCode();
      const second = ctx.context.createPairingCode();
      expect(second.code).not.toBe(first.code);
      expect(ctx.context.currentPairingCode()?.code).toBe(second.code);
    });

    it('honours the configured TTL, with a 30-second floor', async () => {
      ctx = await createTestContext();
      ctx.context.saveSettings({ pairingCodeTtlSeconds: 5 });
      const code = ctx.context.createPairingCode();
      expect(code.expiresAt - code.createdAt).toBe(30_000);
    });
  });

  it('exports and imports a configuration bundle without the token', async () => {
    ctx = await createTestContext();
    ctx.context.workers.createGroup('Farmers', 'crew', '#3fb950');
    ctx.context.workers.createPreset({
      name: 'Standard', description: '', items: [{ query: 'diamond', count: 64, label: 'Diamonds' }],
      minArmorPieces: 4, minFood: 8, lowDurabilityPercent: 10,
    });

    const bundle = ctx.context.exportBundle();
    expect(JSON.stringify(bundle)).not.toContain(ctx.context.getWorkerToken());
    expect(bundle.workerGroups).toBeDefined();
    expect(bundle.regearPresets).toBeDefined();

    const fresh = await createTestContext();
    const imported = fresh.context.importBundle(bundle);
    expect(imported).toBe(2);
    expect(fresh.context.workers.listGroups().some((g) => g.name === 'Farmers')).toBe(true);
    expect(fresh.context.workers.listPresets().some((p) => p.name === 'Standard')).toBe(true);
    // Re-importing is a no-op because names already exist.
    expect(fresh.context.importBundle(bundle)).toBe(0);
    await fresh.context.shutdown();
  });

  it('emits a host event that lands on the bus', async () => {
    ctx = await createTestContext();
    ctx.context.emitEvent('SYSTEM', 'hello world');
    expect(ctx.context.bus.recentEvents().some((e) => e.message === 'hello world')).toBe(true);
  });
});
