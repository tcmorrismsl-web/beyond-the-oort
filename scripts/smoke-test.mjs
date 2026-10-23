#!/usr/bin/env node
/**
 * Boots the production build in WebKit (Safari's engine) with iPhone
 * emulation and fails on anything a player would hit in the first seconds:
 * uncaught errors, console errors, a game loop that never starts, a canvas
 * that doesn't fill the screen, page scrolling, or a missing service worker.
 *
 * Exit codes: 0 pass, 1 fail, 3 browser unavailable (not a verdict).
 * Needs: npm i -D playwright && npx playwright install webkit
 * Run after `vite build`, from the project root.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 4179;
const URL = `http://127.0.0.1:${PORT}/?smoke`;

let pw;
try {
  pw = await import('playwright');
} catch {
  console.log('smoke: playwright not installed');
  process.exit(3);
}
if (!existsSync(pw.webkit.executablePath())) {
  console.log('smoke: WebKit not installed (npx playwright install webkit)');
  process.exit(3);
}
if (!existsSync('dist/index.html')) {
  console.error('smoke: no dist/ — build first');
  process.exit(1);
}

const server = spawn('npx', ['--no-install', 'vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
const problems = [];
let browser;

try {
  for (let i = 0; ; i += 1) {
    try {
      if ((await fetch(URL)).ok) break;
    } catch { /* not up yet */ }
    if (i > 60) throw new Error('preview server did not start');
    await new Promise((r) => setTimeout(r, 250));
  }

  browser = await pw.webkit.launch();
  for (const deviceName of ['iPhone 15 landscape', 'iPhone SE']) {
    const device = pw.devices[deviceName];
    if (!device) continue;
    const context = await browser.newContext({ ...device });
    const page = await context.newPage();
    const tag = `[${deviceName}]`;
    page.on('pageerror', (e) => problems.push(`${tag} uncaught: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag} console.error: ${m.text()}`); });
    page.on('requestfailed', (r) => problems.push(`${tag} failed request: ${r.url()}`));

    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('#game canvas', { timeout: 15000 }).catch(() => problems.push(`${tag} no canvas after 15s`));
    await page.waitForTimeout(1000);

    const frameA = await page.evaluate(() => window.__smoke?.frame() ?? -1);
    await page.waitForTimeout(1000);
    const frameB = await page.evaluate(() => window.__smoke?.frame() ?? -1);
    if (frameA < 0) problems.push(`${tag} smoke hook missing (window.__smoke) — main.ts must expose it on ?smoke`);
    else if (frameB - frameA < 20) problems.push(`${tag} game loop barely running (${frameB - frameA} frames/s)`);

    const scenes = await page.evaluate(() => window.__smoke?.activeScenes() ?? []);
    if (scenes.length === 0) problems.push(`${tag} no active scene`);

    const layout = await page.evaluate(() => {
      const c = document.querySelector('#game canvas');
      const r = c?.getBoundingClientRect();
      return {
        cw: r?.width ?? 0, ch: r?.height ?? 0,
        vw: window.innerWidth, vh: window.innerHeight,
        sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      };
    });
    if (layout.cw < layout.vw - 1 || layout.ch < layout.vh - 1) problems.push(`${tag} canvas ${layout.cw}x${layout.ch} does not fill ${layout.vw}x${layout.vh}`);
    if (layout.sw > layout.vw + 1 || layout.sh > layout.vh + 1) problems.push(`${tag} page scrolls (${layout.sw}x${layout.sh} > viewport)`);

    // Rotation (a real bug twice on iPhone): rotate, and also imitate iOS
    // laying out the new size late, after the last resize event. Within a
    // moment the game and every camera must match the screen again.
    const sizesMatch = async () => page.evaluate(() => {
      const s = window.__smoke?.size();
      if (!s) return 'smoke hook has no size()';
      const want = [window.innerWidth, window.innerHeight];
      const all = [s.game, ...s.cameras];
      const bad = all.find(([w, h]) => Math.abs(w - want[0]) > 1 || Math.abs(h - want[1]) > 1);
      return bad ? `game/cameras ${JSON.stringify(all)} vs screen ${want.join('x')}` : '';
    });
    const vp = page.viewportSize();
    if (vp) {
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await page.waitForTimeout(800);
      const afterRotate = await sizesMatch();
      if (afterRotate) problems.push(`${tag} after rotating: ${afterRotate}`);

      await page.evaluate(([w, h]) => {
        const g = document.getElementById('game');
        if (g) { g.style.width = `${w}px`; g.style.height = `${h}px`; }
      }, [vp.height, vp.width]);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const g = document.getElementById('game');
        if (g) { g.style.width = ''; g.style.height = ''; }
      });
      await page.waitForTimeout(800);
      const afterLate = await sizesMatch();
      if (afterLate) problems.push(`${tag} after late (iOS-style) layout: ${afterLate}`);
    }

    // Touch the movement zone and the right side; nothing should throw.
    await page.touchscreen.tap(layout.vw * 0.25, layout.vh * 0.6);
    await page.touchscreen.tap(layout.vw * 0.85, layout.vh * 0.6);
    await page.waitForTimeout(300);

    // Second load should be controlled by the service worker (offline-ready).
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    const sw = await page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()));
    if (!sw) problems.push(`${tag} service worker not registered`);

    await context.close();
  }
} catch (err) {
  problems.push(`smoke run crashed: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser?.close();
  server.kill();
}

if (problems.length) {
  console.error('smoke: FAILED\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('smoke: passed in WebKit (iPhone 15 landscape, iPhone SE)');
process.exit(0);
