import { describe, expect, it } from 'vitest';
import { determineWinner, lobbyCanStart } from '../shared/game/onlineRules';

describe('regras da sala online', () => {
  const players = [
    { id: 'a', mage: 'ice' as const, connected: true },
    { id: 'b', mage: 'fire' as const, connected: true },
    { id: 'c', mage: 'shadow' as const, connected: true },
    { id: 'd', mage: 'light' as const, connected: true },
  ];

  it('inicia com jogadores suficientes mesmo quando os magos se repetem', () => {
    expect(lobbyCanStart(players, 4)).toBe(true);
    expect(lobbyCanStart(players.slice(0, 2), 4)).toBe(false);
    expect(lobbyCanStart([...players.slice(0, 3), { id: 'd', mage: 'ice' as const, connected: true }], 4)).toBe(true);
  });

  it('declara apenas o último jogador vivo', () => {
    expect(determineWinner([{ id: 'a', alive: true }, { id: 'b', alive: false }])).toBe('a');
    expect(determineWinner([{ id: 'a', alive: true }, { id: 'b', alive: true }])).toBeUndefined();
  });
});
