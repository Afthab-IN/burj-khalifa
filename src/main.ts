import * as THREE from 'three';
import { U } from './shaderlib';
import { loadCity } from './data';
import { buildSkyDome, TimeOfDay, SkyEnvironment } from './sky';
import { buildTower, towerUniforms } from './tower';
import { buildingMaterial, buildCity, buildFiller, cityUniforms } from './city';
import { buildGround, groundUniforms, EX, EZ, coastDist } from './ground';
import { PlanarReflection } from './reflection';
import { buildWater } from './water';
import { Fountain, SHOW_LENGTH } from './fountain';
import { Music } from './music';
import { buildPost, GRADE_PRESETS } from './post';
import { CameraRig, makeShots } from './camera';
import { Toolbar } from './ui';

const LIGHT_PRESETS = [
  { name: 'Morning haze', hour: 7.6, clouds: 0.25 },
  { name: 'Midday', hour: 12.4, clouds: 0.2 },
  { name: 'Golden hour', hour: 18.2, clouds: 0.35 },
  { name: 'Sunset', hour: 18.75, clouds: 0.4 },
  { name: 'Blue hour', hour: 19.25, clouds: 0.3 },
  { name: 'Night', hour: 21.6, clouds: 0.2 },
  { name: 'Day cycle', hour: -1, clouds: 0.3 },
];
const DECKS = [
  { name: 'Level 124 · At the Top', h: 452 },
  { name: 'Level 148 · At the Top Sky', h: 555 },
];

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
let dpr = Math.min(maxDpr, 1.25);
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 2, 70000);

