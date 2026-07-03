import { ITEMS } from '../config/items.js';
import { MAGES } from '../config/mages.js';
import type { FinalBuild } from '../protocol.js';
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

export function validateFinalBuild(build: FinalBuild, selectedMage: MageId): string | undefined {
  if (build.mageId !== selectedMage) return 'O mago da build não corresponde ao lobby.';
  if (!Array.isArray(build.selectedItems) || build.selectedItems.length !== 2) return 'A build deve ter dois itens passivos.';
  const all = [...build.selectedItems, build.activeRelic];
  if (new Set(all).size !== 3 || all.some(id => !ITEMS[id])) return 'A build contém itens inválidos ou repetidos.';
  if (build.selectedItems.some(id => ITEMS[id].active)) return 'As duas primeiras escolhas devem ser itens passivos.';
  if (!ITEMS[build.activeRelic].active) return 'A terceira escolha deve ser uma relíquia ativa.';
  const expected = MAGES[selectedMage].stats;
  const s = build.finalStats;
  if (!s || Object.values(s).some(v => !Number.isFinite(v))) return 'Stats finais inválidos.';
  if (s.maxHp < expected.maxHp * .5 || s.maxHp > 250 || s.damage < expected.damage * .5 || s.damage > 100 || s.speed < 2 || s.speed > 15 || s.attackInterval < .1 || s.attackInterval > 3 || s.dashCooldown < .5 || s.dashCooldown > 15 || s.specialCooldown < 1 || s.specialCooldown > 30 || s.shield < 0 || s.shield > 100) return 'Stats finais fora dos limites seguros.';
  return undefined;
}
