import { describe, expect, it } from 'vitest';
import { determineWinner, lobbyCanStart, validateFinalBuild } from '../shared/game/onlineRules';
import { calculateStats } from '../shared/config/items';
import { MAGES } from '../shared/config/mages';

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
  it('valida dois itens passivos e uma relíquia ativa', () => {
    const valid = { mageId: 'ice' as const, selectedItems: ['vital-crystal', 'power-rune'] as ['vital-crystal', 'power-rune'], activeRelic: 'blink-rune' as const, finalStats: calculateStats(MAGES.ice.stats, ['vital-crystal', 'power-rune', 'blink-rune']), completedAt: Date.now() };
    expect(validateFinalBuild(valid, 'ice')).toBeUndefined();
    expect(validateFinalBuild({ ...valid, activeRelic: 'rapid-focus' }, 'ice')).toMatch(/ativa/);
    expect(validateFinalBuild({ ...valid, selectedItems: ['missing', 'power-rune'] as never }, 'ice')).toMatch(/inválidos/);
    expect(validateFinalBuild({ ...valid, finalStats: { ...valid.finalStats, damage: 9999 } }, 'ice')).toMatch(/limites/);
  });
});
