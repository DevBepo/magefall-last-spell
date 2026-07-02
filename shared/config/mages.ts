import type { MageId, Stats } from '../types.js';

export interface MageConfig {
  id: MageId;
  name: string;
  title: string;
  description: string;
  color: number;
  accent: number;
  stats: Stats;
}

const base: Stats = {
  maxHp: 100, damage: 10, speed: 7, attackInterval: 0.55,
  dashCooldown: 4, specialCooldown: 12, shield: 0,
};

export const MAGES: Record<MageId, MageConfig> = {
  ice: {
    id: 'ice', name: 'Ice', title: 'Tecelão do Inverno',
    description: 'Desacelera inimigos e congela alvos com seu especial.',
    color: 0x42cfff, accent: 0xbdf7ff, stats: { ...base },
  },
  fire: {
    id: 'fire', name: 'Fire', title: 'Arauto das Cinzas',
    description: 'Muito dano, pouca defesa e uma bola de fogo explosiva.',
    color: 0xff4b22, accent: 0xffc247,
    stats: { ...base, maxHp: 85, damage: 12, specialCooldown: 11 },
  },
  shadow: {
    id: 'shadow', name: 'Shadow', title: 'Andarilho do Vazio',
    description: 'Intangível após o dash e capaz de teleportar pela mira.',
    color: 0x7a35d4, accent: 0xf05cff, stats: { ...base, specialCooldown: 10 },
  },
  light: {
    id: 'light', name: 'Light', title: 'Guardião da Aurora',
    description: 'Rápido, resiliente e capaz de acelerar ainda mais.',
    color: 0xffd65a, accent: 0xffffff,
    stats: { ...base, speed: 7.7, specialCooldown: 13 },
  },
};
