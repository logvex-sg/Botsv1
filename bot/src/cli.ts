#!/usr/bin/env node
/**
 * The `logvex-bot` command line.
 *
 * A worker is normally launched by the Fleet Manager, but it is also a first-class program: this is
 * how an operator runs one by hand, checks its configuration, or points it at a server for a test.
 *
 * Commands:
 *   run                 connect and serve tasks (the default)
 *   config              print the effective configuration
 *   path                print where the configuration lives
 *   plan "<text>"       interpret an instruction offline, without connecting
 *   commands            list the server commands the worker is allowed to send
 *   plugins             list the built-in plugins
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configPath, loadConfig, normalizeConfig } from './core/config';
import { allowedCommands, TASK_CATALOG } from './core/task-catalog';
import { interpret, describePlan } from './ai/interpret';
import { BUILTIN_PLUGINS } from './plugins';
import { Logger } from './core/logger';
import { MineflayerRuntime } from './runtime/runtime';

function baseDir(argv: string[]): string {
  const flag = argv.find((argument) => argument.startsWith('--dir='));
  if (flag) return flag.slice('--dir='.length);
  return process.cwd();
}

function usage(): void {
  process.stdout.write(
    [
      'logvex-bot - an autonomous Mineflayer worker for the Logvex Fleet Manager',
      '',
      'Usage: logvex-bot [command] [--dir=<path>]',
      '',
      'Commands:',
      '  run              connect and serve tasks (default)',
      '  config           print the effective configuration',
      '  path             print the configuration file path',
      '  plan "<text>"    interpret an instruction offline',
      '  commands         list the allowed server commands',
      '  tasks            list the task kinds this worker implements',
      '  plugins          list the built-in plugins',
      '  help             show this message',
      '',
      'Options:',
      '  --dir=<path>     the worker state directory (default: the current directory)',
      '  --offline        run without dialling the Fleet Manager',
      '  --level=<level>  debug | info | warn | error',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv.find((argument) => !argument.startsWith('--')) ?? 'run';
  const dir = baseDir(argv);
  const levelArg = argv.find((argument) => argument.startsWith('--level='))?.slice('--level='.length) ?? 'info';
  const level = (['debug', 'info', 'warn', 'error'] as const).includes(levelArg as 'info') ? (levelArg as 'debug' | 'info' | 'warn' | 'error') : 'info';

  if (command === 'help') {
    usage();
    return;
  }

  if (command === 'plan') {
    const index = argv.indexOf('plan');
    const instruction = argv.slice(index + 1).filter((argument) => !argument.startsWith('--')).join(' ');
    const plan = interpret(instruction);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write(`${describePlan(plan)}\n`);
    return;
  }

  if (command === 'commands') {
    for (const entry of allowedCommands()) process.stdout.write(`${entry}\n`);
    return;
  }

  if (command === 'tasks') {
    for (const descriptor of TASK_CATALOG) {
      process.stdout.write(`${descriptor.kind}\t${descriptor.mutating ? 'mutating' : 'read-only'}\t${descriptor.gate ?? '-'}\n`);
    }
    return;
  }

  if (command === 'plugins') {
    for (const plugin of BUILTIN_PLUGINS) {
      process.stdout.write(`${plugin.id}\t${plugin.mutating ? 'mutating' : 'read-only'}\tdepends: ${plugin.dependsOn.join(',') || 'none'}\n`);
    }
    return;
  }

  if (command === 'path') {
    process.stdout.write(`${configPath(dir)}\n`);
    return;
  }

  if (command === 'config') {
    const path = configPath(dir);
    if (!existsSync(path)) {
      process.stdout.write(`no configuration at ${path}; run the worker once to create one\n`);
      return;
    }
    const loaded = await loadConfig(path);
    process.stdout.write(`${JSON.stringify(loaded.config, null, 2)}\n`);
    return;
  }

  if (command !== 'run') {
    process.stderr.write(`unknown command: ${command}\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  const logger = new Logger({ level, scope: 'cli' });
  const runtime = new MineflayerRuntime({
    baseDir: dir,
    logger,
    offline: argv.includes('--offline'),
  });

  const config = await runtime.init();
  process.stdout.write(`logvex-bot ${config.workerId} starting; state in ${config.stateDir}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\nreceived ${signal}; shutting down\n`);
    await runtime.stop(signal);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await runtime.start();
  // The runtime keeps the process alive through its timers and sockets; nothing to await here.
  await new Promise<void>(() => undefined);
}

void main().catch((error: unknown) => {
  process.stderr.write(`logvex-bot failed: ${String(error)}\n`);
  process.exitCode = 1;
});

export { normalizeConfig, join };
