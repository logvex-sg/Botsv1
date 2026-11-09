/**
 * Electron main entry point.
 *
 * Creates the application context, starts the local API, opens the window and wires the IPC
 * handlers. It also forwards every bus event to the renderer so the UI updates live, and performs
 * an orderly shutdown on quit.
 */
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { AppContext } from './context';
import { ApiServer } from './api/server';
import { registerIpc } from './ipc/handlers';
import { ApiAuth } from './api/auth';

let window: BrowserWindow | null = null;
let context: AppContext | null = null;
let api: ApiServer | null = null;
let unsubscribe: (() => void) | null = null;

const isDev = process.env.NODE_ENV === 'development';

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0f17',
    title: 'Logvex Fleet Manager',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on('closed', () => {
    window = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await window.loadURL('http://localhost:5173');
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

async function bootstrap(): Promise<void> {
  const userDataDir = app.getPath('userData');
  context = await AppContext.create({ userDataDir, databasePath: join(userDataDir, 'fleet.sqlite') });
  context.start();

  const settings = context.getSettings();
  api = new ApiServer(context, new ApiAuth(context.getApiToken()));
  if (settings.apiEnabled) {
    try {
      await api.start({ host: settings.apiHost, port: settings.apiPort });
    } catch (error) {
      // A busy port must not stop the desktop app from working.
      context.emitEvent('SYSTEM', `API failed to start: ${(error as Error).message}`);
    }
  }

  registerIpc(context, api, () => window);

  // Forward every persisted event to the renderer.
  unsubscribe = context.bus.subscribe((event) => {
    window?.webContents.send('fleet:event', event);
    api?.broadcast({ type: event.type, message: event.message, payload: event.payload });
  });

  await createWindow();
}

app.whenReady().then(() => {
  void bootstrap().catch((error) => {
    // Surface fatal startup errors to the console; the window may not exist yet.
    // eslint-disable-next-line no-console
    console.error('Fleet Manager failed to start:', error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  unsubscribe?.();
  void context?.shutdown();
  void api?.stop();
});
