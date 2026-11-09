/**
 * Application shell.
 *
 * Owns the sidebar navigation, the top bar and the active page. The navigation is the whole product:
 * a dashboard, the worker roster, groups, task dispatch, inventory, regear, commands and consoles,
 * plus settings. The first time the app runs it shows the Host/Worker mode chooser instead.
 *
 * Page ids are stable so deep links (?page=workers) and the screenshot script keep working.
 */
import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { fleet } from './lib/api';
import { Button, Dot, Segmented, ToastStack, useToasts } from './components/ui';
import { ModePage } from './pages/ModePage';
import { DashboardPage } from './pages/DashboardPage';
import { WorkersPage } from './pages/WorkersPage';
import { GroupsPage } from './pages/GroupsPage';
import { TasksPage } from './pages/TasksPage';
import { InventoryPage } from './pages/InventoryPage';
import { RegearPage } from './pages/RegearPage';
import { CommandsPage } from './pages/CommandsPage';
import { ConsolesPage } from './pages/ConsolesPage';
import { SettingsPage } from './pages/SettingsPage';
import type { UiMode } from '../shared/types';

export type PageId =
  | 'dashboard' | 'workers' | 'groups' | 'tasks' | 'inventory' | 'regear' | 'commands' | 'consoles' | 'settings';

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'workers', label: 'Workers', icon: '⛭' },
  { id: 'groups', label: 'Groups', icon: '◫' },
  { id: 'tasks', label: 'Tasks', icon: '▤' },
  { id: 'inventory', label: 'Inventory', icon: '▦' },
  { id: 'regear', label: 'Regear', icon: '⛊' },
  { id: 'commands', label: 'Commands', icon: '⌘' },
  { id: 'consoles', label: 'Consoles', icon: '▷' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

const TITLES: Record<PageId, string> = {
  dashboard: 'Dashboard',
  workers: 'Workers',
  groups: 'Groups',
  tasks: 'Tasks',
  inventory: 'Inventory',
  regear: 'Regear',
  commands: 'Commands',
  consoles: 'Consoles',
  settings: 'Settings',
};

const PAGE_IDS: PageId[] = ['dashboard', 'workers', 'groups', 'tasks', 'inventory', 'regear', 'commands', 'consoles', 'settings'];

/** Old ids from earlier versions map onto the new sections. */
const ALIASES: Record<string, PageId> = {
  overview: 'dashboard',
  fleet: 'workers',
  swarm: 'workers',
  features: 'tasks',
  accounts: 'settings',
  activity: 'consoles',
  console: 'consoles',
  help: 'settings',
};

function initialPage(): PageId {
  if (typeof window === 'undefined') return 'dashboard';
  const requested = new URLSearchParams(window.location.search).get('page');
  if (!requested) return 'dashboard';
  if (PAGE_IDS.includes(requested as PageId)) return requested as PageId;
  return ALIASES[requested] ?? 'dashboard';
}

function Shell() {
  const [page, setPage] = useState<PageId>(initialPage);
  const store = useStore();
  const { toasts, push } = useToasts();

  const uiMode: UiMode = store.settings?.uiMode ?? 'beginner';
  const theme = store.settings?.theme ?? 'dark';
  const online = store.workers.filter((w) => w.online).length;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setMode = async (mode: UiMode): Promise<void> => {
    await fleet.saveSettings({ uiMode: mode });
    await store.refresh();
    push(mode === 'beginner' ? 'Beginner mode on — advanced options hidden' : 'Advanced mode on');
  };

  const toggleTheme = async (): Promise<void> => {
    await fleet.saveSettings({ theme: theme === 'dark' ? 'light' : 'dark' });
    await store.refresh();
  };

  if (!store.ready) {
    return <div className="app"><div className="content"><div className="empty">Starting up…</div></div></div>;
  }

  if (store.error || !store.settings) {
    return (
      <div className="app">
        <div className="content">
          <div className="card" style={{ borderColor: 'var(--error)' }}>
            <div className="card-title" style={{ color: 'var(--error)' }}>The host backend reported a problem</div>
            <div className="card-sub">{store.error ?? 'No settings could be loaded.'}</div>
          </div>
        </div>
      </div>
    );
  }

  // First run: choose Host or Worker before anything else.
  if (!store.settings.onboarded) {
    return (
      <>
        <ModePage
          settings={store.settings}
          push={push}
          onMode={async (mode) => { await fleet.saveSettings({ mode }); await store.refresh(); }}
          onDone={async () => { await fleet.saveSettings({ onboarded: true }); await store.refresh(); }}
        />
        <ToastStack toasts={toasts} />
      </>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Logvex Fleet Manager</h1>
          <div className="sub">HOST MODE</div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
              title={item.label}
            >
              <span className="icon">{item.icon}</span>
              <span className="label">{item.label}</span>
              {item.id === 'workers' && online > 0 && <span className="nav-badge">{online}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <Button variant="ghost" small onClick={() => void fleet.saveSettings({ onboarded: false }).then(() => store.refresh())}>
            Switch to Worker mode
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h2>{TITLES[page]}</h2>
          <div className="spacer" />
          <div className="row" style={{ gap: 14, fontSize: 12, color: 'var(--text-dim)' }}>
            <span className="row" style={{ gap: 6 }} title="Worker server listening state">
              <Dot state={store.workerServer?.bound ? 'ONLINE' : 'OFFLINE'} />
              {store.workerServer?.bound ? `Listening :${store.workerServer.port}` : 'Not listening'}
            </span>
            <span className="row" style={{ gap: 6 }} title="Minecraft clients connected to this host">
              <Dot state={online > 0 ? 'ONLINE' : 'OFFLINE'} />
              {online}/{store.workers.length} workers
            </span>
            <Button small variant="ghost" onClick={toggleTheme} title="Switch light/dark theme">
              {theme === 'dark' ? '☀' : '☾'}
            </Button>
            <Segmented<UiMode>
              value={uiMode}
              onChange={(mode) => void setMode(mode)}
              options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]}
            />
          </div>
        </header>

        <main className="content">
          {page === 'dashboard' && <DashboardPage onNavigate={setPage} push={push} />}
          {page === 'workers' && <WorkersPage push={push} />}
          {page === 'groups' && <GroupsPage push={push} />}
          {page === 'tasks' && <TasksPage push={push} />}
          {page === 'inventory' && <InventoryPage push={push} />}
          {page === 'regear' && <RegearPage push={push} />}
          {page === 'commands' && <CommandsPage push={push} />}
          {page === 'consoles' && <ConsolesPage push={push} />}
          {page === 'settings' && <SettingsPage push={push} uiMode={uiMode} />}
        </main>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
