import type { FarmProgress, FarmStatus, GamePhase, ItemId, MageId, Stats, Vec2 } from './types.js';

export interface FinalBuild { mageId: MageId; selectedItems: [ItemId, ItemId]; activeRelic: ItemId; finalStats: Stats; completedAt: number }
export interface FarmPlayerState { playerId: string; nickname: string; mageId?: MageId; playerIndex: number; connected: boolean; farmStatus: FarmStatus; farmProgress: FarmProgress; selectedItems: ItemId[]; activeRelic?: ItemId; finalStats?: Stats; readyForPvp: boolean; isHost: boolean }
export interface FarmRoomState { roomId: string; phase: GamePhase; players: FarmPlayerState[]; canStartPvp: boolean }

export interface ClientInput { sequence: number; movement: Vec2; aim: Vec2; shooting: boolean }
export interface PlayerSnapshot {
  id: string; name: string; playerIndex: number; mage?: MageId; position: Vec2; rotation: number; hp: number; maxHp: number;
  shield: number; alive: boolean; connected: boolean; items: ItemId[];
  dashCooldown: number; specialCooldown: number; activeCooldown: number; slowedUntil: number; frozenUntil: number; specialUntil: number;
}
export interface ProjectileSnapshot { id: number; ownerId: string; mage: MageId; position: Vec2; explosive: boolean }
export interface TelegraphSnapshot { id: number; position: Vec2; radius: number; triggerAt: number }
export interface BossSnapshot { level: number; position: Vec2; hp: number; maxHp: number; angle: number }
export interface MinionSnapshot { id: number; position: Vec2; hp: number }
export interface WorldSnapshot {
  serverTime: number; phase: GamePhase; players: PlayerSnapshot[]; projectiles: ProjectileSnapshot[];
  telegraphs: TelegraphSnapshot[]; minions: MinionSnapshot[]; boss?: BossSnapshot; winnerId?: string;
}
export interface SelectionPlayer { id: string; name: string; playerIndex: number; mage?: MageId; connected: boolean; isHost: boolean }
export interface SelectionState { roomId: string; players: SelectionPlayer[]; minPlayers: number; maxPlayers: number; canStart: boolean }
export interface ConnectionState { roomId: string; playerId: string; reconnectToken: string; testMode: boolean; isHost: boolean }
export interface RoomRequest { name?: string; reconnectToken?: string; testMode?: boolean; testPlayers?: 2 | 4 }
export interface RoomResult { ok: boolean; message?: string; roomId?: string }
export interface ClientToServerEvents {
  create_room: (payload: RoomRequest, ack: (result: RoomResult) => void) => void;
  join_room: (payload: RoomRequest & { roomId: string }, ack: (result: RoomResult) => void) => void;
  select_mage: (mage: MageId, ack?: (result: RoomResult) => void) => void;
  start_game: (ack?: (result: RoomResult) => void) => void;
  farm_progress: (progress: FarmProgress) => void;
  farm_completed: (build: FinalBuild, ack?: (result: RoomResult) => void) => void;
  start_pvp: (ack?: (result: RoomResult) => void) => void;
  player_input: (input: ClientInput) => void; dash: () => void; special: () => void; use_active: () => void;
  choose_item: (item: ItemId, ack?: (result: RoomResult) => void) => void;
  reset_game: (ack?: (result: RoomResult) => void) => void; test_action: (action: 'kill_boss' | 'win_pvp') => void;
  debug_ping: (sentAt: number, ack: (sentAt: number) => void) => void;
}
export interface ServerToClientEvents {
  connection_state: (state: ConnectionState) => void; selection_state: (state: SelectionState) => void;
  phase_changed: (phase: GamePhase) => void; snapshot: (snapshot: WorldSnapshot) => void;
  room_state: (state: FarmRoomState) => void; farm_status_updated: (state: FarmRoomState) => void;
  farm_completed_ack: (state: FarmRoomState) => void; farm_completed_rejected: (message: string) => void;
  item_offer: (offer: ItemId[]) => void; item_chosen: (items: ItemId[]) => void;
  player_died: (playerId: string) => void; game_over: (payload: { winnerId?: string; players: PlayerSnapshot[] }) => void;
  game_reset: () => void; error_message: (message: string) => void;
}
