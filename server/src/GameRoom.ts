import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { ITEMS, addItem, calculateStats, offerForLevel } from '../../shared/config/items.js';
import { MAGES } from '../../shared/config/mages.js';
import { applyDamage, cooldownReady, segmentCircleHit, tryFreeze } from '../../shared/game/combat.js';
import { determineWinner, lobbyCanStart } from '../../shared/game/onlineRules.js';
import type { ClientInput, ClientToServerEvents, PlayerSnapshot, ServerToClientEvents, WorldSnapshot } from '../../shared/protocol.js';
import type { Combatant, GamePhase, ItemId, MageId, Stats, Vec2 } from '../../shared/types.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameIO = Server<ClientToServerEvents, ServerToClientEvents>;

interface ServerPlayer extends Omit<Combatant, 'mage'> {
  socketId?: string; reconnectToken: string; connected: boolean; disconnectedAt?: number; mage?: MageId; name: string; playerIndex: number;
  stats: Stats; items: ItemId[]; input: ClientInput; rotation: number; lastShotAt: number; lastDashAt: number;
  lastSpecialAt: number; specialUntil: number; echoReady: boolean; hitCount: number; barrierReadyAt: number;
  lastActiveAt: number;
  respawnAt?: number; selectedOffer: ItemId[]; testMode: boolean; testPlayers: 2 | 4;
}
interface ServerProjectile { id: number; ownerId: string; mage: MageId; position: Vec2; previous: Vec2; velocity: Vec2; damage: number; age: number; explosive: boolean; freeze: boolean }
interface ServerTelegraph { id: number; position: Vec2; radius: number; damage: number; triggerAt: number }
interface ServerBoss { level: number; position: Vec2; hp: number; maxHp: number; angle: number; lastAttackAt: number }
interface ServerMinion { id: number; position: Vec2; hp: number; lastHitAt: number }

const emptyInput = (): ClientInput => ({ sequence: 0, movement: { x: 0, z: 0 }, aim: { x: 0, z: -1 }, shooting: false });
const pveArenaRadius = 15.2;
const pvpArenaRadius = 25.5;
const obstacles = [{ x: -6, z: -4, r: 1.65 }, { x: 5, z: 4, r: 1.65 }, { x: -5, z: 6, r: 1.65 }, { x: 6, z: -6, r: 1.65 }];

export class GameRoom {
  readonly players = new Map<string, ServerPlayer>();
  phase: GamePhase = 'mage-selection';
  winnerId?: string;
  boss?: ServerBoss;
  readonly projectiles: ServerProjectile[] = [];
  readonly telegraphs: ServerTelegraph[] = [];
  readonly minions: ServerMinion[] = [];
  private level = 0;
  private now = 0;
  private lastSnapshotAt = 0;
  private entityId = 1;
  private loop?: NodeJS.Timeout;
  private nextPlayerIndex = 1;
  hostId?: string;

  constructor(private readonly io: GameIO, readonly roomId: string, private readonly allowTestMode: boolean, readonly maxPlayers = 6) {}

  get socketRoom(): string { return `game:${this.roomId}`; }
  get connectedCount(): number { return [...this.players.values()].filter(p => p.connected).length; }
  get isEmpty(): boolean { return this.connectedCount === 0; }

  start(): void {
    let previous = performance.now();
    this.loop = setInterval(() => {
      const current = performance.now();
      const dt = Math.min((current - previous) / 1000, .1); previous = current;
      this.tick(dt);
    }, 50);
  }

  stop(): void { if (this.loop) clearInterval(this.loop); }

