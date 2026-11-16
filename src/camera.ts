import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface Shot {
  name: string;
  duration: number;
  at(t: number): { pos: THREE.Vector3; look: THREE.Vector3 };
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => t * t * (3 - 2 * t);
const pingpong = (t: number) => (t < 0.5 ? ease(t * 2) : ease(2 - t * 2));

export function makeShots(axis: THREE.Vector2, lake: THREE.Vector3, toLake: THREE.Vector2): Shot[] {
  const A = (y: number) => v(axis.x, y, axis.y);
  const side = new THREE.Vector2(-toLake.y, toLake.x);
  return [
    {
      name: 'Orbit the tower',
      duration: 90,
      at(t) {
        const a = t * Math.PI * 2 + Math.atan2(toLake.y, toLake.x);
        return { pos: v(axis.x + Math.cos(a) * 950, 260 + 70 * Math.sin(t * Math.PI * 4), axis.y + Math.sin(a) * 950), look: A(380) };
      },
    },
    {
      name: 'Rise up the spire',
      duration: 44,
      at(t) {
        const e = pingpong(t);
        const y = 40 + e * 860;
        const r = 230 - e * 120;
        const a = Math.atan2(toLake.y, toLake.x) + 0.5 + e * 1.4;
        return { pos: v(axis.x + Math.cos(a) * r, y, axis.y + Math.sin(a) * r), look: A(y + 40 + e * 60) };
      },
    },
    {
      name: 'Over the fountain',
      duration: 36,
      at(t) {
        const e = pingpong(t);
        const start = lake.clone().add(v(toLake.x * 260 + side.x * 60, 0, toLake.y * 260 + side.y * 60));
        const end = lake.clone().add(v(-toLake.x * 60 - side.x * 30, 0, -toLake.y * 60 - side.y * 30));
        const pos = start.lerp(end, e);
        pos.y = 14 + 8 * Math.sin(e * Math.PI);
        return { pos, look: A(330 + 120 * e) };
      },
    },
    {
      name: 'Skyline drift',
      duration: 70,
      at(t) {
        const e = pingpong(t);
        const base = v(axis.x + toLake.x * 1300, 420, axis.y + toLake.y * 1300);
        const pos = base.add(v(side.x * (-900 + 1800 * e), 0, side.y * (-900 + 1800 * e)));
        return { pos, look: A(300) };
      },
    },
    {
      name: 'Top of the world',
      duration: 70,
      at(t) {
        const a = t * Math.PI * 2;
        return { pos: v(axis.x + Math.cos(a) * 140, 960, axis.y + Math.sin(a) * 140), look: A(560) };
      },
    },
  ];
}

export class CameraRig {
  controls: OrbitControls;
  shot: Shot | null = null;
  shotTime = 0;
  blend = 1;
  deck = false;
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();
  onShotEnd: (() => void) | null = null;

  constructor(public camera: THREE.PerspectiveCamera, dom: HTMLElement, private groundAt: (x: number, z: number) => number) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.9;
    this.controls.screenSpacePanning = false;
    this.free();
    this.controls.addEventListener('start', () => {
      if (this.shot) { this.shot = null; this.onShotEnd?.(); }
    });
  }

  /** normal orbiting limits */
  free() {
    this.deck = false;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 6000;
    this.controls.maxPolarAngle = Math.PI * 0.497;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.rotateSpeed = 0.5;
  }

  /** stand still at the observation deck and look around */
  enterDeck(lookDir: THREE.Vector3) {
    this.shot = null;
    this.deck = true;
    this.controls.target.copy(this.camera.position).addScaledVector(lookDir.clone().normalize(), 0.6);
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.9;
    this.controls.enableZoom = false;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = -0.35; // drag the view, not the world
    this.controls.update();
  }

  play(shot: Shot | null) {
    if (this.deck) this.free();
    this.shot = shot;
    this.shotTime = 0;
    this.blend = 0;
    this.fromPos.copy(this.camera.position);
    this.fromLook.copy(this.controls.target);
  }

  update(dt: number) {
    if (this.shot) {
      this.shotTime += dt;
      const t = (this.shotTime / this.shot.duration) % 1;
      const { pos, look } = this.shot.at(t);
      this.blend = Math.min(1, this.blend + dt / 3);
      const b = ease(this.blend);
      this.camera.position.lerpVectors(this.fromPos, pos, b);
      const lk = new THREE.Vector3().lerpVectors(this.fromLook, look, b);
      this.controls.target.copy(lk);
      this.camera.lookAt(lk);
    } else {
      this.controls.update();
    }
    if (!this.deck) {
      const g = this.groundAt(this.camera.position.x, this.camera.position.z) + 2;
      if (this.camera.position.y < g) this.camera.position.y = g;
    }
  }
}
