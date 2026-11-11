/**
 * The link: this worker's WebSocket connection to the Fleet Manager.
 *
 * The worker dials out. The host never connects in, which is why a worker behind NAT still works.
 * The link owns framing, reconnection, heartbeats and version negotiation; it does not know what a
 * task *means*, so the runtime above it stays testable without a socket.
 */

import { EventEmitter } from 'node:events';
import { BotError, connectionError } from '../core/errors';
import type { Logger } from '../core/logger';
import { Backoff } from '../core/reliability';
import {
  decodeEnvelope,
  encodeEnvelope,
  negotiate,
  MESSAGE_TYPES,
  WORKER_PROTOCOL_VERSION,
  type WorkerEnvelope,
} from '../core/protocol/messages';
import type { RuntimeKind } from '../core/types';

/** The subset of a WebSocket this link uses. Structural so a fake satisfies it in tests. */
export interface SocketLike extends EventEmitter {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}

export interface SocketFactory {
  (url: string): SocketLike;
}

export interface LinkOptions {
  url: string;
  workerId: string;
  username: string;
  runtime: RuntimeKind;
  token?: string;
  pairingCode?: string;
  logger: Logger;
  socketFactory: SocketFactory;
  heartbeatSeconds: number;
  reconnectSeconds: number;
  maxReconnectSeconds: number;
  /** Provided so the runtime can answer a `task` frame. */
  onFrame: (frame: WorkerEnvelope) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
}

const OPEN = 1;

/**
 * A single worker's outbound link.
 *
 * Frames are newline-free JSON (one message per WebSocket frame), matching the host's `ws` server.
 */
export class Link extends EventEmitter {
  private socket: SocketLike | null = null;
  private readonly backoff: Backoff;
  private readonly logger: Logger;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private negotiated = false;
  private readonly options: LinkOptions;

  constructor(options: LinkOptions) {
    super();
    this.options = options;
    this.logger = options.logger.child('link');
    this.backoff = new Backoff(options.reconnectSeconds * 1000, options.maxReconnectSeconds * 1000);
  }

  isOpen(): boolean {
    return this.socket !== null && this.socket.readyState === OPEN && this.negotiated;
  }

  /** Connects and, unless stopped, keeps reconnecting. */
  start(): void {
    this.stopped = false;
    this.connectOnce();
  }

  private buildUrl(): string {
    const base = this.options.url;
    const url = new URL(base);
    if (this.options.token) url.searchParams.set('token', this.options.token);
    return url.toString();
  }

  private connectOnce(): void {
    if (this.socket) return;
    let socket: SocketLike;
    try {
      socket = this.options.socketFactory(this.buildUrl());
    } catch (error) {
      this.logger.warn('could not open the socket', { error: String(error) });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.negotiated = false;

    socket.on('open', () => {
      this.logger.info('link open');
      this.backoff.reset();
      this.sendHello();
      this.startHeartbeat();
      this.options.onOpen?.();
    });

    socket.on('message', (data: unknown) => {
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      const frame = decodeEnvelope(text);
      if (!frame) {
        this.logger.debug('dropped a malformed frame');
        return;
      }
      if (frame.type === MESSAGE_TYPES.HELLO_ACK) {
        const outcome = negotiate(frame.v);
        if (!outcome.accepted) {
          this.logger.error('the host refused our protocol version', { reason: outcome.reason, peer: frame.v });
          this.sendError(frame.id, outcome.reason ?? 'protocol mismatch');
          this.stopped = true;
          this.close('protocol mismatch');
          return;
        }
        this.negotiated = true;
        this.emit('negotiated', outcome.version);
        return;
      }
      if (frame.type === MESSAGE_TYPES.PING) {
        this.send(MESSAGE_TYPES.PONG, { at: Date.now() }, frame.id);
        return;
      }
      this.options.onFrame(frame);
    });

    socket.on('close', (code: unknown, reason: unknown) => {
      const detail = `${code ?? ''} ${reason ? String(reason) : ''}`.trim();
      this.logger.info('link closed', { detail });
      this.socket = null;
      this.negotiated = false;
      this.stopHeartbeat();
      this.options.onClose?.(detail);
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.on('error', (error: unknown) => {
      this.logger.warn('link error', { error: String(error) });
    });
  }

  private sendHello(): void {
    this.send(MESSAGE_TYPES.HELLO, {
      workerId: this.options.workerId,
      username: this.options.username,
      runtime: this.options.runtime,
      version: WORKER_PROTOCOL_VERSION,
      pairingCode: this.options.pairingCode,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.isOpen()) this.send(MESSAGE_TYPES.PONG, { at: Date.now() });
    }, Math.max(1, this.options.heartbeatSeconds) * 1000);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const { nextDelayMs } = this.backoff.next();
    this.logger.info('reconnecting the link', { delayMs: nextDelayMs });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connectOnce();
    }, nextDelayMs);
    this.reconnectTimer.unref?.();
  }

  send(type: string, payload?: Record<string, unknown>, id?: string): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    const envelope: WorkerEnvelope = { v: WORKER_PROTOCOL_VERSION, type, payload: payload ?? {} };
    if (id) envelope.id = id;
    try {
      this.socket.send(encodeEnvelope(envelope));
    } catch (error) {
      this.logger.warn('could not send a frame', { type, error: String(error) });
    }
  }

  sendStatus(snapshot: Record<string, unknown>): void {
    this.send(MESSAGE_TYPES.STATUS, snapshot);
  }

  sendResult(id: string | undefined, result: Record<string, unknown>): void {
    this.send(MESSAGE_TYPES.RESULT, result, id);
  }

  sendProgress(id: string | undefined, progress: Record<string, unknown>): void {
    this.send(MESSAGE_TYPES.PROGRESS, progress, id);
  }

  sendError(id: string | undefined, message: string, detail?: Record<string, unknown>): void {
    this.send(MESSAGE_TYPES.ERROR, { message, ...(detail ?? {}) }, id);
  }

  sendLog(level: string, message: string, detail?: Record<string, unknown>): void {
    this.send(MESSAGE_TYPES.LOG, { level, message, ...(detail ?? {}) });
  }

  private close(reason: string): void {
    try {
      this.socket?.close(1000, reason);
    } catch {
      /* best effort */
    }
  }

  /** Stops reconnecting and closes the socket. */
  stop(reason = 'the worker is shutting down'): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    this.negotiated = false;
    if (socket) {
      try {
        socket.close(1000, reason);
      } catch {
        try {
          socket.terminate?.();
        } catch {
          /* best effort */
        }
      }
    }
  }

  requireOpen(): void {
    if (!this.isOpen()) throw connectionError('the link to the fleet manager is not open');
  }
}

export { BotError };
