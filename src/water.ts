import * as THREE from 'three';
import { patchMaterial } from './shaderlib';
import type { City, Area } from './data';
import { ringArea } from './data';
import { PlanarReflection } from './reflection';

export const WATER_Y = 0.25;

// All mapped water (the Burj Lake, canals, pools) as one reflective surface.
export function buildWater(city: City, reflection: PlanarReflection) {
  const waters = city.areas.filter((a) => a.k === 'water');
  const pos: number[] = [];
  for (const a of waters) {
    const toV = (f: number[]) => { const o: THREE.Vector2[] = []; for (let i = 0; i < f.length; i += 2) o.push(new THREE.Vector2(f[i], f[i + 1])); return o; };
    const outer = toV(a.outer);
    const holes = a.holes.map(toV);
    const all = [...outer, ...holes.flat()];
    for (const t of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const A = all[t[0]], B = all[t[1]], C = all[t[2]];
      const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
      const tri = up ? [A, B, C] : [A, C, B];
      for (const p of tri) pos.push(p.x, WATER_Y, p.y);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const uniforms = { tRefl: { value: reflection.rt.texture }, uTexMat: { value: reflection.textureMatrix } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0 });
  patchMaterial(mat, {
    key: 'lake',
    extraUniforms: uniforms,
    vertexHead: 'uniform mat4 uTexMat; varying vec4 vReflUv;',
    vertexAfterProject: 'vReflUv = uTexMat * vec4(vWPos, 1.0);',
    fragHead: 'uniform sampler2D tRefl; varying vec4 vReflUv;',
    fragAfterMaps: /* glsl */ `
      vec2 P = vWPos.xz;
      vec3 Vw = normalize(cameraPosition - vWPos);
      float t = uTime;
      vec2 q = P * 0.35 + vec2(t * 0.25, t * 0.17);
      float n0 = vnoise(q), nx = vnoise(q + vec2(0.05, 0.0)), nz = vnoise(q + vec2(0.0, 0.05));
      vec2 q2 = P * 1.3 - vec2(t * 0.4, -t * 0.3);
      float m0 = vnoise(q2), mx = vnoise(q2 + vec2(0.05, 0.0)), mz = vnoise(q2 + vec2(0.0, 0.05));
      float dist = length(cameraPosition - vWPos);
      vec2 grad = (vec2(nx - n0, nz - n0) * 0.5 + vec2(mx - m0, mz - m0) * 0.25 * (1.0 - smoothstep(60.0, 300.0, dist))) / 0.05;
      vec3 nW = normalize(vec3(-grad.x * 0.03, 1.0, -grad.y * 0.03));
      diffuseColor.rgb = vec3(0.02, 0.07, 0.08);
      normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
      float fres = mix(0.06, 1.0, pow(1.0 - clamp(dot(nW, Vw), 0.0, 1.0), 5.0));
    `,
    fragAfterLights: /* glsl */ `
      {
        vec4 ruv = vReflUv;
        ruv.xy += nW.xz * ruv.w * 0.02;
        vec3 refl = texture2DProj(tRefl, ruv).rgb;
        reflectedLight.indirectSpecular = refl * max(fres, 0.12);
        reflectedLight.directDiffuse *= (1.0 - fres);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'water';
  // the Burj Lake: the biggest stretch of water near the tower
  let lake: Area | null = null, best = 0;
  for (const a of waters) {
    let cx = 0, cz = 0;
    for (let i = 0; i < a.outer.length; i += 2) { cx += a.outer[i]; cz += a.outer[i + 1]; }
    cx /= a.outer.length / 2; cz /= a.outer.length / 2;
    const ar = Math.abs(ringArea(a.outer));
    if (Math.hypot(cx, cz) < 900 && ar > best) { best = ar; lake = a; }
  }
  return { mesh, lake };
}
