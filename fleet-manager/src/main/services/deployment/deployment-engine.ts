/**
 * Sequential deployment engine.
 *
 * Deploys a queue ONE instance at a time by default (bounded by `maxConcurrent`): validate →
 * authenticate → connect → wait for health → pause → next. Every stage is persisted and emitted as
 * an event so the live monitor can show progress. The engine never reconnects in a tight loop and
 * never bypasses server limits; retries are bounded and spaced out.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AccountRepository, QueueRepository, ServerProfileRepository } from '../../db/repositories';
import type { InstanceManager } from '../instances/instance-manager';
import type { AccountManager } from '../accounts/account-manager';
import { validateRoleConfig } from '../roles/roles';
import { validateDeployment, type DeploymentValidationInput } from './validation';
import type {
  DeploymentConfig,
  DeploymentQueueItem,
  DeploymentStage,
  ServerProfile,
  ValidationReport,
} from '../../../shared/types';

export type EngineState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'WAITING_APPROVAL' | 'CANCELLED' | 'FINISHED';

export interface EngineDeps {
  accounts: AccountRepository;
  servers: ServerProfileRepository;
  queues: QueueRepository;
  instances: InstanceManager;
  accountManager: AccountManager;
  emitEvent: (type: string, message: string, payload?: Record<string, unknown>) => void;
  /** Waits for an instance to reach RUNNING, or rejects after the timeout. */
  waitForRunning: (instanceId: string, timeoutMs: number) => Promise<boolean>;
}

export class DeploymentEngine extends EventEmitter {
  private state: EngineState = 'IDLE';
  private current: DeploymentConfig | null = null;
  private items: DeploymentQueueItem[] = [];
  private cancelRequested = false;
  private approvalResolvers: ((approved: boolean) => void)[] = [];
  private runToken = 0;

  constructor(private readonly deps: EngineDeps) {
    super();
  }

  getState(): EngineState {
    return this.state;
  }

  getCurrent(): DeploymentConfig | null {
    return this.current;
  }

  getItems(): DeploymentQueueItem[] {
    return this.items;
  }

  /** Validates a deployment without starting anything. */
  async validate(config: DeploymentConfig): Promise<ValidationReport> {
    const input: DeploymentValidationInput = {
      config,
      accounts: this.deps.accounts.list(),
      servers: this.deps.servers.list(),
      instances: this.deps.instances.list(),
      hasCredential: (id) => this.deps.accountManager.hasCredential(id),
      validateRole: (role, cfg) => validateRoleConfig(role, cfg),
    };
    return validateDeployment(input);
  }

  /** Starts a deployment. Returns false when validation fails or a run is already active. */
  async start(config: DeploymentConfig): Promise<{ ok: boolean; report: ValidationReport }> {
    if (this.state === 'RUNNING' || this.state === 'PAUSED' || this.state === 'WAITING_APPROVAL') {
      return { ok: false, report: { ok: false, issues: [{ level: 'error', code: 'busy', message: 'A deployment is already running.' }] } };
    }

    const report = await this.validate(config);
    if (!report.ok) return { ok: false, report };

    this.current = config;
    this.cancelRequested = false;
    this.state = 'RUNNING';
    this.runToken++;
    const token = this.runToken;

    this.items = this.deps.queues.replace(
      config.id,
      config.entries.map((entry, index) => ({
        deploymentId: config.id,
        accountId: entry.accountId,
        instanceName: entry.instanceName,
        role: entry.role,
        roleConfig: entry.roleConfig ?? {},
        position: index,
        stage: 'WAITING' as DeploymentStage,
        attempts: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      })),
    );

    this.deps.emitEvent('DEPLOYMENT_STARTED', `Deployment "${config.name}" started`, { deploymentId: config.id });
    this.emit('state', this.state);

    // Run asynchronously so the caller is not blocked.
    void this.run(token);
    return { ok: true, report };
  }

  pause(): void {
    if (this.state !== 'RUNNING') return;
    this.state = 'PAUSED';
    this.deps.emitEvent('DEPLOYMENT_PAUSED', 'Deployment paused');
    this.emit('state', this.state);
  }

  resume(): void {
    if (this.state !== 'PAUSED') return;
    this.state = 'RUNNING';
    this.deps.emitEvent('DEPLOYMENT_RESUMED', 'Deployment resumed');
    this.emit('state', this.state);
  }

  cancel(): void {
    if (this.state === 'IDLE' || this.state === 'FINISHED') return;
    this.cancelRequested = true;
    this.state = 'CANCELLED';
    this.approvalResolvers.forEach((resolve) => resolve(false));
    this.approvalResolvers = [];
    this.deps.emitEvent('DEPLOYMENT_CANCELLED', 'Deployment cancelled');
    this.emit('state', this.state);
  }

  /** Approves the next instance when the deployment is in manual-approval mode. */
  approve(): void {
    this.approvalResolvers.forEach((resolve) => resolve(true));
    this.approvalResolvers = [];
  }

