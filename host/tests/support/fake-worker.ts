/**
 * A worker-shaped WebSocket client for the integration tests.
 *
 * It speaks the same protocol as the real Java worker (same envelope, same message types, same
 * payload fields) but is written independently, so a drift between the host and the mod shows up
 * here as a failing test rather than as a silent no-op in production.
 *
 * The class deliberately exposes only what a worker can do: say hello, register, send a status
 * snapshot, report an inventory, and answer a task. It cannot ask the host for anything, which
 * matches the real mod.
 */
import { WebSocket } from 'ws';
import {
  WORKER_PROTOCOL_VERSION,
  WorkerInbound,
  WorkerOutbound,
  decodeEnvelope,
  encodeEnvelope,
  type WorkerEnvelope,
  type WorkerSnapshot,
} from '../../src/shared/workers';

export interface FakeWorkerOptions {
  workerId?: string;
  token?: string;
  /** When set, the worker presents this pairing code instead of a token on its first hello. */
  pairingCode?: string;
  protocolVersion?: number;
  /** The worker's self-generated, permanent installation id; ties its token to this client. */
  installationId?: string;
  /** Answers every task by default; return 'ignore' to simulate a worker that never replies. */
  onTask?: (kind: string, payload: Record<string, unknown>) => { ok: boolean; message: string; data?: Record<string, unknown> } | 'ignore';
  username?: string;
  modVersion?: string;
}

export class FakeWorker {
  private socket: WebSocket | null = null;
  readonly received: WorkerEnvelope[] = [];
  readonly tasks: { kind: string; payload: Record<string, unknown>; id: string }[] = [];
  accepted = false;
  refusalReason = '';
  /** True while the host has paused this worker; reflected in the snapshot it reports. */
  paused = false;
  /** True while the host has stopped this worker's service; reflected in the snapshot it reports. */
  stopped = false;
  /** Every control action the host has sent, in order. */
  readonly controls: string[] = [];
  assignedId = '';
  /** The shared token the host handed back on a successful pairing, if any. */
  grantedToken = '';
  closed = false;

  constructor(private readonly options: FakeWorkerOptions = {}) {}