  join(socket: GameSocket, payload: { name?: string; reconnectToken?: string; testMode?: boolean; testPlayers?: 2 | 4 }): { ok: boolean; message?: string } {
    const existing = payload.reconnectToken ? [...this.players.values()].find(p => p.reconnectToken === payload.reconnectToken && !p.connected && this.now - (p.disconnectedAt ?? 0) <= 30) : undefined;
    if (existing) {
      existing.connected = true; existing.socketId = socket.id; existing.disconnectedAt = undefined;
      socket.data.playerId = existing.id; socket.data.roomId = this.roomId; socket.join(this.socketRoom);
      socket.emit('connection_state', { roomId: this.roomId, playerId: existing.id, reconnectToken: existing.reconnectToken, testMode: existing.testMode, isHost: existing.id === this.hostId });
      this.emitSelection(); this.emitSnapshot();
      if (existing.selectedOffer.length) socket.emit('item_offer', existing.selectedOffer);
      return { ok: true };
    }
    if (this.phase !== 'mage-selection') return { ok: false, message: 'A partida desta sala já está em andamento.' };
    if (this.connectedCount >= this.maxPlayers) return { ok: false, message: 'Esta sala está cheia.' };
    const id = randomUUID();
    const testMode = this.allowTestMode && payload.testMode === true;
    const player: ServerPlayer = {
      id, socketId: socket.id, reconnectToken: randomUUID(), connected: true, testMode, testPlayers: testMode && payload.testPlayers === 2 ? 2 : 4,
      name: this.cleanName(payload.name, this.nextPlayerIndex), playerIndex: this.nextPlayerIndex++,
      position: { x: 0, z: 0 }, velocity: { x: 0, z: 0 }, hp: 100, shield: 0, radius: .62, alive: true,
      invulnerableUntil: 0, slowedUntil: 0, frozenUntil: 0, freezeImmuneUntil: 0, lastDamagedAt: -99,
      stats: { ...MAGES.ice.stats }, items: [], input: emptyInput(), rotation: 0, lastShotAt: -99,
      lastDashAt: -99, lastSpecialAt: -99, specialUntil: 0, echoReady: false, hitCount: 0,
      barrierReadyAt: 0, selectedOffer: [],
      lastActiveAt: -99,
    };
    this.players.set(id, player); this.hostId ??= id; socket.data.playerId = id; socket.data.roomId = this.roomId; socket.join(this.socketRoom);
    socket.emit('connection_state', { roomId: this.roomId, playerId: id, reconnectToken: player.reconnectToken, testMode, isHost: id === this.hostId });
    this.emitSelection();
    return { ok: true };
  }

  disconnect(socket: GameSocket): void {
    const p = this.playerFor(socket); if (!p) return;
    p.connected = false; p.socketId = undefined; p.disconnectedAt = this.now; p.input = emptyInput();
    if (this.hostId === p.id) this.hostId = [...this.players.values()].filter(x => x.connected).sort((a, b) => a.playerIndex - b.playerIndex)[0]?.id;
    this.emitSelection();
  }

  selectMage(socket: GameSocket, mage: MageId): { ok: boolean; message?: string } {
    const player = this.playerFor(socket);
    if (!player || this.phase !== 'mage-selection') return { ok: false, message: 'Seleção indisponível.' };
    player.mage = mage; player.stats = { ...MAGES[mage].stats }; player.hp = player.stats.maxHp;
    this.emitSelection(); return { ok: true };
  }

  startGame(socket: GameSocket): { ok: boolean; message?: string } {
    const player = this.playerFor(socket); const connected = [...this.players.values()].filter(p => p.connected);
    if (!player || player.id !== this.hostId) return { ok: false, message: 'Apenas o host pode iniciar a partida.' };
    if (this.phase !== 'mage-selection') return { ok: false, message: 'A partida já foi iniciada.' };
    if (!lobbyCanStart(connected, 2)) return { ok: false, message: 'São necessários 2 jogadores com magos escolhidos.' };
    this.startFarm(1); return { ok: true };
  }

