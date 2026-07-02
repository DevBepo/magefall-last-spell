import type { Combatant, Vec2 } from '../types.js';

type Freezable = Pick<Combatant, 'frozenUntil' | 'freezeImmuneUntil'>;
type Damageable = Pick<Combatant, 'alive' | 'invulnerableUntil' | 'shield' | 'hp' | 'lastDamagedAt'>;

export function cooldownReady(now: number, lastUsed: number, cooldownSeconds: number): boolean {
  return now - lastUsed >= cooldownSeconds;
}

export function segmentCircleHit(from: Vec2, to: Vec2, center: Vec2, radius: number): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((center.x - from.x) * dx + (center.z - from.z) * dz) / lengthSq));
  const px = from.x + dx * t;
  const pz = from.z + dz * t;
  return Math.hypot(center.x - px, center.z - pz) <= radius;
}

export function tryFreeze(target: Freezable, now: number): boolean {
  if (now < target.freezeImmuneUntil) return false;
  target.frozenUntil = now + 1.5;
  target.freezeImmuneUntil = now + 6.5;
  return true;
}

export function applyDamage(target: Damageable, amount: number, now: number): number {
  if (!target.alive || now < target.invulnerableUntil) return 0;
  const absorbed = Math.min(target.shield, amount);
  target.shield -= absorbed;
  const hpDamage = amount - absorbed;
  target.hp = Math.max(0, target.hp - hpDamage);
  target.lastDamagedAt = now;
  if (target.hp <= 0) target.alive = false;
  return hpDamage;
}
