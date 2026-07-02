import * as THREE from 'three';

export class InputController {
  readonly keys = new Set<string>();
  pointer = new THREE.Vector2();
  shooting = false;
  dashRequested = false;
  specialRequested = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'Space') { this.dashRequested = true; e.preventDefault(); }
      if (e.code === 'KeyQ') this.specialRequested = true;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.shooting = true; });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.shooting = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  movement(): THREE.Vector2 {
    const x = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const z = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    return new THREE.Vector2(x, z).normalize();
  }

  consumeDash(): boolean { const value = this.dashRequested; this.dashRequested = false; return value; }
  consumeSpecial(): boolean { const value = this.specialRequested; this.specialRequested = false; return value; }
}
