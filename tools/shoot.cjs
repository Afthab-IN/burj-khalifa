// Headless Chrome (GPU) screenshots of the running dev server.
// usage: node tools/shoot.cjs '<json>'   json = { out, w, h, views: [{ name, hour, cam:[x,y,z], look:[x,y,z], wait, eval }] }
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const cfg = JSON.parse(process.argv[2] || '{}');
(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'],
  });
  const page = await browser.newPage({ viewport: { width: cfg.w || 1440, height: cfg.h || 900 }, deviceScaleFactor: cfg.dsf || 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const t0 = Date.now();
  await page.goto(cfg.url || 'http://127.0.0.1:5244/', { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__scene, null, { timeout: 60000 });
  } catch (e) {
    console.log('NO __scene after 60s');
    console.log(logs.slice(0, 40).join('\n'));
    await page.screenshot({ path: (cfg.out || '/tmp') + '/fail.png' });
    await browser.close();
    return;
  }
  console.log('ready in', Date.now() - t0, 'ms');
  const info = await page.evaluate(() => {
    const gl = window.__scene.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', counts: window.__scene.counts };
  });
  console.log(JSON.stringify(info));
  for (const v of cfg.views || [{ name: 'default', wait: 3000 }]) {
    await page.evaluate((v) => {
      const o = window.__scene;
      if (v.dpr) o.setDpr(v.dpr);
      if (v.hour !== undefined) { o.tod.setHour(v.hour, true); }
      if (v.clouds !== undefined) { o.tod.cloudTarget = v.clouds; o.tod.cloudCover = v.clouds; }
      if (v.shot !== undefined) o.rig.play(v.shot);
      if (v.cam) {
        o.rig.shot = null;
        o.camera.position.set(...v.cam);
        o.rig.controls.target.set(...(v.look || [0, 1.5, 0]));
        o.rig.controls.update();
      }
      if (v.fov) { o.camera.fov = v.fov; o.camera.updateProjectionMatrix(); }
      if (v.eval) (0, eval)(v.eval);
    }, v);
    await page.waitForTimeout(v.wait || 2500);
    if (v.measure) { const r = await page.evaluate(v.measure); console.log('measure', v.name, JSON.stringify(r)); continue; }
    const stats = await page.evaluate(() => ({ ...window.__scene.stats }));
    const path = `${cfg.out}/${v.name}.${cfg.type || 'jpg'}`;
    await page.screenshot({ path, type: cfg.type === 'png' ? 'png' : 'jpeg', quality: 88 });
    console.log(v.name, JSON.stringify(stats), path);
  }
  const errs = logs.filter((l) => /error|warn/i.test(l));
  console.log('console issues:', errs.length);
  console.log(errs.slice(0, 30).join('\n').slice(0, 6000));
  await browser.close();
})();
