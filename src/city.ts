import * as THREE from 'three';
import { patchMaterial } from './shaderlib';
import { ExtrudeBuilder } from './extrude';
import type { City, Building } from './data';
import { mulberry32 } from './noise';

export const cityUniforms = {
  uNightK: { value: 0 },
  uLitFrac: { value: 0.45 },
};

// One facade shader for every ordinary building. Facade coordinates come from
// world position and the wall normal, so the same shader works on the merged
// OSM buildings and on the instanced filler blocks.
export function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0 });
  patchMaterial(mat, {
    key: 'city',
    extraUniforms: cityUniforms,
    vertexHead: 'attribute float aSeed; attribute float aTopH; varying float vSeed; varying float vTopH;',
    vertexAfterProject: 'vSeed = aSeed; vTopH = aTopH;',
    fragHead: /* glsl */ `
      varying float vSeed;
      varying float vTopH;
      uniform float uNightK, uLitFrac;
      float hb(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    `,
    fragAfterMaps: /* glsl */ `
      vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      vec3 emis = vec3(0.0);
      float H = vWPos.y;
      float s1 = fract(vSeed * 7.13), s2 = fract(vSeed * 13.7), s3 = fract(vSeed * 3.31);
      bool tall = vTopH > 55.0;
      if (nW.y > 0.5) {
        // roofs: pale membranes, plant boxes, the odd pool
        float n = hb(floor(vWPos.xz * 0.25) + vSeed);
        vec3 roof = mix(vec3(0.62, 0.6, 0.57), vec3(0.42, 0.42, 0.42), step(0.7, s2));
        roof *= 0.85 + 0.2 * n;
        diffuseColor.rgb = roof;
        roughnessFactor = 0.85;
        metalnessFactor = 0.0;
        // rooftop crown lights on towers
        if (tall && s3 > 0.4) emis += vec3(1.0, 0.92, 0.75) * step(0.97, hb(floor(vWPos.xz * 0.7))) * 2.0 * uNightK;
      } else {
        vec3 tW = normalize(cross(vec3(0.0, 1.0, 0.0), nW));
        float u = dot(vWPos.xz, tW.xz) + s1 * 50.0;
        float fl = tall ? 3.6 : 3.4;
        float fv = fract(H / fl);
        float floorId = floor(H / fl);
        if (tall) {
          // glass curtain wall
          float bay = 1.5 + s2;
          float fu = fract(u / bay);
          float mull = 1.0 - smoothstep(0.04, 0.07, min(fu, 1.0 - fu));
          float spand = 1.0 - smoothstep(0.08, 0.12, fv) * (1.0 - smoothstep(0.84, 0.88, fv));
          vec3 tint = s1 < 0.25 ? vec3(0.28, 0.42, 0.44) : s1 < 0.5 ? vec3(0.5, 0.55, 0.6) : s1 < 0.72 ? vec3(0.45, 0.38, 0.3) : vec3(0.26, 0.28, 0.32);
          vec3 frame = vec3(0.55, 0.56, 0.57);
          float glass = (1.0 - mull) * (1.0 - spand * 0.85);
          diffuseColor.rgb = mix(frame * 0.8, tint, glass);
          float pane = hb(vec2(floor(u / bay), floorId) + vSeed);
          metalnessFactor = mix(0.3, 0.85, glass);
          roughnessFactor = mix(0.4, 0.08 + 0.08 * pane, glass);
          nW = normalize(nW + tW * (pane - 0.5) * 0.05 * glass);
          float lh = hb(vec2(floor(u / bay), floorId) + vSeed * 9.0);
          // whole floors are often lit together in offices; homes are patchier
          float floorLit = step(0.82, hb(vec2(floorId, vSeed * 3.0)));
          float lit = max(step(1.0 - uLitFrac * 0.42, lh), floorLit * step(0.3, lh)) * glass * (0.3 + 0.7 * fract(lh * 31.0));
          emis += mix(vec3(1.0, 0.8, 0.55), vec3(0.85, 0.92, 1.0), hb(vec2(floorId, vSeed))) * lit * 0.42 * uNightK;
          // a lit band where the tower meets the sky
          float crown = smoothstep(vTopH - 3.0, vTopH - 1.5, H) * step(0.6, s3);
          emis += mix(vec3(1.0, 0.95, 0.85), vec3(0.6, 0.8, 1.0), s2) * crown * 0.9 * uNightK;
        } else {
          // stone or render with punched windows
          vec3 wall = s1 < 0.4 ? vec3(0.78, 0.72, 0.6) : s1 < 0.7 ? vec3(0.86, 0.84, 0.8) : vec3(0.7, 0.6, 0.48);
          float bay = 3.0 + s2 * 1.2;
          float fu = fract(u / bay);
          float win = step(0.22, fu) * step(fu, 0.78) * step(0.3, fv) * step(fv, 0.82);
          float ground = 1.0 - step(5.0, H - (vTopH - max(vTopH, 0.0)));
          diffuseColor.rgb = mix(wall * (0.92 + 0.1 * hb(vec2(floorId, vSeed))), vec3(0.12, 0.14, 0.16), win);
          roughnessFactor = mix(0.85, 0.15, win);
          metalnessFactor = mix(0.0, 0.5, win);
          float lh = hb(vec2(floor(u / bay), floorId) + vSeed * 5.0);
          float lit = step(1.0 - uLitFrac * 0.5, lh) * win * (0.4 + 0.6 * fract(lh * 17.0));
          emis += vec3(1.0, 0.76, 0.48) * lit * 0.6 * uNightK;
        }
        // shopfronts along the street
        float street = 1.0 - smoothstep(4.5, 5.5, H);
        emis += vec3(1.0, 0.85, 0.65) * street * step(0.45, hb(vec2(floor(u / 6.0), vSeed))) * 0.7 * uNightK;
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }
      totalEmissiveRadiance += emis;
    `,
  });
  return mat;
}

