/**
 * Worker Mode service tests.
 *
 * The service owns this machine's worker-side settings and the config file a bot's `mods/` folder
 * needs. These tests use a real in-memory settings store (no mocks) and a real temporary directory,
 * so they check the two things that matter: Host Mode and Worker Mode settings never mix, and the
 * provisioned file is exactly what the mod reads.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers';
import { DEFAULT_WORKER_MODE, WorkerModeService } from '../../src/main/worker-mode/worker-mode-service';

let ctx: TestContext;
let dir: string;

beforeEach(async () => {
  ctx = await createTestContext({ startWorkerServer: false });
  dir = mkdtempSync(join(tmpdir(), 'logvex-worker-'));
});

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
  await ctx.context.shutdown();
});

describe('worker mode settings', () => {
  it('starts from the defaults', () => {
    const settings = ctx.context.workerMode.getSettings();
    expect(settings.hostPort).toBe(DEFAULT_WORKER_MODE.hostPort);
    expect(settings.modules.StatusReporter).toBe(true);
  });

  it('persists changes under its own key, apart from the host settings', () => {
    ctx.context.workerMode.saveSettings({ hostAddress: '10.0.0.5', workerName: 'Bot-A' });
    expect(ctx.context.settingsRepo.get('workerMode')).toContain('10.0.0.5');

    // The host settings are untouched: the two modes must never blend.
    const hostSettings = ctx.context.getSettings();
    expect(hostSettings.workerServerPort).toBe(DEFAULT_WORKER_MODE.hostPort === 8721 ? 8721 : hostSettings.workerServerPort);
    expect(JSON.stringify(hostSettings)).not.toContain('10.0.0.5');
  });

  it('merges nested module and permission toggles without dropping the rest', () => {
    const updated = ctx.context.workerMode.saveSettings({
      modules: { ChatTask: false },
      permissions: { chat: false },
    });
    expect(updated.modules.ChatTask).toBe(false);
    expect(updated.modules.StatusReporter).toBe(true);
    expect(updated.permissions.chat).toBe(false);
    expect(updated.permissions.regear).toBe(true);
  });

  it('survives a corrupt stored value by falling back to defaults', () => {
    ctx.context.settingsRepo.set('workerMode', '{not json');
    const fresh = new WorkerModeService({ settings: ctx.context.settingsRepo, emit: () => {} });
    expect(fresh.getSettings().hostPort).toBe(DEFAULT_WORKER_MODE.hostPort);
  });
});

describe('worker config provisioning', () => {
  it('writes a logvex-worker.json the mod can read', () => {
    ctx.context.workerMode.saveSettings({ hostAddress: '192.168.1.50', hostPort: 9000, workerName: 'Miner-1', groupName: 'Miners' });
    const result = ctx.context.workerMode.provision(dir);

    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(dir, 'logvex-worker.json'));
    const written = JSON.parse(readFileSync(result.path, 'utf8'));
    expect(written).toMatchObject({ host: '192.168.1.50', port: 9000, label: 'Miner-1', group: 'Miners' });
    expect(written.protocolVersion).toBe(3);
    expect(written.modules).toBeTypeOf('object');
    // The permission keys are the ones WorkerConfig reads, so the mod honours them directly.
    expect(written.allowCommands).toBe(true);
    expect(written.allowEfly).toBe(true);
  });

  it('keeps the same worker id across two provisions', () => {
    const first = ctx.context.workerMode.provision(dir);
    const second = ctx.context.workerMode.provision(dir);
    expect(second.workerId).toBe(first.workerId);
    expect(first.workerId).toMatch(/^worker-/);
  });

  it('reports a clear error when the directory cannot be written', () => {
    // A path whose parent is a regular file fails immediately with ENOTDIR, which is a reliable
    // unwritable target on any platform.
    const blocker = join(dir, 'not-a-directory');
    writeFileSync(blocker, 'x');
    const result = ctx.context.workerMode.provision(join(blocker, 'nested'));
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
