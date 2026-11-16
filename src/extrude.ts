import * as THREE from 'three';
import type { Ring } from './data';

// Collects walls and roofs for many footprints into one BufferGeometry.
// Wall UVs are in metres: u runs along the perimeter, v is height above ground,
// so facade shaders can lay out floors and window bays at true scale.
export class ExtrudeBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  extra: Record<string, number[]> = {};
  idx: number[] = [];
  constructor(private extraNames: string[] = []) {
    for (const n of extraNames) this.extra[n] = [];
  }

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, ex: number[]) {
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, w);
    this.extraNames.forEach((n, i) => this.extra[n].push(ex[i] ?? 0));
    return this.pos.length / 3 - 1;
  }

  /** Walls of one ring from y0 to y1. smoothAngle (deg) merges normals across gentle corners. */
  walls(flat: number[], y0: number, y1: number, ex: number[], smoothAngle = 25, uOffset = 0) {
    const n = flat.length / 2;
    if (n < 3) return;
    // make the ring counter-clockwise when seen from above (x east, z south => use signed area)
    let a = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]; }
    const P: [number, number][] = [];
    for (let i = 0; i < n; i++) P.push([flat[i * 2], flat[i * 2 + 1]]);
    if (a < 0) P.reverse();
    // edge normals (outward): for a CCW ring in x/z with z south, outward = (dz, -dx)
    const en: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const l = Math.hypot(dx, dz) || 1;
      en.push([dz / l, -dx / l]);
    }
    const cosT = Math.cos((smoothAngle * Math.PI) / 180);
    const vn = (i: number, edge: number) => {
      // normal at vertex i for use on edge `edge` (either i-1 or i)
      const prev = en[(i - 1 + n) % n], next = en[i];
      if (prev[0] * next[0] + prev[1] * next[1] > cosT) {
        const x = prev[0] + next[0], z = prev[1] + next[1];
        const l = Math.hypot(x, z) || 1;
        return [x / l, z / l];
      }
      return en[edge];
    };
    let u = uOffset;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const na = vn(i, i), nb = vn((i + 1) % n, i);
      const a0 = this.v(p[0], y0, p[1], na[0], 0, na[1], u, y0, ex);
      const b0 = this.v(q[0], y0, q[1], nb[0], 0, nb[1], u + len, y0, ex);
      const a1 = this.v(p[0], y1, p[1], na[0], 0, na[1], u, y1, ex);
      const b1 = this.v(q[0], y1, q[1], nb[0], 0, nb[1], u + len, y1, ex);
      // wound so the face normal points outward (see the CCW ring above)
      this.idx.push(a0, a1, b0, b0, a1, b1);
      u += len;
    }
  }

  /** A flat roof at height y (with holes). */
  cap(ring: Ring, y: number, ex: number[], down = false) {
    const toV2 = (f: number[]) => { const o: THREE.Vector2[] = []; for (let i = 0; i < f.length; i += 2) o.push(new THREE.Vector2(f[i], f[i + 1])); return o; };
    let outer = toV2(ring.outer);
    const holes = ring.holes.map(toV2);
    if (THREE.ShapeUtils.isClockWise(outer)) outer = outer.reverse();
    const hs = holes.map((h) => (THREE.ShapeUtils.isClockWise(h) ? h : h.reverse()));
    const tris = THREE.ShapeUtils.triangulateShape(outer, hs);
    const all = [...outer, ...hs.flat()];
    const base = this.pos.length / 3;
    for (const p of all) this.v(p.x, y, p.y, 0, down ? -1 : 1, 0, p.x, p.y, ex);
    for (const t of tris) {
      const A = all[t[0]], B = all[t[1]], C = all[t[2]];
      // y of (B-A)x(C-A): the face normal points up when it is positive
      const cy = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
      const up = cy > 0;
      if (up !== down) this.idx.push(base + t[0], base + t[1], base + t[2]);
      else this.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const n of this.extraNames) g.setAttribute(n, new THREE.Float32BufferAttribute(this.extra[n], 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
