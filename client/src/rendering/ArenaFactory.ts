import * as THREE from 'three';

export function createArena(): THREE.Group {
  const arena = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(17, 18, .8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d3851, roughness: .94, metalness: .05 }),
  );
  floor.position.y = -.45;
  floor.receiveShadow = true;
  arena.add(floor);

  const inner = new THREE.Mesh(
    new THREE.RingGeometry(5.8, 6, 8),
    new THREE.MeshBasicMaterial({ color: 0x66718b, transparent: true, opacity: .35, side: THREE.DoubleSide }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = .012;
  arena.add(inner);

  const stone = new THREE.MeshStandardMaterial({ color: 0x353e52, roughness: 1 });
  const crystalColors = [0x39cfff, 0xff5a35, 0xa958ff, 0xffe07a];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.8, 1.25), stone);
    pillar.position.set(Math.cos(a) * 15.2, 1.4, Math.sin(a) * 15.2);
    pillar.rotation.y = -a;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    arena.add(pillar);

    if (i % 2 === 0) {
      const mat = new THREE.MeshStandardMaterial({ color: crystalColors[i / 2], emissive: crystalColors[i / 2], emissiveIntensity: 1.5 });
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.55), mat);
      crystal.position.set(Math.cos(a + .18) * 13.4, .7, Math.sin(a + .18) * 13.4);
      crystal.scale.y = 2.2;
      crystal.castShadow = true;
      arena.add(crystal);
    }
  }

  const obstaclePositions = [[-6, -4], [5, 4], [-5, 6], [6, -6]];
  for (const [x, z] of obstaclePositions) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), stone);
    rock.position.set(x!, .8, z!);
    rock.scale.set(1.4, 1.2, 1);
    rock.rotation.set(.2, x! * .1, .1);
    rock.castShadow = true;
    rock.receiveShadow = true;
    arena.add(rock);
  }
  return arena;
}

export function createBossModel(level: number): THREE.Group {
  const g = new THREE.Group();
  if (level === 1) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x475061, roughness: .95 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x53ff86, emissive: 0x2cff67, emissiveIntensity: 2 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.1, 2), stone); torso.position.y = 2.1; g.add(torso);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(.58), glow); core.position.set(0, 2.2, 1.05); g.add(core);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.3), stone); head.position.y = 4.1; g.add(head);
    for (const x of [-2.05, 2.05]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(1.05, 3.2, 1.05), stone); arm.position.set(x, 2.1, 0); g.add(arm); }
  } else if (level === 2) {
    const cyan = new THREE.MeshStandardMaterial({ color: 0x29bddd, emissive: 0x126b9a, emissiveIntensity: .8, roughness: .25 });
    for (let i = 0; i < 7; i++) {
      const segment = new THREE.Mesh(new THREE.OctahedronGeometry(1.25 - i * .08), cyan);
      segment.position.set((i - 3) * 1.25, 2 + Math.sin(i * .7) * .7, Math.sin(i * .9) * 1.2);
      segment.rotation.z = i * .25;
      g.add(segment);
    }
  } else {
    const dark = new THREE.MeshStandardMaterial({ color: 0x291544, roughness: .6 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xb735ff, emissive: 0x8b19d4, emissiveIntensity: 2 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(2.3, 5, 8), dark); body.position.y = 2.5; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), dark); head.position.y = 5.2; g.add(head);
    for (const y of [2.1, 3.3, 4.5]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, .12, 8, 32), glow); ring.position.y = y; ring.rotation.x = Math.PI / 2; ring.name = 'boss-ring'; g.add(ring); }
    for (const x of [-3, 3]) { const hand = new THREE.Mesh(new THREE.DodecahedronGeometry(.65), glow); hand.position.set(x, 3.1, 0); g.add(hand); }
  }
  g.traverse(o => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  return g;
}
