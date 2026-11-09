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
    if (url === '/api/v1/modules/player-tracker') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        module: {
          name: 'player-tracker', title: 'Player Tracker', enabled: true, hunter: true,
          settings: [{ name: 'range', title: 'Range', type: 'double', value: '64.0', default: '64.0', modified: false }],
        },
      }));
      return;
    }
    if (url === '/api/v1/settings' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const body = JSON.parse(raw) as { module: string; setting: string; value: string };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: `${body.module}.${body.setting} = ${body.value}` }));
      });
      return;
    }
    if (url === '/api/v1/profiles') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        profiles: [{ name: 'default', active: true, range: 64, scanInterval: 10, sortMode: 'priority', autoSelect: true, protectFriends: true, protectIgnored: true }],
      }));
      return;
    }
    if (url === '/api/v1/profiles/pvp' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile: 'pvp', result: 'active profile is now pvp' }));
      return;
    }
    if (url === '/api/v1/hud') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        hud: [{ name: 'logvex-target', title: 'Logvex Target', group: 'Meteor', active: true, hunter: true }],
      }));
      return;
    }
    if (url === '/api/v1/hud/logvex-target' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, hud: 'logvex-target', result: 'logvex-target is now off' }));
      return;
    }
    if (url === '/api/v1/hunter/start' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, hunter: 'start', result: 'hunter started' }));
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

  it('fetches module detail with settings', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const module = await client.module('player-tracker');
    expect(module.name).toBe('player-tracker');
    expect(module.settings[0].name).toBe('range');
    expect(module.settings[0].value).toBe('64.0');
  });

  it('changes a setting', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const result = await client.setSetting('player-tracker', 'range', '96');
    expect(result.result).toBe('player-tracker.range = 96');
  });

  it('lists profiles and switches the active one', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const profiles = await client.profiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].active).toBe(true);

    const switched = await client.useProfile('pvp');
    expect(switched.result).toBe('active profile is now pvp');
  });

  it('lists HUD elements and toggles one', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const hud = await client.hud();
    expect(hud[0].name).toBe('logvex-target');

    const toggled = await client.toggleHud('logvex-target');
    expect(toggled.result).toBe('logvex-target is now off');
  });

  it('runs a hunter lifecycle action', async () => {
    const client = new HunterClient({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const result = await client.hunter('start');
    expect(result.result).toBe('hunter started');
  });
});