async function init() {
  const city = await loadCity();

  // ---- sky + sun ----
  const sky = buildSkyDome();
  scene.add(sky);
  const skyMat = sky.material as THREE.ShaderMaterial;
  const sun = new THREE.DirectionalLight(0xffffff, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -1300; sc.right = 1300; sc.top = 1300; sc.bottom = -1300; sc.near = 10; sc.far = 5000;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.6;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const tod = new TimeOfDay(sun);
  tod.setHour(LIGHT_PRESETS[2].hour, true);
  tod.cloudTarget = tod.cloudCover = 0.35;
  U.uCloudCover.value = 0.35;
  const env = new SkyEnvironment(renderer, skyMat);
  scene.environment = env.update();

  // ---- the tower ----
  const tower = buildTower(city);
  scene.add(tower.group);
  const axis = tower.axis;

  // ---- city + ground ----
  const bmat = buildingMaterial();
  const cityMesh = buildCity(city, bmat);
  scene.add(cityMesh);
  // Sheikh Zayed Road: the principal direction of the motorway segments
  let sxx = 0, sxz = 0, szz = 0, mx = 0, mz = 0, mn = 0;
  for (const r of city.roads) {
    if (r.k !== 'motorway') continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const dx = r.p[i + 2] - r.p[i], dz = r.p[i + 3] - r.p[i + 1];
      sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
      mx += r.p[i]; mz += r.p[i + 1]; mn++;
    }
  }
  const szrAng = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const szr = { dir: new THREE.Vector2(Math.cos(szrAng), Math.sin(szrAng)), through: new THREE.Vector2(mn ? mx / mn : 0, mn ? mz / mn : 0) };
  const inData = (x: number, z: number) => Math.abs(x) < EX - 40 && Math.abs(z) < EZ - 40;
  const filler = buildFiller(bmat, inData, szr, coastDist);
  scene.add(filler);
  const ground = buildGround(city);
  scene.add(ground);

  // ---- lake + fountain ----
  const reflection = new PlanarReflection(window.innerWidth * dpr, window.innerHeight * dpr);
  const water = buildWater(city, reflection);
  scene.add(water.mesh);
  if (!water.lake) throw new Error('Burj Lake not found in the map data');
  const fountain = new Fountain(water.lake);
  scene.add(fountain.points);
  const music = new Music();
  const toLake = new THREE.Vector2(fountain.center.x - axis.x, fountain.center.z - axis.y).normalize();

  // ---- post + camera ----
  const post = buildPost(renderer, scene, camera, window.innerWidth, window.innerHeight);
  post.setPreset(GRADE_PRESETS[0]);
  const rig = new CameraRig(camera, canvas, () => 0);
  // across the lake, the classic view from the Souk Al Bahar side
  // from a balcony south of the lake: water in front, the whole tower above the skyline
  const startPos = new THREE.Vector3(fountain.center.x - 5, 105, fountain.center.z + 620);
  const startLook = new THREE.Vector3(axis.x + 10, 300, axis.y + 40);
  camera.position.copy(startPos);
  camera.fov = 54; camera.updateProjectionMatrix();
  rig.controls.target.copy(startLook);
  rig.controls.update();
  const shots = makeShots(axis, fountain.center, toLake);

  // ---- light show + elevator ----
  let showOn = false;
  const toggleShow = () => { showOn = !showOn; if (showOn) towerUniforms.uShowT.value = 0; ui.setValue('show', showMenuIndex()); };
  const toggleFountain = () => {
    if (fountain.running) { fountain.stop(); music.stop(); }
    else { fountain.start(); music.play(); }
    ui.setValue('show', showMenuIndex());
  };
  const showMenuIndex = () => (fountain.running && showOn ? 3 : fountain.running ? 1 : showOn ? 2 : 0);

  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.appendChild(hud);
  let ride: { t: number; to: number; r: number; dir: THREE.Vector2 } | null = null;
  const startRide = (deck: number) => {
    rig.play(null);
    if (rig.deck) rig.free();
    const dir = toLake.clone().rotateAround(new THREE.Vector2(), 0.35);
    ride = { t: 0, to: DECKS[deck].h, r: tower.extentAt(2, dir.x, dir.y) + 5, dir };
    hud.classList.add('on');
  };
  const RIDE_TIME = 24;
  const updateRide = (dt: number) => {
    if (!ride) return;
    ride.t += dt;
    const k = Math.min(1, ride.t / RIDE_TIME);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const h = 2 + (ride.to - 2) * e;
    // hug the facade: ease inward when a setback passes below
    const target = tower.extentAt(h + 6, ride.dir.x, ride.dir.y) + 4.5;
    ride.r += (target - ride.r) * (1 - Math.exp(-dt * 1.5));
    ride.r = Math.max(ride.r, target);
    camera.position.set(axis.x + ride.dir.x * ride.r, h + 1.6, axis.y + ride.dir.y * ride.r);
    const yaw = Math.sin(ride.t * 0.25) * 0.5;
    const look = new THREE.Vector3(ride.dir.x, -0.18 - 0.25 * e, ride.dir.y).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    camera.lookAt(camera.position.clone().add(look));
    const level = Math.max(1, Math.round(h / 3.75));
    hud.innerHTML = `<b>${Math.round(h)} m</b><span>Level ${level}</span>`;
    if (k >= 1) {
      const lookDir = look.clone();
      ride = null;
      rig.enterDeck(lookDir);
      hud.innerHTML = `<b>${DECKS.find((d) => Math.abs(d.h - h) < 2)?.name ?? Math.round(h) + ' m'}</b><span>Drag to look around</span>`;
      setTimeout(() => hud.classList.remove('on'), 5000);
    }
  };

  // ---- UI ----
  let lightIdx = 2;
  let cycle = false;
  const fmtHour = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const pickLight = (i: number) => {
    lightIdx = i;
    const p = LIGHT_PRESETS[i];
    cycle = p.hour < 0;
    if (!cycle) tod.setHour(p.hour);
    tod.cloudTarget = p.clouds;
  };
  const shotNames = ['Off', ...shots.map((s) => s.name), ...DECKS.map((d) => `Elevator to ${d.h} m`)];
  const ui = new Toolbar(
    [
      { id: 'grade', label: 'Grade', options: GRADE_PRESETS.map((g) => g.name), value: 0, onPick: (i) => post.setPreset(GRADE_PRESETS[i]) },
      {
        id: 'light', label: 'Time', options: LIGHT_PRESETS.map((l) => l.name), value: lightIdx, onPick: pickLight,
        extra: (pop) => {
          const row = document.createElement('div');
          row.className = 'row';
          row.innerHTML = '<span>Time</span>';
          const inp = document.createElement('input');
          inp.type = 'range'; inp.min = '5.6'; inp.max = '23'; inp.step = '0.01'; inp.value = String(tod.target);
          const t = document.createElement('span');
          t.className = 't';
          t.textContent = fmtHour(tod.target);
          inp.addEventListener('input', () => { cycle = false; tod.setHour(parseFloat(inp.value), true); t.textContent = fmtHour(tod.hour); ui.setValueText('light', fmtHour(tod.hour)); });
          row.append(inp, t);
          pop.appendChild(row);
        },
      },
      { id: 'show', label: 'Show', options: ['Off', 'Fountain', 'Light show', 'Both'], value: 0, onPick: (i) => {
        const wantF = i === 1 || i === 3, wantL = i === 2 || i === 3;
        if (wantF !== fountain.running) toggleFountain();
        if (wantL !== showOn) toggleShow();
      } },
      { id: 'shot', label: 'Shot', options: shotNames, value: 0, onPick: (i) => {
        ride = null;
        hud.classList.remove('on');
        if (i === 0) { if (rig.deck) { rig.free(); camera.position.copy(startPos); rig.controls.target.copy(startLook); } rig.play(null); }
        else if (i <= shots.length) rig.play(shots[i - 1]);
        else startRide(i - shots.length - 1);
      } },
      { id: 'sound', label: 'Sound', options: ['On', 'Off'], value: 0, onPick: (i) => music.setEnabled(i === 0) },
    ],
    [
      { id: 'fov', label: 'Field of view', min: 20, max: 75, step: 1, value: 54, onInput: (v) => { camera.fov = v; camera.updateProjectionMatrix(); } },
      { id: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.01, value: 0.3, onInput: (v) => ((post.grade.uniforms as any).uGrain.value = v) },
    ],
  );
  (post.grade.uniforms as any).uGrain.value = 0.3;
  rig.onShotEnd = () => ui.setValue('shot', 0);
  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = 'Burj Khalifa<span>Downtown Dubai in three.js</span>';
  document.body.appendChild(brand);
  const credit = document.createElement('a');
  credit.className = 'credit';
  credit.href = 'https://www.openstreetmap.org/copyright';
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = '© OpenStreetMap contributors';
  document.body.appendChild(credit);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = 'Click the lake for the fountain show, or the tower for a light show.<span>Shot › Elevator rides to the top</span>';
  document.body.appendChild(hint);
  setTimeout(() => hint.classList.add('done'), 12000);

  // ---- picking ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pick = (e: PointerEvent, occlude: boolean) => {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const targets: THREE.Object3D[] = [tower.mesh, water.mesh];
    if (occlude) targets.push(cityMesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return hit.object === tower.mesh ? 'tower' : hit.object === water.mesh ? 'lake' : 'city';
  };
  let down = { x: 0, y: 0, t: 0 };
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; hint.classList.add('done'); });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 400 || e.button !== 0) return;
    const k = pick(e, true);
    if (k === 'lake') toggleFountain();
    else if (k === 'tower') toggleShow();
  });
  let lastHover = 0;
  canvas.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (e.buttons || now - lastHover < 80) return;
    lastHover = now;
    const k = pick(e, false);
    canvas.style.cursor = k === 'lake' || k === 'tower' ? 'pointer' : '';
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'h') ui.toggleHidden();
    else if (k === 'f') toggleFountain();
    else if (k === 'l') toggleShow();
    else if (k === 'e') { startRide(1); ui.setValue('shot', shots.length + 2); }
    else if (k === 't') { const i = (lightIdx + 1) % (LIGHT_PRESETS.length - 1); pickLight(i); ui.setValue('light', i); }
    else if (k >= '0' && k <= '5') { const i = parseInt(k, 10); ride = null; hud.classList.remove('on'); rig.play(i === 0 ? null : shots[i - 1]); ui.setValue('shot', i); }
  });

  // ---- resize ----
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    post.composer.setPixelRatio(dpr);
    post.setSize(w, h);
    reflection.setSize(w * dpr, h * dpr);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // ---- loop ----
  const clock = new THREE.Timer();
  let envTimer = 0;
  let frames = 0, acc = 0, slowFor = 0, fastFor = 0, lockedUp = false, shadowTick = 0;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const stats = { fps: 0, ms: 0, dpr };
  const dbg = { nopost: false, noRefl: false };
  const frame = () => {
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.1);
    U.uTime.value += dt;
    const time = U.uTime.value;
    if (cycle) { let h = tod.target + dt * 0.15; if (h > 23) h = 5.6; tod.setHour(h, true); }
    tod.update(dt);
    (skyMat.uniforms.uSunDiscCol.value as THREE.Color).copy(sun.color).multiplyScalar(11);
    envTimer -= dt;
    if (tod.changed && envTimer <= 0) { scene.environment = env.update(); tod.changed = false; envTimer = 0.15; renderer.shadowMap.needsUpdate = true; }
    scene.environmentIntensity = tod.state.envIntensity;
    renderer.toneMappingExposure = tod.state.exposure;
    sun.target.position.set(axis.x, 0, axis.y);
    sun.position.copy(sun.target.position).addScaledVector(U.uLightDir.value, 2500);

    // lights come on through dusk
    const nightK = THREE.MathUtils.clamp((3 - tod.state.sunElev) / 9, 0, 1);
    towerUniforms.uNightK.value = nightK;
    cityUniforms.uNightK.value = nightK;
    groundUniforms.uNightK.value = nightK;
    fountain.mat.uniforms.uNightK.value = nightK;
    (fountain.mat.uniforms.uSun.value as THREE.Color).setScalar(Math.min(1, tod.state.lightIntensity / 4));
    cityUniforms.uLitFrac.value = THREE.MathUtils.clamp(0.38 + 0.22 * (1 - Math.abs((tod.hour - 21) / 3)), 0.3, 0.6);
    towerUniforms.uShowT.value += dt;
    towerUniforms.uShow.value += ((showOn ? 1 : 0) - towerUniforms.uShow.value) * (1 - Math.exp(-dt * 2.5));
    if (fountain.running && fountain.t > SHOW_LENGTH + 2.9) ui.setValue('show', showMenuIndex());
    fountain.update(dt, time);
    (tower.beaconMat.uniforms.uTime as any).value = time;
    (tower.beaconMat.uniforms.uPx as any).value = renderer.getPixelRatio();
    fountain.mat.uniforms.uPx.value = renderer.getPixelRatio();

    if (ride) updateRide(dt); else rig.update(dt);
    camera.updateMatrixWorld();

    shadowTick++;
    if (shadowTick % 3 === 0) renderer.shadowMap.needsUpdate = true;
    if (!dbg.noRefl) reflection.render(renderer, scene, camera, [water.mesh]);
    (post.grade.uniforms as any).uTime.value = time;
    if (dbg.nopost) { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    else post.composer.render(dt);

    frames++; acc += dt;
    if (acc >= 1) {
      stats.fps = frames / acc;
      stats.ms = (acc / frames) * 1000;
      if (stats.fps < 45 && dpr > 1) { slowFor++; fastFor = 0; if (slowFor >= 2) { dpr = Math.max(1, dpr - 0.25); stats.dpr = dpr; onResize(); slowFor = 0; lockedUp = true; } }
      else if (stats.fps > 58 && dpr < maxDpr && !lockedUp) { fastFor++; slowFor = 0; if (fastFor >= 3) { dpr = Math.min(maxDpr, dpr + 0.25); stats.dpr = dpr; onResize(); fastFor = 0; } }
      else { slowFor = 0; fastFor = 0; }
      frames = 0; acc = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.getElementById('loader')?.classList.add('done');

  (window as any).__scene = {
    U, renderer, scene, camera, rig, tod, stats, post, ui, dbg, tower, fountain, water, cityMesh, filler, ground, sky,
    occluded: (a: number[], b: number[]) => {
      const A = new THREE.Vector3(...(a as [number, number, number])), B = new THREE.Vector3(...(b as [number, number, number]));
      const d = B.clone().sub(A); const L = d.length();
      const r = new THREE.Raycaster(A, d.normalize(), 0, L - 2);
      return r.intersectObjects([cityMesh], false).length > 0;
    },
    toggleShow, toggleFountain, startRide, setDpr: (v: number) => { dpr = v; stats.dpr = v; onResize(); },
    counts: { buildings: city.buildings.length, tiers: city.tiers.length, nozzles: fountain.nozzles.length },
  };
}

init().catch((e) => {
  console.error(e);
  const l = document.getElementById('loader');
  if (l) l.innerHTML = `<div class="ld-word">Burj Khalifa</div><div class="ld-sub">Could not start: ${String(e?.message || e)}</div>`;
});
