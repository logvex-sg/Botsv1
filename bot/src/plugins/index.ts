/**
 * The built-in plugin set.
 *
 * Eleven plugins covering the automation the worker actually performs. Each declares what it needs
 * so the registry can refuse to start a plugin whose dependency is off, rather than starting it into
 * a broken state.
 */

import type { Plugin } from './plugin';
import { inventoryManagerPlugin, itemLogisticsPlugin, shulkerManagerPlugin, smartStoragePlugin } from './builtin/storage-plugins';
import { craftingPlugin, portalManagerPlugin, restockingPlugin, worldMaintenancePlugin } from './builtin/service-plugins';
import { aiControllerPlugin, monitoringPlugin, navigationPlugin } from './builtin/ops-plugins';

export const BUILTIN_PLUGINS: readonly Plugin[] = [
  inventoryManagerPlugin,
  smartStoragePlugin,
  shulkerManagerPlugin,
  itemLogisticsPlugin,
  restockingPlugin,
  craftingPlugin,
  worldMaintenancePlugin,
  portalManagerPlugin,
  navigationPlugin,
  aiControllerPlugin,
  monitoringPlugin,
];

export { PluginRegistry } from './plugin';
export type { Plugin, PluginContext, PluginState, PluginRuntimeState } from './plugin';
