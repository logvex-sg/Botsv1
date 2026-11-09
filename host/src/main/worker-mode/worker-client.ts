/**
 * The host application acting as a *worker*.
 *
 * The Fabric mod is the normal worker, but the desktop app also needs to be able to speak the same
 * wire protocol from the other side of the connection: to verify that a host address, port and
 * pairing code actually work before an operator copies a config into a bot's `mods/` folder, and to
 * advertise this machine as a worker when someone wants a single-machine setup.
 *
 * This is a faithful client of the protocol: it sends `hello`, waits for `hello-ack`, registers,
 * heartbeats, answers `ping`, and reports `paused`/`stopped` when the host drives it with a
 * `control` message. It never assumes anything the host has not told it, and it never runs a task
 * it cannot answer — an unsupported task is refused explicitly rather than silently dropped.
 *
 * Minecraft-free: nothing here imports the game or the mod, so it is unit-testable against a real
 * WorkerServer over a loopback socket.
 */
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import { WebSocket } from 'ws';
import {
  WORKER_PATH,
  WORKER_PROTOCOL_VERSION,
  WorkerInbound,
  WorkerOutbound,
  decodeEnvelope,
  emptySnapshot,
  encodeEnvelope,
  type WorkerEnvelope,
  type WorkerSnapshot,
} from '../../shared/workers';
import type { WorkerClientState, WorkerClientStatus } from '../../shared/types';

export type { WorkerClientState, WorkerClientStatus };

export interface WorkerClientOptions {
  host: string;
  port: number;
  /** The shared token, or blank when pairing with a one-time code instead. */
  token: string;
  /** A one-time pairing code, used instead of the token on the first join. */
  pairingCode?: string;
  /** A stable id for this client; blank lets the host assign one. */
  workerId?: string;
  /** How the host should see this worker. */
  username?: string;
  /** Seconds between status snapshots. */
  heartbeatSeconds?: number;
  /** When false the client disconnects as soon as the handshake result is known (a connection test). */
  stayConnected?: boolean;
  /** Overridable for tests; defaults to the real `ws` client. */
  socketFactory?: (url: string) => WebSocket;
}


/**
 * A worker-side connection to a host.
 *
 * Emits `status` whenever its {@link WorkerClientStatus} changes and `log` for console lines the
 * panel shows, so the renderer can render progress without polling.
 */
