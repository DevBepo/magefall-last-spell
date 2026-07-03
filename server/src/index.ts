import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js';
import { RoomManager } from './RoomManager.js';

const app = express(); const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true } });
const rooms = new RoomManager(io, process.env.ALLOW_TEST_MODE === 'true'); rooms.start();

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
const clientDist = resolve(process.cwd(), 'dist/client');
if (existsSync(clientDist)) { app.use(express.static(clientDist)); app.use((_req, res) => res.sendFile(resolve(clientDist, 'index.html'))); }

io.on('connection', socket => {
  socket.on('create_room', (payload, ack) => ack(rooms.create(socket, payload)));
  socket.on('join_room', (payload, ack) => ack(rooms.join(socket, payload.roomId, payload)));
  socket.on('select_mage', (mage, ack) => ack?.(rooms.roomFor(socket)?.selectMage(socket, mage) ?? { ok: false, message: 'Entre em uma sala primeiro.' }));
  socket.on('start_game', ack => ack?.(rooms.roomFor(socket)?.startGame(socket) ?? { ok: false, message: 'Sala não encontrada.' }));
  socket.on('player_input', input => rooms.roomFor(socket)?.setInput(socket, input));
  socket.on('dash', () => rooms.roomFor(socket)?.dash(socket));
  socket.on('special', () => rooms.roomFor(socket)?.special(socket));
  socket.on('use_active', () => rooms.roomFor(socket)?.useActive(socket));
  socket.on('choose_item', (item, ack) => ack?.(rooms.roomFor(socket)?.chooseItem(socket, item) ?? { ok: false, message: 'Sala não encontrada.' }));
  socket.on('reset_game', ack => { const result = rooms.roomFor(socket)?.reset(socket) ?? { ok: false, message: 'Sala não encontrada.' }; ack?.(result); });
  socket.on('test_action', action => rooms.roomFor(socket)?.testAction(socket, action));
  socket.on('disconnect', () => rooms.disconnect(socket));
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, '0.0.0.0', () => console.log(`Magefall: Last Spell server on http://localhost:${port}`));
