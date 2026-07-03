import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, RoomRequest, RoomResult, ServerToClientEvents } from '../../shared/protocol.js';
import { GameRoom } from './GameRoom.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameIO = Server<ClientToServerEvents, ServerToClientEvents>;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  readonly rooms = new Map<string, GameRoom>();
  private readonly emptySince = new Map<string, number>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly io: GameIO, private readonly allowTestMode: boolean, private readonly emptyTtlMs = 5 * 60_000) {}

  start(): void { this.cleanupTimer = setInterval(() => this.cleanupExpired(), Math.min(this.emptyTtlMs, 30_000)); }
  stop(): void { if (this.cleanupTimer) clearInterval(this.cleanupTimer); for (const room of this.rooms.values()) room.stop(); }

  create(socket: GameSocket, payload: RoomRequest): RoomResult {
    if (socket.data.roomId) return { ok: false, message: 'Você já está em uma sala.' };
    const roomId = this.generateCode(); const room = new GameRoom(this.io, roomId, this.allowTestMode);
    this.rooms.set(roomId, room); room.start();
    const result = room.join(socket, payload);
    return result.ok ? { ok: true, roomId } : result;
  }

  join(socket: GameSocket, roomIdInput: string, payload: RoomRequest): RoomResult {
    if (socket.data.roomId) return { ok: false, message: 'Você já está em uma sala.' };
    const roomId = this.normalizeCode(roomIdInput); const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: 'Sala não encontrada. Confira o código.' };
    const result = room.join(socket, payload);
    if (result.ok) this.emptySince.delete(roomId);
    return result.ok ? { ok: true, roomId } : result;
  }

  roomFor(socket: GameSocket): GameRoom | undefined { return typeof socket.data.roomId === 'string' ? this.rooms.get(socket.data.roomId) : undefined; }
  disconnect(socket: GameSocket): void { const room = this.roomFor(socket); room?.disconnect(socket); if (room?.isEmpty) this.emptySince.set(room.roomId, Date.now()); }
  normalizeCode(code: string): string { return code.replace(/[^a-z0-9]/gi, '').toUpperCase(); }

  cleanupExpired(now = Date.now()): void {
    for (const [roomId, since] of this.emptySince) if (now - since >= this.emptyTtlMs) {
      const room = this.rooms.get(roomId); if (!room?.isEmpty) { this.emptySince.delete(roomId); continue; }
      room.stop(); this.rooms.delete(roomId); this.emptySince.delete(roomId);
    }
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = ''; for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Não foi possível gerar um código de sala único.');
  }
}