  setInput(socket: GameSocket, input: ClientInput): void {
    const p = this.playerFor(socket); if (!p || !this.isCombat()) return;
    const length = Math.hypot(input.movement.x, input.movement.z) || 1;
    const aimLength = Math.hypot(input.aim.x, input.aim.z) || 1;
    p.input = {
      sequence: input.sequence,
      movement: { x: Math.max(-1, Math.min(1, input.movement.x / Math.max(1, length))), z: Math.max(-1, Math.min(1, input.movement.z / Math.max(1, length))) },
      aim: { x: input.aim.x / aimLength, z: input.aim.z / aimLength }, shooting: input.shooting,
    };
    p.rotation = Math.atan2(p.input.aim.x, p.input.aim.z);
  }

  dash(socket: GameSocket): void {
    const p = this.playerFor(socket); if (!p?.alive || !p.mage || !this.isCombat() || !cooldownReady(this.now, p.lastDashAt, p.stats.dashCooldown) || this.now < p.frozenUntil) return;
    const d = Math.hypot(p.input.movement.x, p.input.movement.z) > .1 ? p.input.movement : p.input.aim;
    this.move(p, d.x * 5, d.z * 5); p.lastDashAt = this.now;
    if (p.mage === 'shadow') p.invulnerableUntil = this.now + .25;
    if (p.items.includes('explosive-step')) this.areaDamage(p, p.position, 2.2, 12);
  }

  special(socket: GameSocket): void {
    const p = this.playerFor(socket); if (!p?.alive || !p.mage || !this.isCombat() || !cooldownReady(this.now, p.lastSpecialAt, p.stats.specialCooldown)) return;
    p.lastSpecialAt = this.now; p.echoReady = p.items.includes('elemental-echo');
    if (p.mage === 'ice') p.specialUntil = this.now + 4;
    if (p.mage === 'fire') this.spawnProjectile(p, p.input.aim, 30, true, false);
    if (p.mage === 'shadow') { this.move(p, p.input.aim.x * 6, p.input.aim.z * 6); p.invulnerableUntil = this.now + .15; }
    if (p.mage === 'light') p.specialUntil = this.now + 3;
  }

