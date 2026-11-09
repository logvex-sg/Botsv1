/**
 * Application shell.
 *
 * Owns the sidebar navigation, the top bar and the active page. Navigation is deliberately small
 * (seven sections) so a new user can see everything at a glance. Old page ids are accepted as
 * aliases so existing deep links (?page=overview) and the screenshot script keep working.
 *
 * The shell also applies the saved theme and exposes the Beginner/Advanced mode switch.
 */
import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { fleet } from './lib/api';
import { Button, ConfirmDialog, Dot, Segmented, ToastStack, useToasts } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { FeaturesPage } from './pages/FeaturesPage';
import type { FeatureTab } from './pages/FeaturesPage';
import { TasksPage } from './pages/TasksPage';
import { AccountsPage } from './pages/AccountsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import type { UiMode } from '../shared/types';

export type PageId =
  | 'dashboard' | 'features' | 'tasks' | 'accounts' | 'activity' | 'settings' | 'help';

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'features', label: 'Main Features', icon: '◈' },
  { id: 'tasks', label: 'Tasks', icon: '▤' },
  { id: 'accounts', label: 'Accounts', icon: '◐' },
  { id: 'activity', label: 'Activity', icon: '⚡' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
  { id: 'help', label: 'Help', icon: '?' },
];

const TITLES: Record<PageId, string> = {
  dashboard: 'Dashboard',
  features: 'Main Features',
  tasks: 'Tasks',
  accounts: 'Accounts & Profiles',
  activity: 'Activity',
  settings: 'Settings',
  help: 'Help',
};

const PAGE_IDS: PageId[] = ['dashboard', 'features', 'tasks', 'accounts', 'activity', 'settings', 'help'];

/** Old ids from earlier versions map onto the new simplified sections. */
const ALIASES: Record<string, PageId> = {
  overview: 'dashboard',
  deployment: 'tasks',
  instances: 'tasks',
  gearer: 'features',
  stasis: 'features',
  hunter: 'features',
  targets: 'features',
  servers: 'features',
  events: 'activity',
  logs: 'activity',
  configuration: 'settings',
};

/** Reads the initial page from ?page=<id>, so deep links and the screenshot script can target one. */
function initialPage(): PageId {
  if (typeof window === 'undefined') return 'dashboard';
  const requested = new URLSearchParams(window.location.search).get('page');
  if (!requested) return 'dashboard';
  if (PAGE_IDS.includes(requested as PageId)) return requested as PageId;
  return ALIASES[requested] ?? 'dashboard';
}

function Shell() {
  const [page, setPage] = useState<PageId>(initialPage);
  const [featureTab, setFeatureTab] = useState<FeatureTab>('hunter');
  const [confirmStop, setConfirmStop] = useState(false);
  const store = useStore();
  const { toasts, push } = useToasts();

  const navigate = (next: PageId, tab?: FeatureTab): void => {
    if (tab) setFeatureTab(tab);
    setPage(next);
  };

  const unread = store.notifications.filter((n) => !n.read).length;
  const uiMode: UiMode = store.settings?.uiMode ?? 'beginner';
  const theme = store.settings?.theme ?? 'dark';

  // Apply the saved theme to the document so the CSS variables switch.
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

  const running = store.instances.filter((i) => i.state === 'RUNNING').length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Logvex Fleet Manager</h1>
          <div className="sub">Bot Command Center</div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
              title={item.label}
            >
              <span className="icon">{item.icon}</span>
              <span className="label">{item.label}</span>
              {item.id === 'activity' && unread > 0 && <span className="nav-badge">{unread}</span>}
            </button>
          ))}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <Button
            variant="danger"
            onClick={() => setConfirmStop(true)}
            disabled={store.instances.length === 0}
            title="Stop every running bot immediately"
          >
            ⏹ Stop everything
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h2>{TITLES[page]}</h2>
          <div className="spacer" />
          <div className="row" style={{ gap: 14, fontSize: 12, color: 'var(--text-dim)' }}>
            <span className="row" style={{ gap: 6 }} title="Logvex Hunter addon link">
              <Dot state={store.hunterConnected ? 'ONLINE' : 'OFFLINE'} />
              Hunter {store.hunterConnected ? 'linked' : 'offline'}
            </span>
            <span className="row" style={{ gap: 6 }} title="Number of bots running">
              <Dot state={running > 0 ? 'ONLINE' : 'OFFLINE'} />
              {running}/{store.instances.length} running
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
          {store.error && (
            <div className="card" style={{ borderColor: 'var(--error)', marginBottom: 16 }}>
              <div className="card-title" style={{ color: 'var(--error)' }}>The backend reported a problem</div>
              <div className="card-sub">{store.error}</div>
            </div>
          )}
          {!store.ready && <div className="empty">Starting up…</div>}
          {store.ready && page === 'dashboard' && <DashboardPage onNavigate={navigate} push={push} />}
          {store.ready && page === 'features' && <FeaturesPage push={push} uiMode={uiMode} initialTab={featureTab} />}
          {store.ready && page === 'tasks' && <TasksPage push={push} uiMode={uiMode} />}
          {store.ready && page === 'accounts' && <AccountsPage push={push} />}
          {store.ready && page === 'activity' && <ActivityPage push={push} />}
          {store.ready && page === 'settings' && <SettingsPage push={push} uiMode={uiMode} />}
          {store.ready && page === 'help' && <HelpPage onNavigate={navigate} />}
        </main>
      </div>

      {confirmStop && (
        <ConfirmDialog
          title="Stop everything?"
          danger
          confirmLabel="Stop all bots"
          message="This immediately disconnects every running bot and cancels any active deployment. You can start them again afterwards."
          onCancel={() => setConfirmStop(false)}
          onConfirm={async () => {
            setConfirmStop(false);
            await store.emergencyStop();
            push('All bots stopped', 'error');
          }}
        />
      )}

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
