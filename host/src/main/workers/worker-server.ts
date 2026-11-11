/**
 * The host's worker server.
 *
 * Workers dial *out* to this server, so the host never needs to know an address for a client and no
 * client needs an inbound port. One `ws` server listens on a configurable port; every connection
 * must present the shared token and the matching protocol version before it is allowed to register.
 *
 * Responsibilities:
 *  - authenticate and register workers, assigning a stable id;
 *  - keep the last status snapshot per worker and mark workers offline when they stop talking;
 *  - dispatch tasks and correlate results back to the caller by task id, with a timeout;
 *  - refuse a second conflicting (mutating) task on the same worker;
 *  - persist the durable record (identity, group, snapshot, inventory) and publish events.
 *
 * Everything a worker sends is treated as untrusted input: envelopes are shape-checked, unknown
 * types are ignored, and task kinds are restricted to the shared closed set.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WorkerCommandRepository, WorkerInventoryRepository, WorkerRepository, WorkerTaskRepository } from '../db/repositories';
import type { WorkerInventorySnapshot } from '../../shared/types';
import type { FleetEventTypeName } from '../../shared/events';
import type { HelloInfo, PairingOutcome, WorkerAuthorizer } from '../pairing/pairing-service';
import {
  WORKER_PATH,
  WORKER_PROTOCOL_VERSION,
  EXCLUSIVE_TASK_KINDS,
  WorkerInbound,
  WorkerOutbound,
  decodeEnvelope,
  emptySnapshot,
  encodeEnvelope,
  isControlAction,
  isTaskKind,
  type ControlAction,
  type TaskKind,
  type WorkerEnvelope,
  type WorkerItem,
  type WorkerSnapshot,
  type WorkerTaskResult,
} from '../../shared/workers';

/** Emitted events are typed as strings on the bus; kept loose to avoid a hard import cycle. */
export type EmitEvent = (type: FleetEventTypeName, message: string, payload?: Record<string, unknown>) => void;

export interface WorkerServerOptions {
  host: string;
  port: number;
  token: string;
  /**
   * Decides whether a worker may join and, on a first pairing, which token to grant it.
   *
   * The server does not know the pairing policy itself: it hands the presented code or token to the
   * authorizer and gets back a verdict plus the worker id to bind. When absent, only the shared
   * token is accepted (a degenerate setup used by some tests).
   */
  authorizer?: WorkerAuthorizer;
  /** How long a worker may go without a heartbeat before it is considered degraded. */
  heartbeatTimeoutMs?: number;
  /** Default timeout for a dispatched task. */
  taskTimeoutMs?: number;
}

/** Live state for one connected worker. */
interface LiveWorker {
  workerId: string;
  socket: WebSocket;
  address: string;
  connectedAt: number;
  lastSeen: number;
  protocolVersion: number;
  modVersion: string;
  snapshot: WorkerSnapshot;
  /** In-flight tasks by id, so a result can be matched to the caller waiting on it. */
  pending: Map<string, {
    resolve: (result: WorkerTaskResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    kind: string;
  }>;
}

export class WorkerServer {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly live = new Map<string, LiveWorker>();
  /** Sockets that connected but have not yet authenticated. */
  private readonly unauthenticated = new Set<WebSocket>();
  /** Recent console lines per worker, newest last. In memory only; a restart clears them. */
  private readonly console = new Map<string, { at: number; message: string }[]>();
  private static readonly CONSOLE_LIMIT = 200;
  private sweepTimer: NodeJS.Timeout | null = null;
  private boundPort = 0;

  private readonly heartbeatTimeoutMs: number;
  private readonly taskTimeoutMs: number;

  constructor(
    private readonly deps: {
      workers: WorkerRepository;
      tasks: WorkerTaskRepository;
      commands: WorkerCommandRepository;
      inventory: WorkerInventoryRepository;
      emit: EmitEvent;
      /** Called whenever a worker reports a new snapshot, so the service can remember it. */
      onSnapshot?: (workerId: string, snapshot: WorkerSnapshot) => void;
      /** Called whenever a worker reports an inventory, so history can be recorded. */
      onInventory?: (workerId: string, snapshot: WorkerInventorySnapshot) => void;
    },
    private options: WorkerServerOptions,
  ) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 15_000;
  }

