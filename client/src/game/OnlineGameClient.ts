import * as THREE from 'three';
import { io, type Socket } from 'socket.io-client';
import { MAGES } from '../../../shared/config/mages';
import { ITEMS } from '../../../shared/config/items';
import type { ClientToServerEvents, FarmRoomState, PlayerSnapshot, SelectionState, ServerToClientEvents, WorldSnapshot } from '../../../shared/protocol';
import type { GamePhase, ItemId, MageId } from '../../../shared/types';
import { createArena, createBossModel } from '../rendering/ArenaFactory';
import { animateMage, createMageModel } from '../rendering/MageFactory';
import { GameUI } from '../ui/GameUI';
import { InputController } from './InputController';
import { GameClient } from './GameClient';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface PositionSample { time: number; x: number; z: number; rotation: number }
interface RenderActor { model: THREE.Group; target: THREE.Vector3; data: PlayerSnapshot; history: PositionSample[] }

const BOSS_NAMES = ['Guardião de Pedra', 'Serpente de Cristal', 'Arquimago do Vazio'];
const PLAYER_COLORS = [0x4cc9f0, 0xffca3a, 0xff595e, 0x8ac926, 0xc77dff, 0xff8fab];

export class OnlineGameClient {
  private readonly ui: GameUI;
  private readonly socket: GameSocket;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly input: InputController;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly actors = new Map<string, RenderActor>();
  private readonly projectileMeshes = new Map<number, THREE.Mesh>();
  private readonly telegraphMeshes = new Map<number, THREE.Mesh>();
  private readonly minionMeshes = new Map<number, THREE.Group>();
  private readonly arena = createArena();
  private readonly testMode = new URLSearchParams(location.search).has('test');
  private readonly debugMode = new URLSearchParams(location.search).get('debug') === '1';
  private readonly interpolationDelay = .12;
  private readonly tempVector = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly mouseAim = new THREE.Vector2();
  private playerId?: string;
  private phase: GamePhase = 'loading';
  private latest?: WorldSnapshot;
  private bossModel?: THREE.Group;
  private bossLevel = 0;
  private sequence = 0;
  private elapsed = 0;
  private lastInputAt = 0;
  private selectedMage?: MageId;
  private selectionState?: SelectionState;
  private roomId?: string;
  private isHost = false;
  private lastSnapshotClientAt = 0;
  private lastSnapshotServerTime = 0;
  private snapshotCount = 0;
  private snapshotRate = 0;
  private perceivedTickRate = 0;
  private snapshotBytes = 0;
  private debugWindowStartedAt = performance.now();
  private frameCount = 0;
  private fps = 0;
  private rtt = 0;
  private readonly rttSamples: number[] = [];
  private lastHudUpdateAt = 0;
  private localFarm?: GameClient;
  private localFarmHost?: HTMLElement;
  private farmState?: FarmRoomState;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.ui = new GameUI(host); this.ui.showConnection('Conectando ao reino', 'Abrindo o portal...');
    this.setupScene(); this.input = new InputController(this.renderer.domElement);
    this.socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    this.bindSocket();
    if (this.debugMode) window.setInterval(() => this.measureRtt(), 1000);
    this.ui.onSelectMage = mage => this.socket.emit('select_mage', mage, result => { if (!result.ok) this.ui.message(result.message ?? 'Mago indisponível'); else { this.selectedMage = mage; if (this.phase === 'solo-farm' && !this.localFarm) this.startLocalFarm(mage); } });
    this.ui.onSelectItem = item => this.socket.emit('choose_item', item, result => { if (!result.ok) this.ui.message(result.message ?? 'Relíquia inválida'); });
    this.ui.onRestart = () => this.socket.emit('reset_game', result => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível voltar ao lobby.'); });
    this.ui.onStartGame = () => this.socket.emit('start_game', result => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível iniciar.'); });
    this.ui.onStartPvp = () => this.socket.emit('start_pvp', result => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível iniciar o PvP.'); });
    this.ui.onCreateRoom = name => this.enterRoom('create', name);
    this.ui.onJoinRoom = (name, roomId) => this.enterRoom('join', name, roomId);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', event => {
      if (event.code === 'Space') this.socket.emit('dash');
      if (event.code === 'KeyQ') this.socket.emit('special');
      if (event.code === 'KeyE') this.socket.emit('use_active');
      if (this.testMode && event.code === 'KeyK') this.socket.emit('test_action', this.phase === 'pvp' ? 'win_pvp' : 'kill_boss');
    });
  }

