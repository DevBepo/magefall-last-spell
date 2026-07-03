import type { GamePhase } from '../types.js';

const transitions: Record<GamePhase, GamePhase[]> = {
  loading: ['mage-selection'],
  'mage-selection': ['farm-level-1', 'solo-farm'],
  'solo-farm': ['waiting-for-pvp'],
  'waiting-for-pvp': ['pvp-countdown', 'pvp'],
  'pvp-countdown': ['pvp'],
  'farm-level-1': ['item-choice-1'],
  'item-choice-1': ['farm-level-2'],
  'farm-level-2': ['item-choice-2'],
  'item-choice-2': ['farm-level-3'],
  'farm-level-3': ['item-choice-3'],
  'item-choice-3': ['pvp'],
  pvp: ['result'],
  result: ['reset'],
  reset: ['mage-selection'],
};

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return transitions[from].includes(to);
}

export function nextPhase(phase: GamePhase): GamePhase {
  return transitions[phase][0] ?? phase;
}

export class GameStateMachine {
  constructor(public phase: GamePhase = 'loading') {}
  transition(to: GamePhase): void {
    if (!canTransition(this.phase, to)) throw new Error(`Invalid transition: ${this.phase} -> ${to}`);
    this.phase = to;
  }
}
