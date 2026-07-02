import * as THREE from 'three';
import { io, type Socket } from 'socket.io-client';
import { MAGES } from '../../../shared/config/mages';
import type { ClientToServerEvents, PlayerSnapshot, ServerToClientEvents, WorldSnapshot } from '../../../shared/protocol';
import type { GamePhase, ItemId, MageId } from '../../../shared/types';
import { createArena, createBossModel } from '../rendering/ArenaFactory';
import { animateMage, createMageModel } from '../rendering/MageFactory';
import { GameUI } from '../ui/GameUI';
import { InputController } from './InputController';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface RenderActor { model: THREE.Group; target: THREE.Vector3; data: PlayerSnapshot }

const BOSS_NAMES = ['Guardião de Pedra', 'Serpente de Cristal', 'Arquimago do Vazio'];

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

  constructor(host: HTMLElement) {
    this.ui = new GameUI(host); this.ui.showConnection('Conectando ao reino', 'Procurando a sala fixa...');
    this.setupScene(); this.input = new InputController(this.renderer.domElement);
    this.socket = io({ transports: ['websocket', 'polling'], reconnection: true });
    this.bindSocket();
    this.ui.onSelectMage = mage => this.socket.emit('select_mage', mage, result => { if (!result.ok) this.ui.message(result.message ?? 'Mago indisponível'); else this.selectedMage = mage; });
    this.ui.onSelectItem = item => this.socket.emit('choose_item', item, result => { if (!result.ok) this.ui.message(result.message ?? 'Relíquia inválida'); });
    this.ui.onRestart = () => this.socket.emit('reset_game');
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', event => {
      if (event.code === 'Space') this.socket.emit('dash');
      if (event.code === 'KeyQ') this.socket.emit('special');
      if (this.testMode && event.code === 'KeyK') this.socket.emit('test_action', this.phase === 'pvp' ? 'win_pvp' : 'kill_boss');
    });
  }

  start(): void { requestAnimationFrame(this.frame); }

  private bindSocket(): void {
    this.socket.on('connect', () => {
      const requested = Number(new URLSearchParams(location.search).get('players'));
      this.socket.emit('join_game', { reconnectToken: localStorage.getItem('mage-reconnect') ?? undefined, testMode: this.testMode, testPlayers: requested === 2 ? 2 : 4 });
    });
    this.socket.on('connect_error', () => this.ui.showConnection('Servidor indisponível', 'Inicie client e server com npm run dev ou use o modo offline.', true));
    this.socket.on('connection_state', state => { this.playerId = state.playerId; localStorage.setItem('mage-reconnect', state.reconnectToken); });
    this.socket.on('room_full', () => this.ui.showConnection('Sala cheia', 'Os quatro lugares já estão ocupados. Tente novamente depois.', true));
    this.socket.on('selection_state', state => {
      if (this.phase !== 'loading' && this.phase !== 'mage-selection') return;
      this.phase = 'mage-selection';
      const taken = state.players.filter(p => p.mage && p.id !== this.playerId).map(p => p.mage!);
      this.ui.showMageSelection(taken, state.players.filter(p => p.connected).length, state.requiredPlayers);
    });
    this.socket.on('phase_changed', phase => this.onPhaseChanged(phase));
    this.socket.on('snapshot', snapshot => { this.latest = snapshot; this.phase = snapshot.phase; this.syncWorld(snapshot); });
    this.socket.on('item_offer', offer => this.ui.showItemChoice(Number(this.phase.slice(-1)), offer));
    this.socket.on('item_chosen', items => this.ui.message(`${items.length}/3 relíquias prontas`));
    this.socket.on('player_died', id => { const actor = this.actors.get(id); if (actor) actor.model.visible = false; if (id === this.playerId) this.ui.message(this.phase === 'pvp' ? 'Você foi eliminado' : 'Retornando em 3 segundos...'); });
    this.socket.on('game_over', result => {
      const me = result.players.find(p => p.id === this.playerId); if (!me?.mage) return;
      this.ui.showResult(result.winnerId === this.playerId, me.mage, me.items);
    });
    this.socket.on('game_reset', () => { this.clearWorld(); this.selectedMage = undefined; });
    this.socket.on('error_message', message => this.ui.message(message));
  }

  private onPhaseChanged(phase: GamePhase): void {
    this.phase = phase;
    if (phase.startsWith('farm')) { this.ui.hideOverlay(); this.ui.message(`Nível ${phase.slice(-1)} · ${BOSS_NAMES[Number(phase.slice(-1)) - 1]}`, 1800); }
    if (phase === 'pvp') { this.ui.hideOverlay(); this.ui.message('ARENA FINAL · 3', 2200); }
    if (phase === 'mage-selection') this.ui.showMageSelection();
  }

  private setupScene(): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)); this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.28;
    this.ui.root.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x091124); this.scene.fog = new THREE.FogExp2(0x091124, .02);
    this.scene.add(createArena()); this.scene.add(new THREE.HemisphereLight(0x9eb8ff, 0x172038, 2.05));
    const moon = new THREE.DirectionalLight(0xc8dcff, 2.3); moon.position.set(-12, 22, 10); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); this.scene.add(moon);
    this.camera.position.set(18, 24, 23); this.camera.lookAt(0, 0, 0);
  }

  private frame = (timeMs: number): void => {
    requestAnimationFrame(this.frame); const dt = Math.min((timeMs / 1000 - this.elapsed) || 0, .05); this.elapsed = timeMs / 1000;
    this.raycaster.setFromCamera(this.input.pointer, this.camera); this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld);
    if (this.playerId && this.phase !== 'loading' && timeMs - this.lastInputAt >= 50) { this.lastInputAt = timeMs; const move = this.input.movement(); const me = this.actors.get(this.playerId); const aim = me ? new THREE.Vector2(this.pointerWorld.x - me.target.x, this.pointerWorld.z - me.target.z).normalize() : new THREE.Vector2(0, -1); this.socket.emit('player_input', { sequence: ++this.sequence, movement: { x: move.x, z: move.y }, aim: { x: aim.x, z: aim.y }, shooting: this.input.shooting }); }
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
      if (!actor || actor.data.mage !== player.mage) { if (actor) this.scene.remove(actor.model); const model = createMageModel(player.mage, player.id === this.playerId ? 1 : .92); this.scene.add(model); actor = { model, target: new THREE.Vector3(player.position.x, 0, player.position.z), data: player }; this.actors.set(player.id, actor); }
      actor.data = player; actor.target.set(player.position.x, 0, player.position.z);
    }
    this.syncBoss(snapshot); this.syncProjectiles(snapshot); this.syncTelegraphs(snapshot);
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
    this.camera.position.lerp(new THREE.Vector3(focusX + 18, 24, focusZ + 22), 1 - Math.pow(.015, Math.max(dt, .001))); this.camera.lookAt(focusX, 0, focusZ);
  }

  private updateHud(): void {
    const me = this.latest?.players.find(p => p.id === this.playerId); if (!me || !me.mage || !this.latest || !this.phase.match(/farm|pvp/)) return;
    const cfg = MAGES[me.mage].stats; const boss = this.latest.boss;
    this.ui.updateHud({ hp: me.hp, maxHp: me.maxHp, shield: me.shield, dash: me.dashCooldown / cfg.dashCooldown, special: me.specialCooldown / cfg.specialCooldown, items: me.items,
      bossHp: boss?.hp, bossMaxHp: boss?.maxHp, phaseLabel: boss ? BOSS_NAMES[boss.level - 1]! : `${this.latest.players.filter(p => p.alive).length} MAGOS VIVOS` });
  }

  private clearWorld(): void {
    for (const a of this.actors.values()) this.scene.remove(a.model); this.actors.clear();
    for (const m of this.projectileMeshes.values()) this.scene.remove(m); this.projectileMeshes.clear();
    for (const m of this.telegraphMeshes.values()) this.scene.remove(m); this.telegraphMeshes.clear();
    if (this.bossModel) this.scene.remove(this.bossModel); this.bossModel = undefined;
  }

  private resize(): void { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
}