  useActive(socket: GameSocket): void {
    const p = this.playerFor(socket); if (!p?.alive || !this.isCombat()) return;
    const id = p.items.find(item => ITEMS[item].active); if (!id) return;
    const cooldown = ITEMS[id].cooldown ?? 12; if (!cooldownReady(this.now, p.lastActiveAt, cooldown)) return;
    p.lastActiveAt = this.now;
    if (id === 'blink-rune') this.move(p, p.input.aim.x * 7, p.input.aim.z * 7);
    if (id === 'healing-shard') p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.maxHp * .35);
    if (id === 'time-crystal') { p.lastDashAt = -99; p.lastSpecialAt = -99; }
    if (id === 'repulse-orb') for (const target of this.players.values()) if (target.id !== p.id && target.alive && this.phase === 'pvp') { const dx = target.position.x - p.position.x, dz = target.position.z - p.position.z, d = Math.hypot(dx, dz); if (d < 6) { this.move(target, dx / (d || 1) * 4, dz / (d || 1) * 4); this.damage(target, 14); } }
  }

  chooseItem(socket: GameSocket, item: ItemId): { ok: boolean; message?: string } {
    const p = this.playerFor(socket);
    if (!p || !this.phase.startsWith('item-choice') || !p.selectedOffer.includes(item)) return { ok: false, message: 'Relíquia não pertence à oferta.' };
    const before = p.items.length; p.items = addItem(p.items, item);
    if (p.items.length === before) return { ok: false, message: 'Relíquia inválida.' };
    p.selectedOffer = []; this.socketFor(p)?.emit('item_chosen', p.items);
    const active = [...this.players.values()].filter(x => x.mage);
    if (active.every(x => x.items.length >= this.level)) {
      if (this.level < 3) this.startFarm(this.level + 1); else this.startPvp();
    }
    return { ok: true };
  }

  reset(socket: GameSocket): { ok: boolean; message?: string } {
    const player = this.playerFor(socket);
    if (!player || player.id !== this.hostId) return { ok: false, message: 'Apenas o host pode voltar ao lobby.' };
    if (this.phase !== 'result') return { ok: false, message: 'A partida ainda não terminou.' };
    this.phase = 'reset'; this.io.to(this.socketRoom).emit('phase_changed', this.phase);
    setTimeout(() => {
      this.clearWorld(); this.phase = 'mage-selection'; this.winnerId = undefined; this.level = 0;
      for (const p of this.players.values()) { p.mage = undefined; p.items = []; p.selectedOffer = []; p.alive = true; }
      this.io.to(this.socketRoom).emit('game_reset'); this.io.to(this.socketRoom).emit('phase_changed', this.phase); this.emitSelection();
    }, 250);
    return { ok: true };
  }

  testAction(socket: GameSocket, action: 'kill_boss' | 'win_pvp'): void {
    const p = this.playerFor(socket); if (!p?.testMode || !this.allowTestMode) return;
    if (action === 'kill_boss' && this.boss) this.boss.hp = 0;
    if (action === 'win_pvp' && this.phase === 'pvp') for (const other of this.players.values()) if (other.id !== p.id) { other.hp = 0; other.alive = false; }
  }

  snapshot(): WorldSnapshot {
    return {
      serverTime: this.now, phase: this.phase, players: [...this.players.values()].filter(p => p.mage).map(p => this.playerSnapshot(p)),
      projectiles: this.projectiles.map(p => ({ id: p.id, ownerId: p.ownerId, mage: p.mage, position: { ...p.position }, explosive: p.explosive })),
      telegraphs: this.telegraphs.map(t => ({ id: t.id, position: { ...t.position }, radius: t.radius, triggerAt: t.triggerAt })),
      minions: this.minions.map(m => ({ id: m.id, position: { ...m.position }, hp: m.hp })),
      boss: this.boss ? { level: this.boss.level, position: { ...this.boss.position }, hp: this.boss.hp, maxHp: this.boss.maxHp, angle: this.boss.angle } : undefined,
      winnerId: this.winnerId,
    };
  }

  private startFarm(level: number): void {
    this.clearWorld(); this.level = level; this.phase = `farm-level-${level}` as GamePhase;
    const starts = [{ x: -4, z: 10 }, { x: 4, z: 10 }, { x: -8, z: 7 }, { x: 8, z: 7 }, { x: -11, z: 2 }, { x: 11, z: 2 }];
    [...this.players.values()].filter(p => p.mage).forEach((p, i) => this.resetPlayer(p, starts[i] ?? { x: 0, z: 10 }));
    const hp = [360, 520, 680][level - 1]!;
    this.boss = { level, position: { x: 0, z: -5 }, hp, maxHp: hp, angle: 0, lastAttackAt: this.now + 1.5 };
    this.io.to(this.socketRoom).emit('phase_changed', this.phase); this.emitSnapshot();
  }

  private startPvp(): void {
    this.clearWorld(); this.phase = 'pvp';
    const starts = [{ x: 0, z: 21 }, { x: -20, z: -12 }, { x: 20, z: -12 }, { x: 0, z: -21 }, { x: -22, z: 5 }, { x: 22, z: 5 }];
    [...this.players.values()].filter(p => p.mage).forEach((p, i) => { this.resetPlayer(p, starts[i] ?? { x: 0, z: 0 }); p.invulnerableUntil = this.now + 3; });
    this.io.to(this.socketRoom).emit('phase_changed', this.phase); this.emitSnapshot();
  }

  private resetPlayer(p: ServerPlayer, position: Vec2): void {
    p.stats = calculateStats(MAGES[p.mage!].stats, p.items); p.hp = p.stats.maxHp; p.shield = p.stats.shield;
    p.position = { ...position }; p.velocity = { x: 0, z: 0 }; p.alive = true; p.respawnAt = undefined;
    p.frozenUntil = 0; p.slowedUntil = 0; p.input = emptyInput(); p.echoReady = false;
  }

  private tick(dt: number): void {
    this.now += dt; this.cleanupDisconnected();
    if (this.isCombat()) {
      for (const p of this.players.values()) this.updatePlayer(p, dt);
      this.updateProjectiles(dt); this.updateBoss(dt); this.updateMinions(dt); this.updateTelegraphs(); this.checkEnd();
    }
    if (this.now - this.lastSnapshotAt >= 1 / 12) { this.lastSnapshotAt = this.now; this.emitSnapshot(); }
  }

  private updatePlayer(p: ServerPlayer, dt: number): void {
    if (!p.mage) return;
    if (!p.alive) { if (this.phase.startsWith('farm') && p.respawnAt && this.now >= p.respawnAt) this.resetPlayer(p, { x: 0, z: 10 }); return; }
    if (!p.connected) return;
    let speed = p.stats.speed * (this.now < p.slowedUntil ? .8 : 1) * (p.mage === 'light' && this.now < p.specialUntil ? 1.7 : 1);
    if (this.now < p.frozenUntil) speed = 0;
    this.move(p, p.input.movement.x * speed * dt, p.input.movement.z * speed * dt);
    if (p.input.shooting) this.shoot(p);
    if (p.mage === 'light' && this.now - p.lastDamagedAt > 4) p.hp = Math.min(p.stats.maxHp, p.hp + 3 * dt);
  }

  private shoot(p: ServerPlayer): void {
    if (!p.mage || !cooldownReady(this.now, p.lastShotAt, p.stats.attackInterval)) return;
    p.lastShotAt = this.now; p.hitCount++; let damage = p.stats.damage;
    if (p.echoReady) { damage *= 1.5; p.echoReady = false; }
    this.spawnProjectile(p, p.input.aim, damage, false, p.mage === 'ice' && this.now < p.specialUntil);
    if (p.items.includes('double-shot') && p.hitCount % 4 === 0) this.spawnProjectile(p, { x: p.input.aim.x * .99 - p.input.aim.z * .12, z: p.input.aim.z * .99 + p.input.aim.x * .12 }, damage * .6, false, false);
  }

  private spawnProjectile(p: ServerPlayer, direction: Vec2, damage: number, explosive: boolean, freeze: boolean): void {
    this.projectiles.push({ id: this.entityId++, ownerId: p.id, mage: p.mage!, position: { x: p.position.x + direction.x, z: p.position.z + direction.z }, previous: { ...p.position }, velocity: { x: direction.x * (explosive ? 13 : 19), z: direction.z * (explosive ? 13 : 19) }, damage, age: 0, explosive, freeze });
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i]!; shot.previous = { ...shot.position }; shot.position.x += shot.velocity.x * dt; shot.position.z += shot.velocity.z * dt; shot.age += dt;
      const owner = this.players.get(shot.ownerId); let hit = false;
      if (this.boss && owner && segmentCircleHit(shot.previous, shot.position, this.boss.position, 2.1)) { this.boss.hp -= shot.damage; hit = true; }
      for (const minion of this.minions) if (owner && segmentCircleHit(shot.previous, shot.position, minion.position, .7)) { minion.hp -= shot.damage; hit = true; break; }
      for (const target of this.players.values()) {
        if (!owner || target.id === owner.id || !target.alive || this.phase.startsWith('farm')) continue;
        if (segmentCircleHit(shot.previous, shot.position, target.position, target.radius + .22)) {
          if (shot.explosive) this.areaDamage(owner, target.position, 3, shot.damage); else { this.damage(target, this.damageFor(owner, target, shot.damage)); if (shot.mage === 'ice') { target.slowedUntil = this.now + 1.5; if (shot.freeze) tryFreeze(target, this.now); } }
          hit = true; break;
        }
      }
      if (hit || shot.age > 2.5 || Math.hypot(shot.position.x, shot.position.z) > (this.phase === 'pvp' ? 29 : 18)) this.projectiles.splice(i, 1);
    }
  }

  private updateBoss(dt: number): void {
    const b = this.boss; if (!b) return; b.angle += dt * (.35 + b.level * .08);
    if (b.level === 2) b.position.x = Math.sin(b.angle) * 3;
    if (b.level === 3 && this.minions.length < 6 && Math.floor(this.now) % 8 === 0 && this.now - b.lastAttackAt > .5) {
      for (let i = 0; i < 2 && this.minions.length < 6; i++) this.minions.push({ id: this.entityId++, position: { x: b.position.x + (i ? 3 : -3), z: b.position.z + 2 }, hp: 28, lastHitAt: -99 });
    }
    const interval = [2.8, 2.25, 1.8][b.level - 1]!;
    if (this.now - b.lastAttackAt >= interval) {
      b.lastAttackAt = this.now; const targets = [...this.players.values()].filter(p => p.alive && p.connected);
      const target = targets[Math.floor(Math.random() * targets.length)]; if (!target) return;
      const count = b.level === 3 && b.hp < b.maxHp * .35 ? 4 : b.level;
      for (let i = 0; i < count; i++) this.telegraphs.push({ id: this.entityId++, position: { x: target.position.x + (i - 1) * 2.2, z: target.position.z + Math.sin(i * 2) * 1.8 }, radius: b.level === 1 ? 2.7 : 1.9, damage: b.level === 1 ? 20 : 17, triggerAt: this.now + .75 + i * .1 });
    }
  }

  private updateMinions(dt: number): void {
    for (let i = this.minions.length - 1; i >= 0; i--) {
      const m = this.minions[i]!; if (m.hp <= 0) { this.minions.splice(i, 1); continue; }
      const target = [...this.players.values()].filter(p => p.alive).sort((a, b) => Math.hypot(a.position.x - m.position.x, a.position.z - m.position.z) - Math.hypot(b.position.x - m.position.x, b.position.z - m.position.z))[0];
      if (!target) continue; const dx = target.position.x - m.position.x, dz = target.position.z - m.position.z, d = Math.hypot(dx, dz) || 1;
      m.position.x += dx / d * 3.2 * dt; m.position.z += dz / d * 3.2 * dt;
      if (d < 1.25 && this.now - m.lastHitAt > 1.1) { m.lastHitAt = this.now; this.damage(target, 8); }
    }
  }

  private updateTelegraphs(): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i]!; if (this.now < t.triggerAt) continue;
      for (const p of this.players.values()) if (p.alive && Math.hypot(p.position.x - t.position.x, p.position.z - t.position.z) <= t.radius) this.damage(p, t.damage);
      this.telegraphs.splice(i, 1);
    }
  }

  private checkEnd(): void {
    if (this.boss && this.boss.hp <= 0) {
      this.boss = undefined; this.projectiles.length = 0; this.telegraphs.length = 0;
      this.phase = `item-choice-${this.level}` as GamePhase; this.io.to(this.socketRoom).emit('phase_changed', this.phase);
      for (const p of this.players.values()) if (p.mage) { p.selectedOffer = offerForLevel(this.level, p.items); this.socketFor(p)?.emit('item_offer', p.selectedOffer); }
    }
    if (this.phase === 'pvp') {
      const alive = [...this.players.values()].filter(p => p.mage && p.alive);
      if (alive.length <= 1) { this.winnerId = determineWinner([...this.players.values()].filter(p => p.mage)); this.phase = 'result'; this.io.to(this.socketRoom).emit('phase_changed', this.phase); this.io.to(this.socketRoom).emit('game_over', { winnerId: this.winnerId, players: [...this.players.values()].filter(p => p.mage).map(p => this.playerSnapshot(p)) }); }
    }
  }

  private damage(target: ServerPlayer, amount: number): void {
    if (target.items.includes('reactive-barrier') && this.now >= target.barrierReadyAt) { amount *= .5; target.barrierReadyAt = this.now + 12; }
    const wasAlive = target.alive; applyDamage(target, amount, this.now);
    if (wasAlive && !target.alive) { target.respawnAt = this.phase.startsWith('farm') ? this.now + 3 : undefined; this.io.to(this.socketRoom).emit('player_died', target.id); }
  }

  private damageFor(owner: ServerPlayer, target: ServerPlayer, base: number): number { return owner.items.includes('wounded-hunter') && target.hp / target.stats.maxHp < .35 ? base * 1.2 : base; }
  private areaDamage(owner: ServerPlayer, center: Vec2, radius: number, amount: number): void {
    if (this.boss && Math.hypot(this.boss.position.x - center.x, this.boss.position.z - center.z) <= radius + 2) this.boss.hp -= amount;
    if (this.phase === 'pvp') for (const p of this.players.values()) if (p.id !== owner.id && p.alive && Math.hypot(p.position.x - center.x, p.position.z - center.z) <= radius) this.damage(p, this.damageFor(owner, p, amount));
  }

  private move(p: ServerPlayer, dx: number, dz: number): void {
    let x = p.position.x + dx, z = p.position.z + dz; const distance = Math.hypot(x, z);
    const arenaRadius = this.phase === 'pvp' ? pvpArenaRadius : pveArenaRadius;
    if (distance > arenaRadius) { x *= arenaRadius / distance; z *= arenaRadius / distance; }
    const scale = this.phase === 'pvp' ? 1.55 : 1; for (const o of obstacles) { const ox=o.x*scale, oz=o.z*scale, d = Math.hypot(x - ox, z - oz), min = p.radius + o.r*scale; if (d < min) { x = ox + (x - ox) / (d || 1) * min; z = oz + (z - oz) / (d || 1) * min; } }
    p.position = { x, z };
  }

  private cleanupDisconnected(): void {
    for (const [id, p] of this.players) {
      if (p.connected || p.disconnectedAt === undefined || this.now - p.disconnectedAt < 30) continue;
      if (this.phase === 'mage-selection') this.players.delete(id); else if (this.phase === 'pvp') { p.alive = false; p.hp = 0; }
    }
  }

  private clearWorld(): void { this.boss = undefined; this.projectiles.length = 0; this.telegraphs.length = 0; this.minions.length = 0; }
  private isCombat(): boolean { return this.phase.startsWith('farm') || this.phase === 'pvp'; }
  private playerFor(socket: GameSocket): ServerPlayer | undefined { return typeof socket.data.playerId === 'string' ? this.players.get(socket.data.playerId) : undefined; }
  private socketFor(p: ServerPlayer): GameSocket | undefined { return p.socketId ? this.io.sockets.sockets.get(p.socketId) : undefined; }
  private cleanName(name: string | undefined, index: number): string { const cleaned = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 16); return cleaned || `Player ${index}`; }
  private playerSnapshot(p: ServerPlayer): PlayerSnapshot { const active = p.items.find(id => ITEMS[id].active); return { id: p.id, name: p.name, playerIndex: p.playerIndex, mage: p.mage, position: { ...p.position }, rotation: p.rotation, hp: p.hp, maxHp: p.stats.maxHp, shield: p.shield, alive: p.alive, connected: p.connected, items: [...p.items], dashCooldown: Math.max(0, p.stats.dashCooldown - (this.now - p.lastDashAt)), specialCooldown: Math.max(0, p.stats.specialCooldown - (this.now - p.lastSpecialAt)), activeCooldown: Math.max(0, (active ? ITEMS[active].cooldown ?? 12 : 0) - (this.now - p.lastActiveAt)), slowedUntil: p.slowedUntil, frozenUntil: p.frozenUntil, specialUntil: p.specialUntil }; }
  private emitSelection(): void { const connected = [...this.players.values()].filter(p => p.connected); this.io.to(this.socketRoom).emit('selection_state', { roomId: this.roomId, players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, playerIndex: p.playerIndex, mage: p.mage, connected: p.connected, isHost: p.id === this.hostId })), minPlayers: 2, maxPlayers: this.maxPlayers, canStart: lobbyCanStart(connected, 2) }); }
  private emitSnapshot(): void { this.io.to(this.socketRoom).emit('snapshot', this.snapshot()); }
}
