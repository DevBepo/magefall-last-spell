import { afterEach, describe, expect, it } from 'vitest';
import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';
import { RoomManager } from '../server/src/RoomManager';
import { calculateStats } from '../shared/config/items';
import { MAGES } from '../shared/config/mages';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function fakeIo(): Server<ClientToServerEvents, ServerToClientEvents> {
  return { to: () => ({ emit: () => undefined }), sockets: { sockets: new Map() } } as unknown as Server<ClientToServerEvents, ServerToClientEvents>;
}

let socketNumber = 0;
function fakeSocket(): GameSocket {
  return { id: `socket-${++socketNumber}`, data: {}, join: () => undefined, emit: () => true } as unknown as GameSocket;
}

describe('RoomManager', () => {
  const managers: RoomManager[] = [];
  afterEach(() => managers.splice(0).forEach(manager => manager.stop()));
  const manager = (ttl = 1000) => { const value = new RoomManager(fakeIo(), true, ttl); managers.push(value); return value; };

  it('cria sala com código curto não ambíguo', () => {
    const result = manager().create(fakeSocket(), { name: 'Jonas' });
    expect(result).toMatchObject({ ok: true });
    expect(result.roomId).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it('entra por código sem diferenciar maiúsculas', () => {
    const rooms = manager(); const created = rooms.create(fakeSocket(), {});
    expect(rooms.join(fakeSocket(), created.roomId!.toLowerCase(), { name: 'Pedro' })).toMatchObject({ ok: true, roomId: created.roomId });
  });

  it('retorna erros para sala inexistente e sala cheia', () => {
    const rooms = manager(); expect(rooms.join(fakeSocket(), 'ABCDE', {})).toMatchObject({ ok: false });
    const created = rooms.create(fakeSocket(), {}); for (let i = 0; i < 5; i++) expect(rooms.join(fakeSocket(), created.roomId!, {} ).ok).toBe(true);
    expect(rooms.join(fakeSocket(), created.roomId!, {}).message).toContain('cheia');
  });

  it('usa nickname fallback, permite magos repetidos e transfere host', () => {
    const rooms = manager(); const host = fakeSocket(); const guest = fakeSocket(); const created = rooms.create(host, {});
    rooms.join(guest, created.roomId!, { name: '  Pedro   Silva  ' }); const room = rooms.rooms.get(created.roomId!)!;
    expect([...room.players.values()].map(p => p.name)).toEqual(['Player 1', 'Pedro Silva']);
    expect(room.selectMage(host, 'fire').ok).toBe(true); expect(room.selectMage(guest, 'fire').ok).toBe(true);
    rooms.disconnect(host); expect(room.hostId).toBe(guest.data.playerId);
  });

  it('mantém duas salas independentes e remove sala vazia expirada', () => {
    const rooms = manager(1); const a = fakeSocket(); const b = fakeSocket(); const roomA = rooms.create(a, {}); const roomB = rooms.create(b, {});
    expect(roomA.roomId).not.toBe(roomB.roomId); rooms.disconnect(a); rooms.cleanupExpired(Date.now() + 5);
    expect(rooms.rooms.has(roomA.roomId!)).toBe(false); expect(rooms.rooms.has(roomB.roomId!)).toBe(true);
  });

  it('mantém snapshot compacto e com precisão limitada', () => {
    const rooms = manager(); const host = fakeSocket(); const guest = fakeSocket(); const created = rooms.create(host, { name: 'Host' });
    rooms.join(guest, created.roomId!, { name: 'Guest' }); const room = rooms.rooms.get(created.roomId!)!;
    room.selectMage(host, 'ice'); room.selectMage(guest, 'fire'); const snapshot = room.snapshot(); const json = JSON.stringify(snapshot);
    expect(new TextEncoder().encode(json).byteLength).toBeLessThan(2500);
    expect(json).not.toContain('description'); expect(json).not.toContain('reconnectToken');
    expect(snapshot.players.every(player => (String(player.position.x).split('.')[1]?.length ?? 0) <= 3)).toBe(true);
  });
  it('aceita farms individuais e inicia PvP somente com dois prontos', () => {
    const rooms = manager(); const host = fakeSocket(); const guest = fakeSocket(); const third = fakeSocket(); const created = rooms.create(host, {});
    rooms.join(guest, created.roomId!, {}); rooms.join(third, created.roomId!, {}); const room = rooms.rooms.get(created.roomId!)!;
    room.selectMage(host, 'ice'); room.selectMage(guest, 'fire'); room.selectMage(third, 'shadow'); expect(room.startGame(host).ok).toBe(true); expect(room.phase).toBe('solo-farm');
    const build = (mageId: 'ice' | 'fire') => ({ mageId, selectedItems: ['vital-crystal', 'power-rune'] as ['vital-crystal', 'power-rune'], activeRelic: 'blink-rune' as const, finalStats: calculateStats(MAGES[mageId].stats, ['vital-crystal', 'power-rune', 'blink-rune']), completedAt: Date.now() });
    expect(room.completeFarm(host, build('ice')).ok).toBe(true); expect(room.beginPvp(host).ok).toBe(false);
    expect(room.completeFarm(guest, build('fire')).ok).toBe(true); expect(room.beginPvp(guest).ok).toBe(false); expect(room.beginPvp(host).ok).toBe(true);
    expect(room.phase).toBe('pvp'); expect(room.snapshot().players.filter(p => p.alive).map(p => p.id)).not.toContain(third.data.playerId);
  });
});
