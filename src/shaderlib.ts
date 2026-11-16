import * as THREE from 'three';

// Uniforms shared by every patched material. The same {value} objects are
// referenced everywhere, so updating U.x.value once updates all shaders.
export const U = {
  uTime: { value: 0 },
  uLightDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() }, // active light (sun or moon), points TO the light
  uLightCol: { value: new THREE.Color(1, 1, 1) }, // active light colour * intensity
  uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() }, // the real sun, also below the horizon
  uMoonDir: { value: new THREE.Vector3(-0.4, 0.5, -0.3).normalize() },
  uZenith: { value: new THREE.Color(0.2, 0.35, 0.6) },
  uHorizon: { value: new THREE.Color(0.8, 0.75, 0.65) },
  uSunGlow: { value: new THREE.Color(1, 0.8, 0.5) },
  uGround: { value: new THREE.Color(0.5, 0.4, 0.3) },
  uFogDensity: { value: 0.0016 },
  uNight: { value: 0 },
  uCloudCover: { value: 0.45 },
  uCloudCol: { value: new THREE.Color(1, 1, 1) },
  uCloudShade: { value: new THREE.Color(0.5, 0.5, 0.55) },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindAmp: { value: 1.0 },
  uEnvPass: { value: 0 },
  uHFInner: { value: null as THREE.Texture | null },
  uHFOuter: { value: null as THREE.Texture | null },
  uHFInnerRect: { value: new THREE.Vector4(-1, -1, 2, 2) },
  uHFOuterRect: { value: new THREE.Vector4(-1, -1, 2, 2) },
  uDSInner: { value: null as THREE.Texture | null },
  uDSOuter: { value: null as THREE.Texture | null },
};

// Shared GLSL: the analytic atmosphere used by the sky dome and by the fog in
// every material, so distant dunes melt into exactly the horizon colour.
export const ATMO_GLSL = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunGlow;
uniform vec3 uSunDir;
uniform vec3 uGround;
uniform float uFogDensity;
uniform float uNight;

vec3 atmosphere(vec3 dir) {
  float y = dir.y;
  float up = clamp(y, 0.0, 1.0);
  // horizon haze -> clearer light band -> zenith; avoids the grey you get
  // from blending warm haze straight into blue
  vec3 mid = mix(uZenith * 1.55, uHorizon, 0.28);
  vec3 sky = mix(uHorizon, mid, smoothstep(0.0, 0.32, pow(up, 0.8)));
  sky = mix(sky, uZenith, smoothstep(0.12, 0.95, up));
  // thin brighter band right at the horizon
  sky += uHorizon * 0.18 * exp(-abs(y) * 22.0);
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  // broad forward-scatter glow around the sun, strongest near the horizon
  float horizonBoost = 0.5 + 0.5 * exp(-up * 4.0);
  sky += uSunGlow * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.55) * horizonBoost;
  // below the horizon: blend to a ground-bounce colour
  if (y < 0.0) sky = mix(sky, uGround, clamp(-y * 3.0, 0.0, 1.0));
  return sky;
}
`;

// GLSL for sampling the heightfields from any patched material.
const HF_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uHFInner;
uniform sampler2D uHFOuter;
uniform vec4 uHFInnerRect;
uniform vec4 uHFOuterRect;
float hfInnerWeight(vec2 p) {
  vec2 ui = (p - uHFInnerRect.xy) / uHFInnerRect.zw;
  vec2 e = min(ui, 1.0 - ui);
  return smoothstep(0.0, 0.07, min(e.x, e.y));
}
vec4 hfLod(vec2 p, float lod) {
  vec4 o = textureLod(uHFOuter, (p - uHFOuterRect.xy) / uHFOuterRect.zw, lod);
  vec4 i = textureLod(uHFInner, (p - uHFInnerRect.xy) / uHFInnerRect.zw, lod);
  return mix(o, i, hfInnerWeight(p));
}
float hfHeight(vec2 p) { return hfLod(p, 0.0).x; }
vec3 hfNormalFrom(vec4 s) { return vec3(s.y, sqrt(max(0.0, 1.0 - s.y * s.y - s.z * s.z)), s.z); }

// Baked dune shadow (see duneshadow.ts), refreshed when the light moves.
uniform sampler2D uDSInner;
uniform sampler2D uDSOuter;
float duneShadowAt(vec2 p) {
  float o = textureLod(uDSOuter, (p - uHFOuterRect.xy) / uHFOuterRect.zw, 0.0).r;
  float i = textureLod(uDSInner, (p - uHFInnerRect.xy) / uHFInnerRect.zw, 0.0).r;
  return mix(o, i, hfInnerWeight(p));
}

// Soft shadow cast by the dunes themselves (ray-march toward the light).
float hfShadow(vec3 p, vec3 L) {
  if (L.y <= 0.002) return 0.0;
  float res = 1.0;
  float t = 1.5;
  for (int i = 0; i < 30; i++) {
    vec3 q = p + L * t;
    if (q.y > 75.0) break;
    float h = hfLod(q.xz, 1.0).x;
    res = min(res, 10.0 * (q.y - h) / t);
    if (res < -0.02) break;
    t += max(1.2, t * 0.2);
  }
  return clamp(res, 0.0, 1.0);
}
`;

