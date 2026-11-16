import * as THREE from 'three';
import { U, COMMON_GLSL } from './shaderlib';
import { clamp, lerp } from './noise';

// ---------------------------------------------------------------------------
// Sky dome: analytic atmosphere + sun/moon discs + drifting clouds + stars.
// ---------------------------------------------------------------------------
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww; // pinned to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
${COMMON_GLSL}
uniform vec3 uMoonDir;
uniform float uCloudCover;
uniform vec3 uCloudCol;
uniform vec3 uCloudShade;
uniform float uEnvPass;
uniform vec3 uSunDiscCol;

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = atmosphere(dir);
  vec3 sd = normalize(uSunDir);
  float cosSun = dot(dir, sd);

  // stars and moon at night
  if (uNight > 0.01 && dir.y > 0.0) {
    vec3 sp = dir * 420.0;
    vec2 cell = floor(sp.xz / (sp.y * 0.0025 + 1.0));
    float st = step(0.9965, h21(cell)) * h21(cell + 7.7);
    float tw = 0.75 + 0.25 * sin(uTime * 3.0 + h21(cell + 3.3) * 40.0);
    col += vec3(0.75, 0.82, 1.0) * st * tw * 0.6 * uNight * smoothstep(0.0, 0.25, dir.y) * (1.0 - uEnvPass);
    float cm = dot(dir, normalize(uMoonDir));
    col += vec3(0.75, 0.8, 0.95) * smoothstep(0.99965, 0.99978, cm) * 3.5 * uNight * (1.0 - uEnvPass);
    col += vec3(0.25, 0.32, 0.5) * pow(max(cm, 0.0), 60.0) * 0.35 * uNight;
  }

  // clouds: a single drifting layer projected onto a dome
  if (dir.y > 0.0) {
    vec2 cp = dir.xz / (dir.y + 0.12) * 1.1 + uWindDir * uTime * 0.006;
    float n = fbm5(cp * 1.4);
    float cov = smoothstep(0.74 - uCloudCover * 0.5, 0.96 - uCloudCover * 0.5, n);
    float n2 = fbm5(cp * 1.4 + normalize(sd.xz + 1e-4) * 0.09);
    float lit = clamp(0.55 + (n - n2) * 5.0, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudCol, lit);
    // silver lining and forward glow near the sun
    cc += uSunGlow * pow(max(cosSun, 0.0), 14.0) * (1.0 - cov) * 1.0;
    float fade = smoothstep(0.0, 0.16, dir.y);
    col = mix(col, cc, cov * fade * 0.92);
    // thin high haze softens the zenith
    col = mix(col, uHorizon * 0.9, 0.12 * smoothstep(0.4, 0.8, fbm3(cp * 0.4 + 9.0)) * fade);
  }

  // sun disc
  if (uEnvPass < 0.5) {
    float disc = smoothstep(0.99955, 0.99975, cosSun);
    col += uSunDiscCol * disc * smoothstep(-0.02, 0.01, dir.y);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { ...U, uSunDiscCol: { value: new THREE.Color(40, 34, 26) } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  // keep the shared uniform objects (spread copies the same {value} refs)
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

// ---------------------------------------------------------------------------
// Time of day. Everything is keyed by sun elevation (degrees) and blended.
// Colours are sRGB hex, scaled by a radiance multiplier.
// ---------------------------------------------------------------------------
interface SkyKey {
  e: number;
  zen: string; hor: string; glow: string; ground: string;
  sky: number; // radiance multiplier for zenith/horizon
  sun: string; sunI: number;
  cloud: string; shade: string; cloudI: number;
  fog: number;
  env: number; // environment (ambient) intensity
  exposure: number;
}

const KEYS: SkyKey[] = [
  { e: -28, zen: '#050a1a', hor: '#2a2230', glow: '#1a1520', ground: '#3a2a1e', sky: 1.0, sun: '#000000', sunI: 0, cloud: '#1e2840', shade: '#0a0e1a', cloudI: 1, fog: 0.000126, env: 1.35, exposure: 1.55 },
  { e: -10, zen: '#0d1636', hor: '#46405a', glow: '#4a3448', ground: '#3a2a22', sky: 1.0, sun: '#000000', sunI: 0, cloud: '#3a3550', shade: '#141626', cloudI: 1, fog: 0.000168, env: 1.0, exposure: 1.45 },
  { e: -3, zen: '#22325f', hor: '#9a6a70', glow: '#d07a52', ground: '#241c1e', sky: 1.0, sun: '#ff6a36', sunI: 0.0, cloud: '#b07870', shade: '#383455', cloudI: 1, fog: 0.000098, env: 0.95, exposure: 1.12 },
  { e: 2, zen: '#36579a', hor: '#e6a47e', glow: '#ffa05c', ground: '#4e3a30', sky: 1.0, sun: '#ff9a58', sunI: 3.8, cloud: '#ffbc90', shade: '#6a5a78', cloudI: 1.1, fog: 0.000084, env: 0.9, exposure: 1.0 },
  { e: 8, zen: '#3e6aac', hor: '#ecc09a', glow: '#ffc488', ground: '#6e5440', sky: 1.05, sun: '#ffc88c', sunI: 5.0, cloud: '#ffe4c4', shade: '#8a8090', cloudI: 1.15, fog: 0.000091, env: 0.85, exposure: 0.92 },
  { e: 22, zen: '#3f70b4', hor: '#e2cfb2', glow: '#ffe0b0', ground: '#8a6a4a', sky: 1.1, sun: '#ffe6c4', sunI: 5.0, cloud: '#ffffff', shade: '#9a9aa6', cloudI: 1.25, fog: 0.000126, env: 0.62, exposure: 0.78 },
  { e: 50, zen: '#3a6cb2', hor: '#d9d2c2', glow: '#fff0d6', ground: '#9a7a58', sky: 1.15, sun: '#fff3e2', sunI: 5.6, cloud: '#ffffff', shade: '#a8acb6', cloudI: 1.35, fog: 0.000112, env: 0.58, exposure: 0.74 },
  { e: 80, zen: '#3568ae', hor: '#d6d2c8', glow: '#fff4e4', ground: '#9a7a58', sky: 1.15, sun: '#fff6ea', sunI: 5.8, cloud: '#ffffff', shade: '#aab0ba', cloudI: 1.35, fog: 0.000112, env: 0.58, exposure: 0.72 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
function lerpHex(out: THREE.Color, a: string, b: string, t: number, scale = 1) {
  tmpA.set(a); tmpB.set(b);
  out.copy(tmpA).lerp(tmpB, t).multiplyScalar(scale);
}

export interface SkyState {
  hour: number; // 5..23.5
  sunElev: number; // degrees
  exposure: number;
  envIntensity: number;
  lightIntensity: number;
  moonMode: boolean;
}

export function sunFromHour(hour: number) {
  // a simple stylised day: sunrise ~6:10, noon peak ~76 deg, sunset ~19:00
  const e = 76 * Math.sin((Math.PI * (hour - 6.2)) / 12.8);
  // azimuth from north, clockwise: east at sunrise, south at noon (Dubai is at 25 N), west at sunset
  const az = THREE.MathUtils.degToRad(85 + ((hour - 6) / 13) * 190);
  return { elev: e, az };
}

export class TimeOfDay {
  hour = 10.5;
  target = 10.5;
  cloudCover = 0.42;
  cloudTarget = 0.42;
  state: SkyState = { hour: 10.5, sunElev: 45, exposure: 0.9, envIntensity: 1, lightIntensity: 5, moonMode: false };
  dirty = true;

  constructor(public light: THREE.DirectionalLight) {}

  setHour(h: number, instant = false) {
    this.target = h;
    if (instant) { this.hour = h; this.dirty = true; }
  }

  update(dt: number) {
    const diff = this.target - this.hour;
    if (Math.abs(diff) > 1e-4) {
      // ease toward the target (about 2.5 s for a big jump)
      const step = diff * (1 - Math.exp(-dt * 1.6));
      this.hour += Math.abs(step) < 1e-4 ? diff : step;
      this.dirty = true;
    }
    const cd = this.cloudTarget - this.cloudCover;
    if (Math.abs(cd) > 1e-4) { this.cloudCover += cd * (1 - Math.exp(-dt * 1.5)); U.uCloudCover.value = this.cloudCover; }
    if (this.dirty) this.apply();
  }

  apply() {
    const { elev, az } = sunFromHour(this.hour);
    const er = THREE.MathUtils.degToRad(elev);
    const sunDir = new THREE.Vector3(Math.cos(er) * Math.sin(az), Math.sin(er), -Math.cos(er) * Math.cos(az)).normalize();
    U.uSunDir.value.copy(sunDir);

    // find keys
    let i = 0;
    while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((elev - a.e) / (b.e - a.e), 0, 1);
    const sky = lerp(a.sky, b.sky, t);
    lerpHex(U.uZenith.value, a.zen, b.zen, t, sky);
    lerpHex(U.uHorizon.value, a.hor, b.hor, t, sky);
    lerpHex(U.uSunGlow.value, a.glow, b.glow, t, 1.0);
    lerpHex(U.uGround.value, a.ground, b.ground, t, 1.05); // bright sand bounce lights undersides
    const cloudI = lerp(a.cloudI, b.cloudI, t);
    lerpHex(U.uCloudCol.value, a.cloud, b.cloud, t, cloudI);
    lerpHex(U.uCloudShade.value, a.shade, b.shade, t, 1.0);
    U.uFogDensity.value = lerp(a.fog, b.fog, t);
    const night = clamp((-elev - 4) / 10, 0, 1);
    U.uNight.value = night;

    // the single directional light is the sun by day and the moon by night
    const sunI = lerp(a.sunI, b.sunI, t) * clamp((elev + 0.5) / 2.5, 0, 1);
    const moonDir = new THREE.Vector3(0.35, 0.62, 0.7).normalize();
    U.uMoonDir.value.copy(moonDir);
    const moonI = 0.35 * night;
    const sunCol = new THREE.Color();
    lerpHex(sunCol, a.sun, b.sun, t);
    if (sunI >= moonI) {
      U.uLightDir.value.copy(sunDir.y < 0.02 ? new THREE.Vector3(sunDir.x, 0.02, sunDir.z).normalize() : sunDir);
      this.light.color.copy(sunCol);
      this.light.intensity = sunI;
      this.state.moonMode = false;
    } else {
      U.uLightDir.value.copy(moonDir);
      this.light.color.set('#9fb6ea');
      this.light.intensity = moonI;
      this.state.moonMode = true;
    }
    U.uLightCol.value.copy(this.light.color).multiplyScalar(this.light.intensity);

    this.state.hour = this.hour;
    this.state.sunElev = elev;
    this.state.exposure = lerp(a.exposure, b.exposure, t);
    this.state.envIntensity = lerp(a.env, b.env, t);
    this.state.lightIntensity = this.light.intensity;
    this.dirty = false;
    this.changed = true;
  }
  changed = true;
}

// ---------------------------------------------------------------------------
// Environment lighting: PMREM of the sky (no sun disc), refreshed when the
// sky changes. Rendered from a tiny scene that holds a second sky mesh.
// ---------------------------------------------------------------------------
export class SkyEnvironment {
  pmrem: THREE.PMREMGenerator;
  scene = new THREE.Scene();
  rt: THREE.WebGLRenderTarget | null = null;
  lastUpdate = -1;

  constructor(private renderer: THREE.WebGLRenderer, skyMat: THREE.Material) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
    m.frustumCulled = false;
    this.scene.add(m);
  }

  update(): THREE.Texture {
    U.uEnvPass.value = 1;
    const old = this.rt;
    this.rt = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size: 128 } as any);
    U.uEnvPass.value = 0;
    if (old) old.dispose();
    return this.rt.texture;
  }
}
