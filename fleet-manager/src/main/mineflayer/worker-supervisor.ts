/**
 * Worker supervisor.
 *
 * Spawns and manages one isolated child process per running bot. The supervisor translates worker
 * telemetry into domain state, forwards role events to the role coordinator and guarantees that a
 * worker crash is contained: a non-zero exit marks that instance FAILED without affecting others.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type { WorkerCommand, WorkerEnvelope } from './protocol';
import type { WorkerStartCommand } from './protocol';

export interface SupervisorEvents {
  telemetry: (instanceId: string, telemetry: import('./protocol').WorkerTelemetry) => void;
  state: (instanceId: string, state: SupervisorState, detail?: string) => void;
  roleEvent: (instanceId: string, type: string, payload: Record<string, unknown>) => void;
  log: (instanceId: string, level: string, message: string) => void;
  players: (instanceId: string, players: unknown[]) => void;
  inventory: (instanceId: string, data: unknown) => void;
  health: (instanceId: string, health: number, food: number) => void;
  position: (instanceId: string, position: { x: number; y: number; z: number }, dimension: string) => void;
  exited: (instanceId: string, code: number | null, expected: boolean) => void;
}

export type SupervisorState =
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'FAILED'
  | 'STOPPED';

interface WorkerHandle {
  child: ChildProcess;
  expectedStop: boolean;
  start: WorkerStartCommand;
}

export class WorkerSupervisor extends EventEmitter {
  private readonly workers = new Map<string, WorkerHandle>();
  private readonly workerPath: string;

  constructor(workerPath?: string) {
    super();
    // Compiled output sits next to this file at runtime.
    this.workerPath = workerPath ?? resolve(__dirname, 'bot-worker.js');
  }

  isRunning(instanceId: string): boolean {
    return this.workers.has(instanceId);
  }

  runningCount(): number {
    return this.workers.size;
  }

  start(command: WorkerStartCommand): void {
    if (this.workers.has(command.instanceId)) return;

    const child = fork(this.workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, LOGVEX_INSTANCE_ID: command.instanceId },
    });

    const handle: WorkerHandle = { child, expectedStop: false, start: command };
    this.workers.set(command.instanceId, handle);

    child.on('message', (raw: unknown) => this.onMessage(command.instanceId, raw as WorkerEnvelope));
    child.on('exit', (code) => {
      const expected = handle.expectedStop;
      this.workers.delete(command.instanceId);
      this.emit('exited', command.instanceId, code, expected);
    });
    child.on('error', (error) => {
      this.emit('state', command.instanceId, 'FAILED', error.message);
    });

    this.send(command.instanceId, command);
  }

  stop(instanceId: string): void {
    const handle = this.workers.get(instanceId);
    if (!handle) return;
    handle.expectedStop = true;
    this.send(instanceId, { kind: 'stop' });
    // Hard kill if the worker does not exit promptly.
    setTimeout(() => {
      if (this.workers.has(instanceId)) {
        try {
          handle.child.kill('SIGKILL');
        } catch {
          // ignore
        }
        this.workers.delete(instanceId);
      }
    }, 3000).unref?.();
  }

  sendCommand(instanceId: string, command: string): void {
    this.send(instanceId, { kind: 'command', command });
  }

  stopAll(): void {
    for (const id of [...this.workers.keys()]) this.stop(id);
  }

  private send(instanceId: string, command: WorkerCommand): void {
    const handle = this.workers.get(instanceId);
    if (!handle?.child.connected) return;
    try {
      handle.child.send(command);
    } catch {
      // ignore
    }
  }

  private onMessage(instanceId: string, envelope: WorkerEnvelope): void {
    if (!envelope || typeof envelope !== 'object') return;
    const event = envelope.event;
    switch (event.kind) {
      case 'ready':
        break;
      case 'connecting':
        this.emit('state', instanceId, 'CONNECTING');
        break;
      case 'login':
        this.emit('state', instanceId, 'AUTHENTICATING');
        break;
      case 'spawn':
        this.emit('state', instanceId, 'INITIALIZING');
        break;
      case 'connected':
        this.emit('state', instanceId, 'RUNNING');
        break;
      case 'telemetry':
        this.emit('telemetry', instanceId, event.telemetry);
        break;
      case 'health':
        this.emit('health', instanceId, event.health, event.food);
        break;
      case 'position':
        this.emit('position', instanceId, event.position, event.dimension);
        break;
      case 'players':
        this.emit('players', instanceId, event.players);
        break;
      case 'inventory':
        this.emit('inventory', instanceId, { items: event.items, armor: event.armor });
        break;
      case 'roleEvent':
        this.emit('roleEvent', instanceId, event.type, event.payload);
        break;
      case 'chat':
        this.emit('log', instanceId, 'info', `<${event.username}> ${event.message}`);
        break;
      case 'kick':
        this.emit('state', instanceId, 'FAILED', `kicked: ${event.reason}`);
        break;
      case 'error':
        this.emit('log', instanceId, 'error', event.message);
        if (event.fatal) this.emit('state', instanceId, 'FAILED', event.message);
        break;
      case 'end':
        this.emit('state', instanceId, 'STOPPED', event.reason);
        break;
      case 'log':
        this.emit('log', instanceId, event.level, event.message);
        break;
      default:
        break;
    }
  }
}