export const COMMON_GLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec2 uWindDir;
uniform float uWindAmp;
${ATMO_GLSL}
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float fbm5(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
${HF_SAMPLE_GLSL}
`;

export const FOG_APPLY_GLSL = /* glsl */ `
{
  vec3 fogRay = vWPos - cameraPosition;
  float fogDist = length(fogRay);
  vec3 fogDir = fogRay / max(fogDist, 1e-4);
  // height fog: thicker in the low basins, thinner on crests and up high
  float hAvg = max(0.0, (vWPos.y + cameraPosition.y) * 0.5);
  float dens = uFogDensity * (0.3 + 0.7 * exp(-hAvg * 0.0018));
  float fogAmt = 1.0 - exp(-fogDist * dens);
  vec3 fogCol = atmosphere(normalize(vec3(fogDir.x, max(fogDir.y, 0.0) * 0.35 + 0.015, fogDir.z)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogAmt, 0.0, 1.0));
}
`;

const WIND_FN = /* glsl */ `
#ifdef USE_WIND
attribute float aSway;
vec3 windOffset(vec3 wp, float sway, vec3 origin) {
  float ph = dot(origin.xz, vec2(0.071, 0.053));
  float gust = 0.65 + 0.35 * sin(uTime * 0.37 + origin.x * 0.013 + origin.z * 0.009);
  float w = sin(uTime * 1.05 + ph) * 0.55 + sin(uTime * 2.2 + ph * 1.7 + wp.y * 0.35) * 0.22;
  float flutter = sin(uTime * 6.5 + wp.x * 2.1 + wp.z * 1.7) * 0.05 + sin(uTime * 9.1 + wp.x * 3.3 - wp.z * 2.2) * 0.03;
  vec3 d = vec3(uWindDir.x, 0.0, uWindDir.y);
  return (d * (w * gust + 0.35 * gust) + vec3(0.0, flutter, 0.0) + d.zyx * vec3(-1.0, 0.0, 1.0) * flutter) * sway * uWindAmp;
}
#endif
`;

const PROJECT_REPLACE = /* glsl */ `
vec4 oWP = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  oWP = batchingMatrix * oWP;
#endif
#ifdef USE_INSTANCING
  oWP = instanceMatrix * oWP;
#endif
oWP = modelMatrix * oWP;
#ifdef USE_WIND
{
  vec4 io = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    io = instanceMatrix * io;
  #endif
  io = modelMatrix * io;
  oWP.xyz += windOffset(oWP.xyz, aSway, io.xyz);
}
#endif
vWPos = oWP.xyz;
vec4 mvPosition = viewMatrix * oWP;
gl_Position = projectionMatrix * mvPosition;
`;

export interface PatchOpts {
  key: string;
  wind?: boolean;
  fog?: boolean;
  vertexHead?: string;
  vertexAfterProject?: string;
  fragHead?: string;
  fragAfterMaps?: string; // after <normal_fragment_maps>: can edit diffuseColor, normal, roughnessFactor
  fragAfterLights?: string; // after <lights_fragment_end>: can edit reflectedLight
  fragBeforeFog?: string; // can edit gl_FragColor before fog
  extraUniforms?: Record<string, THREE.IUniform>;
  vsReplace?: Array<[string, string]>; // [include line, code inserted AFTER it]
  fsReplace?: Array<[string, string]>;
  defines?: Record<string, string | number | boolean>;
  landShadow?: boolean;
}

export function patchMaterial<T extends THREE.Material>(mat: T, o: PatchOpts): T {
  const fog = o.fog !== false;
  if (o.wind) {
    (mat as any).defines = { ...(mat as any).defines, USE_WIND: '' };
  }
  if (o.defines) (mat as any).defines = { ...(mat as any).defines, ...o.defines };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, o.extraUniforms || {});
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\n${COMMON_GLSL}\n${WIND_FN}\nvarying vec3 vWPos;\n${o.vertexHead || ''}`);
    for (const [inc, code] of o.vsReplace || []) vs = vs.replace(inc, `${inc}\n${code}`);
    vs = vs.replace('#include <project_vertex>', PROJECT_REPLACE + (o.vertexAfterProject || ''));
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\n${COMMON_GLSL}\nvarying vec3 vWPos;\n${o.fragHead || ''}`);
    for (const [inc, code] of o.fsReplace || []) fs = fs.replace(inc, `${inc}\n${code}`);
    if (o.fragAfterMaps) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.fragAfterMaps}`);
    const ds = !o.landShadow ? '' : 'float ds = duneShadowAt(vWPos.xz);\nreflectedLight.directDiffuse *= ds;\nreflectedLight.directSpecular *= ds;\ndirectLight.color *= ds;\n';
    fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${ds}${o.fragAfterLights || ''}`);
    fs = fs.replace('#include <fog_fragment>', `${o.fragBeforeFog || ''}\n${fog ? FOG_APPLY_GLSL : ''}`);
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'burj-' + o.key;
  return mat;
}

// Depth material for shadows that sways with the same wind and respects alpha cut-outs.
export function windDepthMaterial(key: string, map?: THREE.Texture | null, alphaTest = 0): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map || null, alphaTest });
  return patchMaterial(m, { key: 'depth-' + key, wind: true, fog: false });
}
