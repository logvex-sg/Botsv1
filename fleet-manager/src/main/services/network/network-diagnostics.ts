/**
 * Network diagnostics.
 *
 * Measures DNS resolution, TCP reachability and handshake latency for a server profile, plus
 * per-instance connection information. It only reads network state; it never rotates addresses or
 * conceals connections.
 */
import { lookup } from 'node:dns/promises';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';

export interface DnsResult {
  host: string;
  addresses: string[];
  error: string | null;
  durationMs: number;
}

export interface LatencyResult {
  host: string;
  port: number;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface InterfaceInfo {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}

export interface DiagnosticsReport {
  dns: DnsResult;
  latency: LatencyResult;
  interfaces: InterfaceInfo[];
  checkedAt: number;
}

export async function resolveDns(host: string): Promise<DnsResult> {
  const started = Date.now();
  try {
    const result = await lookup(host, { all: true });
    return {
      host,
      addresses: result.map((r) => r.address),
      error: null,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return { host, addresses: [], error: (error as Error).message, durationMs: Date.now() - started };
  }
}

export function measureLatency(host: string, port: number, timeoutMs = 5000): Promise<LatencyResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: LatencyResult) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ host, port, reachable: true, latencyMs: Date.now() - started, error: null }));
    socket.once('timeout', () => finish({ host, port, reachable: false, latencyMs: null, error: 'timeout' }));
    socket.once('error', (error) => finish({ host, port, reachable: false, latencyMs: null, error: error.message }));
  });
}

export function listInterfaces(): InterfaceInfo[] {
  const out: InterfaceInfo[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      out.push({ name, address: net.address, family: String(net.family), internal: net.internal });
    }
  }
  return out;
}

export async function runDiagnostics(host: string, port: number): Promise<DiagnosticsReport> {
  const dns = await resolveDns(host);
  const latency = dns.error ? { host, port, reachable: false, latencyMs: null, error: dns.error } : await measureLatency(host, port);
  return { dns, latency, interfaces: listInterfaces(), checkedAt: Date.now() };
}
