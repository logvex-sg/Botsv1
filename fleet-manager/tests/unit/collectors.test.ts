import { describe, it, expect } from 'vitest';
import { collectHealth, collectPlayers, collectPosition } from '../../src/main/mineflayer/collectors';

describe('collectors', () => {
  it('reads position and dimension', () => {
    const bot = { entity: { position: { x: 1, y: 64, z: -3 } }, game: { dimension: 'minecraft:overworld' } };
    expect(collectPosition(bot)).toEqual({ position: { x: 1, y: 64, z: -3 }, dimension: 'minecraft:overworld' });
  });

  it('returns null position when the bot has no entity', () => {
    expect(collectPosition({})).toBeNull();
  });

  it('defaults health when missing', () => {
    expect(collectHealth({})).toEqual({ health: 20, food: 20 });
  });

  it('excludes the bot itself from the player list', () => {
    const bot = {
      username: 'me',
      players: { a: { username: 'me', uuid: '1' }, b: { username: 'other', uuid: '2', ping: 42 } },
    };
    const players = collectPlayers(bot);
    expect(players).toHaveLength(1);
    expect(players[0].username).toBe('other');
    expect(players[0].ping).toBe(42);
  });
});
