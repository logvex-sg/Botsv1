import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MockMinecraftServer } from '../mock-server/mock-minecraft';
import { measureLatency, resolveDns, runDiagnostics, listInterfaces } from '../../src/main/services/network/network-diagnostics';

let mock: MockMinecraftServer;
let port = 0;

beforeAll(async () => {
  mock = new MockMinecraftServer();
  port = await mock.start(0);
});
afterAll(async () => { await mock.stop(); });

describe('network diagnostics', () => {
  it('resolves localhost', async () => {
    const result = await resolveDns('localhost');
    expect(result.error).toBeNull();
    expect(result.addresses.length).toBeGreaterThan(0);
  });

  it('measures latency to an open port', async () => {
    const result = await measureLatency('127.0.0.1', port);
    expect(result.reachable).toBe(true);
    expect(result.latencyMs).not.toBeNull();
  });

  it('reports an unreachable port', async () => {
    const result = await measureLatency('127.0.0.1', 1, 500);
    expect(result.reachable).toBe(false);
  });

  it('lists network interfaces', () => {
    expect(listInterfaces().length).toBeGreaterThan(0);
  });

  it('runs a full report', async () => {
    const report = await runDiagnostics('127.0.0.1', port);
    expect(report.dns.error).toBeNull();
    expect(report.latency.reachable).toBe(true);
  });
});
