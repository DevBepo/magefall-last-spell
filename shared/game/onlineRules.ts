import type { MageId } from '../types.js';

export interface LobbyPlayer { id: string; mage?: MageId; connected: boolean }

export function lobbyCanStart(players: LobbyPlayer[], requiredPlayers: number): boolean {
  const active = players.filter(player => player.connected);
  return active.length >= requiredPlayers && active.every(player => player.mage);
}

export function determineWinner(players: Array<{ id: string; alive: boolean }>): string | undefined {
  const alive = players.filter(player => player.alive);
  return alive.length === 1 ? alive[0]!.id : undefined;
}
