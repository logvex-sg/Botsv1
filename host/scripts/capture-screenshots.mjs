/**
 * Captures the UI screenshots in docs/screenshots/.
 *
 * It drives a running Vite dev server in demo mode (`?demo`) with headless Chromium over the
 * Chrome DevTools Protocol, so no Electron or backend is required and the output is reproducible.
 *
 * Usage:
 *   1. npm run dev:renderer -- --port 5173 --host 0.0.0.0   (in one terminal)
 *   2. node scripts/capture-screenshots.mjs
 *
 * Environment:
 *   BASE_URL   Base URL of the dev server (default http://127.0.0.1:5173)
 *   CHROME     Path to a Chromium/Chrome binary (default: auto-detected)
 *   OUT_DIR    Output directory (default docs/screenshots)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUT_DIR ?? join(__dirname, '..', 'docs', 'screenshots');
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const PORT = Number(process.env.DEBUG_PORT ?? 9333);

const PAGES = [
  ['01-dashboard', 'dashboard'],
  ['02-workers', 'workers'],
  ['03-groups', 'groups'],
  ['04-tasks', 'tasks'],
  ['05-multiverse-servers', 'multiverse'],
  ['06-inventory', 'inventory'],
  ['07-regear', 'regear'],
  ['08-commands', 'commands'],
  ['09-consoles', 'consoles'],
  ['10-statistics', 'statistics'],
  ['11-worker-mode', 'worker-mode'],
  ['12-settings', 'settings'],
  ['13-storage-overview', 'storage'],
  ['14-storage-categories', 'storage', 'tab=categories'],
  ['16-storage-structures', 'storage', 'tab=structures'],
];

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const candidate of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No Chromium/Chrome binary found. Set the CHROME environment variable.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

/** Minimal CDP client over a single target's WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const resolver = this.pending.get(message.id);
      if (!resolver) return;
      this.pending.delete(message.id);
      if (message.error) resolver.reject(new Error(message.error.message));
      else resolver.resolve(message.result);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const chrome = findChrome();
  // A profile under /tmp avoids permission and leftover-lock problems in the output directory.
  const userDataDir = join(tmpdir(), `logvex-shots-${process.pid}`);
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // Wait for the debugging endpoint.
    let version = null;
    for (let i = 0; i < 150 && !version; i++) {
      try {
        version = await fetchJson(`http://127.0.0.1:${PORT}/json/version`);
      } catch {
        await sleep(200);
      }
    }
    if (!version) throw new Error('Chromium did not expose a debugging port.');

    // Reuse the existing page target; /json/new is PUT-only on recent Chromium builds.
    const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
    const target = targets.find((t) => t.type === 'page');
    if (!target) throw new Error('No page target available.');
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    for (const [name, page, extra] of PAGES) {
      const url = `${BASE_URL}/?demo&page=${page}${extra ? `&${extra}` : ''}`;
      await cdp.send('Page.navigate', { url });
      // Give the SPA time to mount and the demo store to settle.
      await sleep(1400);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = join(OUT_DIR, `${name}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`captured ${name} -> ${file}`);
    }

    cdp.close();
  } finally {
    child.kill('SIGKILL');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
