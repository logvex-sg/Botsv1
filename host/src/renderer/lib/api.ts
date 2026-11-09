/**
 * Typed wrapper around the preload bridge.
 *
 * The renderer imports `fleet` from here rather than touching `window` directly, which keeps the
 * call sites type-checked against {@link FleetApi}. In Electron it returns the real bridge; in a
 * plain browser it either serves development demo data (Vite dev server with `?demo`) or a stub
 * that explains the backend is unavailable.
 */
import type { FleetApi } from '../../shared/ipc';

declare global {
  interface Window {
    fleet: FleetApi;
  }
}

function createStub(): FleetApi {
  const notAvailable = async (): Promise<never> => {
    throw new Error('Fleet backend is not available. Run the app through Electron.');
  };
  return new Proxy({} as FleetApi, {
    get(_target, prop) {
      if (prop === 'onEvent') return () => () => {};
      return notAvailable;
    },
  });
}

function useDemo(): boolean {
  if (typeof window === 'undefined') return false;
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('demo');
}

async function resolveApi(): Promise<FleetApi> {
  if (typeof window !== 'undefined' && window.fleet) return window.fleet;
  if (useDemo()) {
    // Loaded dynamically so the demo data is tree-shaken out of production builds.
    const { createDemoApi } = await import('./demo');
    return createDemoApi();
  }
  return createStub();
}

export const fleet: FleetApi = await resolveApi();
