import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { WorkerSupervisor } from '../../src/main/mineflayer/worker-supervisor';
import type { WorkerStartCommand, WorkerTelemetry } from '../../src/main/mineflayer/protocol';

const fixture = resolve(__dirname, '../fixtures/fake-worker.js');

function command(instanceId: string, mode: string): WorkerStartCommand {
  process.env.LOGVEX_FAKE_MODE = mode;
  return {
    kind: 'start', instanceId, role: 'HUNTER', username: 'TestBot', host: '127.0.0.1', port: 25565,
    version: '', auth: 'offline', connectTimeoutMs: 2000, roleConfig: {},
  };
}

let supervisor: WorkerSupervisor | null = null;
afterEach(() => { supervisor?.stopAll(); supervisor = null; delete process.env.LOGVEX_FAKE_MODE; });

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(true); }
      else if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
    }, 15);
  });
}

describe('WorkerSupervisor (real fork + IPC)', () => {
  it('reaches RUNNING and forwards telemetry, position and role events', async () => {
    supervisor = new WorkerSupervisor(fixture);
    const states: string[] = [];
    const telemetry: WorkerTelemetry[] = [];
    const positions: unknown[] = [];
    const roleEvents: unknown[] = [];

    supervisor.on('state', (_id: string, state: string) => states.push(state));
    supervisor.on('telemetry', (_id: string, t: WorkerTelemetry) => telemetry.push(t));
    supervisor.on('position', (_id: string, p: unknown) => positions.push(p));
    supervisor.on('roleEvent', (_id: string, type: string, payload: unknown) => roleEvents.push({ type, payload }));

    supervisor.start(command('inst-1', 'ok'));
    expect(supervisor.isRunning('inst-1')).toBe(true);

    expect(await waitFor(() => states.includes('RUNNING'))).toBe(true);
    expect(await waitFor(() => telemetry.length > 0)).toBe(true);
    expect(await waitFor(() => positions.length > 0)).toBe(true);
    expect(await waitFor(() => roleEvents.length > 0)).toBe(true);

    expect(states).toContain('CONNECTING');
    expect(states).toContain('AUTHENTICATING');
    expect(states).toContain('INITIALIZING');
    expect(telemetry[0].ping).toBe(40);
    expect(roleEvents[0]).toMatchObject({ type: 'EQUIPMENT_READY' });
  });

  it('marks a crashing worker as exited unexpectedly', async () => {
    supervisor = new WorkerSupervisor(fixture);
    let exit: { code: number | null; expected: boolean } | null = null;
    supervisor.on('exited', (_id: string, code: number | null, expected: boolean) => { exit = { code, expected }; });

    supervisor.start(command('inst-2', 'crash'));
    expect(await waitFor(() => exit !== null)).toBe(true);
    expect(exit!.code).not.toBe(0);
    expect(exit!.expected).toBe(false);
    expect(supervisor.isRunning('inst-2')).toBe(false);
  });

  it('marks an expected stop as clean', async () => {
    supervisor = new WorkerSupervisor(fixture);
    let exit: { code: number | null; expected: boolean } | null = null;
    supervisor.on('exited', (_id: string, code: number | null, expected: boolean) => { exit = { code, expected }; });

    supervisor.start(command('inst-3', 'ok'));
    expect(await waitFor(() => supervisor!.isRunning('inst-3'))).toBe(true);
    supervisor.stop('inst-3');
    expect(await waitFor(() => exit !== null)).toBe(true);
    expect(exit!.expected).toBe(true);
  });

  it('forwards fatal worker errors as FAILED state', async () => {
    supervisor = new WorkerSupervisor(fixture);
    const failures: string[] = [];
    supervisor.on('state', (_id: string, state: string, detail?: string) => { if (state === 'FAILED') failures.push(detail ?? ''); });
    supervisor.start(command('inst-4', 'fail'));
    expect(await waitFor(() => failures.length > 0)).toBe(true);
    expect(failures[0]).toContain('simulated failure');
  });

  it('does not start the same instance twice', async () => {
    supervisor = new WorkerSupervisor(fixture);
    supervisor.start(command('inst-5', 'ok'));
    supervisor.start(command('inst-5', 'ok'));
    expect(supervisor.runningCount()).toBe(1);
  });
});
