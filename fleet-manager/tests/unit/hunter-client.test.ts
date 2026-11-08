import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { HunterClient } from '../../src/main/services/hunter/hunter-client';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    const auth = req.headers.authorization;
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '1.0.0' }));
      return;
    }
    if (auth !== 'Bearer secret') {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (url === '/api/v1/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ targets: [{ username: 'Steve', uuid: 'u1', encounters: 3 }], players: [] }));
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HunterClient', () => {
  it('reports health without a token', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: '' });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.version).toBe('1.0.0');
  });

  it('fetches targets with a valid token', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const targets = await client.targets();
    expect(targets).toHaveLength(1);
    expect(targets[0].username).toBe('Steve');
    expect(client.isConnected()).toBe(true);
  });

  it('degrades gracefully when unauthorised', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'wrong' });
    await expect(client.targets()).rejects.toThrow();
    expect(client.isConnected()).toBe(false);
  });

  it('reports offline for an unreachable host', async () => {
    const client = new HunterClient({ baseUrl: 'http://127.0.0.1:1', token: '', timeoutMs: 300 });
    const health = await client.health();
    expect(health.ok).toBe(false);
  });
});
