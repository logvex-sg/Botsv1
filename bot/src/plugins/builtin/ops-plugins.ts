/**
 * Navigation, AI-controller and monitoring plugins.
 */

import { describePlan } from '../../ai/interpret';
import { previewPlan } from '../../ai/planner';
import { countFood, freeSlots } from '../../core/engine/inventory-engine';
import type { Plugin } from '../plugin';

/** Walks the worker to a configured waypoint when it drifts too far from it. */
export const navigationPlugin: Plugin = {
  id: 'navigation',
  name: 'Navigation',
  description: 'Keeps the worker near its configured station, walking back when it drifts.',
  dependsOn: [],
  mutating: true,
  intervalMs: 30_000,
  async tick(context) {
    const structures = context.registries.structures.list().filter((structure) => structure.kind === 'storage' && !structure.protected);
    if (structures.length === 0) return;
    const position = context.position();
    if (!position) return;

    const station = structures[0]!;
    const centre = {
      x: Math.floor((station.region.min.x + station.region.max.x) / 2),
      y: station.region.max.y + 1,
      z: Math.floor((station.region.min.z + station.region.max.z) / 2),
    };
    const dx = position.x - centre.x;
    const dy = position.y - centre.y;
    const dz = position.z - centre.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance <= 8) return;
    if (distance > context.config.navigation.maxDistance) {
      context.emit('navigation.too-far', { distance: Math.round(distance), stationId: station.id });
      return;
    }
    const result = await context.executeTask('navigate', { x: centre.x, y: centre.y, z: centre.z, range: 3 });
    context.emit(result.ok ? 'navigation.returned' : 'navigation.failed', { message: result.message, stationId: station.id });
  },
  status() {
    return 'holding station';
  },
};

/**
 * The natural-language controller.
 *
 * This plugin does not accept free text from the network; the host sends an `nl-task` through the
 * executor. Its tick is a no-op beyond reporting readiness, so the planner is exercised only when a
 * real instruction arrives — which keeps a language model out of the hot loop entirely.
 */
export const aiControllerPlugin: Plugin = {
  id: 'ai-controller',
  name: 'AI Controller',
  description: 'Interprets natural-language instructions through the configured provider, with an offline fallback.',
  dependsOn: [],
  mutating: false,
  intervalMs: 300_000,
  async tick(context) {
    const pending = context.registries.containers.size;
    context.emit('ai.ready', { provider: context.config.ai.provider, containers: pending });
  },
  status() {
    return 'ready for instructions';
  },
};

/** Reports health, food, inventory pressure and connection state. */
export const monitoringPlugin: Plugin = {
  id: 'monitoring',
  name: 'Monitoring',
  description: 'Reports health, food, inventory pressure and shulker state to the fleet manager.',
  dependsOn: [],
  mutating: false,
  intervalMs: 10_000,
  async tick(context) {
    const carried = context.inventory.carried();
    const food = countFood(carried);
    const free = freeSlots(carried);
    if (food < 8) context.emit('monitor.low-food', { food });
    if (free <= 1) context.emit('monitor.inventory-full', { freeSlots: free });
    const shulkers = context.shulkers.count();
    if (shulkers === 0) context.emit('monitor.no-shulkers', {});
  },
  status() {
    return 'reporting status';
  },
};

export { describePlan, previewPlan };