export function buildCity(city: City, mat: THREE.Material) {
  const eb = new ExtrudeBuilder(['aSeed', 'aTopH']);
  const rnd = mulberry32(8);
  const add = (b: Building) => {
    const seed = rnd();
    const ex = [seed, b.h];
    eb.walls(b.outer, b.mh, b.h, ex, 30);
    for (const hole of b.holes) eb.walls(hole, b.mh, b.h, ex, 30);
    eb.cap(b, b.h, ex);
    if (b.mh > 0.5) eb.cap(b, b.mh, ex, true);
  };
  city.buildings.forEach(add);
  city.podium.forEach(add);
  const geo = eb.build();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'city';
  return mesh;
}

// Low-rise city with scattered towers that carries Dubai on past the edge of
// the mapped area, plus a denser tower line along the Sheikh Zayed Road axis.
export function buildFiller(mat: THREE.Material, inData: (x: number, z: number) => boolean, szr: { dir: THREE.Vector2; through: THREE.Vector2 }, coast: (x: number, z: number) => number) {
  const rnd = mulberry32(55);
  const items: { x: number; z: number; w: number; d: number; h: number; r: number }[] = [];
  const R = 9500;
  const step = 70;
  for (let gx = -R; gx <= R; gx += step) {
    for (let gz = -R; gz <= R; gz += step) {
      const x = gx + (rnd() - 0.5) * 30, z = gz + (rnd() - 0.5) * 30;
      const dist = Math.hypot(x, z);
      if (dist > R || inData(x, z) || coast(x, z) < 150) continue;
      // distance to the Sheikh Zayed Road line
      const px = x - szr.through.x, pz = z - szr.through.y;
      const along = px * szr.dir.x + pz * szr.dir.y;
      const off = Math.abs(px * -szr.dir.y + pz * szr.dir.x);
      const corridor = Math.exp(-((off - 140) ** 2) / (2 * 120 * 120)) * (off > 40 ? 1 : 0);
      const density = 0.55 * Math.exp(-dist / 7000) + 0.35 * corridor;
      if (rnd() > density + 0.15) continue;
      let h = 8 + rnd() * 18;
      if (rnd() < 0.08 + corridor * 0.7) h = 60 + Math.pow(rnd(), 1.5) * (corridor > 0.3 ? 260 : 140);
      const w = 22 + rnd() * 34, d = 22 + rnd() * 34;
      const r = corridor > 0.3 ? Math.atan2(szr.dir.y, szr.dir.x) : Math.floor(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.2;
      items.push({ x, z, w: h > 60 ? w * 0.8 : w, d: h > 60 ? d * 0.8 : d, h, r });
      void along;
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const seed = new Float32Array(items.length), top = new Float32Array(items.length);
  const im = new THREE.InstancedMesh(box, mat, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -it.r);
    m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.w, it.h, it.d));
    im.setMatrixAt(i, m);
    seed[i] = rnd();
    top[i] = it.h;
  });
  box.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  box.setAttribute('aTopH', new THREE.InstancedBufferAttribute(top, 1));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = false;
  im.receiveShadow = true;
  im.name = 'filler';
  return im;
}
