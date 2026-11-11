/**
 * Restocking, crafting planning, world maintenance and portal management plugins.
 */

import { countIn } from '../../core/engine/inventory-engine';
import { evaluateRules, findSources, planRestock } from '../../core/engine/restock-engine';
import { maintenanceDue } from '../../core/engine/structure-registry';
import { isFoodish } from '../../core/engine/inventory-engine';
import type { ItemStack } from '../../core/types';
import type { Plugin } from '../plugin';

/** Tops up carried items that have fallen below their restock minimum. */
export const restockingPlugin: Plugin = {
  id: 'restocking',
  name: 'Restocking',
  description: 'Withdraws configured items from storage when the worker runs low.',
  dependsOn: ['inventory-manager'],
  mutating: true,
  intervalMs: 45_000,
  async tick(context) {
    const rules = context.registries.restockRules.list();
    if (rules.length === 0) return;
    const carried = context.inventory.carried();
    const needs = evaluateRules(rules, carried);
    if (needs.length === 0) return;

    const containers = context.registries.containers.list();
    const contents = new Map<string, ItemStack[]>();
    for (const container of containers) {
      if (container.lastSeenAt && context.now() - container.lastSeenAt < 5 * 60_000) contents.set(container.id, []);
    }

    for (const need of needs) {
      const rule = rules.find((candidate) => candidate.id === need.ruleId);
      const sources = findSources(
        need,
        containers,
        contents,
        (container) => {
          const position = context.position();
          if (!position) return Number.MAX_SAFE_INTEGER;
          const dx = position.x - container.position.x;
          const dy = position.y - container.position.y;
          const dz = position.z - container.position.z;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        },
        rule,
      );
      const plan = planRestock(need, sources, (id) => context.registries.containerById(id));
      if (plan.steps.length === 0) {
        context.emit('restock.unsourced', { query: need.query, reason: plan.reason });
        continue;
      }
      const result = await context.executeTask('restock', { query: need.query, limit: plan.planned });
      context.emit(result.ok ? 'restock.done' : 'restock.failed', { query: need.query, message: result.message });
    }
  },
  status() {
    return 'watching restock rules';
  },
};

/**
 * Plans crafting.
 *
 * Crafting is deliberately not automated: the plugin reports what *could* be crafted from the
 * inventory so a human or a host policy decides. Automating crafting without a recipe graph the
 * worker has verified is exactly the kind of guess this system avoids.
 */
export const craftingPlugin: Plugin = {
  id: 'crafting',
  name: 'Crafting Planner',
  description: 'Reports craftable items from the current inventory. Does not craft automatically.',
  dependsOn: ['inventory-manager'],
  mutating: false,
  intervalMs: 60_000,
  async tick(context) {
    const carried = context.inventory.carried();
    if (carried.length === 0) return;
    // Report only the raw counts; a real recipe graph would be added here if the worker is given one.
    context.emit('crafting.inventory', { stacks: carried.length });
  },
  status() {
    return 'reporting craftable items';
  },
};

/** Runs a maintenance pass over structures whose interval has elapsed. */
export const worldMaintenancePlugin: Plugin = {
  id: 'world-maintenance',
  name: 'World Maintenance',
  description: 'Reports and maintains registered structures that are due for attention.',
  dependsOn: [],
  mutating: true,
  intervalMs: 120_000,
  async tick(context) {
    const structures = context.registries.structures.list();
    if (structures.length === 0) return;
    const due = maintenanceDue(structures, context.now());
    if (due.length === 0) return;

    for (const structure of due) {
      context.emit('maintenance.due', {
        structureId: structure.id,
        name: structure.name,
        protected: structure.protected,
      });
      // A protected structure is reported and left alone.
      if (structure.protected) continue;
      const result = await context.executeTask('status', {});
      if (result.ok) await context.registries.noteMaintenance(structure.id);
    }
  },
  status() {
    return 'watching structure maintenance';
  },
};

/** Tracks portals and reports them; never removes one automatically. */
export const portalManagerPlugin: Plugin = {
  id: 'portal-manager',
  name: 'Portal Manager',
  description: 'Registers and reports portals. Removal always requires a manual confirmation.',
  dependsOn: [],
  mutating: false,
  intervalMs: 90_000,
  async tick(context) {
    const portals = context.registries.portals.list();
    if (portals.length === 0) return;
    const position = context.position();
    const unconfirmed = portals.filter((portal) => !portal.confirmed);
    if (unconfirmed.length > 0) {
      context.emit('portal.unconfirmed', { count: unconfirmed.length });
    }
    const result = await context.executeTask('portal-scan', { action: 'scan', radius: 32 });
    if (result.ok && position) {
      context.emit('portal.scanned', { message: result.message });
    }
  },
  status() {
    return 'tracking portals';
  },
};

/** Reports when food runs low; eats nothing automatically. */
export const monitoringFood = (items: readonly ItemStack[]): number => items.filter(isFoodish).reduce((sum, item) => sum + item.count, 0);

export { countIn };
