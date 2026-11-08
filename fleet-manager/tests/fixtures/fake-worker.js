/**
 * Fake bot worker fixture.
 *
 * Speaks the same IPC protocol as the real worker so the supervisor can be tested end to end
 * (real fork, real IPC) without opening a network connection. Behaviour is driven by environment
 * variables so a single fixture covers the success and failure paths.
 *
 *   LOGVEX_FAKE_MODE=ok        emit connecting -> login -> spawn -> connected, then telemetry
 *   LOGVEX_FAKE_MODE=fail      emit an error and exit non-zero
 *   LOGVEX_FAKE_MODE=crash     exit immediately with a non-zero code
 */
const instanceId = process.env.LOGVEX_INSTANCE_ID || 'test';
const mode = process.env.LOGVEX_FAKE_MODE || 'ok';

const send = (event) => {
  if (process.send) process.send({ instanceId, event });
};

process.on('message', (message) => {
  if (message && message.kind === 'stop') {
    send({ kind: 'end', reason: 'stopped' });
    process.exit(0);
  }
  if (message && message.kind === 'command') {
    send({ kind: 'log', level: 'info', message: `command: ${message.command}` });
  }
});

if (mode === 'crash') {
  process.exit(3);
} else if (mode === 'fail') {
  send({ kind: 'error', message: 'simulated failure', fatal: true });
  setTimeout(() => process.exit(1), 10);
} else {
  send({ kind: 'connecting' });
  setTimeout(() => send({ kind: 'login' }), 5);
  setTimeout(() => send({ kind: 'spawn', username: 'TestBot' }), 10);
  setTimeout(() => {
    send({ kind: 'connected', version: '1.21.11' });
    send({ kind: 'telemetry', telemetry: { memoryBytes: 128000000, cpuPercent: 12, ping: 40 } });
    send({ kind: 'position', position: { x: 1, y: 64, z: 2 }, dimension: 'minecraft:overworld' });
    send({ kind: 'roleEvent', type: 'EQUIPMENT_READY', payload: { ready: true } });
  }, 15);
}
