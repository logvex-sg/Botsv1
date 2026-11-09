/**
 * Protocol drift test.
 *
 * The worker protocol is declared twice: once in Java (`Protocol.java`, the worker's copy) and once
 * in TypeScript (`src/shared/workers.ts`, the host's copy). Nothing at compile time ties the two
 * together, so this test reads the Java source directly and asserts the host mirror matches it.
 *
 * That is what makes the README's promise true: add a message type or a task kind to one side only
 * and this test fails, rather than the drift reaching a user as a frame neither side understands.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXCLUSIVE_TASK_KINDS,
  TASK_KINDS,
  WORKER_PROTOCOL_VERSION,
  WorkerInbound,
  WorkerOutbound,
} from '../../src/shared/workers';

const here = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_JAVA = join(here, '..', '..', '..', 'worker-mod', 'src', 'main', 'java', 'com', 'logvex', 'worker', 'core', 'Protocol.java');

/** Every `public static final String NAME = "value";` in Protocol.java, keyed by NAME. */
function parseJavaConstants(source: string): Map<string, string> {
  const constants = new Map<string, string>();
  const pattern = /public\s+static\s+final\s+String\s+([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*;/g;
  for (const match of source.matchAll(pattern)) constants.set(match[1], match[2]);
  return constants;
}

function parseJavaVersion(source: string): number {
  const match = source.match(/public\s+static\s+final\s+int\s+VERSION\s*=\s*(\d+)\s*;/);
  if (!match) throw new Error('Protocol.java has no int VERSION constant');
  return Number(match[1]);
}

/** The constants whose names start with a prefix, mapped to their string values. */
function withPrefix(constants: Map<string, string>, prefix: string): Map<string, string> {
  return new Map([...constants].filter(([name]) => name.startsWith(prefix)));
}

const javaSource = readFileSync(PROTOCOL_JAVA, 'utf8');
const java = parseJavaConstants(javaSource);

const INBOUND_NAMES = ['HELLO', 'REGISTER', 'STATUS', 'INVENTORY', 'EQUIPMENT', 'RESULT', 'PROGRESS', 'PONG', 'ERROR', 'LOG'];
const OUTBOUND_NAMES = ['HELLO_ACK', 'COMMAND', 'TASK', 'PING', 'KICK'];
const EXCLUSIVE_KINDS = ['regear', 'command', 'chat', 'efly'];

function values(names: string[]): string[] {
  return names.map((name) => {
    const value = java.get(name);
    if (value === undefined) throw new Error(`Protocol.java has no constant ${name}`);
    return value;
  });
}

describe('protocol drift', () => {
  it('reads the Java protocol file', () => {
    expect(java.size).toBeGreaterThan(20);
  });

  it('agrees on the protocol version', () => {
    expect(parseJavaVersion(javaSource)).toBe(WORKER_PROTOCOL_VERSION);
  });

  it('agrees on the worker -> host message types', () => {
    expect(values(INBOUND_NAMES).sort()).toEqual(Object.values(WorkerInbound).sort());
  });

  it('agrees on the host -> worker message types', () => {
    expect(values(OUTBOUND_NAMES).sort()).toEqual(Object.values(WorkerOutbound).sort());
  });

  it('agrees on the task kinds', () => {
    expect([...withPrefix(java, 'TASK_').values()].sort()).toEqual([...TASK_KINDS].sort());
  });

  it('agrees on the exclusive (mutating) task kinds', () => {
    expect([...EXCLUSIVE_TASK_KINDS].sort()).toEqual([...EXCLUSIVE_KINDS].sort());
  });

  it('has a distinct constant for every task kind', () => {
    const taskValues = [...withPrefix(java, 'TASK_').values()];
    expect(new Set(taskValues).size).toBe(taskValues.length);
  });
});
