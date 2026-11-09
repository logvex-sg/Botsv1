/**
 * Fleet: the host-controlled worker network.
 *
 * This is the V2 surface. The Host application (this app) is the single point of control; each
 * Worker is a Minecraft client running the logvex-worker mod. The tabs here are the whole feature:
 * a live dashboard, the roster with per-worker controls, groups, task dispatch, fleet-wide item
 * counts, an audited command log and equipment regear presets.
 */
import { useState } from 'react';
import { FleetDashboardTab } from './workers/FleetDashboardTab';
import { WorkersTab } from './workers/WorkersTab';
import { GroupsTab } from './workers/GroupsTab';
import { TasksTab } from './workers/TasksTab';
import { InventoryTab } from './workers/InventoryTab';
import { CommandsTab } from './workers/CommandsTab';
import { RegearTab } from './workers/RegearTab';
import { ConsoleTab } from './workers/ConsoleTab';
import { Callout } from '../components/ui';

interface Props {
  push: (message: string, tone?: string) => void;
}

export type FleetTab = 'dashboard' | 'workers' | 'groups' | 'tasks' | 'inventory' | 'commands' | 'regear' | 'console';

const TABS: { id: FleetTab; label: string; blurb: string }[] = [
  { id: 'dashboard', label: 'Dashboard', blurb: 'Whether the host is reachable, which clients are connected, and what is running right now.' },
  { id: 'workers', label: 'Workers', blurb: 'Every client that has connected, with its live state and the controls that act on it.' },
  { id: 'groups', label: 'Groups', blurb: 'Named sets of clients, so you can address many of them at once.' },
  { id: 'tasks', label: 'Tasks', blurb: 'Send a task to one or many clients and watch the confirmed results come back.' },
  { id: 'inventory', label: 'Inventory', blurb: 'Count items across the fleet from each client’s last reported inventory.' },
  { id: 'commands', label: 'Commands', blurb: 'Send server commands and chat lines through the clients, with an audit log.' },
  { id: 'regear', label: 'Regear', blurb: 'Loadout presets, and the difference between what a client should carry and what it has.' },
  { id: 'console', label: 'Console', blurb: 'What each client says about its own connection, and which tasks it supports.' },
];

/** Reads the initial tab from ?fleet=<id>, so deep links and the screenshot script can target one. */
function initialTab(): FleetTab {
  if (typeof window === 'undefined') return 'dashboard';
  const requested = new URLSearchParams(window.location.search).get('fleet');
  if (requested && TABS.some((t) => t.id === requested)) return requested as FleetTab;
  return 'dashboard';
}

export function FleetPage({ push }: Props) {
  const [tab, setTab] = useState<FleetTab>(initialTab);
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <Callout tone="info" title={active.label}>{active.blurb}</Callout>

      {tab === 'dashboard' && <FleetDashboardTab push={push} onOpenTab={(next) => setTab(next)} />}
      {tab === 'workers' && <WorkersTab push={push} />}
      {tab === 'groups' && <GroupsTab push={push} />}
      {tab === 'tasks' && <TasksTab push={push} />}
      {tab === 'inventory' && <InventoryTab push={push} />}
      {tab === 'commands' && <CommandsTab push={push} />}
      {tab === 'regear' && <RegearTab push={push} />}
      {tab === 'console' && <ConsoleTab push={push} />}
    </div>
  );
}
