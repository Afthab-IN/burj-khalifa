import * as THREE from 'three';
import type { Area } from './data';
import { pointInRing } from './data';
import { WATER_Y } from './water';

// The fountain show. Nozzles follow the lake's centreline, plus two rings.
// Each frame the choreography writes every nozzle's height, sway and light into
// a small float texture; the particles read it on the GPU.
export const SHOW_LENGTH = 52;
export const BPM = 100;
const BEAT = 60 / BPM;

interface Nozzle { x: number; z: number; s: number; ring: number; ang: number; }

export class Fountain {
  points: THREE.Points;
  private state: Float32Array;
  private tex: THREE.DataTexture;
  mat: THREE.ShaderMaterial;
  nozzles: Nozzle[] = [];
  perp = new THREE.Vector2();
  t = -1; // seconds into the show, -1 when idle
  center = new THREE.Vector3();

  constructor(lake: Area) {
    const f = lake.outer;
    // principal axis of the lake
    let cx = 0, cz = 0;
    const n = f.length / 2;
    for (let i = 0; i < n; i++) { cx += f[i * 2]; cz += f[i * 2 + 1]; }
    cx /= n; cz /= n;
    let sxx = 0, sxz = 0, szz = 0;
    for (let i = 0; i < n; i++) { const dx = f[i * 2] - cx, dz = f[i * 2 + 1] - cz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ax = new THREE.Vector2(Math.cos(ang), Math.sin(ang));
    const pp = new THREE.Vector2(-ax.y, ax.x);
    this.perp.copy(pp);
    // centreline: midpoint of the chord across the lake at each step along the axis
    const mid = (s: number): THREE.Vector2 | null => {
      const ox = cx + ax.x * s, oz = cz + ax.y * s;
      const hits: number[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = f[i * 2] - ox, z1 = f[i * 2 + 1] - oz, x2 = f[j * 2] - ox, z2 = f[j * 2 + 1] - oz;
        const ex = x2 - x1, ez = z2 - z1;
        const den = pp.x * ez - pp.y * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (x1 * ez - z1 * ex) / den;
        const u = (x1 * pp.y - z1 * pp.x) / den;
        if (u >= 0 && u <= 1) hits.push(t);
      }
      hits.sort((a, b) => a - b);
      // the interval containing the axis point
      for (let k = 0; k + 1 < hits.length; k += 2) {
        if (hits[k] <= 0 && hits[k + 1] >= 0) {
          const m = (hits[k] + hits[k + 1]) / 2;
          if (hits[k + 1] - hits[k] < 25) return null;
          return new THREE.Vector2(ox + pp.x * m, oz + pp.y * m);
        }
      }
      return null;
    };
    // the main line: the longest straight run through the lake that keeps
    // clear of the shore, searched over angles and offsets
    const clearance = (x: number, z: number) => {
      if (!pointInRing(x, z, f)) return -1;
      let d = Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = f[i * 2], z1 = f[i * 2 + 1], x2 = f[j * 2], z2 = f[j * 2 + 1];
        const ex = x2 - x1, ez = z2 - z1;
        const l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * ex + (z - z1) * ez) / l2));
        d = Math.min(d, Math.hypot(x - (x1 + ex * t), z - (z1 + ez * t)));
      }
      return d;
    };
    let best = { len: 0, a: new THREE.Vector2(), b: new THREE.Vector2() };
    for (let deg = 0; deg < 180; deg += 4) {
      const dir = new THREE.Vector2(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));
      const nrm = new THREE.Vector2(-dir.y, dir.x);
      for (let off = -120; off <= 120; off += 12) {
        let run = 0, runStart = 0;
        for (let t = -260; t <= 260; t += 4) {
          const x = cx + nrm.x * off + dir.x * t, z = cz + nrm.y * off + dir.y * t;
          if (clearance(x, z) >= 16) {
            if (run === 0) runStart = t;
            run += 4;
            if (run > best.len && run <= 290) {
              best = { len: run, a: new THREE.Vector2(cx + nrm.x * off + dir.x * runStart, cz + nrm.y * off + dir.y * runStart), b: new THREE.Vector2(x, z) };
            }
          } else run = 0;
        }
      }
    }
    const lineDir = best.b.clone().sub(best.a).normalize();
    pp.set(-lineDir.y, lineDir.x);
    this.perp.copy(pp);
    // a gentle bow, like the real fountain's arc
    const smooth: THREE.Vector2[] = [];
    const steps = Math.max(2, Math.floor(best.len / 2.6));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const p = best.a.clone().lerp(best.b, u).addScaledVector(pp, Math.sin(u * Math.PI) * best.len * 0.06);
      if (clearance(p.x, p.y) > 4) smooth.push(p);
    }
    let total = 0;
    const cum = [0];
    for (let i = 1; i < smooth.length; i++) { total += smooth[i].distanceTo(smooth[i - 1]); cum.push(total); }
    for (let i = 0; i < smooth.length; i++) {
      const p = smooth[i];
      this.nozzles.push({ x: p.x, z: p.y, s: cum[i] / Math.max(1, total), ring: 0, ang: 0 });
    }
    // two rings near the ends
    for (const end of [0.12, 0.88]) {
      const k = Math.floor(end * (smooth.length - 1));
      const c = smooth[k];
      if (!c) continue;
      let rc = c.clone().addScaledVector(pp, 26);
      if (clearance(rc.x, rc.y) < 16) rc = c.clone().addScaledVector(pp, -26);
      if (clearance(rc.x, rc.y) < 16) continue;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const x = rc.x + Math.cos(a) * 12, z = rc.y + Math.sin(a) * 12;
        this.nozzles.push({ x, z, s: end, ring: end < 0.5 ? 1 : 2, ang: a });
      }
    }
    this.center.set(cx, WATER_Y, cz);

    const N = this.nozzles.length;
    this.state = new Float32Array(N * 4);
    this.tex = new THREE.DataTexture(this.state, N, 1, THREE.RGBAFormat, THREE.FloatType);
    this.tex.needsUpdate = true;

    const P = 110;
    const nozzlePos = new Float32Array(N * P * 3);
    const seed = new Float32Array(N * P * 4);
    let k = 0;
    this.nozzles.forEach((nz, i) => {
      for (let j = 0; j < P; j++, k++) {
        nozzlePos.set([nz.x, WATER_Y, nz.z], k * 3);
        seed.set([i, j / P + Math.random() * 0.01, Math.random(), Math.random()], k * 4);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(nozzlePos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tState: { value: this.tex }, uCount: { value: N }, uTime: { value: 0 }, uPx: { value: 1 },
        uPerp: { value: this.perp }, uNightK: { value: 0 }, uSun: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform sampler2D tState;
        uniform float uCount, uTime, uPx;
        uniform vec2 uPerp;
        varying float vA;
        varying float vB;
        void main() {
          vec4 st = texture2D(tState, vec2((aSeed.x + 0.5) / uCount, 0.5));
          float H = st.r;
          if (H < 0.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          float g = 9.81;
          float v0 = sqrt(2.0 * g * H);
          float T = 2.0 * v0 / g;
          float t = fract(uTime / T + aSeed.y) * T; // spread evenly along the arc, up and back down
          // spray spreads as it rises
          vec3 dir = normalize(vec3(uPerp.x * sin(st.g), cos(st.g), uPerp.y * sin(st.g)));
          vec3 p = position + dir * v0 * t - vec3(0.0, 0.5 * g * t * t, 0.0);
          float life0 = t / T;
          float plume = smoothstep(0.35, 0.55, life0);
          vec2 jitter = (vec2(aSeed.z, aSeed.w) - 0.5) * (0.25 + life0 * 1.2 + plume * H * 0.06);
          p.xz += jitter;
          p.y = max(p.y, position.y);
          float life = t / T;
          vA = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.75, 1.0, life)) * st.b;
          vB = st.a;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((0.45 + life * 1.3 + aSeed.w * 0.5) * uPx * 300.0 / -mv.z, 1.0, 40.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vB;
        uniform float uNightK;
        uniform vec3 uSun;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          if (a < 0.01) discard;
          vec3 day = vec3(0.92, 0.95, 0.98) * (0.55 + 0.45 * uSun);
          vec3 night = mix(vec3(1.0, 0.95, 0.85), vec3(0.85, 0.92, 1.0), vB) * 1.3;
          vec3 c = mix(day, night, uNightK);
          gl_FragColor = vec4(c * a * 0.8, a * mix(0.6, 0.35, uNightK));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.points.name = 'fountain';
  }

  start() { this.t = 0; }
  stop() { this.t = -1; }
  get running() { return this.t >= 0; }

  update(dt: number, time: number) {
    this.mat.uniforms.uTime.value = time;
    if (this.t >= 0) {
      this.t += dt;
      if (this.t > SHOW_LENGTH + 3) this.t = -1;
    }
    const t = this.t;
    const N = this.nozzles.length;
    for (let i = 0; i < N; i++) {
      const nz = this.nozzles[i];
      let h = 0, tilt = 0, on = 0;
      if (t >= 0 && t < SHOW_LENGTH + 2.5) {
        const beat = Math.floor(t / BEAT);
        const bt = t - beat * BEAT;
        const s = nz.s;
        on = 1;
        if (nz.ring) {
          // rings pulse on the beat, and climb in the second half
          const pulse = Math.exp(-bt * 3.0);
          h = t < 26 ? 6 + 20 * pulse * (t > 6 ? 1 : t / 6) : t < 44 ? 25 + 45 * pulse : 60 + 70 * pulse;
          if (t > SHOW_LENGTH) h *= Math.max(0, 1 - (t - SHOW_LENGTH) / 2);
          tilt = 0;
        } else if (t < 6) {
          h = (6 + 12 * (0.5 + 0.5 * Math.sin(s * 30 - t * 3))) * (t / 6);
        } else if (t < 18) {
          h = 30 + 16 * Math.sin(s * 9 + t * 1.3);
          tilt = 0.42 * Math.sin(t * 2.1 + s * 5);
        } else if (t < 26) {
          const group = Math.floor(s * 40) % 4;
          h = 12 + (group === beat % 4 ? 95 * Math.exp(-bt * 2.2) : 0);
        } else if (t < 36) {
          const head = ((t - 26) * 0.32) % 1;
          const d = s - head;
          h = 18 + 105 * Math.exp(-(d * d) / (2 * 0.06 * 0.06)) + 105 * Math.exp(-((s - (1 - head)) ** 2) / (2 * 0.06 * 0.06));
          tilt = 0.25 * Math.sin(t * 3 + s * 12);
        } else if (t < 44) {
          h = 45 + 30 * Math.sin(s * 14 - t * 4);
          tilt = 0.5 * Math.sin(t * 2.6 + s * 3);
        } else if (t < SHOW_LENGTH) {
          const k = (t - 44) / (SHOW_LENGTH - 44);
          h = 60 + 80 * k + 15 * Math.sin(s * 20 + t * 5);
          tilt = 0.35 * Math.sin(t * 3.4 + s * 6) * (1 - k);
        } else {
          h = 140 * Math.max(0, 1 - (t - SHOW_LENGTH) / 2.2);
        }
      }
      this.state[i * 4] = Math.max(0, h);
      this.state[i * 4 + 1] = tilt;
      this.state[i * 4 + 2] = on;
      this.state[i * 4 + 3] = nz.ring ? 1 : (Math.sin(nz.s * 20 + time) * 0.5 + 0.5) * 0.3;
    }
    this.tex.needsUpdate = true;
  }
}