  start(): void { requestAnimationFrame(this.frame); }

  private enterRoom(kind: 'create' | 'join', name: string, roomId = ''): void {
    localStorage.setItem('mage-name', name); const requested = Number(new URLSearchParams(location.search).get('players'));
    const payload = { name, testMode: this.testMode, testPlayers: (requested === 2 ? 2 : 4) as 2 | 4 };
    const done = (result: { ok: boolean; message?: string }) => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível entrar na sala.'); };
    if (kind === 'create') this.socket.emit('create_room', payload, done);
    else this.socket.emit('join_room', { ...payload, roomId }, done);
  }

  private joinRoom(name: string, roomId: string, reconnectToken: string): void {
    const requested = Number(new URLSearchParams(location.search).get('players'));
    this.socket.emit('join_room', { roomId, name, reconnectToken, testMode: this.testMode, testPlayers: requested === 2 ? 2 : 4 }, result => {
      if (!result.ok) { localStorage.removeItem('mage-room'); localStorage.removeItem('mage-reconnect'); this.ui.showHome(); this.ui.message(result.message ?? 'A sala anterior expirou.'); }
    });
  }

  private bindSocket(): void {
    this.socket.on('connect', () => {
      const roomId = localStorage.getItem('mage-room'); const token = localStorage.getItem('mage-reconnect');
      if (roomId && token) this.joinRoom(localStorage.getItem('mage-name') ?? '', roomId, token); else this.ui.showHome();
    });
    this.socket.on('connect_error', () => this.ui.showConnection('Servidor indisponível', 'Inicie client e server com npm run dev ou use o modo offline.', true));
    this.socket.on('connection_state', state => { this.playerId = state.playerId; this.roomId = state.roomId; this.isHost = state.isHost; localStorage.setItem('mage-reconnect', state.reconnectToken); localStorage.setItem('mage-room', state.roomId); });
    this.socket.on('selection_state', state => {
      if (this.phase !== 'loading' && this.phase !== 'mage-selection') return;
      this.phase = 'mage-selection'; this.selectionState = state; this.isHost = state.players.find(p => p.id === this.playerId)?.isHost ?? false;
      this.ui.showMageSelection(state, this.playerId);
    });
    this.socket.on('phase_changed', phase => this.onPhaseChanged(phase));
    this.socket.on('room_state', state => { this.farmState = state; });
    this.socket.on('farm_status_updated', state => { this.farmState = state; if (state.players.find(p => p.playerId === this.playerId)?.readyForPvp) this.ui.showWaiting(state, this.playerId); });
    this.socket.on('farm_completed_ack', state => { this.stopLocalFarm(); this.farmState = state; this.ui.showWaiting(state, this.playerId); });
    this.socket.on('farm_completed_rejected', message => this.ui.message(message));
    this.socket.on('snapshot', snapshot => this.receiveSnapshot(snapshot));
    this.socket.on('item_offer', offer => this.ui.showItemChoice(Number(this.phase.slice(-1)), offer));
    this.socket.on('item_chosen', items => this.ui.message(`${items.length}/3 relíquias prontas`));
    this.socket.on('player_died', id => { const actor = this.actors.get(id); if (actor) actor.model.visible = false; if (id === this.playerId) this.ui.message(this.phase === 'pvp' ? 'Você foi eliminado' : 'Retornando em 3 segundos...'); });
    this.socket.on('game_over', result => {
      const me = result.players.find(p => p.id === this.playerId); if (!me?.mage) return;
      const winner = result.players.find(p => p.id === result.winnerId);
      this.ui.showResult(result.winnerId === this.playerId, me.mage, me.items, winner?.name ?? 'Ninguém', this.isHost);
    });
    this.socket.on('game_reset', () => { this.clearWorld(); this.selectedMage = undefined; });
    this.socket.on('error_message', message => this.ui.message(message));
  }

