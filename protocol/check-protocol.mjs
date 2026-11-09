/**
 * Protocol consistency check.
 *
 * The worker wire contract is declared three times: canonically in `protocol/protocol.json`, in
 * TypeScript for the host (`host/src/shared/workers.ts`) and in Java for the mod
 * (`worker-mod/src/main/java/com/logvex/worker/core/Protocol.java`). Nothing at compile time ties
 * the three together, so this script reads all three as text and asserts they agree. It is run from
 * the host's Vitest suite (`host/tests/unit/protocol-consistency.test.ts`), so a drift between any
 * two of them fails the build instead of reaching a user as a frame the other side cannot parse.
 *
 * Usage: node protocol/check-protocol.mjs [--json]
 * Exits non-zero and prints every mismatch when the three disagree.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

export function loadCanonical() {
  return JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'));
}

/** Every `public static final String NAME = "value";` in Protocol.java, keyed by NAME. */
export function parseJavaConstants(source) {
  const constants = new Map();
  const pattern = /public\s+static\s+final\s+String\s+([A-Z0-9_]+)\s*=\s*"([^"]*)"\s*;/g;
  for (const match of source.matchAll(pattern)) constants.set(match[1], match[2]);
  return constants;
}

export function parseJavaVersion(source) {
  const match = source.match(/public\s+static\s+final\s+int\s+VERSION\s*=\s*(\d+)\s*;/);
  if (!match) throw new Error('Protocol.java has no int VERSION constant');
  return Number(match[1]);
}

/** Extracts the string members of a `const NAME = { ... } as const;` object literal. */
export function parseTsObject(source, name) {
  const start = source.indexOf(`export const ${name} = {`);
  if (start < 0) throw new Error(`workers.ts has no export const ${name}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('} as const', open);
  if (close < 0) throw new Error(`could not find the end of ${name}`);
  const body = source.slice(open + 1, close);
  const values = [];
  const pattern = /:\s*'([^']*)'/g;
  for (const match of body.matchAll(pattern)) values.push(match[1]);
  return values;
}

/** Extracts the members of a `export const NAME = [ 'a', 'b' ] as const;` array literal. */
export function parseTsArray(source, name) {
  const start = source.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`workers.ts has no export const ${name}`);
  const equals = source.indexOf('=', start);
  if (equals < 0) throw new Error(`${name} has no initialiser`);
  const open = source.indexOf('[', equals);
  const close = source.indexOf(']', open);
  if (close < 0) throw new Error(`could not find the end of ${name}`);
  const body = source.slice(open + 1, close);
  const values = [];
  const pattern = /'([^']*)'/g;
  for (const match of body.matchAll(pattern)) values.push(match[1]);
  return values;
}

export function parseTsVersion(source) {
  const match = source.match(/export\s+const\s+WORKER_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/);
  if (!match) throw new Error('workers.ts has no WORKER_PROTOCOL_VERSION');
  return Number(match[1]);
}

function sorted(list) {
  return [...list].sort();
}

function diff(label, expected, actual, problems) {
  const e = sorted(expected);
  const a = sorted(actual);
  if (JSON.stringify(e) === JSON.stringify(a)) return;
  problems.push(`${label} differs:\n    canonical: ${e.join(', ')}\n    mirror:    ${a.join(', ')}`);
}

/** Compares the canonical contract with both mirrors. Returns a list of human-readable problems. */
export function checkConsistency() {
  const canonical = loadCanonical();
  const ts = readFileSync(join(repoRoot, 'host', 'src', 'shared', 'workers.ts'), 'utf8');
  const java = readFileSync(
    join(repoRoot, 'worker-mod', 'src', 'main', 'java', 'com', 'logvex', 'worker', 'core', 'Protocol.java'),
    'utf8',
  );
  const javaConstants = parseJavaConstants(java);
  const problems = [];

  if (parseTsVersion(ts) !== canonical.version) {
    problems.push(`host WORKER_PROTOCOL_VERSION (${parseTsVersion(ts)}) != canonical version (${canonical.version})`);
  }
  if (parseJavaVersion(java) !== canonical.version) {
    problems.push(`Protocol.VERSION (${parseJavaVersion(java)}) != canonical version (${canonical.version})`);
  }

  diff('worker -> host message types (TS)', canonical.inbound.types, parseTsObject(ts, 'WorkerInbound'), problems);
  diff('host -> worker message types (TS)', canonical.outbound.types, parseTsObject(ts, 'WorkerOutbound'), problems);
  diff('task kinds (TS)', canonical.taskKinds, parseTsArray(ts, 'TASK_KINDS'), problems);
  diff('exclusive task kinds (TS)', canonical.exclusiveTaskKinds, parseTsArray(ts, 'EXCLUSIVE_TASK_KINDS'), problems);

  const javaInbound = ['HELLO', 'REGISTER', 'STATUS', 'INVENTORY', 'EQUIPMENT', 'RESULT', 'PROGRESS', 'PONG', 'ERROR', 'LOG'];
  const javaOutbound = ['HELLO_ACK', 'COMMAND', 'TASK', 'PING', 'KICK', 'CONTROL'];
  const javaInboundValues = javaInbound.map((n) => {
    const v = javaConstants.get(n);
    if (v === undefined) problems.push(`Protocol.java has no constant ${n}`);
    return v;
  });
  const javaOutboundValues = javaOutbound.map((n) => {
    const v = javaConstants.get(n);
    if (v === undefined) problems.push(`Protocol.java has no constant ${n}`);
    return v;
  });
  diff('worker -> host message types (Java)', canonical.inbound.types, javaInboundValues, problems);
  diff('host -> worker message types (Java)', canonical.outbound.types, javaOutboundValues, problems);

  const javaTaskKinds = [...javaConstants]
    .filter(([name]) => name.startsWith('TASK_'))
    .map(([, value]) => value);
  diff('task kinds (Java)', canonical.taskKinds, javaTaskKinds, problems);

  for (const action of canonical.eflyActions) {
    const constant = `EFLY_${action.toUpperCase()}`;
    if (javaConstants.get(constant) !== action) {
      problems.push(`Protocol.java ${constant} != "${action}"`);
    }
  }
  for (const action of canonical.controlActions) {
    const constant = `CONTROL_${action.toUpperCase()}`;
    if (javaConstants.get(constant) !== action) {
      problems.push(`Protocol.java ${constant} != "${action}"`);
    }
  }
  diff('control actions (TS)', canonical.controlActions, parseTsArray(ts, 'CONTROL_ACTIONS'), problems);
  for (const [field, constant] of Object.entries(canonical.payloadFields)) {
    if (javaConstants.get(constant) !== field) {
      problems.push(`Protocol.java ${constant} != "${field}"`);
    }
  }

  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const problems = checkConsistency();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: problems.length === 0, problems }, null, 2)}\n`);
  } else if (problems.length === 0) {
    console.log('protocol OK: protocol.json, workers.ts and Protocol.java agree');
  } else {
    console.error(`protocol MISMATCH (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
  }
  process.exit(problems.length === 0 ? 0 : 1);
}
