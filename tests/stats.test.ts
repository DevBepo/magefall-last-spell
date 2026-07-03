import { describe, expect, it } from 'vitest';
import { MAGES } from '../shared/config/mages';
import { ACTIVE_ITEM_IDS, addItem, calculateStats, offerForLevel } from '../shared/config/items';

describe('stats e itens', () => {
  it('aplica modificadores de atributo em sequência', () => {
    const stats = calculateStats(MAGES.ice.stats, ['vital-crystal', 'power-rune', 'arcane-boots']);
    expect(stats.maxHp).toBe(125);
    expect(stats.damage).toBeCloseTo(11.5);
    expect(stats.speed).toBeCloseTo(7.84);
  });

  it('limita inventário a três itens e evita duplicatas', () => {
    let items = addItem([], 'vital-crystal');
    items = addItem(items, 'vital-crystal');
    items = addItem(items, 'power-rune');
    items = addItem(items, 'arcane-boots');
    items = addItem(items, 'rapid-focus');
    expect(items).toEqual(['vital-crystal', 'power-rune', 'arcane-boots']);
  });
});

it('third boss offers three distinct active relics', () => {
  const offer = offerForLevel(3, ['vital-crystal', 'power-rune']);
  expect(offer).toHaveLength(3);
  expect(new Set(offer).size).toBe(3);
  expect(offer.every(id => ACTIVE_ITEM_IDS.includes(id))).toBe(true);
});