export class WorkerClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnect: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private closing = false;
  private readonly options: Required<Omit<WorkerClientOptions, 'socketFactory'>>;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly startedAt = Date.now();

  private state: WorkerClientState = 'idle';
  /** Resolves the promise returned by {@link connect} once the handshake result is known. */
  private settleConnect: (() => void) | null = null;
  private grantedToken = '';
  private assignedId = '';
  private lastError = '';
  private paused = false;
  private stopped = false;

  constructor(options: WorkerClientOptions) {
    super();
    this.options = {
      host: options.host,
      port: options.port,
      token: options.token,
      pairingCode: options.pairingCode ?? '',
      workerId: options.workerId ?? '',
      username: options.username ?? hostname(),
      heartbeatSeconds: options.heartbeatSeconds ?? 5,
      stayConnected: options.stayConnected ?? false,
    };
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
  }

  status(): WorkerClientStatus {
    return {
      state: this.state,
      connected: this.socket?.readyState === WebSocket.OPEN,
      registered: this.state === 'registered',
      workerId: this.assignedId || this.options.workerId,
      username: this.options.username,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      grantedToken: this.grantedToken,
      lastError: this.lastError,
      paused: this.paused,
      stopped: this.stopped,
      detail: this.detail(),
    };
  }

  /** Opens the connection. Resolves once the handshake has been answered (or refused). */
  connect(): Promise<WorkerClientStatus> {
    if (this.socket) return Promise.resolve(this.status());
    this.closing = false;
    this.setState('connecting');
    const url = `ws://${this.options.host}:${this.options.port}${WORKER_PATH}`;
    this.log(`connecting to ${url}`);

    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = this.socketFactory(url);
      } catch (error) {
        this.lastError = (error as Error).message;
        this.setState('disconnected');
        resolve(this.status());
        return;
      }
      this.socket = socket;
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        this.settleConnect = null;
        resolve(this.status());
      };
      // The handshake result (accepted or refused) settles the promise; the socket staying open
      // afterwards must not keep a `connect()` caller waiting.
      this.settleConnect = settle;
      const timer = setTimeout(() => {
        this.lastError = 'the host did not answer the handshake in time';
        this.log(this.lastError);
        settle();
        try {
          socket.close();
        } catch {
          // Already gone.
        }
      }, 8000);

      socket.on('open', () => {
        this.setState('handshaking');
        this.sendHello();
      });
      socket.on('message', (data) => this.onMessage(data.toString()));
      socket.on('error', (error: Error) => {
        this.lastError = error.message;
        this.log(`socket error: ${error.message}`);
      });
      socket.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timer);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.socket = null;
        this.log(`disconnected (${code}${reason?.length ? ` ${reason.toString()}` : ''})`);
        if (!this.closing && this.state !== 'refused') this.setState('disconnected');
        settle();
        this.maybeReconnect();
      });
    });
  }

  /** Closes the connection and stops reconnecting. */
  disconnect(): void {
    this.closing = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.reconnect = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.socket) {
      try {
        this.socket.close(1000, 'operator closed the connection');
      } catch {
        // Already gone.
      }
      this.socket = null;
    }
    this.setState('idle');
  }

  private sendHello(): void {
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.HELLO,
      payload: {
        token: this.options.token,
        pairingCode: this.options.pairingCode,
        protocolVersion: WORKER_PROTOCOL_VERSION,
        workerId: this.options.workerId,
        username: this.options.username,
        modVersion: 'host-app',
      },
    });
  }

  private onMessage(raw: string): void {
    const envelope = decodeEnvelope(raw);
    if (!envelope) return;
    switch (envelope.type) {
      case WorkerOutbound.HELLO_ACK:
        this.onHelloAck(envelope);
        break;
      case WorkerOutbound.PING:
        this.send({ v: WORKER_PROTOCOL_VERSION, type: WorkerInbound.PONG });
        break;
      case WorkerOutbound.KICK:
        this.log(`the host asked this worker to stand down: ${String(envelope.payload?.reason ?? 'no reason given')}`);
        this.disconnect();
        break;
      case WorkerOutbound.CONTROL:
        this.onControl(envelope);
        break;
      case WorkerOutbound.TASK:
      case WorkerOutbound.COMMAND:
        this.onTask(envelope);
        break;
      default:
        // Unknown types are ignored so a newer host stays usable with an older app.
        break;
    }
  }

  private onHelloAck(envelope: WorkerEnvelope): void {
    const accepted = envelope.payload?.accepted === true;
    if (!accepted) {
      this.lastError = String(envelope.payload?.reason ?? 'the host refused the connection');
      this.log(`refused: ${this.lastError}`);
      this.setState('refused');
      this.settleConnect?.();
      return;
    }
    const granted = typeof envelope.payload?.token === 'string' ? (envelope.payload.token as string) : '';
    if (granted) this.grantedToken = granted;
    this.assignedId = String(envelope.payload?.workerId ?? this.options.workerId);
    this.setState('registered');
    this.log(`registered with the host as ${this.assignedId}`);

    this.sendSnapshot(WorkerInbound.REGISTER);
    this.heartbeat = setInterval(() => this.sendSnapshot(WorkerInbound.STATUS), this.options.heartbeatSeconds * 1000);
    this.heartbeat.unref?.();
    this.settleConnect?.();

    if (!this.options.stayConnected) {
      // A connection test has done its job; drop the link so the host does not keep a phantom worker.
      setTimeout(() => this.disconnect(), 250).unref?.();
    }
  }

  private onControl(envelope: WorkerEnvelope): void {
    const action = String(envelope.payload?.action ?? '');
    switch (action) {
      case 'pause':
        this.paused = true;
        break;
      case 'resume':
        this.paused = false;
        break;
      case 'disconnect':
        this.stopped = true;
        break;
      case 'connect':
      case 'restart':
        this.stopped = false;
        this.paused = false;
        break;
      default:
        this.log(`ignored an unknown control action: ${action}`);
        return;
    }
    this.log(`host asked to ${action}`);
    this.emitStatus();
    this.sendSnapshot(WorkerInbound.STATUS);
  }

  private onTask(envelope: WorkerEnvelope): void {
    const taskId = envelope.id ?? String(envelope.payload?.taskId ?? '');
    const kind = String(envelope.payload?.kind ?? '');
    if (!taskId) return;
    // This desktop worker has no Minecraft client, so it can answer a status request but must refuse
    // anything that would need a game. Refusing explicitly is better than a silent drop.
    const ok = kind === 'status';
    this.send({
      v: WORKER_PROTOCOL_VERSION,
      type: WorkerInbound.RESULT,
      id: taskId,
      payload: {
        ok,
        taskId,
        kind,
        message: ok ? 'host app worker: no game client attached' : `the host-app worker cannot run '${kind}'`,
        data: {},
      },
    });
  }

  private sendSnapshot(type: string): void {
    if (this.state !== 'registered') return;
    const snapshot: WorkerSnapshot = {
      ...emptySnapshot(this.assignedId),
      username: this.options.username,
      label: this.options.username,
      inWorld: false,
      dimension: 'host-app',
      capabilities: ['status'],
      paused: this.paused,
      stopped: this.stopped,
      lastActivity: `connected for ${Math.round((Date.now() - this.startedAt) / 1000)}s`,
      lastActivityAt: Date.now(),
    };
    this.send({ v: WORKER_PROTOCOL_VERSION, type, payload: snapshot as unknown as Record<string, unknown> });
  }

  private maybeReconnect(): void {
    if (this.closing || !this.options.stayConnected || this.state === 'refused') return;
    this.reconnectAttempt++;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.log(`reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      void this.connect();
    }, delay);
    this.reconnect.unref?.();
  }

  private send(envelope: WorkerEnvelope): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(encodeEnvelope(envelope));
    } catch (error) {
      this.log(`could not send ${envelope.type}: ${(error as Error).message}`);
    }
  }

  private setState(state: WorkerClientState): void {
    if (this.state === state) {
      this.emitStatus();
      return;
    }
    this.state = state;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit('status', this.status());
  }

  private log(message: string): void {
    this.emit('log', { at: Date.now(), message });
  }

  private detail(): string {
    switch (this.state) {
      case 'idle':
        return 'Not connected';
      case 'connecting':
        return 'Opening the connection…';
      case 'handshaking':
        return 'Waiting for the host to acknowledge the handshake';
      case 'registered':
        return this.stopped
          ? 'Registered, service stopped by the host'
          : this.paused
            ? 'Registered, paused by the host'
            : 'Registered with the host';
      case 'refused':
        return this.lastError || 'The host refused the connection';
      case 'disconnected':
        return this.lastError ? `Disconnected: ${this.lastError}` : 'Disconnected';
      default:
        return this.state;
    }
  }
}
