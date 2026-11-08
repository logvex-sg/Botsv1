/**
 * Pure-ish helpers that read state off a mineflayer bot object.
 *
 * Kept separate from the worker so they can be unit-tested against a lightweight fake bot without
 * spawning a real connection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyBot = any;

export interface PositionSnapshot {
  position: { x: number; y: number; z: number };
  dimension: string;
}

export interface HealthSnapshot {
  health: number;
  food: number;
}

export interface PlayerSnapshot {
  username: string;
  uuid: string | null;
  ping: number;
}

export interface InventorySnapshot {
  items: { name: string; count: number; slot: number; durability?: number }[];
  armor: string[];
}

export function collectPosition(bot: AnyBot): PositionSnapshot | null {
  const entity = bot?.entity;
  if (!entity?.position) return null;
  return {
    position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
    dimension: String(bot.game?.dimension ?? bot.dimension ?? ''),
  };
}

export function collectHealth(bot: AnyBot): HealthSnapshot {
  return {
    health: typeof bot?.health === 'number' ? bot.health : 20,
    food: typeof bot?.food === 'number' ? bot.food : 20,
  };
}

export function collectPlayers(bot: AnyBot): PlayerSnapshot[] {
  const players = bot?.players ?? {};
  const out: PlayerSnapshot[] = [];
  for (const key of Object.keys(players)) {
    const player = players[key];
    if (!player || player.username === bot.username) continue;
    out.push({
      username: String(player.username ?? key),
      uuid: player.uuid ?? null,
      ping: typeof player.ping === 'number' ? player.ping : 0,
    });
  }
  return out;
}

export function collectInventory(bot: AnyBot): InventorySnapshot {
  const items: InventorySnapshot['items'] = [];
  const armor: string[] = [];
  const inv = bot?.inventory;
  if (inv && typeof inv.items === 'function') {
    for (const item of inv.items()) {
      if (!item) continue;
      items.push({
        name: String(item.name ?? 'unknown'),
        count: Number(item.count ?? 1),
        slot: Number(item.slot ?? -1),
        durability: typeof item.durabilityUsed === 'number' ? item.durabilityUsed : undefined,
      });
    }
  }
  const armorSlots = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (const slot of armorSlots) {
    const item = bot?.inventory?.slots ? bot.inventory.slots[bot.getEquipmentDestSlot?.(slot) ?? -1] : null;
    if (item?.name) armor.push(String(item.name));
  }
  return { items, armor };
}
