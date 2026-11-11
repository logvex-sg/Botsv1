/**
 * Storage plugins: sorting, shulker management and inventory hygiene.
 *
 * Each plugin is a scheduler. On its tick it decides whether there is work, and if so asks the
 * worker's executor to do it — so the permission gate and the post-mutation verification apply to
 * plugin-initiated work exactly as they do to a host-issued task.
 */

import { unsortableItems } from '../../core/engine/storage-engine';
import { capacityOf, suggestOrganisation, surplusEmptyShulkers } from '../../core/engine/shulker-engine';
import type { Plugin } from '../plugin';

/**
 * Sorts loose items into their categories' containers.
 *
 * It only acts when there is something to sort; otherwise it reports and does nothing, so an idle
 * worker stays idle instead of shuffling items.
 */
export const smartStoragePlugin: Plugin = {
  id: 'smart-storage',
  name: 'Smart Storage',
  description: 'Sorts loose carried items into the containers their categories belong to.',
  dependsOn: ['inventory-manager'],
  mutating: true,
  intervalMs: 20_000,
  async tick(context) {
    if (context.registries.containers.size === 0) return;
    const categories = context.registries.categories.list();
    const carried = context.inventory.carried();
    if (carried.length === 0) return;

    const unsortable = unsortableItems(carried, categories);
    if (unsortable.length === carried.length) {
      context.emit('storage.nothing-to-sort', { reason: 'no carried item matches a known category' });
      return;
    }

    const network = context.registries.networks.list()[0];
    if (network?.paused) {
      context.emit('storage.network-paused', { networkId: network.id });
      return;
    }

    const result = await context.executeTask('restock', { query: unsortable[0]?.id ?? carried[0]!.id, limit: 64 });
    context.emit(result.ok ? 'storage.sorted' : 'storage.sort-failed', { message: result.message });
  },
  status() {
    return 'watching for loose items';
  },
};

/** Fills shulker boxes with matching items and reserves the empty ones. */
export const shulkerManagerPlugin: Plugin = {
  id: 'shulker-manager',
  name: 'Shulker Manager',
  description: 'Inspects carried shulker boxes, unpacks partial ones and keeps a reserve of empties.',
  dependsOn: ['inventory-manager'],
  mutating: true,
  intervalMs: 30_000,
  async tick(context) {
    const categories = context.registries.categories.list();
    const records = context.shulkers.inspect();
    if (records.length === 0) return;

    const freeSlots = context.inventory.freeSlots();
    const suggestions = suggestOrganisation(records, categories, 2, freeSlots);
    const capacity = capacityOf(records);

    if (capacity.opaque > 0) {
      context.emit('shulker.opaque', { count: capacity.opaque, reason: 'contents could not be read' });
    }

    // Only unpack when the box is safe to unpack; the executor re-checks this, but deciding here
    // avoids issuing a task that is certain to be refused.
    const unpack = suggestions.find((suggestion) => suggestion.kind === 'unpack');
    if (unpack) {
      const result = await context.executeTask('shulker-unpack', { slot: unpack.slot });
      if (result.ok) context.emit('shulker.unpacked', { slot: unpack.slot, message: result.message });
    }

    const surplus = surplusEmptyShulkers(records, 2);
    if (surplus.length > 0) {
      context.emit('shulker.surplus', { count: surplus.length, slots: surplus.map((record) => record.slot) });
    }
  },
  status() {
    return 'monitoring shulker boxes';
  },
};

/** Keeps the inventory tidy: reports what is unsorted and what could be disposed of. */
export const inventoryManagerPlugin: Plugin = {
  id: 'inventory-manager',
  name: 'Inventory Manager',
  description: 'Reports inventory pressure, unsorted items and disposal candidates. Never discards valuables.',
  dependsOn: [],
  mutating: false,
  intervalMs: 15_000,
  async tick(context) {
    const carried = context.inventory.carried();
    const categories = context.registries.categories.list();
    const freeSlots = context.inventory.freeSlots();
    const unsortable = unsortableItems(carried, categories);

    if (freeSlots <= 2) {
      context.emit('inventory.pressure', { freeSlots, stacks: carried.length });
    }
    if (unsortable.length > 0) {
      context.emit('inventory.unsorted', { count: unsortable.length, ids: [...new Set(unsortable.map((item) => item.id))].slice(0, 8) });
    }
  },
  status() {
    return 'watching inventory pressure';
  },
};

/** Moves items between containers along configured routes. */
export const itemLogisticsPlugin: Plugin = {
  id: 'item-logistics',
  name: 'Item Logistics',
  description: 'Runs configured container-to-container transfer routes.',
  dependsOn: ['inventory-manager'],
  mutating: true,
  intervalMs: 25_000,
  async tick(context) {
    const routes = context.registries.routes.list().filter((route) => route.enabled);
    if (routes.length === 0) return;
    for (const route of routes) {
      const source = context.registries.containerById(route.fromContainerId);
      const destination = context.registries.containerById(route.toContainerId);
      if (!source || !destination) {
        context.emit('logistics.dangling-route', { routeId: route.id, reason: 'an endpoint is no longer registered' });
        continue;
      }
      const result = await context.executeTask('container-move', {
        direction: 'withdraw',
        query: route.query,
        limit: route.batchSize,
        x: source.position.x,
        y: source.position.y,
        z: source.position.z,
      });
      if (result.ok) {
        context.emit('logistics.moved', { routeId: route.id, message: result.message });
      }
    }
  },
  status() {
    return 'running transfer routes';
  },
};
