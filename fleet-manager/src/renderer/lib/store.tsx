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
  HealthReport, InstanceRecord, NotificationItem, ServerProfile, SetupReport, StasisLocation, TargetEntry,
  RegearPreset, WorkerGroup, WorkerOverview, WorkerTaskRecord, WorkerView,
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
  setup: SetupReport | null;
  workers: WorkerView[];
  workerGroups: WorkerGroup[];
  workerOverview: WorkerOverview | null;
  workerTasks: WorkerTaskRecord[];
  regearPresets: RegearPreset[];
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
  setup: null,
  workers: [],
  workerGroups: [],
  workerOverview: null,
  workerTasks: [],
  regearPresets: [],
};

interface StoreValue extends AppState {
  refresh: () => Promise<void>;
  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshTargets: () => Promise<void>;
  refreshDeployments: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshSetup: () => Promise<void>;
  refreshWorkers: () => Promise<void>;
  refreshWorkerTasks: () => Promise<void>;
  refreshRegearPresets: () => Promise<void>;
  emergencyStop: () => Promise<void>;
  clearEmergency: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [health, settings, accounts, servers, groups, instances, targets, stasis, equipment, deployments, events, notifications, hunter, setup] =
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
          fleet.getSetupReport().catch(() => null),
        ]);
      // Workers are loaded separately so a worker-server problem cannot block the whole app.
      const [workers, workerGroups, workerOverview, workerTasks, regearPresets] = await Promise.all([
        fleet.listWorkers().catch(() => []),
        fleet.listWorkerGroups().catch(() => []),
        fleet.getWorkerOverview().catch(() => null),
        fleet.listWorkerTasks(100).catch(() => []),
        fleet.listRegearPresets().catch(() => []),
      ]);
      if (!mounted.current) return;
      setState({
        ready: true, error: null, health, settings, accounts, servers, groups, instances,
        targets, stasis, equipment, deployments, events, notifications, hunterConnected: hunter.connected,
        setup, workers, workerGroups, workerOverview, workerTasks, regearPresets,
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

  const refreshSetup = useCallback(async () => {
    const setup = await fleet.getSetupReport().catch(() => null);
    if (mounted.current) setState((prev) => ({ ...prev, setup }));
  }, []);

  const refreshWorkers = useCallback(async () => {
    const [workers, workerGroups, workerOverview] = await Promise.all([
      fleet.listWorkers().catch(() => []),
      fleet.listWorkerGroups().catch(() => []),
      fleet.getWorkerOverview().catch(() => null),
    ]);
    if (mounted.current) setState((prev) => ({ ...prev, workers, workerGroups, workerOverview }));
  }, []);

  const refreshWorkerTasks = useCallback(async () => {
    const workerTasks = await fleet.listWorkerTasks(100).catch(() => []);
    if (mounted.current) setState((prev) => ({ ...prev, workerTasks }));
  }, []);

  const refreshRegearPresets = useCallback(async () => {
    const regearPresets = await fleet.listRegearPresets().catch(() => []);
    if (mounted.current) setState((prev) => ({ ...prev, regearPresets }));
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
      // Worker events arrive at heartbeat cadence; a refresh here keeps the roster live without
      // the renderer having to poll the main process on a timer.
      if ((event as FleetEvent).type.startsWith('WORKER_')) {
        void Promise.all([
          fleet.listWorkers().catch(() => []),
          fleet.listWorkerGroups().catch(() => []),
          fleet.getWorkerOverview().catch(() => null),
          fleet.listWorkerTasks(100).catch(() => []),
        ]).then(([workers, workerGroups, workerOverview, workerTasks]) => {
          if (mounted.current) setState((prev) => ({ ...prev, workers, workerGroups, workerOverview, workerTasks }));
        });
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
    () => ({
      ...state, refresh, refreshInstances, refreshAccounts, refreshTargets, refreshDeployments,
      refreshEvents, refreshSetup, refreshWorkers, refreshWorkerTasks, refreshRegearPresets,
      emergencyStop, clearEmergency,
    }),
    [state, refresh, refreshInstances, refreshAccounts, refreshTargets, refreshDeployments,
      refreshEvents, refreshSetup, refreshWorkers, refreshWorkerTasks, refreshRegearPresets,
      emergencyStop, clearEmergency],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
