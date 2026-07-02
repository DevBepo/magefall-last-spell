import type { GamePhase, ItemId, MageId, Vec2 } from './types.js';

export interface ClientInput { sequence: number; movement: Vec2; aim: Vec2; shooting: boolean }
export interface PlayerSnapshot {
  id: string; mage?: MageId; position: Vec2; rotation: number; hp: number; maxHp: number;
  shield: number; alive: boolean; connected: boolean; items: ItemId[];
  dashCooldown: number; specialCooldown: number; slowedUntil: number; frozenUntil: number; specialUntil: number;
}
export interface ProjectileSnapshot { id: number; ownerId: string; mage: MageId; position: Vec2; explosive: boolean }
export interface TelegraphSnapshot { id: number; position: Vec2; radius: number; triggerAt: number }
export interface BossSnapshot { level: number; position: Vec2; hp: number; maxHp: number; angle: number }
export interface WorldSnapshot {
  serverTime: number; phase: GamePhase; players: PlayerSnapshot[]; projectiles: ProjectileSnapshot[];
  telegraphs: TelegraphSnapshot[]; boss?: BossSnapshot; winnerId?: string;
}
export interface SelectionPlayer { id: string; mage?: MageId; connected: boolean }
export interface SelectionState { players: SelectionPlayer[]; requiredPlayers: number }
export interface ConnectionState { playerId: string; reconnectToken: string; testMode: boolean }
export interface ClientToServerEvents {
  join_game: (payload: { reconnectToken?: string; testMode?: boolean; testPlayers?: 2 | 4 }) => void;
  select_mage: (mage: MageId, ack?: (result: { ok: boolean; message?: string }) => void) => void;
  player_input: (input: ClientInput) => void; dash: () => void; special: () => void;
  choose_item: (item: ItemId, ack?: (result: { ok: boolean; message?: string }) => void) => void;
  reset_game: () => void; test_action: (action: 'kill_boss' | 'win_pvp') => void;
}
export interface ServerToClientEvents {
  connection_state: (state: ConnectionState) => void; selection_state: (state: SelectionState) => void;
  phase_changed: (phase: GamePhase) => void; snapshot: (snapshot: WorldSnapshot) => void;
  item_offer: (offer: ItemId[]) => void; item_chosen: (items: ItemId[]) => void;
  player_died: (playerId: string) => void; game_over: (payload: { winnerId?: string; players: PlayerSnapshot[] }) => void;
  game_reset: () => void; room_full: () => void; error_message: (message: string) => void;
}