  /** Retries a single failed queue item. */
  async retryItem(itemId: string): Promise<boolean> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item || item.stage !== 'FAILED') return false;
    item.stage = 'WAITING';
    item.error = null;
    this.deps.queues.updateStage(item.id, 'WAITING', { error: null });
    if (this.state === 'IDLE' || this.state === 'FINISHED') {
      this.state = 'RUNNING';
      this.runToken++;
      void this.run(this.runToken);
    }
    return true;
  }

  private async run(token: number): Promise<void> {
    const config = this.current!;
    const concurrency = Math.max(1, config.maxConcurrent);

    try {
      while (this.hasWorkLeft()) {
        if (token !== this.runToken || this.cancelRequested) break;
        await this.waitWhilePaused(token);

        if (config.manualApproval) {
          const approved = await this.requestApproval();
          if (!approved) {
            this.state = 'CANCELLED';
            break;
          }
        }

        const pending = this.items.filter((i) => i.stage === 'WAITING');
        if (pending.length === 0) break;

        const batch = pending.slice(0, concurrency);
        await Promise.all(batch.map((item) => this.deployItem(item, config)));

        if (this.cancelRequested || token !== this.runToken) break;
        await this.sleep(config.pauseBetweenMs, token);
      }
    } catch (error) {
      this.deps.emitEvent('DEPLOYMENT_FAILED', `Deployment error: ${(error as Error).message}`);
    } finally {
      if (token === this.runToken) {
        this.state = this.cancelRequested ? 'CANCELLED' : 'FINISHED';
        this.deps.emitEvent('DEPLOYMENT_FINISHED',
          `Deployment "${config.name}" finished`,
          { deploymentId: config.id, cancelled: this.cancelRequested });
        this.emit('state', this.state);
      }
    }
  }

  private async deployItem(item: DeploymentQueueItem, config: DeploymentConfig): Promise<void> {
    this.setStage(item, 'VALIDATING');

    const account = this.deps.accounts.get(item.accountId);
    if (!account) {
      this.fail(item, 'account not found');
      return;
    }
    if (account.authMode !== 'offline' && !(await this.deps.accountManager.hasCredential(account.id))) {
      this.fail(item, 'no stored credential');
      return;
    }

    const roleIssues = validateRoleConfig(item.role, item.roleConfig ?? {});
    if (roleIssues.length > 0) {
      this.fail(item, `role config invalid: ${roleIssues[0].message}`);
      return;
    }

    this.setStage(item, 'AUTHENTICATING');
    this.setStage(item, 'CONNECTING');

    let instanceId: string | null = null;
    try {
      const created = this.deps.instances.create({
        name: item.instanceName,
        accountId: item.accountId,
        role: item.role,
        groupId: account.groupId,
        serverProfileId: config.serverProfileId ?? account.serverProfileId,
        config: item.roleConfig ?? {},
        priority: this.items.length - item.position,
      });
      instanceId = created.id;
      this.deps.instances.start(created.id);
      this.setStage(item, 'INITIALIZING');

      const ok = await this.deps.waitForRunning(created.id, config.connectionTimeoutMs);
      if (ok) {
        this.setStage(item, 'RUNNING');
        this.deps.emitEvent('INSTANCE_CONNECTED', `${item.instanceName} connected`,
          { instanceId: created.id, accountId: item.accountId, role: item.role });
      } else {
        this.deps.instances.stop(created.id);
        await this.maybeRetry(item, config, 'connection timed out');
      }
    } catch (error) {
      if (instanceId) this.deps.instances.stop(instanceId);
      await this.maybeRetry(item, config, (error as Error).message);
    }
  }

  private async maybeRetry(item: DeploymentQueueItem, config: DeploymentConfig, reason: string): Promise<void> {
    item.attempts++;
    if (item.attempts <= config.retryAttempts && !this.cancelRequested) {
      this.setStage(item, 'WAITING', { attempts: item.attempts });
      this.deps.emitEvent('DEPLOYMENT_STAGE', `Retrying ${item.instanceName} (${item.attempts}/${config.retryAttempts})`,
        { itemId: item.id });
      await this.sleep(config.retryDelayMs, this.runToken);
      if (!this.cancelRequested) await this.deployItem(item, config);
      return;
    }
    this.fail(item, reason);
  }

  private fail(item: DeploymentQueueItem, reason: string): void {
    item.error = reason;
    this.setStage(item, 'FAILED', { error: reason });
    this.deps.emitEvent('INSTANCE_ERROR', `${item.instanceName} failed: ${reason}`, { itemId: item.id });
  }

  private setStage(item: DeploymentQueueItem, stage: DeploymentStage, extra: Partial<DeploymentQueueItem> = {}): void {
    item.stage = stage;
    Object.assign(item, extra);
    this.deps.queues.updateStage(item.id, stage, {
      attempts: extra.attempts,
      error: extra.error ?? item.error ?? null,
      startedAt: stage === 'CONNECTING' ? Date.now() : item.startedAt,
      finishedAt: stage === 'RUNNING' || stage === 'FAILED' ? Date.now() : item.finishedAt,
    });
    this.emit('item', item);
  }

  private hasWorkLeft(): boolean {
    return this.items.some((i) => i.stage === 'WAITING' || i.stage === 'INITIALIZING' || i.stage === 'CONNECTING');
  }

  private async waitWhilePaused(token: number): Promise<void> {
    while (this.state === 'PAUSED' && token === this.runToken && !this.cancelRequested) {
      await this.sleep(250, token);
    }
  }

  private requestApproval(): Promise<boolean> {
    this.state = 'WAITING_APPROVAL';
    this.emit('state', this.state);
    return new Promise((resolve) => {
      this.approvalResolvers.push(resolve);
    });
  }

  private sleep(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.max(0, ms));
      timer.unref?.();
      // Wake early on cancel so shutdown is prompt.
      const check = setInterval(() => {
        if (this.cancelRequested || token !== this.runToken) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 100);
      check.unref?.();
    });
  }
}

export function makeQueueId(): string {
  return randomUUID();
}
