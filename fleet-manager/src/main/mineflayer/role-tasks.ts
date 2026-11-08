/**
 * Role-specific observation logic executed inside the worker.
 *
 * These functions only *observe* and *report*. They never attack, never move the bot and never
 * modify the world; combat for the HUNTER role is delegated to the Meteor addon through the
 * authenticated API, gated by an explicit allow-list. This keeps the fleet safe by construction.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectInventory, collectPlayers, collectPosition, type AnyBot } from './collectors';

export interface RoleEventOut {
  type: string;
  payload: Record<string, unknown>;
}

export interface EquipmentResult {
  ready: boolean;
  payload: Record<string, unknown>;
}

const DEFAULT_WEAPONS = [
  'netherite_sword', 'diamond_sword', 'iron_sword',
  'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_sword', 'wooden_sword',
];

/** Gearer: evaluate whether the equipped armour/weapons/supplies meet the profile. */
export function evaluateEquipment(bot: AnyBot, config: Record<string, unknown>): EquipmentResult {
  const inventory = collectInventory(bot);
  const armor = inventory.armor;
  const weapons = inventory.items.filter((i) => DEFAULT_WEAPONS.includes(i.name)).map((i) => i.name);
  const totems = inventory.items.filter((i) => i.name === 'totem_of_undying').reduce((sum, i) => sum + i.count, 0);
  const food = inventory.items.filter((i) => /apple|bread|cooked|carrot|beef|pork|chicken|mutton|potato/.test(i.name))
    .reduce((sum, i) => sum + i.count, 0);

  const minArmor = Number(config.minArmorPieces ?? 4);
  const minTotems = Number(config.minTotems ?? 1);
  const minFood = Number(config.minFood ?? 4);

  const warnings: string[] = [];
  if (armor.length < minArmor) warnings.push(`Armour ${armor.length}/${minArmor}`);
  if (weapons.length === 0) warnings.push('No weapon');
  if (totems < minTotems) warnings.push(`Totems ${totems}/${minTotems}`);
  if (food < minFood) warnings.push(`Food ${food}/${minFood}`);

  return {
    ready: warnings.length === 0,
    payload: {
      armor,
      weapons,
      totems,
      food,
      warnings,
      warningCount: warnings.length,
    },
  };
}

/** Stasis: report whether the stasis location is currently available. */
export function evaluateStasis(bot: AnyBot, config: Record<string, unknown>): RoleEventOut {
  const position = collectPosition(bot);
  const connected = Boolean(bot?.entity);
  const requiredItems = Array.isArray(config.requiredItems) ? (config.requiredItems as string[]) : [];
  const inventory = collectInventory(bot);
  const present = new Set(inventory.items.map((i) => i.name));
  const missing = requiredItems.filter((item) => !present.has(item));

  if (!connected) {
    return { type: 'STASIS_UNAVAILABLE', payload: { reason: 'not connected' } };
  }
  if (missing.length > 0) {
    return { type: 'STASIS_UNAVAILABLE', payload: { reason: 'missing components', missing } };
  }
  return {
    type: 'STASIS_READY',
    payload: {
      position: position?.position ?? null,
      dimension: position?.dimension ?? '',
      verifiedAt: Date.now(),
    },
  };
}

/**
 * Hunter: observe allow-listed targets and report detection/reappearance events.
 *
 * `seen` is kept per worker invocation cycle via the config object so repeated ticks do not spam
 * the same detection.
 */
export function observeTargets(bot: AnyBot, config: Record<string, unknown>): RoleEventOut[] {
  const allowlist = Array.isArray(config.allowlist) ? (config.allowlist as string[]).map((s) => s.toLowerCase()) : [];
  if (allowlist.length === 0) return [];

  const observed = new Set<string>((config.__observed as string[] | undefined) ?? []);
  const events: RoleEventOut[] = [];
  const position = collectPosition(bot);
  const players = collectPlayers(bot);

  const stillPresent = new Set<string>();
  for (const player of players) {
    const key = (player.uuid ?? player.username).toLowerCase();
    if (!allowlist.includes(player.username.toLowerCase()) && !allowlist.includes(key)) continue;
    stillPresent.add(key);
    if (!observed.has(key)) {
      events.push({
        type: 'TARGET_DETECTED',
        payload: {
          username: player.username,
          uuid: player.uuid,
          ping: player.ping,
          position: position?.position ?? null,
          dimension: position?.dimension ?? '',
        },
      });
    }
  }

  for (const key of observed) {
    if (!stillPresent.has(key)) {
      events.push({ type: 'TARGET_DISAPPEARED', payload: { key } });
    }
  }

  config.__observed = [...stillPresent];
  return events;
}
