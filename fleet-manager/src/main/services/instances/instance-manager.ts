/**
 * Instance manager.
 *
 * Owns the runtime state of every bot instance: start/stop/restart, live metrics, health scoring,
 * connection bookkeeping and the ring buffer of recent log lines. It is the only component that
 * talks to the {@link WorkerSupervisor}, so lifecycle logic stays in one place.
 */
import type { InstanceRepository } from '../../db/repositories';
import type { WorkerSupervisor } from '../../mineflayer/worker-supervisor';
import type { WorkerStartCommand, WorkerTelemetry } from '../../mineflayer/protocol';
import type { ConnectionState, InstanceMetrics, InstanceRecord, InstanceState } from '../../../shared/types';
import { withRoleDefaults } from '../roles/roles';

export interface RuntimeInstance extends InstanceRecord {
  logs: string[];
  accountUsername: string;
}

const LOG_LIMIT = 300;

export class InstanceManager {
  private readonly runtime = new Map<string, RuntimeInstance>();

  constructor(
    private readonly repo: InstanceRepository,
    private readonly supervisor: WorkerSupervisor,
    private readonly resolveAccount: (accountId: string) => { username: string } | undefined,
    private readonly resolveServer: (serverProfileId: string | null) => { host: string; port: number; version: string; authMode: string; connectionTimeoutMs: number } | undefined,
  ) {
    this.supervisor.on('telemetry', (id, telemetry) => this.applyTelemetry(id, telemetry));
    this.supervisor.on('state', (id, state, detail) => this.applyState(id, state, detail));
    this.supervisor.on('health', (id, health) => this.applyHealth(id, health));
    this.supervisor.on('position', (id, position, dimension) => this.applyPosition(id, position, dimension));
    this.supervisor.on('log', (id, level, message) => this.appendLog(id, level, message));
    this.supervisor.on('exited', (id, code, expected) => this.applyExit(id, code, expected));
  }

  /** Loads persisted instances into the runtime map (all stopped). */
  load(): void {
    for (const record of this.repo.list()) {
      if (this.runtime.has(record.id)) continue;
      const account = this.resolveAccount(record.accountId);
      this.runtime.set(record.id, {
        ...record,
        logs: [],
        accountUsername: account?.username ?? 'unknown',
      });
    }
  }

  list(): RuntimeInstance[] {
    return [...this.runtime.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  }

  get(id: string): RuntimeInstance | undefined {
    return this.runtime.get(id);
  }

  create(input: Parameters<InstanceRepository['create']>[0]): RuntimeInstance {
    const record = this.repo.create(input);
    const account = this.resolveAccount(record.accountId);
    const runtime: RuntimeInstance = { ...record, logs: [], accountUsername: account?.username ?? 'unknown' };
    this.runtime.set(record.id, runtime);
    return runtime;
  }

  update(id: string, patch: Partial<InstanceRecord>): RuntimeInstance | undefined {
    const updated = this.repo.update(id, patch);
    if (!updated) return undefined;
    const existing = this.runtime.get(id);
    if (!existing) return undefined;
    const merged: RuntimeInstance = { ...existing, ...updated, logs: existing.logs, accountUsername: existing.accountUsername };
    this.runtime.set(id, merged);
    return merged;
  }

  remove(id: string): boolean {
    if (this.supervisor.isRunning(id)) this.supervisor.stop(id);
    this.runtime.delete(id);
    return this.repo.remove(id);
  }

  /** Starts an instance. Returns the (now starting) runtime record. */
  start(id: string): RuntimeInstance | undefined {
    const instance = this.runtime.get(id);
    if (!instance) return undefined;
    if (this.supervisor.isRunning(id)) return instance;

    const account = this.resolveAccount(instance.accountId);
    const server = this.resolveServer(instance.serverProfileId);
    if (!account || !server) {
      this.applyState(id, 'FAILED', 'missing account or server profile');
      return this.runtime.get(id);
    }

    const command: WorkerStartCommand = {
      kind: 'start',
      instanceId: id,
      role: instance.role,
      username: account.username,
      host: server.host,
      port: server.port,
      version: server.version,
      auth: server.authMode === 'microsoft' ? 'microsoft' : 'offline',
      connectTimeoutMs: server.connectionTimeoutMs,
      roleConfig: withRoleDefaults(instance.role, instance.config),
    };

    this.setRuntime(id, { state: 'VALIDATING', connection: 'CONNECTING', lastError: null });
    this.supervisor.start(command);
    this.setRuntime(id, { state: 'CONNECTING' });
    return this.runtime.get(id);
  }

  stop(id: string): RuntimeInstance | undefined {
    const instance = this.runtime.get(id);
    if (!instance) return undefined;
    this.supervisor.stop(id);
    this.setRuntime(id, { state: 'STOPPING' });
    return this.runtime.get(id);
  }

  restart(id: string): RuntimeInstance | undefined {
    const instance = this.runtime.get(id);
    if (!instance) return undefined;
    this.supervisor.stop(id);
    // Give the worker a moment to release the connection before restarting.
    setTimeout(() => this.start(id), 1500).unref?.();
    return instance;
  }

  sendCommand(id: string, command: string): boolean {
    if (!this.supervisor.isRunning(id)) return false;
    this.supervisor.sendCommand(id, command);
    return true;
  }

  stopAll(): void {
    for (const instance of this.runtime.values()) {
      if (this.supervisor.isRunning(instance.id)) this.stop(instance.id);
    }
  }

  runningCount(): number {
    return this.list().filter((i) => i.state === 'RUNNING').length;
  }

  failedCount(): number {
    return this.list().filter((i) => i.state === 'FAILED').length;
  }

  // ------------------------------------------------------------- internals

  private applyTelemetry(id: string, telemetry: WorkerTelemetry): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    const metrics: InstanceMetrics = {
      ...instance.metrics,
      memoryBytes: telemetry.memoryBytes,
      cpuPercent: telemetry.cpuPercent,
      ping: telemetry.ping,
      position: telemetry.position ?? instance.metrics.position,
      dimension: telemetry.dimension ?? instance.metrics.dimension,
      health: telemetry.health ?? instance.metrics.health,
      food: telemetry.food ?? instance.metrics.food,
    };
    this.setRuntime(id, { metrics, health: this.scoreHealth(instance, telemetry) });
  }

