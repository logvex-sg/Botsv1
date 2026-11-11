/**
 * Application store.
 *
 * A single React context that loads the worker roster and its supporting collections once, exposes
 * refreshers, and subscribes to live events from the main process. Pages read from this store
 * rather than each calling IPC individually, so the UI stays consistent and refreshes are cheap.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fleet } from './api';
import type {
  AppSettings, FleetEvent, HealthReport, NotificationItem, PairingCode, PairingStatus, RegearPreset,
  WorkerGroup, WorkerOverview, WorkerTaskRecord, WorkerView,
} from '../../shared/types';
import type { WorkerServerStatus } from '../../shared/ipc';

export interface AppState {
  ready: boolean;
  error: string | null;
  health: HealthReport | null;
  settings: AppSettings | null;
  events: FleetEvent[];
  notifications: NotificationItem[];
  workers: WorkerView[];
  workerGroups: WorkerGroup[];
  workerOverview: WorkerOverview | null;
  workerTasks: WorkerTaskRecord[];
  regearPresets: RegearPreset[];
  workerServer: WorkerServerStatus | null;
  pairingCode: PairingCode | null;
  /** The whole pairing panel state: active code, its remaining life and every paired worker. */
  pairingStatus: PairingStatus | null;
}

const initialState: AppState = {
  ready: false,
  error: null,
  health: null,
  settings: null,
  events: [],
  notifications: [],
  workers: [],
  workerGroups: [],
  workerOverview: null,
  workerTasks: [],
  regearPresets: [],
  workerServer: null,
  pairingCode: null,
  pairingStatus: null,
};

interface StoreValue extends AppState {
  refresh: () => Promise<void>;
  refreshWorkers: () => Promise<void>;
  refreshWorkerTasks: () => Promise<void>;
  refreshRegearPresets: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  refreshServer: () => Promise<void>;
  refreshPairing: () => Promise<void>;
  setPairingCode: (code: PairingCode | null) => void;
}

type WorkerCollections = Pick<AppState, 'workers' | 'workerGroups' | 'workerOverview' | 'workerTasks' | 'regearPresets'>;

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const mounted = useRef(true);

  const loadWorkers = useCallback(async (): Promise<WorkerCollections> => {
    const [workers, workerGroups, workerOverview, workerTasks, regearPresets] = await Promise.all([
      fleet.listWorkers().catch(() => []),
      fleet.listWorkerGroups().catch(() => []),
      fleet.getWorkerOverview().catch(() => null),
      fleet.listWorkerTasks(100).catch(() => []),
      fleet.listRegearPresets().catch(() => []),
    ]);
    return { workers, workerGroups, workerOverview, workerTasks, regearPresets };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [health, settings, events, notifications, workerServer, pairingStatus, workersPart] = await Promise.all([
        fleet.getHealth(),
        fleet.getSettings(),
        fleet.listEvents(200),
        fleet.listNotifications(),
        fleet.getWorkerServer().catch(() => null),
        fleet.getPairingStatus().catch(() => null),
        loadWorkers(),
      ]);
      if (!mounted.current) return;
      setState({
        ready: true, error: null, health, settings, events, notifications, workerServer,
        pairingStatus, pairingCode: pairingStatus?.code ?? null, ...workersPart,
      });
    } catch (error) {
      if (!mounted.current) return;
      setState((prev) => ({ ...prev, ready: true, error: (error as Error).message }));
    }
  }, [loadWorkers]);

  const refreshWorkers = useCallback(async () => {
    const part = await loadWorkers();
    if (mounted.current) setState((prev) => ({ ...prev, ...part }));
  }, [loadWorkers]);

  const refreshWorkerTasks = useCallback(async () => {
    const workerTasks = await fleet.listWorkerTasks(100).catch(() => []);
    if (mounted.current) setState((prev) => ({ ...prev, workerTasks }));
  }, []);

  const refreshRegearPresets = useCallback(async () => {
    const regearPresets = await fleet.listRegearPresets().catch(() => []);
    if (mounted.current) setState((prev) => ({ ...prev, regearPresets }));
  }, []);

  const refreshEvents = useCallback(async () => {
    const [events, notifications] = await Promise.all([fleet.listEvents(200), fleet.listNotifications()]);
    if (mounted.current) setState((prev) => ({ ...prev, events, notifications }));
  }, []);

  const refreshServer = useCallback(async () => {
    const [workerServer, pairingStatus] = await Promise.all([
      fleet.getWorkerServer().catch(() => null),
      fleet.getPairingStatus().catch(() => null),
    ]);
    if (mounted.current) setState((prev) => ({ ...prev, workerServer, pairingStatus, pairingCode: pairingStatus?.code ?? null }));
  }, []);

  const refreshPairing = useCallback(async () => {
    const pairingStatus = await fleet.getPairingStatus().catch(() => null);
    if (mounted.current) setState((prev) => ({ ...prev, pairingStatus, pairingCode: pairingStatus?.code ?? null }));
  }, []);

  const setPairingCode = useCallback((code: PairingCode | null) => {
    setState((prev) => ({ ...prev, pairingCode: code }));
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = fleet.onEvent((event) => {
      if (!mounted.current) return;
      const typed = event as FleetEvent;
      setState((prev) => ({ ...prev, events: [typed, ...prev.events].slice(0, 200) }));
      // Worker events arrive at heartbeat cadence; refreshing here keeps the roster live without a
      // renderer-side poll on a timer.
      if (typed.type.startsWith('WORKER_')) {
        void loadWorkers().then((part) => {
          if (mounted.current) setState((prev) => ({ ...prev, ...part }));
        });
      }
      if (typed.type === 'WORKER_REGISTERED' || typed.type === 'WORKER_DISCONNECTED' || typed.type === 'WORKER_PAIRED') {
        void fleet.getWorkerServer().then((workerServer) => {
          if (mounted.current) setState((prev) => ({ ...prev, workerServer }));
        });
        void fleet.getPairingStatus().then((pairingStatus) => {
          if (mounted.current) setState((prev) => ({ ...prev, pairingStatus, pairingCode: pairingStatus?.code ?? null }));
        });
      }
    });

    return () => {
      mounted.current = false;
      off();
    };
  }, [refresh, loadWorkers]);

  const value = useMemo<StoreValue>(
    () => ({
      ...state, refresh, refreshWorkers, refreshWorkerTasks, refreshRegearPresets, refreshEvents, refreshServer, refreshPairing, setPairingCode,
    }),
    [state, refresh, refreshWorkers, refreshWorkerTasks, refreshRegearPresets, refreshEvents, refreshServer, refreshPairing, setPairingCode],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