  private receiveSnapshot(snapshot: WorldSnapshot): void {
    const now = performance.now(); this.snapshotCount++;
    if (this.lastSnapshotClientAt && snapshot.serverTime > this.lastSnapshotServerTime) this.perceivedTickRate = 1 / (snapshot.serverTime - this.lastSnapshotServerTime);
    this.lastSnapshotClientAt = now; this.lastSnapshotServerTime = snapshot.serverTime; if (this.debugMode) this.snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    this.latest = snapshot; this.phase = snapshot.phase; this.syncWorld(snapshot);
  }

  private measureRtt(): void {
    if (!this.socket.connected) return; const sentAt = performance.now();
    this.socket.emit('debug_ping', sentAt, echoed => { this.rtt = performance.now() - echoed; this.rttSamples.push(this.rtt); if (this.rttSamples.length > 10) this.rttSamples.shift(); });
  }

  private onPhaseChanged(phase: GamePhase): void {
    this.phase = phase;
    if (phase === 'solo-farm' && this.selectedMage && !this.localFarm) this.startLocalFarm(this.selectedMage);
    if (phase.startsWith('farm')) { this.ui.hideOverlay(); this.ui.message(`Nível ${phase.slice(-1)} · ${BOSS_NAMES[Number(phase.slice(-1)) - 1]}`, 1800); }
    if (phase === 'pvp') { this.stopLocalFarm(); this.arena.scale.setScalar(1.55); this.ui.hideOverlay(); this.ui.message('ARENA FINAL · CONFRONTO', 2200); } else this.arena.scale.setScalar(1);
    if (phase === 'mage-selection') this.ui.showMageSelection(this.selectionState, this.playerId);
  }

