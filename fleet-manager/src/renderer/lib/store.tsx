/**
 * Application store.
 *
 * A single React context that loads every collection once, exposes refreshers and subscribes to
 * live events from the main process. Pages read from this store rather than each calling IPC
 * individually, so the UI stays consistent and refreshes are cheap.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fleet } from './api';
import type {
  Account, AppSettings, DeploymentConfig, EquipmentProfileRecord, FleetEvent, Group,
  HealthReport, InstanceRecord, NotificationItem, ServerProfile, StasisLocation, TargetEntry,
} from '../../shared/types';
import type { AccountView } from '../../main/services/accounts/account-manager';
import type { RuntimeInstance } from '../../main/services/instances/instance-manager';

export interface AppState {
  ready: boolean;
  error: string | null;
  health: HealthReport | null;
  settings: AppSettings | null;
  accounts: AccountView[];
  servers: ServerProfile[];
  groups: Group[];
  instances: RuntimeInstance[];
  targets: TargetEntry[];
  stasis: StasisLocation[];
  equipment: EquipmentProfileRecord[];
  deployments: DeploymentConfig[];
  events: FleetEvent[];
  notifications: NotificationItem[];
  hunterConnected: boolean;
}

const initialState: AppState = {
  ready: false,
  error: null,
  health: null,
  settings: null,
  accounts: [],
  servers: [],
  groups: [],
  instances: [],
  targets: [],
  stasis: [],
  equipment: [],
  deployments: [],
  events: [],
  notifications: [],
  hunterConnected: false,
};

interface StoreValue extends AppState {
  refresh: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshTargets: () => Promise<void>;
  refreshDeployments: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  emergencyStop: () => Promise<void>;
  clearEmergency: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [health, settings, accounts, servers, groups, instances, targets, stasis, equipment, deployments, events, notifications, hunter] =
        await Promise.all([
          fleet.getHealth(),
          fleet.getSettings(),
          fleet.listAccounts(),
          fleet.listServers(),
          fleet.listGroups(),
          fleet.listInstances(),
          fleet.listTargets(),
          fleet.listStasis(),
          fleet.listEquipment(),
          fleet.listDeployments(),
          fleet.listEvents(200),
          fleet.listNotifications(),
          fleet.hunterStatus().catch(() => ({ connected: false, url: '', lastSync: null })),
        ]);
      if (!mounted.current) return;
      setState({
        ready: true, error: null, health, settings, accounts, servers, groups, instances,
        targets, stasis, equipment, deployments, events, notifications, hunterConnected: hunter.connected,
      });
    } catch (error) {
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, ready: true, error: (error as Error).message }));
    }
  }, []);

  const refreshInstances = useCallback(async () => {
    const instances = await fleet.listInstances();
    if (mounted.current) setState((prev) => ({ ...prev, instances }));
  }, []);
  const refreshAccounts = useCallback(async () => {
    const accounts = await fleet.listAccounts();
    if (mounted.current) setState((prev) => ({ ...prev, accounts }));
  }, []);
  const refreshTargets = useCallback(async () => {
    const targets = await fleet.listTargets();
    if (mounted.current) setState((prev) => ({ ...prev, targets }));
  }, []);
  const refreshDeployments = useCallback(async () => {
    const deployments = await fleet.listDeployments();
    if (mounted.current) setState((prev) => ({ ...prev, deployments }));
  }, []);
  const refreshEvents = useCallback(async () => {
    const [events, notifications] = await Promise.all([fleet.listEvents(200), fleet.listNotifications()]);
    if (mounted.current) setState((prev) => ({ ...prev, events, notifications }));
  }, []);

  const emergencyStop = useCallback(async () => {
    await fleet.emergencyStop();
    await refreshInstances();
  }, [refreshInstances]);

  const clearEmergency = useCallback(async () => {
    await fleet.clearEmergencyStop();
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = fleet.onEvent((event) => {
      if (!mounted.current) return;
      setState((prev) => ({
        ...prev,
        events: [event as FleetEvent, ...prev.events].slice(0, 200),
      }));
      // Light-touch live refresh for the collections the user is most likely watching.
      if (['INSTANCE_STATE_CHANGED', 'INSTANCE_CONNECTED', 'INSTANCE_DISCONNECTED', 'INSTANCE_ERROR'].includes((event as FleetEvent).type)) {
        void fleet.listInstances().then((instances) => mounted.current && setState((prev) => ({ ...prev, instances })));
      }
      if (['TARGET_DETECTED', 'TARGET_UPDATED', 'TARGET_DISAPPEARED', 'TARGET_REAPPEARED'].includes((event as FleetEvent).type)) {
        void fleet.listTargets().then((targets) => mounted.current && setState((prev) => ({ ...prev, targets })));
      }
    });

    const poll = setInterval(() => {
      void fleet.listInstances().then((instances) => mounted.current && setState((prev) => ({ ...prev, instances })));
      void fleet.listNotifications().then((notifications) => mounted.current && setState((prev) => ({ ...prev, notifications })));
    }, 3000);

    return () => {
      mounted.current = false;
      off();
      clearInterval(poll);
    };
  }, [refresh]);

  const value = useMemo<StoreValue>(
    () => ({ ...state, refresh, refreshInstances, refreshAccounts, refreshTargets, refreshDeployments, refreshEvents, emergencyStop, clearEmergency }),
    [state, refresh, refreshInstances, refreshAccounts, refreshTargets, refreshDeployments, refreshEvents, emergencyStop, clearEmergency],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
