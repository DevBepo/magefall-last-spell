import { describe, expect, it } from 'vitest';
import { cooldownReady, segmentCircleHit, tryFreeze } from '../shared/game/combat';
import type { Combatant } from '../shared/types';

const target = (): Combatant => ({
  id: 'target', mage: 'fire', position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, hp: 100,
  shield: 0, radius: .6, alive: true, invulnerableUntil: 0, slowedUntil: 0, frozenUntil: 0,
  freezeImmuneUntil: 0, lastDamagedAt: 0,
});

describe('combate', () => {
  it('calcula cooldown', () => {
    expect(cooldownReady(5, 1, 4)).toBe(true);
    expect(cooldownReady(4.9, 1, 4)).toBe(false);
  });

  it('detecta projétil cruzando um círculo', () => {
    expect(segmentCircleHit({ x: -2, z: 0 }, { x: 2, z: 0 }, { x: 0, z: .2 }, .5)).toBe(true);
    expect(segmentCircleHit({ x: -2, z: 2 }, { x: 2, z: 2 }, { x: 0, z: 0 }, .5)).toBe(false);
  });

  it('impede congelamento repetido durante imunidade', () => {
    const actor = target();
    expect(tryFreeze(actor, 10)).toBe(true);
    expect(actor.frozenUntil).toBe(11.5);
    expect(tryFreeze(actor, 12)).toBe(false);
    expect(tryFreeze(actor, 16.5)).toBe(true);
  });
});