  private applyState(id: string, state: string, detail?: string): void {
    const mapped = state as InstanceState;
    const connection: ConnectionState =
      mapped === 'RUNNING' ? 'ONLINE'
        : mapped === 'FAILED' ? 'ERROR'
          : mapped === 'STOPPED' ? 'OFFLINE'
            : 'CONNECTING';
    const patch: Partial<RuntimeInstance> = { state: mapped, connection };
    if (mapped === 'RUNNING' && !this.runtime.get(id)?.startedAt) patch.startedAt = Date.now();
    if (mapped === 'FAILED' && detail) patch.lastError = detail;
    if (mapped === 'STOPPED') {
      patch.stoppedAt = Date.now();
      patch.uptimeMs = 0;
    }
    this.setRuntime(id, patch);
    if (detail) this.appendLog(id, mapped === 'FAILED' ? 'error' : 'info', detail);
  }

  private applyHealth(id: string, health: number): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    this.setRuntime(id, { health: Math.round(Math.max(0, Math.min(100, (health / 20) * 100))) });
  }

  private applyPosition(id: string, position: { x: number; y: number; z: number }, dimension: string): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    this.setRuntime(id, { metrics: { ...instance.metrics, position, dimension } });
  }

  private applyExit(id: string, code: number | null, expected: boolean): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    if (!expected && code !== 0) {
      this.setRuntime(id, { state: 'FAILED', connection: 'ERROR', lastError: `worker exited with code ${code}` });
      this.appendLog(id, 'error', `worker exited unexpectedly (code ${code})`);
    } else {
      this.setRuntime(id, { state: 'STOPPED', connection: 'OFFLINE', uptimeMs: 0, stoppedAt: Date.now() });
    }
  }

  private appendLog(id: string, level: string, message: string): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
    instance.logs.push(line);
    while (instance.logs.length > LOG_LIMIT) instance.logs.shift();
    this.setRuntime(id, { lastEvent: message });
  }

  private scoreHealth(instance: RuntimeInstance, telemetry: WorkerTelemetry): number {
    let score = 100;
    if (telemetry.ping > 300) score -= 20;
    else if (telemetry.ping > 150) score -= 10;
    if (instance.state === 'FAILED') score -= 60;
    if (telemetry.cpuPercent > 80) score -= 15;
    return Math.max(0, Math.min(100, score));
  }

  private setRuntime(id: string, patch: Partial<RuntimeInstance>): void {
    const instance = this.runtime.get(id);
    if (!instance) return;
    if (instance.startedAt && instance.state === 'RUNNING') {
      patch.uptimeMs = Date.now() - instance.startedAt;
    }
    this.runtime.set(id, { ...instance, ...patch });
  }
}
