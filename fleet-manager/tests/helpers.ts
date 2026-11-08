/**
 * Shared test helpers.
 *
 * Builds a fully wired {@link AppContext} over an in-memory database with a fake supervisor and
 * fake credential vault, so integration tests exercise real service logic without spawning child
 * processes or touching the OS keychain.
 */
import { EventEmitter } from 'node:events';
import { AppContext } from '../src/main/context';
import type { CredentialVault } from '../src/main/security/credential-vault';
import type { WorkerSupervisor } from '../src/main/mineflayer/worker-supervisor';

export class MemoryVault implements CredentialVault {
  private readonly store = new Map<string, string>();
  async isAvailable(): Promise<boolean> { return true; }
  async set(id: string, secret: string): Promise<void> { this.store.set(id, secret); }
  async get(id: string): Promise<string | null> { return this.store.get(id) ?? null; }
  async delete(id: string): Promise<void> { this.store.delete(id); }
  async has(id: string): Promise<boolean> { return this.store.has(id); }
}

/** A supervisor double that records start/stop calls and can emit synthetic events. */
export class FakeSupervisor extends EventEmitter {
  readonly started: string[] = [];
  readonly stopped: string[] = [];
  private readonly running = new Set<string>();

  isRunning(id: string): boolean { return this.running.has(id); }
  runningCount(): number { return this.running.size; }

  start(command: { instanceId: string }): void {
    this.started.push(command.instanceId);
    this.running.add(command.instanceId);
  }
  stop(id: string): void {
    this.stopped.push(id);
    this.running.delete(id);
  }
  sendCommand(): void {}
  stopAll(): void { this.running.clear(); }

  /** Simulates the worker reporting RUNNING. */
  emitRunning(instanceId: string): void {
    this.emit('state', instanceId, 'RUNNING');
  }
  emitTelemetry(instanceId: string, telemetry: Record<string, unknown>): void {
    this.emit('telemetry', instanceId, telemetry);
  }
  emitRoleEvent(instanceId: string, type: string, payload: Record<string, unknown>): void {
    this.emit('roleEvent', instanceId, type, payload);
  }
  emitExit(instanceId: string, code: number | null, expected = false): void {
    this.emit('exited', instanceId, code, expected);
  }
}

export interface TestContext {
  context: AppContext;
  supervisor: FakeSupervisor;
  vault: MemoryVault;
}

export async function createTestContext(options: { waitForRunning?: (id: string, timeout: number) => Promise<boolean> } = {}): Promise<TestContext> {
  const supervisor = new FakeSupervisor();
  const vault = new MemoryVault();
  const context = await AppContext.create({
    databasePath: ':memory:',
    userDataDir: '/tmp/logvex-test',
    vault,
    supervisor: supervisor as unknown as WorkerSupervisor,
    waitForRunning: options.waitForRunning,
  });
  return { context, supervisor, vault };
}

/** Creates an account + server + returns their ids for convenience. */
export async function seed(context: AppContext, vault: MemoryVault, options: {
  username?: string; authMode?: 'offline' | 'microsoft'; withCredential?: boolean;
} = {}) {
  const server = context.servers.create({
    name: 'Test Server', host: '127.0.0.1', port: 25565, version: '', authMode: 'offline',
    connectionTimeoutMs: 3000, options: {},
  });
  const account = await context.accounts.create({
    username: options.username ?? 'TestBot',
    authMode: options.authMode ?? 'offline',
    role: 'HUNTER',
  });
  if (options.withCredential && options.authMode === 'microsoft') {
    await vault.set(account.id, 'secret-token');
  }
  return { server, account };
}