  private setupScene(): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.28;
    this.ui.root.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x091124); this.scene.fog = new THREE.FogExp2(0x091124, .02);
    this.scene.add(this.arena); this.scene.add(new THREE.HemisphereLight(0x9eb8ff, 0x172038, 2.05));
    const moon = new THREE.DirectionalLight(0xc8dcff, 2.3); moon.position.set(-12, 22, 10); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); this.scene.add(moon);
    this.camera.position.set(18, 24, 23); this.camera.lookAt(0, 0, 0);
  }

  private frame = (timeMs: number): void => {
    requestAnimationFrame(this.frame); const dt = Math.min((timeMs / 1000 - this.elapsed) || 0, .05); this.elapsed = timeMs / 1000; this.frameCount++;
    this.raycaster.setFromCamera(this.input.pointer, this.camera); this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld);
    const movement = this.input.movement();
    if (this.playerId && this.phase !== 'loading' && timeMs - this.lastInputAt >= 50) { this.lastInputAt = timeMs; const me = this.actors.get(this.playerId); const keyboardAim = this.input.keyboardAim(); const mouseAim = me ? this.mouseAim.set(this.pointerWorld.x - me.target.x, this.pointerWorld.z - me.target.z).normalize() : undefined; const aim = keyboardAim ?? (this.input.shooting ? mouseAim : undefined) ?? this.input.aimFallback(); this.socket.emit('player_input', { sequence: ++this.sequence, movement: { x: Math.round(movement.x * 1000) / 1000, z: Math.round(movement.y * 1000) / 1000 }, aim: { x: Math.round(aim.x * 1000) / 1000, z: Math.round(aim.y * 1000) / 1000 }, shooting: this.input.shooting || this.input.keyboardShooting }); }
    const renderTime = this.latest ? this.latest.serverTime + Math.max(0, timeMs - this.lastSnapshotClientAt) / 1000 - this.interpolationDelay : 0;
    for (const [id, actor] of this.actors) {
      if (id === this.playerId) {
        if (actor.data.mage && actor.data.alive && this.phase.match(/farm|pvp/)) { const speed = MAGES[actor.data.mage].stats.speed; actor.model.position.x += movement.x * speed * dt; actor.model.position.z += movement.y * speed * dt; }
        const error = actor.model.position.distanceTo(actor.target); if (error > 5) actor.model.position.copy(actor.target); else actor.model.position.lerp(actor.target, 1 - Math.pow(.08, dt)); actor.model.rotation.y = actor.data.rotation;
      } else this.interpolateActor(actor, renderTime);
      actor.model.visible = actor.data.alive;
      animateMage(actor.model, this.elapsed + id.length, actor.data.alive);
    }
    this.interpolateEntities(dt); this.updateDebug(timeMs);
    this.updateCamera(dt); if (this.elapsed - this.lastHudUpdateAt >= .1) { this.lastHudUpdateAt = this.elapsed; this.updateHud(); } this.renderer.render(this.scene, this.camera);
  };

  private syncWorld(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.players.map(p => p.id));
    for (const [id, actor] of this.actors) if (!ids.has(id)) { this.removeObject(actor.model); this.actors.delete(id); }
    for (const player of snapshot.players) {
      if (!player.mage) continue; let actor = this.actors.get(player.id);
      if (!actor || actor.data.mage !== player.mage) { if (actor) this.removeObject(actor.model); const model = createMageModel(player.mage, player.id === this.playerId ? 1 : .92, PLAYER_COLORS[(player.playerIndex - 1) % PLAYER_COLORS.length]); this.addNameLabel(model, player); this.scene.add(model); actor = { model, target: new THREE.Vector3(player.position.x, 0, player.position.z), data: player, history: [] }; this.actors.set(player.id, actor); }
      actor.data = player; actor.target.set(player.position.x, 0, player.position.z); actor.history.push({ time: snapshot.serverTime, x: player.position.x, z: player.position.z, rotation: player.rotation }); if (actor.history.length > 8) actor.history.shift();
    }
    this.syncBoss(snapshot); this.syncProjectiles(snapshot); this.syncTelegraphs(snapshot); this.syncMinions(snapshot);
  }

  private startLocalFarm(mage: MageId): void {
    const mount = document.createElement('div'); mount.className = 'local-farm'; this.host.append(mount); this.localFarmHost = mount;
    this.localFarm = new GameClient(mount, { soloMage: mage, onFarmComplete: (mageId, items, finalStats) => {
      if (items.length !== 3) return; this.socket.emit('farm_completed', { mageId, selectedItems: [items[0]!, items[1]!], activeRelic: items[2]!, finalStats, completedAt: Date.now() }, result => { if (!result.ok) this.ui.message(result.message ?? 'Build rejeitada.'); });
    } }); this.localFarm.start();
  }
  private stopLocalFarm(): void { this.localFarm?.stop(); this.localFarm = undefined; this.localFarmHost?.remove(); this.localFarmHost = undefined; }

  private syncMinions(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.minions.map(m => m.id));
    for (const [id, mesh] of this.minionMeshes) if (!ids.has(id)) { this.removeObject(mesh); this.minionMeshes.delete(id); }
    for (const m of snapshot.minions) { let model = this.minionMeshes.get(m.id); if (!model) { model = new THREE.Group(); const body = new THREE.Mesh(new THREE.DodecahedronGeometry(.55), new THREE.MeshStandardMaterial({ color: 0x1a092a, emissive: 0x6d1499, emissiveIntensity: 1 })); const eyes = new THREE.Mesh(new THREE.BoxGeometry(.35,.08,.08), new THREE.MeshBasicMaterial({ color: 0xff3cff })); eyes.position.set(0,.12,.5); model.add(body, eyes); model.position.set(m.position.x,.65,m.position.z); this.scene.add(model); this.minionMeshes.set(m.id, model); } model.userData.targetX = m.position.x; model.userData.targetZ = m.position.z; }
  }

  private addNameLabel(model: THREE.Group, player: PlayerSnapshot): void {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64; const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 26px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#050812cc'; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = '#ffffff'; ctx.fillText(`P${player.playerIndex} ${player.name}`, 128, 41);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })); sprite.position.set(0, 3.15, 0); sprite.scale.set(3.2, .8, 1); model.add(sprite);
  }

  private interpolateActor(actor: RenderActor, renderTime: number): void {
    while (actor.history.length > 2 && actor.history[1]!.time <= renderTime) actor.history.shift();
    const from = actor.history[0], to = actor.history[1] ?? from; if (!from || !to) return;
    const span = Math.max(.001, to.time - from.time), alpha = Math.max(0, Math.min(1, (renderTime - from.time) / span));
    this.tempVector.set(from.x + (to.x - from.x) * alpha, 0, from.z + (to.z - from.z) * alpha);
    if (actor.model.position.distanceTo(this.tempVector) > 7) actor.model.position.copy(this.tempVector); else actor.model.position.lerp(this.tempVector, .72);
    actor.model.rotation.y = from.rotation + (to.rotation - from.rotation) * alpha;
  }

  private interpolateEntities(dt: number): void {
    const alpha = 1 - Math.pow(.001, Math.max(dt, .001));
    for (const mesh of this.projectileMeshes.values()) { mesh.position.x += ((mesh.userData.targetX as number) - mesh.position.x) * alpha; mesh.position.z += ((mesh.userData.targetZ as number) - mesh.position.z) * alpha; }
    for (const mesh of this.minionMeshes.values()) { mesh.position.x += ((mesh.userData.targetX as number) - mesh.position.x) * alpha; mesh.position.z += ((mesh.userData.targetZ as number) - mesh.position.z) * alpha; }
  }

  private updateDebug(timeMs: number): void {
    if (!this.debugMode || timeMs - this.debugWindowStartedAt < 1000) return;
    const seconds = (timeMs - this.debugWindowStartedAt) / 1000; this.fps = this.frameCount / seconds; this.snapshotRate = this.snapshotCount / seconds;
    const averageRtt = this.rttSamples.length ? this.rttSamples.reduce((sum, value) => sum + value, 0) / this.rttSamples.length : 0;
    this.ui.updateDebug({ fps: this.fps, rtt: this.rtt, averageRtt, snapshotRate: this.snapshotRate, perceivedTickRate: this.perceivedTickRate, players: this.latest?.players.length ?? 0, projectiles: this.latest?.projectiles.length ?? 0, minions: this.latest?.minions.length ?? 0, snapshotBytes: this.snapshotBytes, interpolationDelay: this.interpolationDelay * 1000, connection: this.socket.connected ? `connected/${this.socket.io.engine.transport.name}` : 'disconnected' });
    this.frameCount = 0; this.snapshotCount = 0; this.debugWindowStartedAt = timeMs;
  }

  private removeObject(object: THREE.Object3D): void { this.scene.remove(object); object.traverse(child => { if (!(child instanceof THREE.Mesh || child instanceof THREE.Sprite)) return; const materials = Array.isArray(child.material) ? child.material : [child.material]; for (const material of materials) { const map = 'map' in material ? material.map as THREE.Texture | null : null; map?.dispose(); material.dispose(); } if (child instanceof THREE.Mesh) child.geometry.dispose(); }); }

  private syncBoss(snapshot: WorldSnapshot): void {
    if (!snapshot.boss) { if (this.bossModel) this.removeObject(this.bossModel); this.bossModel = undefined; this.bossLevel = 0; return; }
    if (!this.bossModel || this.bossLevel !== snapshot.boss.level) { if (this.bossModel) this.removeObject(this.bossModel); this.bossLevel = snapshot.boss.level; this.bossModel = createBossModel(this.bossLevel); this.scene.add(this.bossModel); }
    this.bossModel.position.set(snapshot.boss.position.x, .25 + Math.sin(this.elapsed * 1.7) * .18, snapshot.boss.position.z); this.bossModel.rotation.y = snapshot.boss.angle;
  }

  private syncProjectiles(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.projectiles.map(p => p.id));
    for (const [id, mesh] of this.projectileMeshes) if (!ids.has(id)) { this.removeObject(mesh); this.projectileMeshes.delete(id); }
    for (const p of snapshot.projectiles) {
      let mesh = this.projectileMeshes.get(p.id); if (!mesh) { const cfg = MAGES[p.mage]; mesh = new THREE.Mesh(new THREE.SphereGeometry(p.explosive ? .34 : .18, 8, 6), new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 2.5 })); this.scene.add(mesh); this.projectileMeshes.set(p.id, mesh); }
      if (!mesh.userData.initialized) { mesh.position.set(p.position.x, 1.15, p.position.z); mesh.userData.initialized = true; } mesh.userData.targetX = p.position.x; mesh.userData.targetZ = p.position.z;
    }
  }

  private syncTelegraphs(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.telegraphs.map(t => t.id));
    for (const [id, mesh] of this.telegraphMeshes) if (!ids.has(id)) { this.removeObject(mesh); this.telegraphMeshes.delete(id); }
    for (const t of snapshot.telegraphs) if (!this.telegraphMeshes.has(t.id)) { const mesh = new THREE.Mesh(new THREE.CircleGeometry(t.radius, 32), new THREE.MeshBasicMaterial({ color: 0xff4058, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.set(t.position.x, .04, t.position.z); this.scene.add(mesh); this.telegraphMeshes.set(t.id, mesh); }
  }

  private updateCamera(dt: number): void {
    const me = this.playerId ? this.actors.get(this.playerId) : undefined; if (!me) return;
    const focusX = me.model.position.x * .48, focusZ = me.model.position.z * .48;
    const wide = this.phase === 'pvp'; this.cameraTarget.set(focusX + (wide ? 23 : 18), wide ? 31 : 24, focusZ + (wide ? 28 : 22)); this.camera.position.lerp(this.cameraTarget, 1 - Math.pow(.015, Math.max(dt, .001))); this.camera.lookAt(focusX, 0, focusZ);
  }

  private updateHud(): void {
    const me = this.latest?.players.find(p => p.id === this.playerId); if (!me || !me.mage || !this.latest || !this.phase.match(/farm|pvp/)) return;
    const cfg = MAGES[me.mage].stats; const boss = this.latest.boss;
    const active = me.items.find(id => ITEMS[id].active); this.ui.updateHud({ hp: me.hp, maxHp: me.maxHp, shield: me.shield, dash: me.dashCooldown / cfg.dashCooldown, special: me.specialCooldown / cfg.specialCooldown, active: active ? me.activeCooldown / (ITEMS[active].cooldown ?? 12) : undefined, items: me.items,
      bossHp: boss?.hp, bossMaxHp: boss?.maxHp, phaseLabel: boss ? BOSS_NAMES[boss.level - 1]! : `${this.latest.players.filter(p => p.alive).length} MAGOS VIVOS`, players: this.latest.players.map(p => ({ name: p.name, playerIndex: p.playerIndex, alive: p.alive })) });
  }

  private clearWorld(): void {
    for (const a of this.actors.values()) this.removeObject(a.model); this.actors.clear();
    for (const m of this.projectileMeshes.values()) this.removeObject(m); this.projectileMeshes.clear();
    for (const m of this.telegraphMeshes.values()) this.removeObject(m); this.telegraphMeshes.clear();
    for (const m of this.minionMeshes.values()) this.removeObject(m); this.minionMeshes.clear();
    if (this.bossModel) this.removeObject(this.bossModel); this.bossModel = undefined;
  }

  private resize(): void { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
