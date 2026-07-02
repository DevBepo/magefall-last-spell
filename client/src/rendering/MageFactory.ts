import * as THREE from 'three';
import { MAGES } from '../../../shared/config/mages';
import type { MageId } from '../../../shared/types';

export function createMageModel(mageId: MageId, scale = 1): THREE.Group {
  const cfg = MAGES[mageId];
  const group = new THREE.Group();
  group.userData.baseY = 0;

  const robeMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: .72 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x060812, roughness: .9 });
  const accentMat = new THREE.MeshStandardMaterial({ color: cfg.accent, emissive: cfg.accent, emissiveIntensity: 2 });

  const robe = new THREE.Mesh(new THREE.CylinderGeometry(.52, .72, 1.15, 8), robeMat);
  robe.position.y = .65;
  robe.castShadow = true;
  group.add(robe);

  const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(.7, .58, .25, 8), robeMat);
  shoulders.position.y = 1.22;
  shoulders.castShadow = true;
  group.add(shoulders);

  const face = new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 8, 0, Math.PI * 2, 0, Math.PI * .75), darkMat);
  face.position.set(0, 1.52, .02);
  face.scale.z = .72;
  group.add(face);

  const hood = new THREE.Mesh(new THREE.ConeGeometry(.58, 1.18, 8), robeMat);
  hood.position.set(0, 1.95, -.05);
  hood.rotation.x = -.08;
  hood.castShadow = true;
  group.add(hood);

  for (const x of [-.14, .14]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.045, 8, 6), accentMat);
    eye.position.set(x, 1.6, .34);
    group.add(eye);
  }

  for (const x of [-.73, .73]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .48, 4, 8), robeMat);
    arm.position.set(x, 1.05, 0);
    arm.rotation.z = x > 0 ? -.55 : .55;
    arm.castShadow = true;
    group.add(arm);
  }

  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 1), accentMat);
  orb.position.set(.92, 1.28, .05);
  orb.name = 'orb';
  group.add(orb);
  const light = new THREE.PointLight(cfg.accent, 1.2, 4);
  light.position.copy(orb.position);
  group.add(light);

  if (mageId === 'ice') {
    for (const x of [-.52, .52]) {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.18), accentMat);
      crystal.position.set(x, 1.43, 0);
      crystal.scale.y = 1.8;
      group.add(crystal);
    }
  } else if (mageId === 'shadow') {
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(.11), accentMat);
      shard.position.set(Math.cos(i * Math.PI / 2) * .9, .8 + (i % 2) * .4, -.25);
      shard.name = 'orbit';
      group.add(shard);
    }
  } else if (mageId === 'light') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.42, .035, 8, 32), accentMat);
    halo.position.y = 2.58;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
  } else {
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(.07, .2, 6), accentMat);
      flame.position.set(.92 + (i - 1) * .13, 1.5 + Math.abs(i - 1) * .08, .05);
      group.add(flame);
    }
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.72, .82, 32),
    new THREE.MeshBasicMaterial({ color: cfg.accent, transparent: true, opacity: .55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .025;
  group.add(ring);
  group.scale.setScalar(scale);
  return group;
}

export function animateMage(model: THREE.Group, time: number, active = true): void {
  model.position.y = Math.sin(time * 2.4 + model.id) * .05;
  const orb = model.getObjectByName('orb');
  if (orb) { orb.rotation.y = time * 2; orb.position.y = 1.28 + Math.sin(time * 3) * .08; }
  model.children.filter(c => c.name === 'orbit').forEach((c, i) => {
    c.position.x = Math.cos(time * 1.5 + i * 1.57) * .9;
    c.position.z = Math.sin(time * 1.5 + i * 1.57) * .9;
  });
  model.traverse(o => { if (o instanceof THREE.Mesh) o.material.opacity = active ? 1 : .38; });
}
