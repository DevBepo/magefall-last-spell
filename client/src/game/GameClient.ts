import * as THREE from 'three';
import { MAGES } from '../../../shared/config/mages';
import { ITEMS, addItem, calculateStats, offerForLevel } from '../../../shared/config/items';
import { applyDamage, cooldownReady, segmentCircleHit, tryFreeze } from '../../../shared/game/combat';
import { GameStateMachine, nextPhase } from '../../../shared/game/stateMachine';
import type { Combatant, ItemId, MageId, Stats, Vec2 } from '../../../shared/types';
import { createArena, createBossModel } from '../rendering/ArenaFactory';
import { animateMage, createMageModel } from '../rendering/MageFactory';
import { GameUI } from '../ui/GameUI';
import { InputController } from './InputController';

interface Actor extends Combatant {
  model: THREE.Group;
  stats: Stats;
  isBot: boolean;
  lastShotAt: number;
  lastDashAt: number;
  lastSpecialAt: number;
  specialUntil: number;
  echoReady: boolean;
  hitCount: number;
  barrierReadyAt: number;
  aiAngle: number;
}

interface Projectile {
  mesh: THREE.Mesh;
  owner: Actor;
  velocity: THREE.Vector3;
  damage: number;
  radius: number;
  age: number;
  explosive: boolean;
  freeze: boolean;
}

interface Telegraph {
  mesh: THREE.Mesh;
  createdAt: number;
  triggerAt: number;
  radius: number;
  damage: number;
  position: THREE.Vector3;
}

const PHASE_NAMES = ['Guardião de Pedra', 'Serpente de Cristal', 'Arquimago do Vazio'];
const OBSTACLES = [{ x: -6, z: -4, r: 1.65 }, { x: 5, z: 4, r: 1.65 }, { x: -5, z: 6, r: 1.65 }, { x: 6, z: -6, r: 1.65 }];
const ARENA_RADIUS = 15.2;

