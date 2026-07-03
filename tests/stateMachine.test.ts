import { describe, expect, it } from 'vitest';
import { GameStateMachine, canTransition, nextPhase } from '../shared/game/stateMachine';

describe('máquina de estados', () => {
  it('percorre uma partida completa', () => {
    const game = new GameStateMachine();
    const expected = ['mage-selection', 'solo-farm', 'waiting-for-pvp', 'pvp', 'result', 'reset', 'mage-selection'] as const;
    for (const phase of expected) game.transition(phase);
    expect(game.phase).toBe('mage-selection');
  });

  it('rejeita transições inválidas', () => {
    expect(canTransition('loading', 'pvp')).toBe(false);
    expect(nextPhase('farm-level-2')).toBe('item-choice-2');
    const game = new GameStateMachine('loading');
    expect(() => game.transition('pvp')).toThrow(/Invalid transition/);
  });
});
