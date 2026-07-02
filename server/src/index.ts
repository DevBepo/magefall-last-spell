import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.js';
import { GameRoom } from './GameRoom.js';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true } });
const room = new GameRoom(io, process.env.ALLOW_TEST_MODE === 'true');

app.get('/health', (_req, res) => res.json({ ok: true, players: room.players.size, phase: room.phase }));

const clientDist = resolve(process.cwd(), 'dist/client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
}

io.on('connection', socket => {
  socket.on('join_game', payload => room.join(socket, payload));
  socket.on('select_mage', (mage, ack) => ack?.(room.selectMage(socket, mage)));
  socket.on('player_input', input => room.setInput(socket, input));
  socket.on('dash', () => room.dash(socket));
  socket.on('special', () => room.special(socket));
  socket.on('choose_item', (item, ack) => ack?.(room.chooseItem(socket, item)));
  socket.on('reset_game', () => room.reset());
  socket.on('test_action', action => room.testAction(socket, action));
  socket.on('disconnect', () => room.disconnect(socket));
});

room.start();
const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, '0.0.0.0', () => console.log(`Magefall: Last Spell server on http://localhost:${port}`));
