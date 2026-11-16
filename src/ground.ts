import * as THREE from 'three';
import { patchMaterial } from './shaderlib';
import type { City } from './data';

// Extent of the mapped area (metres from the tower, matches scripts/fetch_osm.py).
export const EX = 2270, EZ = 2265;
export const COAST_DIR = new THREE.Vector2(-0.62, -0.78).normalize(); // north-west, toward the Gulf
export const COAST_DIST = 5600;
export const coastDist = (x: number, z: number) => COAST_DIST - (x * COAST_DIR.x + z * COAST_DIR.y);

export const groundUniforms = { uNightK: { value: 0 } };

function paintMaps(city: City) {
  const S = 4096;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const G = 2048;
  const gc = document.createElement('canvas');
  gc.width = gc.height = G;
  const gg = gc.getContext('2d')!;
  const sx = S / (2 * EX), sz = S / (2 * EZ);
  const X = (x: number) => (x + EX) * sx, Z = (z: number) => (z + EZ) * sz;

  g.fillStyle = '#b9ad98';
  g.fillRect(0, 0, S, S);
  // soft variation so the base isn't a flat fill
  for (let i = 0; i < 3500; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 90;
    g.fillStyle = `rgba(${150 + Math.random() * 50},${140 + Math.random() * 40},${120 + Math.random() * 30},0.08)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const fillRing = (ctx: CanvasRenderingContext2D, f: number[], holes: number[][], sx2 = sx, sz2 = sz) => {
    ctx.beginPath();
    const path = (r: number[]) => {
      for (let i = 0; i < r.length; i += 2) {
        const px = (r[i] + EX) * sx2, py = (r[i + 1] + EZ) * sz2;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    path(f);
    holes.forEach(path);
    ctx.fill('evenodd');
  };
  const order = ['site', 'plaza', 'green', 'water'] as const;
  const col: Record<string, string> = { site: '#c8b08a', plaza: '#d6cdbd', green: '#4f6b36', water: '#1c3a40' };
  for (const k of order) {
    g.fillStyle = col[k];
    for (const a of city.areas) if (a.k === k) fillRing(g, a.outer, a.holes);
  }
  // roads: kerbs/sidewalks first, then asphalt, small roads under big ones
  const roads = [...city.roads].sort((a, b) => a.w - b.w);
  const stroke = (ctx: CanvasRenderingContext2D, p: number[], s1: number, s2: number) => {
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) {
      const px = (p[i] + EX) * s1, py = (p[i + 1] + EZ) * s2;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  };
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of roads) {
    if (r.w < 4) continue;
    g.strokeStyle = '#a59c8e';
    g.lineWidth = (r.w + 4) * sx;
    stroke(g, r.p, sx, sz);
  }
  for (const r of roads) {
    const foot = r.w < 4;
    g.strokeStyle = foot ? '#cfc4b0' : r.k.startsWith('motorway') || r.k.startsWith('trunk') ? '#2c2d30' : '#38393c';
    g.lineWidth = Math.max(1.2, r.w * sx);
    stroke(g, r.p, sx, sz);
  }
  // lane markings on the big roads
  g.setLineDash([6 * sx, 9 * sx]);
  g.strokeStyle = 'rgba(235,235,225,0.55)';
  g.lineWidth = Math.max(1, 0.35 * sx);
  for (const r of roads) if (r.w >= 16) stroke(g, r.p, sx, sz);
  g.setLineDash([]);

  // night glow: sodium and white LED along the roads, warm pools in plazas
  const gsx = G / (2 * EX), gsz = G / (2 * EZ);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, G, G);
  gg.lineCap = 'round'; gg.lineJoin = 'round';
  gg.fillStyle = 'rgba(255,190,120,0.35)';
  for (const a of city.areas) if (a.k === 'plaza') fillRing(gg, a.outer, a.holes, gsx, gsz);
  gg.shadowColor = 'rgba(255,170,90,0.9)';
  gg.shadowBlur = 6;
  for (const r of roads) {
    if (r.w < 5) continue;
    gg.strokeStyle = r.w > 14 ? 'rgba(255,200,140,0.9)' : 'rgba(255,175,105,0.7)';
    gg.lineWidth = Math.max(1, (r.w + 6) * gsx);
    stroke(gg, r.p, gsx, gsz);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;
  const glow = new THREE.CanvasTexture(gc);
  glow.anisotropy = 8;
  return { map, glow };
}

export function buildGround(city: City) {
  const { map, glow } = paintMaps(city);
  const geo = new THREE.PlaneGeometry(2 * EX, 2 * EZ, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0 });
  patchMaterial(mat, {
    key: 'ground',
    extraUniforms: { ...groundUniforms, tGlow: { value: glow } },
    fragHead: 'uniform sampler2D tGlow; uniform float uNightK;',
    fragAfterMaps: /* glsl */ `
      {
        vec2 guv = vec2((vWPos.x + ${EX.toFixed(1)}) / ${(2 * EX).toFixed(1)}, 1.0 - (vWPos.z + ${EZ.toFixed(1)}) / ${(2 * EZ).toFixed(1)});
        float gl = texture(tGlow, guv).r;
        // asphalt is a touch glossier, so wet-looking headlight sheen at night
        float dark = 1.0 - smoothstep(0.12, 0.3, dot(diffuseColor.rgb, vec3(0.33)));
        roughnessFactor = mix(0.92, 0.55, dark);
        totalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * gl * gl * 0.11 * uNightK;
      }
    `,
  });
  const inner = new THREE.Mesh(geo, mat);
  inner.receiveShadow = true;
  inner.name = 'ground';

  // the rest of Dubai out to the haze, and the Gulf to the north-west
  const og = new THREE.PlaneGeometry(60000, 60000, 1, 1);
  og.rotateX(-Math.PI / 2);
  og.translate(0, -0.05, 0);
  const omat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  patchMaterial(omat, {
    key: 'outer',
    extraUniforms: { ...groundUniforms },
    fragHead: 'uniform float uNightK;',
    fragAfterMaps: /* glsl */ `
      {
        vec2 P = vWPos.xz;
        if (abs(P.x) < ${(EX - 1).toFixed(1)} && abs(P.y) < ${(EZ - 1).toFixed(1)}) discard;
        float coast = ${COAST_DIST.toFixed(1)} - dot(P, vec2(${COAST_DIR.x.toFixed(4)}, ${COAST_DIR.y.toFixed(4)})) + 260.0 * (vnoise(P * 0.0012) - 0.5);
        vec3 nW = vec3(0.0, 1.0, 0.0);
        if (coast < 0.0) {
          // the Gulf: calm, hazy, glinting
          vec2 q = P * 0.02 + uTime * vec2(0.05, 0.03);
          float n0 = vnoise(q), nx = vnoise(q + vec2(0.1, 0.0)), nz = vnoise(q + vec2(0.0, 0.1));
          nW = normalize(vec3((n0 - nx) * 0.6, 1.0, (n0 - nz) * 0.6));
          diffuseColor.rgb = mix(vec3(0.03, 0.12, 0.14), vec3(0.08, 0.2, 0.2), smoothstep(-400.0, 0.0, coast));
          roughnessFactor = 0.12;
        } else {
          // city fabric: a street grid aligned with the old Dubai blocks, patches of sand and green
          float a = 0.68;
          vec2 r = vec2(cos(a) * P.x + sin(a) * P.y, -sin(a) * P.x + cos(a) * P.y);
          vec2 g1 = abs(fract(r / 170.0) - 0.5) * 170.0;
          vec2 g2 = abs(fract(r / 57.0) - 0.5) * 57.0;
          float mainRd = 1.0 - smoothstep(9.0, 11.0, min(g1.x, g1.y));
          float minor = 1.0 - smoothstep(3.0, 4.0, min(g2.x, g2.y));
          float n = vnoise(P * 0.004) * 0.6 + vnoise(P * 0.03) * 0.4;
          vec3 base = mix(vec3(0.72, 0.67, 0.58), vec3(0.78, 0.7, 0.55), n);
          base = mix(base, vec3(0.33, 0.42, 0.24), smoothstep(0.72, 0.8, vnoise(P * 0.002 + 9.0)) * 0.8);
          vec3 asphalt = vec3(0.2, 0.2, 0.21);
          base = mix(base, asphalt, max(mainRd, minor * 0.7));
          base = mix(base, vec3(0.86, 0.8, 0.66), smoothstep(-160.0, -20.0, -coast) * 0.0 + (1.0 - smoothstep(0.0, 120.0, coast)));
          diffuseColor.rgb = base;
          // a carpet of street lights at night
          float lights = mainRd * 1.0 + minor * 0.45;
          totalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * lights * 0.12 * uNightK * (0.6 + 0.4 * vnoise(P * 0.05));
        }
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      }
    `,
  });
  const outer = new THREE.Mesh(og, omat);
  outer.receiveShadow = true;
  outer.name = 'outer';
  const group = new THREE.Group();
  group.add(inner, outer);
  return group;
}