  get port(): number {
    return this.boundPort;
  }

  get running(): boolean {
    return this.wss !== null;
  }

  setToken(token: string): void {
    this.options = { ...this.options, token };
  }

  async start(server?: Server): Promise<number> {
    if (this.wss) return this.boundPort;
    this.wss = server
      ? new WebSocketServer({ server, path: WORKER_PATH })
      : new WebSocketServer({ host: this.options.host, port: this.options.port, path: WORKER_PATH });
    this.wss.on('connection', (socket, request) => this.onConnection(socket, request.socket.remoteAddress ?? ''));
    this.wss.on('error', (error) => {
      this.deps.emit('SYSTEM', `Worker server error: ${error.message}`);
    });

    if (!server) {
      await new Promise<void>((resolve, reject) => {
        this.wss!.once('listening', () => resolve());
        this.wss!.once('error', reject);
      });
      this.boundPort = (this.wss.address() as { port: number }).port;
      this.server = null;
    }

    // A worker that stops heartbeating (network drop with no FIN) is caught here.
    this.sweepTimer = setInterval(() => this.sweep(), 5_000);
    this.sweepTimer.unref?.();
    return this.boundPort;
  }

  async stop(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const worker of this.live.values()) {
      this.failPending(worker, 'host shutting down');
      try {
        worker.socket.close(1001, 'host shutting down');
      } catch {
        // Already gone.
      }
    }
    this.live.clear();
    this.unauthenticated.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    this.server = null;
  }

  // ------------------------------------------------------------------ queries

  isOnline(workerId: string): boolean {
    return this.live.has(workerId);
  }

  onlineIds(): string[] {
    return [...this.live.keys()];
  }

  liveSnapshot(workerId: string): WorkerSnapshot | null {
    return this.live.get(workerId)?.snapshot ?? null;
  }

  connectedAt(workerId: string): number | null {
    return this.live.get(workerId)?.connectedAt ?? null;
  }

  heartbeatAgeSeconds(workerId: string): number | null {
    const worker = this.live.get(workerId);
    if (!worker) return null;
    return Math.round((Date.now() - worker.lastSeen) / 1000);
  }

  /** How many mutating tasks are in flight for a worker (0 or 1 by construction). */
  exclusiveInFlight(workerId: string): number {
    const worker = this.live.get(workerId);
    if (!worker) return 0;
    let count = 0;
    for (const pending of worker.pending.values()) {
      if (EXCLUSIVE_KINDS.has(pending.kind as TaskKind)) count++;
    }
    return count;
  }

  // ------------------------------------------------------------------ dispatch

  /**
   * Sends a task and waits for its result.
   *
   * Throws when the worker is offline, when a conflicting task is already running, or when the
   * worker does not answer within the timeout. Never resolves optimistically: only a matching
   * result frame completes the promise.
   */
  async sendTask(
    workerId: string,
    kind: TaskKind,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<WorkerTaskResult> {
    const worker = this.live.get(workerId);
    if (!worker) throw new Error(`worker ${workerId} is not connected`);
    if (!isTaskKind(kind)) throw new Error(`unknown task kind: ${kind}`);

    if (EXCLUSIVE_KINDS.has(kind) && this.exclusiveInFlight(workerId) > 0) {
      throw new Error(`worker ${workerId} is already running a conflicting task`);
    }

    const taskId = randomUUID();
    this.deps.tasks.create({ id: taskId, workerId, kind, params });

    return new Promise<WorkerTaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.pending.delete(taskId);
        this.deps.tasks.complete(taskId, 'TIMEOUT', null, `no result within ${timeoutMs ?? this.taskTimeoutMs}ms`);
        reject(new Error(`worker ${workerId} did not answer the ${kind} task in time`));
      }, timeoutMs ?? this.taskTimeoutMs);
      timer.unref?.();

      worker.pending.set(taskId, { resolve, reject, timer, kind });
      const envelope: WorkerEnvelope = {
        v: WORKER_PROTOCOL_VERSION,
        type: kind === 'command' ? WorkerOutbound.COMMAND : WorkerOutbound.TASK,
        id: taskId,
        payload: { kind, ...params },
      };
      try {
        worker.socket.send(encodeEnvelope(envelope));
        this.deps.tasks.markDispatched(taskId);
      } catch (error) {
        clearTimeout(timer);
        worker.pending.delete(taskId);
        this.deps.tasks.complete(taskId, 'FAILED', null, (error as Error).message);
        reject(error as Error);
      }
    });
  }

  /** Fire-and-forget ping, used by the UI's "inspect" button to confirm liveness. */
  ping(workerId: string): boolean {
    const worker = this.live.get(workerId);
    if (!worker) return false;
    try {
      worker.socket.send(encodeEnvelope({ v: WORKER_PROTOCOL_VERSION, type: WorkerOutbound.PING }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asks a worker to act on its own link: connect, disconnect, restart, pause or resume.
   *
   * The worker owns its connection, so the host cannot open or close it directly; it can only ask.
   * This is a fire-and-forget request — the worker's next status snapshot (which carries `paused`
   * and `stopped`) is what actually tells the host the change took effect.
   */
  sendControl(workerId: string, action: ControlAction): boolean {
    if (!isControlAction(action)) throw new Error(`unknown control action: ${action}`);
    const worker = this.live.get(workerId);
    if (!worker) return false;
    try {
      worker.socket.send(encodeEnvelope({
        v: WORKER_PROTOCOL_VERSION,
        type: WorkerOutbound.CONTROL,
        id: randomUUID(),
        payload: { action },
      }));
      this.deps.emit('WORKER_CONTROL', `Sent '${action}' to ${workerId}`, { workerId, action });
      return true;
    } catch {
      return false;
    }
  }

  /** Disconnects a worker and asks it to stand down. */
  kick(workerId: string, reason: string): boolean {
    const worker = this.live.get(workerId);
    if (!worker) return false;
    try {
      worker.socket.send(encodeEnvelope({
        v: WORKER_PROTOCOL_VERSION,
        type: WorkerOutbound.KICK,
        payload: { reason },
      }));
    } catch {
      // Fall through to the close below.
    }
    worker.socket.close(1000, 'kicked');
    return true;
  }

  // ------------------------------------------------------------------ inbound

  private onConnection(socket: WebSocket, address: string): void {
    this.unauthenticated.add(socket);
    let workerId: string | null = null;

    socket.on('message', (data) => {
      const envelope = decodeEnvelope(data.toString());
      if (!envelope) return;

      if (workerId === null) {
        // Only `hello` is accepted before authentication; anything else drops the socket.
        if (envelope.type !== WorkerInbound.HELLO) {
          socket.close(4401, 'expected hello');
          return;
        }
        const accepted = this.handleHello(socket, envelope, address);
        if (accepted) {
          workerId = accepted;
          this.unauthenticated.delete(socket);
        }
        return;
      }

      this.handleAuthenticated(workerId, envelope);
    });

    socket.on('close', () => {
      this.unauthenticated.delete(socket);
      // A replaced socket closes *after* the replacement has already taken the id, so only the
      // socket that still owns the entry may clean it up. Without this check the stale socket's
      // close would tear down the fresh connection.
      if (workerId && this.live.get(workerId)?.socket === socket) this.onDisconnect(workerId);
    });
    socket.on('error', () => {
      // A socket error is followed by 'close'; nothing extra to do.
    });
  }

  /** Validates the handshake. Returns the assigned worker id, or null when the socket was refused. */
  private handleHello(socket: WebSocket, envelope: WorkerEnvelope, address: string): string | null {
    const payload = envelope.payload ?? {};
    const token = typeof payload.token === 'string' ? payload.token : '';
    const pairingCode = typeof payload.pairingCode === 'string' ? payload.pairingCode.trim() : '';
    const protocolVersion = typeof payload.protocolVersion === 'number' ? payload.protocolVersion : 0;
    const modVersion = typeof payload.modVersion === 'string' ? payload.modVersion : '';
    const suppliedId = typeof payload.workerId === 'string' ? payload.workerId.trim() : '';
    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const installationId = typeof payload.installationId === 'string' ? payload.installationId.trim() : '';

    const refuse = (reason: string): null => {
      socket.send(encodeEnvelope({
        v: WORKER_PROTOCOL_VERSION,
        type: WorkerOutbound.HELLO_ACK,
        payload: { accepted: false, reason, protocolVersion: WORKER_PROTOCOL_VERSION },
      }));
      socket.close(4403, reason);
      return null;
    };

    if (protocolVersion !== WORKER_PROTOCOL_VERSION) {
      return refuse(`protocol mismatch: host speaks v${WORKER_PROTOCOL_VERSION}`);
    }

    // A worker may present a short-lived pairing code (first join) or the token it was granted
    // before. Both paths go through the authorizer, which owns expiry, single use and revocation.
    const hello: HelloInfo = { installationId, workerId: suppliedId, username };
    const outcome: PairingOutcome = this.options.authorizer
      ? pairingCode.length > 0
        ? this.options.authorizer.authorizeWithCode(pairingCode, hello)
        : this.options.authorizer.authorizeWithToken(token, hello)
      : pairingCode.length === 0 && this.tokenMatches(token)
        ? { ok: true, token, workerId: suppliedId }
        : { ok: false, reason: 'wrong-code', message: 'invalid token' };

    if (!outcome.ok) return refuse(outcome.message);

    // The granted token is only handed back on a pairing-code join; a token join already has it.
    const grantedToken = pairingCode.length > 0 ? outcome.token : null;
    const workerId = outcome.workerId || suppliedId || username || randomUUID().slice(0, 8);

    // A second connection claiming an id that is already live replaces the old one. This makes a
    // worker that reconnects after a network drop recover cleanly instead of being refused.
    const existing = this.live.get(workerId);
    if (existing && existing.socket !== socket) {
      this.failPending(existing, 'replaced by a new connection');
      // Removed from the map *before* the close so the old socket's close handler sees no owner
      // and leaves the new connection alone.
      this.live.delete(workerId);
      try {
        existing.socket.close(4000, 'replaced');
      } catch {
        // Already gone.
      }
    }

    this.live.set(workerId, {
      workerId,
      socket,
      address,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      protocolVersion,
      modVersion,
      snapshot: emptySnapshot(workerId),
      pending: new Map(),
    });

    socket.send(encodeEnvelope({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerOutbound.HELLO_ACK,
      payload: {
        accepted: true,
        workerId,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        // Present only on a successful pairing: the worker persists it and uses it from then on.
        ...(grantedToken ? { token: grantedToken } : {}),
      },
    }));
    if (grantedToken) {
      this.deps.emit('WORKER_PAIRED', `Worker ${username || workerId} paired with the host`, {
        workerId,
        username,
        address,
      });
    }
    return workerId;
  }

  private handleAuthenticated(workerId: string, envelope: WorkerEnvelope): void {
    const worker = this.live.get(workerId);
    if (!worker) return;
    worker.lastSeen = Date.now();

    switch (envelope.type) {
      case WorkerInbound.REGISTER:
      case WorkerInbound.STATUS: {
        const snapshot = this.parseSnapshot(envelope.payload, workerId);
        worker.snapshot = snapshot;
        this.deps.onSnapshot?.(workerId, snapshot);
        this.deps.workers.upsert({
          id: workerId,
          label: snapshot.label,
          username: snapshot.username,
          minecraftVersion: snapshot.minecraftVersion,
          serverAddress: snapshot.serverAddress,
          protocolVersion: worker.protocolVersion,
          modVersion: worker.modVersion || snapshot.modVersion,
          lastAddress: worker.address,
          status: 'ONLINE',
          snapshot: snapshot as unknown as Record<string, unknown>,
          fabricVersion: snapshot.fabricVersion,
          meteorVersion: snapshot.meteorVersion,
          capabilities: snapshot.capabilities,
        });
        if (envelope.type === WorkerInbound.REGISTER) {
          this.deps.emit('WORKER_REGISTERED', `Worker ${snapshot.username || workerId} connected`, {
            workerId,
            username: snapshot.username,
            address: worker.address,
            minecraftVersion: snapshot.minecraftVersion,
            serverAddress: snapshot.serverAddress,
          });
        }
        break;
      }
      case WorkerInbound.INVENTORY:
        this.handleInventory(workerId, envelope.payload ?? {});
        break;
      case WorkerInbound.RESULT:
        this.handleResult(worker, envelope);
        break;
      case WorkerInbound.PONG:
        // lastSeen already updated.
        break;
      case WorkerInbound.ERROR: {
        const message = typeof envelope.payload?.message === 'string' ? envelope.payload.message : 'worker error';
        this.deps.emit('WORKER_ERROR', `${workerId}: ${message}`, { workerId });
        break;
      }
      case WorkerInbound.LOG:
        this.handleLog(workerId, envelope.payload ?? {});
        break;
      default:
        // Unknown types are ignored so an older host stays compatible with a newer worker.
        break;
    }
  }

  private handleLog(workerId: string, payload: Record<string, unknown>): void {
    const message = typeof payload.message === 'string' ? payload.message : '';
    if (!message) return;
    const at = typeof payload.at === 'number' && Number.isFinite(payload.at) ? payload.at : Date.now();
    const lines = this.console.get(workerId) ?? [];
    lines.push({ at, message });
    if (lines.length > WorkerServer.CONSOLE_LIMIT) lines.splice(0, lines.length - WorkerServer.CONSOLE_LIMIT);
    this.console.set(workerId, lines);
    this.deps.emit('WORKER_LOG', message, { workerId, at });
  }

  /** Recent console lines for one worker, oldest first. */
  consoleFor(workerId: string): { at: number; message: string }[] {
    return this.console.get(workerId) ?? [];
  }

  clearConsole(workerId: string): void {
    this.console.delete(workerId);
  }

  private handleResult(worker: LiveWorker, envelope: WorkerEnvelope): void {
    const taskId = envelope.id ?? '';
    const pending = worker.pending.get(taskId);
    const payload = envelope.payload ?? {};
    const result: WorkerTaskResult = {
      ok: payload.ok === true,
      taskId,
      kind: typeof payload.kind === 'string' ? payload.kind : pending?.kind ?? '',
      message: typeof payload.message === 'string' ? payload.message : '',
      data: typeof payload.data === 'object' && payload.data !== null ? (payload.data as Record<string, unknown>) : {},
    };

    if (pending) {
      clearTimeout(pending.timer);
      worker.pending.delete(taskId);
    }
    this.deps.tasks.complete(
      taskId,
      result.ok ? 'SUCCEEDED' : 'FAILED',
      result as unknown as Record<string, unknown>,
      result.ok ? null : result.message,
    );

    // A result carrying an inventory payload refreshes the cached snapshot even when it was not
    // explicitly requested, so the dashboard stays current.
    if (result.kind === 'inventory' && result.ok && result.data) {
      this.storeInventory(worker.workerId, result.data);
    }
    if ((result.kind === 'command' || result.kind === 'chat') && result.ok) {
      this.deps.emit('WORKER_COMMAND', `${worker.workerId}: ${result.message}`, {
        workerId: worker.workerId,
        message: result.message,
      });
    }

    pending?.resolve(result);
  }

  private handleInventory(workerId: string, payload: Record<string, unknown>): void {
    this.storeInventory(workerId, payload);
    this.deps.emit('WORKER_INVENTORY', `Inventory reported by ${workerId}`, { workerId });
  }

  private storeInventory(workerId: string, data: Record<string, unknown>): void {
    const toStringArray = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const out = value.filter((entry): entry is string => typeof entry === 'string');
      return out.length > 0 ? out : undefined;
    };
    const toEnchantments = (value: unknown): { id: string; level: number }[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const out = value
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => ({ id: typeof entry.id === 'string' ? entry.id : '', level: typeof entry.level === 'number' ? entry.level : 1 }))
        .filter((entry) => entry.id.length > 0);
      return out.length > 0 ? out : undefined;
    };
    const toItems = (value: unknown): WorkerItem[] => {
      if (!Array.isArray(value)) return [];
      return value
        .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : '',
          name: typeof entry.name === 'string' ? entry.name : '',
          count: typeof entry.count === 'number' ? entry.count : 0,
          slot: typeof entry.slot === 'number' ? entry.slot : -1,
          damage: typeof entry.damage === 'number' ? entry.damage : 0,
          maxDamage: typeof entry.maxDamage === 'number' ? entry.maxDamage : 0,
          damageable: entry.damageable === true,
          tags: toStringArray(entry.tags),
          enchantments: toEnchantments(entry.enchantments),
          components: toStringArray(entry.components),
          customName: typeof entry.customName === 'string' ? entry.customName : null,
        }))
        .filter((item) => item.id.length > 0);
    };

    const snapshot: WorkerInventorySnapshot = {
      workerId,
      capturedAt: Date.now(),
      carried: toItems(data.carried),
      accessible: toItems(data.accessible),
      armor: toItems(data.armor),
      containerOpen: data.containerOpen === true,
    };
    this.deps.inventory.save(snapshot);
    this.deps.onInventory?.(workerId, snapshot);
  }

  private onDisconnect(workerId: string): void {
    const worker = this.live.get(workerId);
    if (!worker) return;
    this.failPending(worker, 'worker disconnected');
    this.live.delete(workerId);
    this.deps.workers.touch(workerId, worker.snapshot as unknown as Record<string, unknown>, 'OFFLINE');
    this.deps.emit('WORKER_DISCONNECTED', `Worker ${worker.snapshot.username || workerId} disconnected`, {
      workerId,
      username: worker.snapshot.username,
    });
  }

  /** Marks workers that have gone quiet, and closes them once they are well past the timeout. */
  private sweep(): void {
    const now = Date.now();
    for (const worker of [...this.live.values()]) {
      const age = now - worker.lastSeen;
      if (age > this.heartbeatTimeoutMs * 3) {
        this.failPending(worker, 'heartbeat lost');
        try {
          worker.socket.terminate();
        } catch {
          // Already gone; 'close' will clean up.
        }
      } else if (age > this.heartbeatTimeoutMs) {
        this.deps.workers.touch(worker.workerId, worker.snapshot as unknown as Record<string, unknown>, 'DEGRADED');
      }
    }
  }

  private failPending(worker: LiveWorker, reason: string): void {
    for (const [taskId, pending] of worker.pending) {
      clearTimeout(pending.timer);
      this.deps.tasks.complete(taskId, 'FAILED', null, reason);
      pending.reject(new Error(reason));
    }
    worker.pending.clear();
  }

  private parseSnapshot(payload: Record<string, unknown> | undefined, workerId: string): WorkerSnapshot {
    const base = emptySnapshot(workerId);
    if (!payload) return base;
    const number = (key: string, fallback: number): number =>
      typeof payload[key] === 'number' && Number.isFinite(payload[key]) ? (payload[key] as number) : fallback;
    const text = (key: string, fallback: string): string =>
      typeof payload[key] === 'string' ? (payload[key] as string) : fallback;
    const bool = (key: string, fallback: boolean): boolean =>
      typeof payload[key] === 'boolean' ? (payload[key] as boolean) : fallback;

    return {
      workerId,
      label: text('label', ''),
      username: text('username', ''),
      minecraftVersion: text('minecraftVersion', ''),
      serverAddress: text('serverAddress', ''),
      dimension: text('dimension', 'unknown'),
      gameMode: text('gameMode', 'unknown'),
      inWorld: bool('inWorld', false),
      x: number('x', 0),
      y: number('y', 0),
      z: number('z', 0),
      health: number('health', 0),
      maxHealth: number('maxHealth', 0),
      food: number('food', 0),
      saturation: number('saturation', 0),
      armorPieces: number('armorPieces', 0),
      totems: number('totems', 0),
      foodItems: number('foodItems', 0),
      heldItem: text('heldItem', ''),
      offhandItem: text('offhandItem', ''),
      currentTask: text('currentTask', ''),
      lastActivity: text('lastActivity', ''),
      lastActivityAt: number('lastActivityAt', 0),
      lastError: text('lastError', ''),
      eflyActive: bool('eflyActive', false),
      eflyTarget: text('eflyTarget', ''),
      taskProgress: text('taskProgress', ''),
      paused: bool('paused', false),
      stopped: bool('stopped', false),
      totalItems: number('totalItems', 0),
      distinctItems: number('distinctItems', 0),
      freeSlots: number('freeSlots', 0),
      capabilities: Array.isArray(payload.capabilities)
        ? (payload.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
        : [],
      fabricVersion: text('fabricVersion', ''),
      meteorVersion: text('meteorVersion', ''),
      modVersion: text('modVersion', ''),
    };
  }

  private tokenMatches(supplied: string): boolean {
    const expected = this.options.token;
    if (!expected) return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

export type { WorkerAuthorizer, HelloInfo } from '../pairing/pairing-service';

/** Task kinds that change state, so only one may be in flight per worker at a time. */
const EXCLUSIVE_KINDS = new Set<TaskKind>(EXCLUSIVE_TASK_KINDS);
