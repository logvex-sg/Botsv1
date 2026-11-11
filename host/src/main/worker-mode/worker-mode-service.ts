/**
 * Worker Mode for the desktop app.
 *
 * Host Mode and Worker Mode are deliberately separate: this service reads and writes its own
 * settings key (`workerMode`) and never touches the host's `app` settings, so a machine cannot end
 * up half-host and half-worker. What it *does* share is the protocol — the settings here are exactly
 * the values the Fabric mod needs, and the connection test uses the same wire client the mod speaks.
 *
 * Responsibilities:
 *  - persist the worker connection settings and per-module toggles;
 *  - own a {@link WorkerClient} so the app can advertise itself as a worker;
 *  - run a one-shot connection test against a host before an operator commits;
 *  - write the `logvex-worker.json` a bot's `mods/` folder needs, from the same settings.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SettingsRepository } from '../db/repositories';
import { WorkerClient, type WorkerClientStatus } from './worker-client';
import { WORKER_MODULES, WORKER_PROTOCOL_VERSION } from '../../shared/workers';
import type { WorkerModePatch, WorkerModeSettings, WorkerProvisionResult } from '../../shared/types';

export const DEFAULT_WORKER_MODE: WorkerModeSettings = {
  hostAddress: '127.0.0.1',
  hostPort: 8721,
  token: '',
  pairingCode: '',
  workerId: '',
  workerName: '',
  groupName: 'default',
  autoConnect: false,
  heartbeatSeconds: 5,
  modules: Object.fromEntries(WORKER_MODULES.map((name) => [name, true])),
  permissions: { regear: true, command: true, chat: true, efly: true },
};

export interface WorkerModeDeps {
  settings: SettingsRepository;
  emit: (type: string, message: string, payload?: Record<string, unknown>) => void;
}

export class WorkerModeService {
  private client: WorkerClient | null = null;
  private config: WorkerModeSettings;
  private readonly logLines: { at: number; message: string }[] = [];
  private static readonly LOG_LIMIT = 200;

  constructor(private readonly deps: WorkerModeDeps) {
    this.config = this.load();
  }

  // ------------------------------------------------------------- settings

  private load(): WorkerModeSettings {
    const raw = this.deps.settings.get('workerMode');
    if (!raw) return { ...DEFAULT_WORKER_MODE, modules: { ...DEFAULT_WORKER_MODE.modules } };
    try {
      const parsed = JSON.parse(raw) as Partial<WorkerModeSettings>;
      return {
        ...DEFAULT_WORKER_MODE,
        ...parsed,
        modules: { ...DEFAULT_WORKER_MODE.modules, ...(parsed.modules ?? {}) },
        permissions: { ...DEFAULT_WORKER_MODE.permissions, ...(parsed.permissions ?? {}) },
      };
    } catch {
      // Corrupt settings fall back to defaults rather than crashing the app.
      return { ...DEFAULT_WORKER_MODE, modules: { ...DEFAULT_WORKER_MODE.modules } };
    }
  }

  getSettings(): WorkerModeSettings {
    return { ...this.config, modules: { ...this.config.modules }, permissions: { ...this.config.permissions } };
  }

  saveSettings(patch: WorkerModePatch): WorkerModeSettings {
    this.config = {
      ...this.config,
      ...patch,
      modules: { ...this.config.modules, ...(patch.modules ?? {}) },
      permissions: { ...this.config.permissions, ...(patch.permissions ?? {}) },
    };
    this.deps.settings.set('workerMode', JSON.stringify(this.config));
    return this.getSettings();
  }

  // --------------------------------------------------------------- client

  status(): WorkerClientStatus {
    if (this.client) return this.client.status();
    return {
      state: 'idle',
      connected: false,
      registered: false,
      workerId: this.config.workerId,
      username: this.config.workerName,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      grantedToken: '',
      lastError: '',
      paused: false,
      stopped: false,
      detail: 'Not connected',
    };
  }

  recentLogs(): { at: number; message: string }[] {
    return [...this.logLines];
  }

  /** Opens a persistent worker connection using the saved settings. */
  async connect(): Promise<WorkerClientStatus> {
    if (this.client?.status().registered) return this.client.status();
    this.client?.disconnect();
    this.client = this.buildClient(true);
    const status = await this.client.connect();
    if (status.grantedToken) this.saveSettings({ token: status.grantedToken, pairingCode: '' });
    return status;
  }

  disconnect(): WorkerClientStatus {
    this.client?.disconnect();
    this.client = null;
    return this.status();
  }

  /** Runs a one-shot connection test: does not stay registered afterwards. */
  async test(overrides: WorkerModePatch = {}): Promise<WorkerClientStatus> {
    const current = this.getSettings();
    const merged: WorkerModeSettings = {
      ...current,
      ...overrides,
      modules: { ...current.modules, ...(overrides.modules ?? {}) },
      permissions: { ...current.permissions, ...(overrides.permissions ?? {}) },
    };
    const probe = this.buildClient(false, merged);
    const status = await probe.connect();
    probe.disconnect();
    return status;
  }

  private buildClient(stayConnected: boolean, settings?: WorkerModeSettings): WorkerClient {
    const config = settings ?? this.getSettings();
    const client = new WorkerClient({
      host: config.hostAddress,
      port: config.hostPort,
      token: config.token,
      pairingCode: config.pairingCode,
      workerId: config.workerId,
      username: config.workerName || undefined,
      heartbeatSeconds: config.heartbeatSeconds,
      stayConnected,
    });
    client.on('status', (status: WorkerClientStatus) => {
      this.deps.emit('WORKER_MODE_STATUS', status.detail, { ...status });
    });
    client.on('log', (line: { at: number; message: string }) => {
      this.logLines.push(line);
      if (this.logLines.length > WorkerModeService.LOG_LIMIT) this.logLines.shift();
      this.deps.emit('WORKER_MODE_LOG', line.message, { at: line.at });
    });
    return client;
  }

  // ---------------------------------------------------------- provisioning

  /**
   * Writes the worker config the Fabric mod reads, from the current Worker Mode settings.
   *
   * The file is exactly what the mod's Worker half expects (`logvex-worker.json`): host, port, token or
   * pairing code, a stable worker id, the operator's display name, and the per-module toggles. The
   * operator drops it into each bot's `mods/` folder (or points the mod at this path), so the same
   * screen that tests a connection also produces the artefact that ships.
   */
  provision(directory: string): WorkerProvisionResult {
    const config = this.getSettings();
    // A stable id is what lets the host keep this worker's label, group and history across restarts.
    const workerId = config.workerId || `worker-${randomUUID().slice(0, 8)}`;
    // The exact shape `WorkerConfig` reads in the mod. Module toggles are informational for the
    // operator's own record; the mod's module registry is authoritative for what it can run.
    const payload = {
      host: config.hostAddress,
      port: config.hostPort,
      token: config.token,
      pairingCode: config.pairingCode,
      workerId,
      label: config.workerName,
      group: config.groupName,
      heartbeatSeconds: config.heartbeatSeconds,
      allowCommands: config.permissions.command,
      allowChat: config.permissions.chat,
      allowRegear: config.permissions.regear,
      allowEfly: config.permissions.efly,
      modules: config.modules,
      protocolVersion: WORKER_PROTOCOL_VERSION,
    };
    try {
      mkdirSync(directory, { recursive: true });
      const path = join(directory, 'logvex-worker.json');
      writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      this.saveSettings({ workerId });
      this.deps.emit('WORKER_MODE_PROVISIONED', `Wrote worker config to ${path}`, { path, workerId });
      return { ok: true, path, workerId };
    } catch (error) {
      const message = (error as Error).message;
      this.deps.emit('WORKER_ERROR', `Could not write the worker config: ${message}`);
      return { ok: false, path: '', workerId, error: message };
    }
  }
}
