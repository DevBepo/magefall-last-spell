import { describe, expect, it } from 'vitest';
import { determineWinner, isMageAvailable, lobbyCanStart } from '../shared/game/onlineRules';

describe('regras da sala online', () => {
  const players = [
    { id: 'a', mage: 'ice' as const, connected: true },
    { id: 'b', mage: 'fire' as const, connected: true },
    { id: 'c', mage: 'shadow' as const, connected: true },
    { id: 'd', mage: 'light' as const, connected: true },
  ];

  it('reserva cada mago para um único jogador', () => {
    expect(isMageAvailable(players, 'b', 'ice')).toBe(false);
    expect(isMageAvailable(players, 'a', 'ice')).toBe(true);
  });

  it('inicia somente com jogadores suficientes e magos distintos', () => {
    expect(lobbyCanStart(players, 4)).toBe(true);
    expect(lobbyCanStart(players.slice(0, 2), 4)).toBe(false);
    expect(lobbyCanStart([...players.slice(0, 3), { id: 'd', mage: 'ice' as const, connected: true }], 4)).toBe(false);
  });

  it('declara apenas o último jogador vivo', () => {
    expect(determineWinner([{ id: 'a', alive: true }, { id: 'b', alive: false }])).toBe('a');
    expect(determineWinner([{ id: 'a', alive: true }, { id: 'b', alive: true }])).toBeUndefined();
  });
});
