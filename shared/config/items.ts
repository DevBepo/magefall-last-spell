import type { ItemId, Stats } from '../types.js';

export interface ItemConfig {
  id: ItemId;
  name: string;
  icon: string;
  description: string;
  color: string;
  apply: (stats: Stats) => Stats;
  active?: boolean;
  cooldown?: number;
}

const item = (id: ItemId, name: string, icon: string, description: string, color: string, apply: (s: Stats) => Stats): ItemConfig => ({ id, name, icon, description, color, apply });

export const ITEMS: Record<ItemId, ItemConfig> = {
  'vital-crystal': item('vital-crystal', 'Cristal Vital', '◆', '+25 de HP máximo e cura ao obter.', '#6ef2a2', s => ({ ...s, maxHp: s.maxHp + 25 })),
  'power-rune': item('power-rune', 'Runa de Poder', '✦', '+15% de dano.', '#ff6a5e', s => ({ ...s, damage: s.damage * 1.15 })),
  'arcane-boots': item('arcane-boots', 'Botas Arcanas', '➤', '+12% de velocidade.', '#6ecbff', s => ({ ...s, speed: s.speed * 1.12 })),
  'rapid-focus': item('rapid-focus', 'Foco Rápido', '◎', 'Ataca 15% mais rápido.', '#ffd76e', s => ({ ...s, attackInterval: s.attackInterval * .85 })),
  'fluid-core': item('fluid-core', 'Núcleo Fluido', '◈', 'Dash recarrega 20% mais rápido.', '#71f6df', s => ({ ...s, dashCooldown: s.dashCooldown * .8 })),
  'mystic-hourglass': item('mystic-hourglass', 'Ampulheta Mística', '⌛', 'Especial recarrega 15% mais rápido.', '#c5a0ff', s => ({ ...s, specialCooldown: s.specialCooldown * .85 })),
  'double-shot': item('double-shot', 'Tiro Duplo', '❯❯', 'Cada quarto ataque repete com 60% do dano.', '#ffab67', s => ({ ...s })),
  'entry-shield': item('entry-shield', 'Escudo de Entrada', '⬡', '+20 de escudo a cada arena.', '#7ccfff', s => ({ ...s, shield: s.shield + 20 })),
  'elemental-echo': item('elemental-echo', 'Eco Elemental', '◉', 'Especial fortalece o próximo ataque em 50%.', '#ec7cff', s => ({ ...s })),
  'explosive-step': item('explosive-step', 'Passo Explosivo', '✹', 'Dash causa 12 de dano ao terminar.', '#ff7557', s => ({ ...s })),
  'wounded-hunter': item('wounded-hunter', 'Caçador Ferido', '⌁', '+20% de dano contra alvos com pouca vida.', '#e85c78', s => ({ ...s })),
  'reactive-barrier': item('reactive-barrier', 'Barreira Reativa', '⬢', 'Primeiro dano a cada 12s é reduzido à metade.', '#8da8ff', s => ({ ...s })),
  'blink-rune': { ...item('blink-rune', 'Runa de Blink', '◇', 'E: teleporta na direção da mira.', '#63e6ff', s => ({ ...s })), active: true, cooldown: 9 },
  'healing-shard': { ...item('healing-shard', 'Fragmento de Cura', '✚', 'E: recupera 35% da vida máxima.', '#63f59a', s => ({ ...s })), active: true, cooldown: 14 },
  'repulse-orb': { ...item('repulse-orb', 'Orbe de Repulsão', '◉', 'E: afasta e fere inimigos próximos.', '#e07cff', s => ({ ...s })), active: true, cooldown: 11 },
  'time-crystal': { ...item('time-crystal', 'Cristal do Tempo', '⌛', 'E: restaura dash e especial.', '#ffd76e', s => ({ ...s })), active: true, cooldown: 16 },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const ACTIVE_ITEM_IDS = ITEM_IDS.filter(id => ITEMS[id].active);

export function calculateStats(base: Stats, itemIds: ItemId[]): Stats {
  return itemIds.reduce((stats, id) => ITEMS[id].apply(stats), { ...base });
}

export function addItem(current: ItemId[], id: ItemId): ItemId[] {
  if (current.length >= 3 || current.includes(id)) return current;
  return [...current, id];
}

export function offerForLevel(level: number, owned: ItemId[]): ItemId[] {
  const pool = level === 3 ? ACTIVE_ITEM_IDS : level === 1 ? ITEM_IDS.filter(id => !ITEMS[id].active) : ITEM_IDS;
  const available = pool.filter(id => !owned.includes(id));
  const start = ((level - 1) * 3) % available.length;
  return [0, 1, 2].map(i => available[(start + i * 3) % available.length]!).filter((id, i, all) => all.indexOf(id) === i);
}
