/**
 * Protocol consistency test.
 *
 * The worker wire contract is declared three times — canonically in `protocol/protocol.json`, in
 * TypeScript for the host (`src/shared/workers.ts`) and in Java for the mod (`Protocol.java`).
 * Nothing at compile time ties the three together, so this test runs the canonical checker
 * (`protocol/check-protocol.mjs`) and asserts it finds no drift. Add a message type or a task kind
 * to one side only and this test fails, instead of the drift reaching a user as a frame neither
 * side understands.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXCLUSIVE_TASK_KINDS, TASK_KINDS, WORKER_PROTOCOL_VERSION } from '../../src/shared/workers';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

interface ProtocolChecker {
  checkConsistency(): string[];
  loadCanonical(): {
    version: number;
    inbound: { types: string[] };
    outbound: { types: string[] };
    taskKinds: string[];
    exclusiveTaskKinds: string[];
    eflyActions: string[];
    payloadFields: Record<string, string>;
  };
}

const checker = (await import(pathToFileURL(join(repoRoot, 'protocol', 'check-protocol.mjs')).href)) as ProtocolChecker;
const canonical = checker.loadCanonical();
const javaSource = readFileSync(
  join(repoRoot, 'src', 'main', 'java', 'com', 'logvex', 'worker', 'core', 'Protocol.java'),
  'utf8',
);

describe('protocol consistency', () => {
  it('has a canonical contract with a positive version', () => {
    expect(canonical.version).toBeGreaterThan(0);
    expect(canonical.taskKinds.length).toBeGreaterThan(0);
  });

  it('finds no drift between protocol.json, workers.ts and Protocol.java', () => {
    expect(checker.checkConsistency()).toEqual([]);
  });

  it('exposes the canonical version through the host mirror', () => {
    expect(WORKER_PROTOCOL_VERSION).toBe(canonical.version);
  });

  it('exposes the canonical task kinds through the host mirror', () => {
    expect([...TASK_KINDS].sort()).toEqual([...canonical.taskKinds].sort());
    expect([...EXCLUSIVE_TASK_KINDS].sort()).toEqual([...canonical.exclusiveTaskKinds].sort());
  });

  it('names every efly action as a Java constant', () => {
    for (const action of canonical.eflyActions) {
      expect(javaSource).toContain(`"${action}"`);
    }
  });

  it('declares the pairing-code payload field on both sides', () => {
    expect(canonical.payloadFields.pairingCode).toBe('FIELD_PAIRING_CODE');
    expect(javaSource).toContain('FIELD_PAIRING_CODE = "pairingCode"');
  });
});