export class GameClient {
  private readonly ui: GameUI;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, .1, 150);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointerWorld = new THREE.Vector3();
  private readonly state = new GameStateMachine();
  private readonly actors: Actor[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly telegraphs: Telegraph[] = [];
  private readonly testMode = new URLSearchParams(location.search).has('test');
  private input!: InputController;
  private player?: Actor;
  private mageId: MageId = 'ice';
  private items: ItemId[] = [];
  private boss?: { model: THREE.Group; hp: number; maxHp: number; level: number; lastAttackAt: number; angle: number };
  private elapsed = 0;
  private level = 0;
  private running = false;
  private arena = createArena();
  private flashLight = new THREE.PointLight(0xffffff, 0, 12);

  constructor(host: HTMLElement) {
    this.ui = new GameUI(host);
    this.ui.showLoading();
    this.setupRenderer();
    this.setupScene();
    this.ui.onSelectMage = id => this.selectMage(id);
    this.ui.onSelectItem = id => this.selectItem(id);
    this.ui.onRestart = () => this.resetGame();
    window.setTimeout(() => this.transition('mage-selection'), 900);
    window.addEventListener('resize', () => this.resize());
    if (this.testMode) window.addEventListener('keydown', e => this.handleTestKey(e));
  }

  start(): void {
    this.running = true;
    this.clock.start();
    this.frame();
  }

  private setupRenderer(): void {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.ui.root.append(this.renderer.domElement);
    this.input = new InputController(this.renderer.domElement);
    this.resize();
  }

  private setupScene(): void {
    this.scene.background = new THREE.Color(0x091124);
    this.scene.fog = new THREE.FogExp2(0x091124, .02);
    this.scene.add(this.arena);
    this.scene.add(new THREE.HemisphereLight(0x9eb8ff, 0x172038, 2.05));
    const moon = new THREE.DirectionalLight(0xc8dcff, 2.3);
    moon.position.set(-12, 22, 10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -22; moon.shadow.camera.right = 22; moon.shadow.camera.top = 22; moon.shadow.camera.bottom = -22;
    this.scene.add(moon);
    this.scene.add(this.flashLight);
    this.camera.position.set(18, 24, 23);
    this.camera.lookAt(0, 0, 0);
    this.addStars();
  }

  private addStars(): void {
    const positions = new Float32Array(240 * 3);
    for (let i = 0; i < 240; i++) {
      positions[i * 3] = (Math.random() - .5) * 100;
      positions[i * 3 + 1] = 12 + Math.random() * 35;
      positions[i * 3 + 2] = (Math.random() - .5) * 100;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xa5b9e6, size: .12, transparent: true, opacity: .7 })));
  }

  private transition(to: ReturnType<typeof nextPhase>): void {
    this.state.transition(to);
    if (to === 'mage-selection') this.ui.showMageSelection();
  }

  private selectMage(id: MageId): void {
    this.mageId = id;
    this.ui.hideOverlay();
    this.ui.message(`${MAGES[id].name} desperta`, 1200);
    window.setTimeout(() => {
      this.transition('farm-level-1');
      this.startFarm(1);
    }, 450);
  }

  private startFarm(level: number): void {
    this.level = level;
    this.clearCombat();
    const stats = calculateStats(MAGES[this.mageId].stats, this.items);
    this.player = this.createActor('player', this.mageId, { x: 0, z: 9.5 }, false, stats);
    this.player.shield = stats.shield;
    this.actors.push(this.player);
    this.spawnBoss(level);
    this.ui.message(`Nível ${level} · ${PHASE_NAMES[level - 1]}`, 2200);
  }

  private spawnBoss(level: number): void {
    const model = createBossModel(level);
    model.position.set(0, 0, -5);
    this.scene.add(model);
    const hp = [180, 260, 340][level - 1]!;
    this.boss = { model, hp, maxHp: hp, level, lastAttackAt: this.elapsed + 1.5, angle: 0 };
  }

  private createActor(id: string, mage: MageId, position: Vec2, isBot: boolean, stats = MAGES[mage].stats): Actor {
    const model = createMageModel(mage, isBot ? .92 : 1);
    model.position.set(position.x, 0, position.z);
    this.scene.add(model);
    return {
      id, mage, position: { ...position }, velocity: { x: 0, z: 0 }, hp: stats.maxHp,
      shield: stats.shield, radius: .62, alive: true, invulnerableUntil: 0, slowedUntil: 0,
      frozenUntil: 0, freezeImmuneUntil: 0, lastDamagedAt: -99, model, stats: { ...stats }, isBot,
      lastShotAt: -99, lastDashAt: -99, lastSpecialAt: -99, specialUntil: 0,
      echoReady: false, hitCount: 0, barrierReadyAt: 0, aiAngle: Math.random() * Math.PI * 2,
    };
  }

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(this.clock.getDelta(), .05);
    this.elapsed += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number): void {
    this.raycaster.setFromCamera(this.input.pointer, this.camera);
    this.raycaster.ray.intersectPlane(this.floorPlane, this.pointerWorld);
    if (this.player && this.isCombatPhase()) {
      this.updatePlayer(dt);
      this.updateBots(dt);
      this.updateProjectiles(dt);
      this.updateBoss(dt);
      this.updateTelegraphs();
      this.updateCamera(dt);
      this.updateHud();
      this.checkEndConditions();
    }
    for (const actor of this.actors) animateMage(actor.model, this.elapsed + actor.aiAngle, actor.alive);
    if (this.boss) {
      this.boss.model.position.y = .25 + Math.sin(this.elapsed * 1.7) * .18;
      this.boss.model.getObjectsByProperty('name', 'boss-ring').forEach((r, i) => r.rotation.z = this.elapsed * (.5 + i * .18));
    }
    this.flashLight.intensity *= .86;
  }

  private isCombatPhase(): boolean { return this.state.phase.startsWith('farm') || this.state.phase === 'pvp'; }

  private updatePlayer(dt: number): void {
    const p = this.player!;
    if (!p.alive) return;
    const now = this.elapsed;
    const direction = this.input.movement();
    const frozen = now < p.frozenUntil;
    let speed = p.stats.speed * (now < p.slowedUntil ? .8 : 1) * (p.mage === 'light' && now < p.specialUntil ? 1.7 : 1);
    if (frozen) speed = 0;
    if (this.input.consumeDash() && cooldownReady(now, p.lastDashAt, p.stats.dashCooldown) && !frozen) {
      const dashDir = direction.lengthSq() ? direction : new THREE.Vector2(this.pointerWorld.x - p.position.x, this.pointerWorld.z - p.position.z).normalize();
      this.moveActor(p, dashDir.x * 5, dashDir.y * 5);
      p.lastDashAt = now;
      if (p.mage === 'shadow') p.invulnerableUntil = now + .25;
      if (this.items.includes('explosive-step')) this.areaDamage(p, p.position, 2.2, 12);
      this.burst(p.position, MAGES[p.mage].accent, 12);
    }
    this.moveActor(p, direction.x * speed * dt, direction.y * speed * dt);
    const aim = new THREE.Vector2(this.pointerWorld.x - p.position.x, this.pointerWorld.z - p.position.z);
    if (aim.lengthSq() > .01) p.model.rotation.y = Math.atan2(aim.x, aim.y);
    if (this.input.shooting) this.shoot(p, aim.normalize());
    if (this.input.consumeSpecial()) this.useSpecial(p, aim.normalize());
    if (p.mage === 'light' && now - p.lastDamagedAt > 4 && p.hp < p.stats.maxHp) p.hp = Math.min(p.stats.maxHp, p.hp + 3 * dt);
  }

  private moveActor(actor: Actor, dx: number, dz: number): void {
    if (this.elapsed < actor.frozenUntil) return;
    let x = actor.position.x + dx;
    let z = actor.position.z + dz;
    const length = Math.hypot(x, z);
    if (length > ARENA_RADIUS) { x *= ARENA_RADIUS / length; z *= ARENA_RADIUS / length; }
    for (const o of OBSTACLES) {
      const dist = Math.hypot(x - o.x, z - o.z);
      const min = actor.radius + o.r;
      if (dist < min) { const nx = (x - o.x) / (dist || 1); const nz = (z - o.z) / (dist || 1); x = o.x + nx * min; z = o.z + nz * min; }
    }
    actor.position.x = x; actor.position.z = z;
    actor.model.position.x = x; actor.model.position.z = z;
  }

  private shoot(actor: Actor, direction: THREE.Vector2): void {
    const now = this.elapsed;
    if (!actor.alive || now < actor.frozenUntil || direction.lengthSq() === 0 || !cooldownReady(now, actor.lastShotAt, actor.stats.attackInterval)) return;
    actor.lastShotAt = now;
    actor.hitCount++;
    let damage = actor.stats.damage;
    if (actor.echoReady) { damage *= 1.5; actor.echoReady = false; }
    this.spawnProjectile(actor, direction, damage, false, actor.mage === 'ice' && now < actor.specialUntil);
    if (this.itemsFor(actor).includes('double-shot') && actor.hitCount % 4 === 0) {
      const angle = Math.atan2(direction.y, direction.x) + .12;
      this.spawnProjectile(actor, new THREE.Vector2(Math.cos(angle), Math.sin(angle)), damage * .6, false, false);
    }
  }

  private spawnProjectile(owner: Actor, direction: THREE.Vector2, damage: number, explosive: boolean, freeze: boolean): void {
    const cfg = MAGES[owner.mage];
    const mat = new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 2.5 });
    const mesh = new THREE.Mesh(owner.mage === 'ice' ? new THREE.OctahedronGeometry(.2) : new THREE.SphereGeometry(.18, 8, 6), mat);
    mesh.position.set(owner.position.x + direction.x * .9, 1.15, owner.position.z + direction.y * .9);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const speed = explosive ? 13 : 19;
    this.projectiles.push({ mesh, owner, velocity: new THREE.Vector3(direction.x * speed, 0, direction.y * speed), damage, radius: explosive ? .35 : .22, age: 0, explosive, freeze });
  }

  private useSpecial(actor: Actor, aim: THREE.Vector2): void {
    const now = this.elapsed;
    if (!actor.alive || !cooldownReady(now, actor.lastSpecialAt, actor.stats.specialCooldown)) return;
    actor.lastSpecialAt = now;
    actor.echoReady = this.itemsFor(actor).includes('elemental-echo');
    if (actor.mage === 'ice') { actor.specialUntil = now + 4; this.ui.message(actor.isBot ? '' : 'Inverno absoluto'); }
    if (actor.mage === 'fire') this.spawnProjectile(actor, aim, 30, true, false);
    if (actor.mage === 'shadow') { this.moveActor(actor, aim.x * 6, aim.y * 6); actor.invulnerableUntil = now + .15; this.burst(actor.position, MAGES.shadow.accent, 18); }
    if (actor.mage === 'light') { actor.specialUntil = now + 3; this.burst(actor.position, MAGES.light.accent, 18); }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const from = { x: p.mesh.position.x, z: p.mesh.position.z };
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 8; p.mesh.rotation.z += dt * 5; p.age += dt;
      const to = { x: p.mesh.position.x, z: p.mesh.position.z };
      let hit = false;
      if (this.boss && p.owner === this.player && segmentCircleHit(from, to, { x: this.boss.model.position.x, z: this.boss.model.position.z }, 2.1)) {
        this.boss.hp -= this.projectileDamage(p, undefined);
        hit = true;
      }
      for (const target of this.actors) {
        if (target === p.owner || !target.alive || target.isBot === p.owner.isBot && this.state.phase === 'pvp') continue;
        if (segmentCircleHit(from, to, target.position, target.radius + p.radius)) {
          if (p.explosive) this.areaDamage(p.owner, target.position, 3, p.damage); else {
            this.damageActor(target, this.projectileDamage(p, target), p.owner);
            if (p.owner.mage === 'ice') { target.slowedUntil = this.elapsed + 1.5; if (p.freeze) tryFreeze(target, this.elapsed); }
          }
          hit = true; break;
        }
      }
      if (p.age > 2.5 || Math.hypot(to.x, to.z) > 18 || hit) this.removeProjectile(i, p, hit);
    }
  }

  private projectileDamage(p: Projectile, target?: Actor): number {
    let damage = p.damage;
    if (target && this.itemsFor(p.owner).includes('wounded-hunter') && target.hp / target.stats.maxHp < .35) damage *= 1.2;
    return damage;
  }

  private damageActor(target: Actor, damage: number, source?: Actor): void {
    if (this.itemsFor(target).includes('reactive-barrier') && this.elapsed >= target.barrierReadyAt) { damage *= .5; target.barrierReadyAt = this.elapsed + 12; }
    const dealt = applyDamage(target, damage, this.elapsed);
    if (dealt > 0) { this.burst(target.position, 0xffffff, 6); if (!target.alive) { target.model.visible = false; if (source && !source.isBot) this.ui.message(`${MAGES[target.mage].name} eliminado`); } }
  }

  private removeProjectile(index: number, p: Projectile, burst: boolean): void {
    if (burst) this.burst({ x: p.mesh.position.x, z: p.mesh.position.z }, MAGES[p.owner.mage].accent, p.explosive ? 22 : 7);
    this.scene.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose();
    this.projectiles.splice(index, 1);
  }

  private areaDamage(owner: Actor, center: Vec2, radius: number, damage: number): void {
    if (this.boss && owner === this.player && Math.hypot(this.boss.model.position.x - center.x, this.boss.model.position.z - center.z) < radius + 2) this.boss.hp -= damage;
    for (const target of this.actors) if (target !== owner && target.alive && Math.hypot(target.position.x - center.x, target.position.z - center.z) <= radius) this.damageActor(target, damage, owner);
  }

  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b || !this.player?.alive) return;
    b.angle += dt * (.35 + b.level * .08);
    if (b.level === 2) { b.model.rotation.y = b.angle; b.model.position.x = Math.sin(b.angle) * 3; }
    if (b.level === 3) b.model.rotation.y = Math.sin(b.angle) * .5;
    const interval = [2.8, 2.25, 1.8][b.level - 1]!;
    if (this.elapsed - b.lastAttackAt >= interval) {
      b.lastAttackAt = this.elapsed;
      const target = this.player.position;
      if (b.level === 1) this.createTelegraph({ x: target.x, z: target.z }, 2.7, 20, .9);
      if (b.level === 2) {
        this.createTelegraph({ x: target.x, z: target.z }, 2, 16, .7);
        this.createTelegraph({ x: -target.x * .4, z: -target.z * .4 }, 2, 16, 1.05);
      }
      if (b.level === 3) for (let i = 0; i < (b.hp < b.maxHp * .35 ? 4 : 2); i++) this.createTelegraph({ x: target.x + (i - 1) * 2.6, z: target.z + Math.sin(i * 2) * 2 }, 1.8, 18, .65 + i * .12);
    }
  }

  private createTelegraph(position: Vec2, radius: number, damage: number, delay: number): void {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({ color: 0xff4058, transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(position.x, .04, position.z); this.scene.add(mesh);
    this.telegraphs.push({ mesh, createdAt: this.elapsed, triggerAt: this.elapsed + delay, radius, damage, position: mesh.position.clone() });
  }

  private updateTelegraphs(): void {
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i]!;
      const progress = (this.elapsed - t.createdAt) / (t.triggerAt - t.createdAt);
      t.mesh.scale.setScalar(.75 + progress * .25);
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = .13 + progress * .35;
      if (this.elapsed >= t.triggerAt) {
        if (this.player?.alive && Math.hypot(this.player.position.x - t.position.x, this.player.position.z - t.position.z) <= t.radius) this.damageActor(this.player, t.damage);
        this.burst({ x: t.position.x, z: t.position.z }, 0xff4058, 18);
        this.scene.remove(t.mesh); t.mesh.geometry.dispose(); (t.mesh.material as THREE.Material).dispose(); this.telegraphs.splice(i, 1);
      }
    }
  }

  private updateBots(dt: number): void {
    if (this.state.phase !== 'pvp' || !this.player) return;
    for (const bot of this.actors.filter(a => a.isBot && a.alive)) {
      const possible = this.actors.filter(a => a !== bot && a.alive);
      const target = possible.sort((a, b) => Math.hypot(a.position.x - bot.position.x, a.position.z - bot.position.z) - Math.hypot(b.position.x - bot.position.x, b.position.z - bot.position.z))[0];
      if (!target) continue;
      const aim = new THREE.Vector2(target.position.x - bot.position.x, target.position.z - bot.position.z);
      const dist = aim.length(); aim.normalize();
      const tangent = new THREE.Vector2(-aim.y, aim.x).multiplyScalar(Math.sin(this.elapsed * .7 + bot.aiAngle));
      const move = dist > 8 ? aim : dist < 4 ? aim.clone().multiplyScalar(-1) : tangent;
      const speed = bot.stats.speed * (this.elapsed < bot.slowedUntil ? .8 : 1) * dt * .72;
      this.moveActor(bot, move.x * speed, move.y * speed);
      bot.model.rotation.y = Math.atan2(aim.x, aim.y);
      if (dist < 13) this.shoot(bot, aim);
      if (dist < 5 && cooldownReady(this.elapsed, bot.lastDashAt, bot.stats.dashCooldown + 1.5)) { bot.lastDashAt = this.elapsed; this.moveActor(bot, -aim.x * 4, -aim.y * 4); if (bot.mage === 'shadow') bot.invulnerableUntil = this.elapsed + .25; }
      if (Math.sin(this.elapsed * .38 + bot.aiAngle) > .985) this.useSpecial(bot, aim);
    }
  }

  private checkEndConditions(): void {
    if (this.boss && this.boss.hp <= 0) this.finishBoss();
    if (this.state.phase === 'pvp') {
      const alive = this.actors.filter(a => a.alive);
      if (alive.length <= 1) this.finishPvp(alive[0] === this.player);
    } else if (this.player && !this.player.alive) {
      window.setTimeout(() => { if (this.player && !this.player.alive && this.state.phase.startsWith('farm')) { this.player.hp = this.player.stats.maxHp; this.player.alive = true; this.player.model.visible = true; this.player.position = { x: 0, z: 10 }; this.player.invulnerableUntil = this.elapsed + 2; this.moveActor(this.player, 0, 0); this.ui.message('Você retornou à batalha'); } }, 1600);
    }
  }

  private finishBoss(): void {
    if (!this.boss) return;
    const level = this.boss.level;
    this.burst({ x: this.boss.model.position.x, z: this.boss.model.position.z }, 0xffd86b, 45);
    this.scene.remove(this.boss.model); this.boss = undefined;
    for (const p of [...this.projectiles]) this.removeProjectile(this.projectiles.indexOf(p), p, false);
    const choice = (['item-choice-1', 'item-choice-2', 'item-choice-3'] as const)[level - 1]!;
    this.transition(choice);
    this.ui.showItemChoice(level, offerForLevel(level, this.items));
  }

  private selectItem(id: ItemId): void {
    const before = this.items.length;
    this.items = addItem(this.items, id);
    if (this.items.length === before) return;
    this.ui.message(`${ITEMS[id].name} adquirido`);
    this.ui.hideOverlay();
    if (this.level < 3) {
      const next = (['farm-level-2', 'farm-level-3'] as const)[this.level - 1]!;
      this.transition(next);
      this.startFarm(this.level + 1);
    } else {
      this.transition('pvp');
      this.startPvp();
    }
  }

  private startPvp(): void {
    this.clearCombat();
    const stats = calculateStats(MAGES[this.mageId].stats, this.items);
    this.player = this.createActor('player', this.mageId, { x: 0, z: 11 }, false, stats);
    this.player.shield = stats.shield; this.actors.push(this.player);
    const others = (Object.keys(MAGES) as MageId[]).filter(id => id !== this.mageId);
    const positions = [{ x: -10, z: -7 }, { x: 10, z: -7 }, { x: 0, z: -11 }];
    others.forEach((mage, i) => {
      const botItems = offerForLevel(i + 1, []).slice(0, 3);
      const bot = this.createActor(`bot-${mage}`, mage, positions[i]!, true, calculateStats(MAGES[mage].stats, botItems));
      bot.shield = bot.stats.shield; this.actors.push(bot);
    });
    for (const a of this.actors) a.invulnerableUntil = this.elapsed + 2.5;
    this.ui.message('ARENA FINAL', 2200);
  }

  private finishPvp(won: boolean): void {
    this.transition('result');
    this.ui.showResult(won, this.mageId, this.items);
  }

  private resetGame(): void {
    this.transition('reset');
    this.clearCombat(); this.items = []; this.level = 0;
    window.setTimeout(() => this.transition('mage-selection'), 250);
  }

  private clearCombat(): void {
    for (const a of this.actors) this.scene.remove(a.model); this.actors.length = 0;
    for (const p of this.projectiles) this.scene.remove(p.mesh); this.projectiles.length = 0;
    for (const t of this.telegraphs) this.scene.remove(t.mesh); this.telegraphs.length = 0;
    if (this.boss) this.scene.remove(this.boss.model); this.boss = undefined; this.player = undefined;
  }

  private updateCamera(dt: number): void {
    if (!this.player) return;
    // Look slightly toward the arena centre so the local mage and the boss/opponents
    // remain readable in the same isometric frame.
    const focusX = this.player.position.x * .48;
    const focusZ = this.player.position.z * .48;
    const target = new THREE.Vector3(focusX + 18, 24, focusZ + 22);
    this.camera.position.lerp(target, 1 - Math.pow(.015, dt));
    this.camera.lookAt(focusX, 0, focusZ);
  }

  private updateHud(): void {
    const p = this.player!;
    const dashLeft = Math.max(0, p.stats.dashCooldown - (this.elapsed - p.lastDashAt));
    const specialLeft = Math.max(0, p.stats.specialCooldown - (this.elapsed - p.lastSpecialAt));
    this.ui.updateHud({
      hp: p.hp, maxHp: p.stats.maxHp, shield: p.shield,
      dash: dashLeft / p.stats.dashCooldown, special: specialLeft / p.stats.specialCooldown,
      items: this.items, bossHp: this.boss?.hp, bossMaxHp: this.boss?.maxHp,
      phaseLabel: this.boss ? PHASE_NAMES[this.boss.level - 1]! : this.state.phase === 'pvp' ? `${this.actors.filter(a => a.alive).length} MAGOS VIVOS` : '',
    });
  }

  private itemsFor(actor: Actor): ItemId[] { return actor === this.player ? this.items : []; }

  private burst(position: Vec2, color: number, count: number): void {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 });
    for (let i = 0; i < Math.min(count, 26); i++) {
      const bit = new THREE.Mesh(new THREE.TetrahedronGeometry(.05 + Math.random() * .08), mat);
      const a = Math.random() * Math.PI * 2, r = .2 + Math.random() * 1.4;
      bit.position.set(Math.cos(a) * r, .2 + Math.random() * 1.8, Math.sin(a) * r); group.add(bit);
    }
    group.position.set(position.x, 0, position.z); this.scene.add(group);
    this.flashLight.position.set(position.x, 2, position.z); this.flashLight.color.set(color); this.flashLight.intensity = 5;
    const born = performance.now();
    const animate = () => { const age = (performance.now() - born) / 1000; group.scale.setScalar(1 + age * 1.5); mat.opacity = 1 - age / .55; if (age < .55) requestAnimationFrame(animate); else { this.scene.remove(group); group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); mat.dispose(); } }; animate();
  }

  private resize(): void {
    const width = innerWidth, height = innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
  }

  private handleTestKey(event: KeyboardEvent): void {
    if (event.code === 'KeyK' && this.boss) this.boss.hp = 0;
    if (event.code === 'KeyK' && this.state.phase === 'pvp') for (const bot of this.actors.filter(a => a.isBot)) { bot.hp = 0; bot.alive = false; bot.model.visible = false; }
  }
}
