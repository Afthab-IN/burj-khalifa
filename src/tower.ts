import * as THREE from 'three';
import { patchMaterial } from './shaderlib';
import { ExtrudeBuilder } from './extrude';
import { City, ringCentroid } from './data';

export const towerUniforms = {
  uShow: { value: 0 }, // 0..1 light show strength (eased)
  uShowT: { value: 0 }, // seconds into the show
  uNightK: { value: 0 }, // 0 day .. 1 night
  uAxis: { value: new THREE.Vector2() },
};

export function buildTower(city: City) {
  const top = city.tiers[city.tiers.length - 1];
  const [ax, az] = ringCentroid(top.rings[0].outer);
  towerUniforms.uAxis.value.set(ax, az);

  const eb = new ExtrudeBuilder(['aCap']);
  for (const t of city.tiers) {
    for (const r of t.rings) {
      eb.walls(r.outer, t.h0, t.h1, [0], 32);
      eb.cap(r, t.h1, [1]);
    }
  }
  const geo = eb.build();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.9 });
  patchMaterial(mat, {
    key: 'tower',
    extraUniforms: towerUniforms,
    vertexHead: 'attribute float aCap; varying vec2 vF; varying float vCap;',
    vertexAfterProject: 'vF = uv; vCap = aCap;',
    fragHead: /* glsl */ `
      varying vec2 vF;
      varying float vCap;
      uniform float uShow, uShowT, uNightK;
      uniform vec2 uAxis;
      vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0, 4, 2), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
      float hh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    `,
    fragAfterMaps: /* glsl */ `
      float H = vWPos.y;
      vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
      float finMask = 0.0;
      float glassMask = 0.0;
      vec3 emis = vec3(0.0);
      float spireZone = smoothstep(585.0, 620.0, H);
      if (vCap > 0.5) {
        // terraces at each setback: pale concrete with plant
        float n = hh(floor(vWPos.xz * 0.5));
        diffuseColor.rgb = vec3(0.55, 0.55, 0.54) * (0.9 + 0.15 * n);
        metalnessFactor = 0.0;
        roughnessFactor = 0.8;
      } else {
        float u = vF.x;
        // vertical stainless fins every bay, the tower's signature striping
        float bay = 1.55;
        float fu = fract(u / bay) - 0.5;
        float finW = 0.075;
        finMask = 1.0 - smoothstep(finW, finW + 0.03, abs(fu));
        float finSlope = sign(fu) * smoothstep(finW + 0.03, finW, abs(fu)) * smoothstep(0.0, finW, abs(fu));
        // floors and spandrels
        float fl = 3.9;
        float fv = fract(H / fl);
        float spandrel = 1.0 - smoothstep(0.06, 0.1, fv) * (1.0 - smoothstep(0.86, 0.9, fv));
        // plant-room bands roughly every 30 floors
        float mech = 1.0 - smoothstep(0.0, 0.6, abs(mod(H + 6.0, 117.0) - 3.5) - 4.0);
        glassMask = (1.0 - finMask) * (1.0 - spandrel) * (1.0 - mech);
        vec3 glass = vec3(0.3, 0.38, 0.46);
        vec3 metal = vec3(0.72, 0.73, 0.75);
        vec3 span = vec3(0.34, 0.36, 0.38);
        vec3 c = mix(span, glass, glassMask);
        c = mix(c, metal, finMask);
        c = mix(c, vec3(0.28, 0.3, 0.32), mech * (1.0 - finMask));
        // the spire is clad steel: panel lines, no glass
        vec3 steel = vec3(0.7, 0.71, 0.73) * (0.92 + 0.08 * step(0.5, fract(H / 2.4)));
        c = mix(c, steel, spireZone);
        diffuseColor.rgb = c;
        // each glass pane is a slightly different plane: breaks up the reflections
        float pane = hh(vec2(floor(u / bay), floor(H / fl)));
        roughnessFactor = mix(mix(0.32, 0.07 + pane * 0.06, glassMask), 0.28, finMask);
        roughnessFactor = mix(roughnessFactor, 0.3, spireZone);
        metalnessFactor = mix(0.78, 1.0, finMask);
        // fins catch light on their edges
        vec3 tW = normalize(cross(vec3(0.0, 1.0, 0.0), nW));
        nW = normalize(nW + tW * finSlope * 0.9 * (1.0 - spireZone) + tW * (pane - 0.5) * 0.04 * glassMask);
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);

        // night: lit floors (hotel, residences, offices) and the floodlit spire
        float floorId = floor(H / fl);
        float cell = floor(u / (bay * 4.0));
        float lit = step(0.87, hh(vec2(cell, floorId) + 3.1)) * glassMask * step(H, 585.0) * (0.4 + 0.6 * hh(vec2(floorId, cell) + 9.0));
        vec3 warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.9, 1.0), hh(vec2(floorId, 7.7)));
        emis += warm * lit * 0.8 * uNightK;
        emis += vec3(0.85, 0.9, 1.0) * spireZone * 0.55 * uNightK;

        // the LED light show that runs across the facade
        if (uShow > 0.001) {
          float t = uShowT;
          float seg = 7.0;
          float pat = mod(floor(t / seg), 5.0);
          float pt = mod(t, seg);
          float fade = smoothstep(0.0, 0.7, pt) * smoothstep(seg, seg - 0.7, pt);
          float ang = atan(vWPos.z - uAxis.y, vWPos.x - uAxis.x);
          vec3 c2 = vec3(0.0);
          if (pat < 0.5) {
            float band = pow(0.5 + 0.5 * sin(H * 0.045 - t * 4.5), 3.0);
            c2 = hsv(fract(H * 0.0012 - t * 0.12), 0.85, 1.0) * band;
          } else if (pat < 1.5) {
            float s = pow(0.5 + 0.5 * sin(ang * 3.0 + H * 0.028 - t * 3.2), 4.0);
            c2 = mix(vec3(1.0, 0.7, 0.25), vec3(1.0), s) * s;
          } else if (pat < 2.5) {
            float sp = step(0.86, hh(vec2(floor(u / (bay * 2.0)), floor(H / (fl * 2.0))) + floor(t * 9.0)));
            c2 = mix(vec3(0.6, 0.85, 1.0), vec3(1.0), sp) * sp;
          } else if (pat < 3.5) {
            float level = pt / (seg - 1.0) * 640.0;
            float filled = 1.0 - smoothstep(level - 8.0, level, H);
            c2 = mix(vec3(0.1, 0.4, 1.0), vec3(0.3, 1.0, 0.9), H / 640.0) * filled * (0.7 + 0.3 * sin(H * 0.2 - t * 6.0));
          } else {
            float d = H - mod(pt * 260.0, 900.0);
            c2 = vec3(1.0, 0.25, 0.45) * exp(-d * d / 900.0) + vec3(1.0, 0.25, 0.45) * 0.08;
          }
          float ledMask = (1.0 - finMask * 0.6) * (1.0 - spireZone * 0.5);
          emis += c2 * fade * uShow * ledMask * mix(0.6, 3.2, uNightK);
        }
      }
      totalEmissiveRadiance += emis;
    `,
    fragAfterLights: /* glsl */ `
      // the sun's mirror image in the glass: keep it a glint, not a blowout
      reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(2.2));
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'tower';

  // red aviation beacons on the spire and at a few setbacks
  const beaconPos: number[] = [];
  const addBeacon = (x: number, y: number, z: number) => beaconPos.push(x, y, z);
  addBeacon(ax, 829, az);
  for (const t of city.tiers) {
    if (t.h1 < 200 || t.h1 % 2 > 0.5) continue;
    const r = t.rings[0].outer;
    // the outermost point of this tier
    let best = 0, bx = 0, bz = 0;
    for (let i = 0; i < r.length; i += 2) {
      const d = Math.hypot(r[i] - ax, r[i + 1] - az);
      if (d > best) { best = d; bx = r[i]; bz = r[i + 1]; }
    }
    addBeacon(bx, t.h1 + 0.5, bz);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(beaconPos, 3));
  const beaconMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uNightK: towerUniforms.uNightK },
    vertexShader: /* glsl */ `
      uniform float uPx;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uPx * 2600.0 / -mv.z, 2.0, 24.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNightK;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float on = step(0.55, fract(uTime * 0.75));
        float a = (smoothstep(0.5, 0.0, d) * 0.6 + smoothstep(0.12, 0.0, d)) * on * (0.25 + 0.75 * uNightK);
        gl_FragColor = vec4(vec3(1.0, 0.08, 0.04) * a * 6.0, 1.0);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const beacons = new THREE.Points(bg, beaconMat);
  beacons.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh, beacons);
  group.name = 'burj';

  // distance from the tower's axis to its skin at height h, looking along (dx, dz)
  const extentAt = (h: number, dx: number, dz: number) => {
    const tier = city.tiers.find((t) => h >= t.h0 && h <= t.h1) || city.tiers[city.tiers.length - 1];
    let best = 0;
    for (const r of tier.rings) {
      const f = r.outer;
      const n = f.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x1 = f[i * 2] - ax, z1 = f[i * 2 + 1] - az, x2 = f[j * 2] - ax, z2 = f[j * 2 + 1] - az;
        // ray (0,0)+t(dx,dz) vs segment
        const ex = x2 - x1, ez = z2 - z1;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (x1 * ez - z1 * ex) / den;
        const s = (x1 * dz - z1 * dx) / den;
        if (t > 0 && s >= 0 && s <= 1) best = Math.max(best, t);
      }
    }
    return best;
  };

  return { group, mesh, beacons, beaconMat, axis: new THREE.Vector2(ax, az), extentAt };
}
