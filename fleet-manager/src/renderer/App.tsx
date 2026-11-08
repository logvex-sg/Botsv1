/**
 * Application shell.
 *
 * Owns the sidebar navigation and renders the active page. Global chrome (top bar, emergency stop,
 * notification count, toasts) lives here so every page shares it.
 */
import { useState } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { Button, Dot, ToastStack, useToasts } from './components/ui';
import { OverviewPage } from './pages/OverviewPage';
import { AccountsPage } from './pages/AccountsPage';
import { GearerPage } from './pages/GearerPage';
import { StasisPage } from './pages/StasisPage';
import { HunterPage } from './pages/HunterPage';
import { InstancesPage } from './pages/InstancesPage';
import { DeploymentPage } from './pages/DeploymentPage';
import { TargetsPage } from './pages/TargetsPage';
import { EventsPage } from './pages/EventsPage';
import { ServersPage } from './pages/ServersPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogsPage } from './pages/LogsPage';

export type PageId =
  | 'overview' | 'accounts' | 'gearer' | 'stasis' | 'hunter' | 'instances'
  | 'deployment' | 'targets' | 'events' | 'servers' | 'settings' | 'logs';

const NAV: { section: string; items: { id: PageId; label: string; icon: string }[] }[] = [
  {
    section: 'Command Center',
    items: [
      { id: 'overview', label: 'Overview', icon: '◉' },
      { id: 'deployment', label: 'Deployment Center', icon: '▤' },
      { id: 'instances', label: 'Instance Manager', icon: '▦' },
      { id: 'accounts', label: 'Account Manager', icon: '◐' },
    ],
  },
  {
    section: 'Bot Roles',
    items: [
      { id: 'gearer', label: 'Gearer Manager', icon: '◈' },
      { id: 'stasis', label: 'Stasis Manager', icon: '◆' },
      { id: 'hunter', label: 'Hunter Manager', icon: '◎' },
    ],
  },
  {
    section: 'Data',
    items: [
      { id: 'targets', label: 'Target Database', icon: '✧' },
      { id: 'events', label: 'Event Center', icon: '⚡' },
      { id: 'servers', label: 'Server Profiles', icon: '⬡' },
    ],
  },
  {
    section: 'System',
    items: [
      { id: 'settings', label: 'Configuration', icon: '⚙' },
      { id: 'logs', label: 'Logs & Statistics', icon: '▤' },
    ],
  },
];

const TITLES: Record<PageId, string> = {
  overview: 'Overview',
  accounts: 'Account Manager',
  gearer: 'Gearer Manager',
  stasis: 'Stasis Manager',
  hunter: 'Hunter Manager',
  instances: 'Instance Manager',
  deployment: 'Deployment Center',
  targets: 'Target Database',
  events: 'Event Center',
  servers: 'Server Profiles',
  settings: 'Configuration',
  logs: 'Logs & Statistics',
};

const PAGE_IDS: PageId[] = [
  'overview', 'accounts', 'gearer', 'stasis', 'hunter', 'instances',
  'deployment', 'targets', 'events', 'servers', 'settings', 'logs',
];

/** Reads the initial page from ?page=<id>, so deep links and the screenshot script can target one. */
function initialPage(): PageId {
  if (typeof window === 'undefined') return 'overview';
  const requested = new URLSearchParams(window.location.search).get('page') as PageId | null;
  return requested && PAGE_IDS.includes(requested) ? requested : 'overview';
}

function Shell() {
  const [page, setPage] = useState<PageId>(initialPage);
  const store = useStore();
  const { toasts, push } = useToasts();

  const unread = store.notifications.filter((n) => !n.read).length;

  const handleEmergency = async (): Promise<void> => {
    await store.emergencyStop();
    push('Emergency stop engaged — all instances halted', 'error');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Logvex Fleet Manager</h1>
          <div className="sub">Bot Command Center</div>
        </div>
        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.section}>
              <div className="nav-section">{section.section}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => setPage(item.id)}
                >
                  <span className="icon">{item.icon}</span>
                  {item.label}
                  {item.id === 'events' && unread > 0 && <span className="nav-badge">{unread}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <Button variant="danger" onClick={handleEmergency} disabled={store.instances.length === 0}>
            ⏹ Emergency Stop
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h2>{TITLES[page]}</h2>
          <div className="spacer" />
          <div className="row" style={{ gap: 14, fontSize: 12, color: 'var(--text-dim)' }}>
            <span className="row" style={{ gap: 6 }}>
              <Dot state={store.hunterConnected ? 'ONLINE' : 'OFFLINE'} />
              Hunter {store.hunterConnected ? 'linked' : 'offline'}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Dot state={store.health?.database.ok ? 'ONLINE' : 'ERROR'} />
              DB {store.health?.database.ok ? 'ok' : 'error'}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Dot state={store.instances.some((i) => i.state === 'RUNNING') ? 'ONLINE' : 'OFFLINE'} />
              {store.instances.filter((i) => i.state === 'RUNNING').length}/{store.instances.length} running
            </span>
          </div>
        </header>

        <main className="content">
          {store.error && (
            <div className="card" style={{ borderColor: 'var(--error)', marginBottom: 16 }}>
              <div className="card-title" style={{ color: 'var(--error)' }}>Backend error</div>
              <div className="card-sub">{store.error}</div>
            </div>
          )}
          {page === 'overview' && <OverviewPage onNavigate={setPage} />}
          {page === 'accounts' && <AccountsPage push={push} />}
          {page === 'gearer' && <GearerPage push={push} />}
          {page === 'stasis' && <StasisPage push={push} />}
          {page === 'hunter' && <HunterPage push={push} />}
          {page === 'instances' && <InstancesPage push={push} />}
          {page === 'deployment' && <DeploymentPage push={push} />}
          {page === 'targets' && <TargetsPage push={push} />}
          {page === 'events' && <EventsPage push={push} />}
          {page === 'servers' && <ServersPage push={push} />}
          {page === 'settings' && <SettingsPage push={push} />}
          {page === 'logs' && <LogsPage />}
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
