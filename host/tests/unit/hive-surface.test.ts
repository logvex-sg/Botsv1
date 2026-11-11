/**
 * HIVE MODE surface consistency test.
 *
 * The hive feature is exposed through four places that nothing at compile time ties together: the
 * `FleetApi` interface and the `IPC` channel map in `shared/ipc.ts`, the preload bridge, the IPC
 * handlers, the demo implementation the renderer falls back to under `?demo`, and the REST routes in
 * the API server. Add a method to one and forget another and the failure only shows up at runtime as
 * a button that does nothing. This test reads the sources and asserts every hive method is wired all
 * the way through, so that class of drift fails the build instead.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'src');
const read = (relative: string): string => readFileSync(join(src, relative), 'utf8');

const ipc = read('shared/ipc.ts');
const preload = read('main/preload.ts');
const handlers = read('main/ipc/handlers.ts');
const demo = read('renderer/lib/demo.ts');
const server = read('main/api/server.ts');

/** The hive methods on the renderer-facing interface. */
const INTERFACE_METHODS = [
  'hiveOverview', 'hiveMap', 'hiveSetEnabled', 'hiveSetFormation', 'hiveCommand',
  'hiveSetRole', 'hiveSetCommander', 'hiveEmergencyStop', 'hiveExport',
];

/** The IPC channel names, taken from the `IPC` map. */
function channelNames(): string[] {
  const block = ipc.slice(ipc.indexOf('export const IPC = {'));
  return [...block.matchAll(/'(hive:[a-z:-]+)'/g)].map((match) => match[1]);
}

describe('hive IPC surface', () => {
  it('declares every hive method on the FleetApi interface', () => {
    for (const method of INTERFACE_METHODS) {
      expect(ipc).toContain(`${method}(`);
    }
  });

  it('declares a channel for every hive method', () => {
    const channels = channelNames();
    expect(channels.length).toBe(INTERFACE_METHODS.length);
    for (const method of INTERFACE_METHODS) {
      expect(ipc).toMatch(new RegExp(`\\b${method}: 'hive:`));
    }
  });

  it('invokes every hive channel from the preload bridge', () => {
    for (const channel of channelNames()) {
      expect(preload).toContain(`invoke('${channel}'`);
    }
  });

  it('registers a handler for every hive channel', () => {
    for (const channel of channelNames()) {
      expect(handlers).toContain(`handle('${channel}'`);
    }
  });

  it('implements every hive method in the demo API, so the ?demo renderer has no dead buttons', () => {
    for (const method of INTERFACE_METHODS) {
      expect(demo).toContain(`${method}:`);
    }
  });

  it('serves the hive over the REST API', () => {
    for (const path of ['/api/v1/hive', '/api/v1/hive/map', '/api/v1/hive/command', '/api/v1/hive/emergency-stop']) {
      expect(server).toContain(`'${path}'`);
    }
  });
});
