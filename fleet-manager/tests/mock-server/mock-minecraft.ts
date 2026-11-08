/**
 * Minimal mock Minecraft server for automated tests.
 *
 * It speaks just enough of the protocol to accept a TCP connection and, optionally, the handshake
 * + login-start packets, so connection, timeout and disconnection paths can be exercised without a
 * real Minecraft server. It is intentionally tiny and dependency-free.
 */
import { createServer, type Server, type Socket } from 'node:net';

export interface MockServerOptions {
  /** When set, the server closes the connection after the handshake (simulates a rejection). */
  rejectConnections?: boolean;
  /** Milliseconds to wait before closing a rejected connection. */
  rejectDelayMs?: number;
}

export class MockMinecraftServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private port = 0;
  readonly receivedHandshakes: Buffer[] = [];

  constructor(private readonly options: MockServerOptions = {}) {}

  async start(port = 0): Promise<number> {
    this.server = createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as { port: number }).port;
    return this.port;
  }

  getPort(): number {
    return this.port;
  }

  get connectionCount(): number {
    return this.receivedHandshakes.length;
  }

  private onConnection(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));

    if (this.options.rejectConnections) {
      setTimeout(() => socket.destroy(), this.options.rejectDelayMs ?? 10);
      return;
    }

    socket.on('data', (chunk) => {
      this.receivedHandshakes.push(chunk);
      // Respond to the handshake with a tiny status-like frame so clients see a live socket.
      socket.write(Buffer.from([0x00]));
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
  }
}
