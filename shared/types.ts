export type MageId = 'ice' | 'fire' | 'shadow' | 'light';
export type ItemId =
  | 'vital-crystal' | 'power-rune' | 'arcane-boots' | 'rapid-focus'
  | 'fluid-core' | 'mystic-hourglass' | 'double-shot' | 'entry-shield'
  | 'elemental-echo' | 'explosive-step' | 'wounded-hunter' | 'reactive-barrier';

export type GamePhase =
  | 'loading' | 'mage-selection'
  | 'farm-level-1' | 'item-choice-1'
  | 'farm-level-2' | 'item-choice-2'
  | 'farm-level-3' | 'item-choice-3'
  | 'pvp' | 'result' | 'reset';

export interface Stats {
  maxHp: number;
  damage: number;
  speed: number;
  attackInterval: number;
  dashCooldown: number;
  specialCooldown: number;
  shield: number;
}

export interface Vec2 { x: number; z: number }

export interface Combatant {
  id: string;
  mage: MageId;
  position: Vec2;
  velocity: Vec2;
  hp: number;
  shield: number;
  radius: number;
  alive: boolean;
  invulnerableUntil: number;
  slowedUntil: number;
  frozenUntil: number;
  freezeImmuneUntil: number;
  lastDamagedAt: number;
}
