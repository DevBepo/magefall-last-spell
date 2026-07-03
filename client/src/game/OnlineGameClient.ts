import * as THREE from 'three';
import { io, type Socket } from 'socket.io-client';
import { MAGES } from '../../../shared/config/mages';
import { ITEMS } from '../../../shared/config/items';
import type { ClientToServerEvents, PlayerSnapshot, SelectionState, ServerToClientEvents, WorldSnapshot } from '../../../shared/protocol';
import type { GamePhase, ItemId, MageId } from '../../../shared/types';
import { createArena, createBossModel } from '../rendering/ArenaFactory';
import { animateMage, createMageModel } from '../rendering/MageFactory';
import { GameUI } from '../ui/GameUI';
import { InputController } from './InputController';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface RenderActor { model: THREE.Group; target: THREE.Vector3; data: PlayerSnapshot }

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

  constructor(host: HTMLElement) {
    this.ui = new GameUI(host); this.ui.showConnection('Conectando ao reino', 'Abrindo o portal...');
    this.setupScene(); this.input = new InputController(this.renderer.domElement);
    this.socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    this.bindSocket();
    this.ui.onSelectMage = mage => this.socket.emit('select_mage', mage, result => { if (!result.ok) this.ui.message(result.message ?? 'Mago indisponível'); else this.selectedMage = mage; });
    this.ui.onSelectItem = item => this.socket.emit('choose_item', item, result => { if (!result.ok) this.ui.message(result.message ?? 'Relíquia inválida'); });
    this.ui.onRestart = () => this.socket.emit('reset_game', result => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível voltar ao lobby.'); });
    this.ui.onStartGame = () => this.socket.emit('start_game', result => { if (!result.ok) this.ui.message(result.message ?? 'Não foi possível iniciar.'); });
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
    this.socket.on('snapshot', snapshot => { this.latest = snapshot; this.phase = snapshot.phase; this.syncWorld(snapshot); });
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

  private onPhaseChanged(phase: GamePhase): void {
    this.phase = phase;
    if (phase.startsWith('farm')) { this.ui.hideOverlay(); this.ui.message(`Nível ${phase.slice(-1)} · ${BOSS_NAMES[Number(phase.slice(-1)) - 1]}`, 1800); }
    if (phase === 'pvp') { this.arena.scale.setScalar(1.55); this.ui.hideOverlay(); this.ui.message('ARENA FINAL · CONFRONTO', 2200); } else this.arena.scale.setScalar(1);
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
    requestAnimationFrame(this.frame); const dt = Math.min((timeMs / 1000 - this.elapsed) || 0, .05); this.elapsed = timeMs / 1000;
    this.raycaster.setFromCamera(this.input.pointer, this.camera); this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld);
    if (this.playerId && this.phase !== 'loading' && timeMs - this.lastInputAt >= 50) { this.lastInputAt = timeMs; const move = this.input.movement(); const me = this.actors.get(this.playerId); const keyboardAim = this.input.keyboardAim(); const mouseAim = me ? new THREE.Vector2(this.pointerWorld.x - me.target.x, this.pointerWorld.z - me.target.z).normalize() : undefined; const aim = keyboardAim ?? (this.input.shooting ? mouseAim : undefined) ?? this.input.aimFallback(); this.socket.emit('player_input', { sequence: ++this.sequence, movement: { x: move.x, z: move.y }, aim: { x: aim.x, z: aim.y }, shooting: this.input.shooting || this.input.keyboardShooting }); }
    for (const [id, actor] of this.actors) {
      actor.model.position.lerp(actor.target, id === this.playerId ? .42 : .22); actor.model.rotation.y = actor.data.rotation; actor.model.visible = actor.data.alive;
      animateMage(actor.model, this.elapsed + id.length, actor.data.alive);
    }
    this.updateCamera(dt); this.updateHud(); this.renderer.render(this.scene, this.camera);
  };

  private syncWorld(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.players.map(p => p.id));
    for (const [id, actor] of this.actors) if (!ids.has(id)) { this.scene.remove(actor.model); this.actors.delete(id); }
    for (const player of snapshot.players) {
      if (!player.mage) continue; let actor = this.actors.get(player.id);
      if (!actor || actor.data.mage !== player.mage) { if (actor) this.scene.remove(actor.model); const model = createMageModel(player.mage, player.id === this.playerId ? 1 : .92, PLAYER_COLORS[(player.playerIndex - 1) % PLAYER_COLORS.length]); this.addNameLabel(model, player); this.scene.add(model); actor = { model, target: new THREE.Vector3(player.position.x, 0, player.position.z), data: player }; this.actors.set(player.id, actor); }
      actor.data = player; actor.target.set(player.position.x, 0, player.position.z);
    }
    this.syncBoss(snapshot); this.syncProjectiles(snapshot); this.syncTelegraphs(snapshot); this.syncMinions(snapshot);
  }

  private syncMinions(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.minions.map(m => m.id));
    for (const [id, mesh] of this.minionMeshes) if (!ids.has(id)) { this.scene.remove(mesh); this.minionMeshes.delete(id); }
    for (const m of snapshot.minions) { let model = this.minionMeshes.get(m.id); if (!model) { model = new THREE.Group(); const body = new THREE.Mesh(new THREE.DodecahedronGeometry(.55), new THREE.MeshStandardMaterial({ color: 0x1a092a, emissive: 0x6d1499, emissiveIntensity: 1 })); const eyes = new THREE.Mesh(new THREE.BoxGeometry(.35,.08,.08), new THREE.MeshBasicMaterial({ color: 0xff3cff })); eyes.position.set(0,.12,.5); model.add(body, eyes); this.scene.add(model); this.minionMeshes.set(m.id, model); } model.position.lerp(new THREE.Vector3(m.position.x,.65,m.position.z),.45); }
  }

  private addNameLabel(model: THREE.Group, player: PlayerSnapshot): void {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64; const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 26px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#050812cc'; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = '#ffffff'; ctx.fillText(`P${player.playerIndex} ${player.name}`, 128, 41);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })); sprite.position.set(0, 3.15, 0); sprite.scale.set(3.2, .8, 1); model.add(sprite);
  }

  private syncBoss(snapshot: WorldSnapshot): void {
    if (!snapshot.boss) { if (this.bossModel) this.scene.remove(this.bossModel); this.bossModel = undefined; this.bossLevel = 0; return; }
    if (!this.bossModel || this.bossLevel !== snapshot.boss.level) { if (this.bossModel) this.scene.remove(this.bossModel); this.bossLevel = snapshot.boss.level; this.bossModel = createBossModel(this.bossLevel); this.scene.add(this.bossModel); }
    this.bossModel.position.set(snapshot.boss.position.x, .25 + Math.sin(this.elapsed * 1.7) * .18, snapshot.boss.position.z); this.bossModel.rotation.y = snapshot.boss.angle;
  }

  private syncProjectiles(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.projectiles.map(p => p.id));
    for (const [id, mesh] of this.projectileMeshes) if (!ids.has(id)) { this.scene.remove(mesh); this.projectileMeshes.delete(id); }
    for (const p of snapshot.projectiles) {
      let mesh = this.projectileMeshes.get(p.id); if (!mesh) { const cfg = MAGES[p.mage]; mesh = new THREE.Mesh(new THREE.SphereGeometry(p.explosive ? .34 : .18, 8, 6), new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 2.5 })); this.scene.add(mesh); this.projectileMeshes.set(p.id, mesh); }
      mesh.position.lerp(new THREE.Vector3(p.position.x, 1.15, p.position.z), .65);
    }
  }

  private syncTelegraphs(snapshot: WorldSnapshot): void {
    const ids = new Set(snapshot.telegraphs.map(t => t.id));
    for (const [id, mesh] of this.telegraphMeshes) if (!ids.has(id)) { this.scene.remove(mesh); this.telegraphMeshes.delete(id); }
    for (const t of snapshot.telegraphs) if (!this.telegraphMeshes.has(t.id)) { const mesh = new THREE.Mesh(new THREE.CircleGeometry(t.radius, 32), new THREE.MeshBasicMaterial({ color: 0xff4058, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide })); mesh.rotation.x = -Math.PI / 2; mesh.position.set(t.position.x, .04, t.position.z); this.scene.add(mesh); this.telegraphMeshes.set(t.id, mesh); }
  }

  private updateCamera(dt: number): void {
    const me = this.playerId ? this.actors.get(this.playerId) : undefined; if (!me) return;
    const focusX = me.model.position.x * .48, focusZ = me.model.position.z * .48;
    const wide = this.phase === 'pvp'; this.camera.position.lerp(new THREE.Vector3(focusX + (wide ? 23 : 18), wide ? 31 : 24, focusZ + (wide ? 28 : 22)), 1 - Math.pow(.015, Math.max(dt, .001))); this.camera.lookAt(focusX, 0, focusZ);
  }

  private updateHud(): void {
    const me = this.latest?.players.find(p => p.id === this.playerId); if (!me || !me.mage || !this.latest || !this.phase.match(/farm|pvp/)) return;
    const cfg = MAGES[me.mage].stats; const boss = this.latest.boss;
    const active = me.items.find(id => ITEMS[id].active); this.ui.updateHud({ hp: me.hp, maxHp: me.maxHp, shield: me.shield, dash: me.dashCooldown / cfg.dashCooldown, special: me.specialCooldown / cfg.specialCooldown, active: active ? me.activeCooldown / (ITEMS[active].cooldown ?? 12) : undefined, items: me.items,
      bossHp: boss?.hp, bossMaxHp: boss?.maxHp, phaseLabel: boss ? BOSS_NAMES[boss.level - 1]! : `${this.latest.players.filter(p => p.alive).length} MAGOS VIVOS`, players: this.latest.players.map(p => ({ name: p.name, playerIndex: p.playerIndex, alive: p.alive })) });
  }

  private clearWorld(): void {
    for (const a of this.actors.values()) this.scene.remove(a.model); this.actors.clear();
    for (const m of this.projectileMeshes.values()) this.scene.remove(m); this.projectileMeshes.clear();
    for (const m of this.telegraphMeshes.values()) this.scene.remove(m); this.telegraphMeshes.clear();
    for (const m of this.minionMeshes.values()) this.scene.remove(m); this.minionMeshes.clear();
    if (this.bossModel) this.scene.remove(this.bossModel); this.bossModel = undefined;
  }

  private resize(): void { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