  async connect(port: number, path = '/worker'): Promise<void> {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timed out')), 4000);
      this.socket!.once('open', () => { clearTimeout(timer); resolve(); });
      this.socket!.once('error', (error) => { clearTimeout(timer); reject(error); });
    });

    this.socket.on('message', (data) => this.onMessage(data.toString()));
    this.socket.on('close', () => { this.closed = true; });

    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.HELLO,
      payload: {
        token: this.options.token ?? 'test-worker-token',
        pairingCode: this.options.pairingCode ?? '',
        protocolVersion: this.options.protocolVersion ?? WORKER_PROTOCOL_VERSION,
        workerId: this.options.workerId ?? '',
        username: this.options.username ?? 'TestWorker',
        installationId: this.options.installationId ?? 'test-installation',
        modVersion: this.options.modVersion ?? '1.0.0',
      },
    });
  }

  private onMessage(raw: string): void {
    const envelope = decodeEnvelope(raw);
    if (!envelope) return;
    this.received.push(envelope);

    if (envelope.type === WorkerOutbound.HELLO_ACK) {
      this.accepted = envelope.payload?.accepted === true;
      this.refusalReason = String(envelope.payload?.reason ?? '');
      this.assignedId = String(envelope.payload?.workerId ?? '');
      this.grantedToken = String(envelope.payload?.token ?? '');
      return;
    }
    if (envelope.type === WorkerOutbound.PING) {
      this.send({ v: WORKER_PROTOCOL_VERSION, type: WorkerInbound.PONG });
      return;
    }
    if (envelope.type === WorkerOutbound.KICK) {
      this.closed = true;
      return;
    }
    if (envelope.type === WorkerOutbound.CONTROL) {
      const action = String(envelope.payload?.action ?? '');
      this.controls.push(action);
      if (action === 'pause') this.paused = true;
      if (action === 'resume') this.paused = false;
      if (action === 'disconnect') this.stopped = true;
      if (action === 'connect' || action === 'restart') { this.stopped = false; this.paused = false; }
      // Report the new state straight away, the way the real mod does.
      this.status({ paused: this.paused, stopped: this.stopped });
      return;
    }
    if (envelope.type === WorkerOutbound.TASK || envelope.type === WorkerOutbound.COMMAND) {
      const payload = envelope.payload ?? {};
      const kind = String(payload.kind ?? '');
      const id = envelope.id ?? '';
      this.tasks.push({ kind, payload, id });

      const answer = this.options.onTask
        ? this.options.onTask(kind, payload)
        : { ok: true, message: `did ${kind}`, data: defaultData(kind) };
      if (answer === 'ignore') return;
      this.sendResult(id, kind, answer.ok, answer.message, answer.data ?? {});
    }
  }

  register(snapshot: Partial<WorkerSnapshot> = {}): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.REGISTER,
      payload: { ...baseSnapshot(this.assignedId), ...snapshot } as unknown as Record<string, unknown>,
    });
  }

  status(snapshot: Partial<WorkerSnapshot> = {}): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.STATUS,
      payload: { ...baseSnapshot(this.assignedId), ...snapshot } as unknown as Record<string, unknown>,
    });
  }

  reportInventory(items: { id: string; name?: string; count: number }[], containerOpen = false): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.INVENTORY,
      payload: {
        carried: items.map((item, index) => ({
          id: item.id,
          name: item.name ?? item.id,
          count: item.count,
          slot: index,
          damage: 0,
          maxDamage: 0,
          damageable: false,
        })),
        accessible: [],
        armor: [],
        containerOpen,
      },
    });
  }

  /** Forwards a console line the way the mod's link does when it logs. */
  log(message: string, at = Date.now()): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.LOG,
      payload: { message, at },
    });
  }

  sendResult(id: string, kind: string, ok: boolean, message: string, data: Record<string, unknown>): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.RESULT,
      id,
      payload: { ok, taskId: id, kind, message, data },
    });
  }

  send(envelope: WorkerEnvelope): void {
    this.socket?.send(encodeEnvelope(envelope));
  }

  /** Sends a raw string, so tests can prove the host survives malformed input. */
  sendRaw(text: string): void {
    this.socket?.send(text);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/** The payload the mod would return for a task, so results look realistic in the UI tests. */
function defaultData(kind: string): Record<string, unknown> {
  if (kind === 'inventory') {
    return {
      carried: [
        { id: 'minecraft:diamond', name: 'Diamond', count: 64, slot: 0, damage: 0, maxDamage: 0, damageable: false },
        { id: 'minecraft:totem_of_undying', name: 'Totem of Undying', count: 2, slot: 1, damage: 0, maxDamage: 0, damageable: false },
      ],
      accessible: [],
      armor: [],
      containerOpen: false,
    };
  }
  if (kind === 'count') {
    return { query: 'diamond', carried: 64, accessible: 0, containerOpen: false };
  }
  return {};
}

export function baseSnapshot(workerId: string): WorkerSnapshot {
  return {
    workerId,
    label: '',
    username: 'TestWorker',
    minecraftVersion: '1.21.11',
    serverAddress: 'localhost',
    dimension: 'minecraft:overworld',
    gameMode: 'survival',
    inWorld: true,
    x: 10,
    y: 64,
    z: -20,
    health: 20,
    maxHealth: 20,
    food: 20,
    saturation: 5,
    armorPieces: 4,
    totems: 2,
    foodItems: 12,
    heldItem: 'Diamond Sword',
    offhandItem: 'Shield',
    currentTask: '',
    lastActivity: '',
    lastActivityAt: 0,
    lastError: '',
    eflyActive: false,
    eflyTarget: '',
    taskProgress: '',
    paused: false,
    stopped: false,
    totalItems: 66,
    distinctItems: 2,
    freeSlots: 20,
    capabilities: ['status', 'inventory', 'count', 'search', 'equipment', 'regear', 'command', 'chat', 'position', 'efly', 'container-read', 'container-move', 'shulker-read', 'shulker-unpack', 'restock', 'portal-scan'],
    fabricVersion: '0.16.9',
    meteorVersion: '1.21.11-SNAPSHOT',
    modVersion: '2.0.0',
  };
}

/** Waits until `predicate` is true or the timeout elapses. */
export async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition never became true');
}
