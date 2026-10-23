#!/usr/bin/env node
/**
 * Quality gate for an iPhone web game (Phaser + TypeScript + Vite PWA).
 * Run from the project root:  node scripts/quality-gate.mjs [--fast]
 *
 * Nothing ships unless this exits 0. It runs the toolchain (types, lint,
 * tests, build), then audits what the toolchain cannot see: iPhone/PWA
 * requirements, performance budgets, save-format safety and code hygiene.
 * --fast skips the production build and the checks that need it.
 * --smoke makes the real-browser smoke test mandatory (CI uses this); without
 * it the smoke test still runs when WebKit is installed, else it warns.
 *
 * Budgets come from quality.config.json in the project root (optional).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.cwd();
const fast = process.argv.includes('--fast');
const requireSmoke = process.argv.includes('--smoke');
const defaults = {
  maxEntryGzipKB: 120,        // game code chunk, gzipped
  maxEngineGzipKB: 450,       // phaser chunk, gzipped
  maxTotalDistMB: 25,         // whole build incl. assets
  maxImageKB: 600,            // any single image
  maxTextureDimension: 4096,  // older iPhones cap WebGL textures at 4096
  maxAudioKB: 1500,           // any single audio file
};
const config = { ...defaults, ...readJson(join(root, 'quality.config.json'), {}) };

const failures = [];
const warnings = [];
const passes = [];
const fail = (area, msg) => failures.push(`[${area}] ${msg}`);
const warn = (area, msg) => warnings.push(`[${area}] ${msg}`);
const pass = (msg) => passes.push(msg);

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function run(label, cmd, args) {
  process.stdout.write(`• ${label} … `);
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status === 0) {
    console.log('ok');
    pass(label);
    return true;
  }
  console.log('FAILED');
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-40).join('\n');
  fail(label, `\n${output}`);
  return false;
}

/** PNG width/height straight from the IHDR header; no image library needed. */
function pngSize(path) {
  const b = readFileSync(path);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------------------------------------------------------------- structure
console.log('\nQuality gate' + (fast ? ' (fast)' : '') + '\n');
for (const f of ['package.json', 'tsconfig.json', 'eslint.config.js', 'index.html', 'public/manifest.webmanifest', 'public/sw.js', 'src/main.ts']) {
  if (!existsSync(join(root, f))) fail('structure', `missing ${f}`);
}
if (!existsSync(join(root, 'node_modules'))) {
  fail('structure', 'node_modules missing — run npm install first');
  report();
}

// ---------------------------------------------------------------- toolchain
const tsc = run('typecheck', 'npx', ['--no-install', 'tsc', '--noEmit']);
run('lint', 'npx', ['--no-install', 'eslint', '.', '--max-warnings', '0']);
run('tests', 'npx', ['--no-install', 'vitest', 'run']);
const built = !fast && tsc && run('production build', 'npx', ['--no-install', 'vite', 'build']);

// ---------------------------------------------------------------- source hygiene
const srcFiles = walk(join(root, 'src')).filter((f) => /\.(ts|js|css|html)$/.test(f));
const testFiles = walk(join(root, 'tests'));
for (const file of [...srcFiles, join(root, 'index.html')]) {
  if (!existsSync(file)) continue;
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/@ts-ignore|@ts-nocheck/.test(line)) fail('hygiene', `${at} suppresses the type checker`);
    if (/@ts-expect-error(?!\s*[-—:]\s*\S)/.test(line)) fail('hygiene', `${at} @ts-expect-error needs a reason (// @ts-expect-error — why)`);
    if (/eslint-disable/.test(line) && !/--\s*\S/.test(line)) fail('hygiene', `${at} eslint-disable needs a reason ("-- why")`);
    if (/\b100vh\b/.test(line)) fail('ios', `${at} uses 100vh; Safari's toolbars make it taller than the screen — use 100dvh`);
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) warn('hygiene', `${at} ${line.trim().slice(0, 80)}`);
    if (/\.(ogg|oga|opus)\b/.test(line) && !/\.(m4a|mp3|aac)\b/.test(line)) fail('ios', `${at} references Ogg/Opus audio without an m4a/mp3 alternative — iPhone Safari may not play it`);
    if (/screen\.orientation\.lock/.test(line)) fail('ios', `${at} orientation.lock() is not supported on iPhone; use the manifest orientation and a rotate-device prompt`);
    if (/new\s+AudioContext|webkitAudioContext/.test(line) && !srcFiles.some((f) => /unlock/i.test(readFileSync(f, 'utf8')))) {
      warn('ios', `${at} creates an AudioContext; iPhone keeps it suspended until a user gesture — make sure audio is unlocked on first tap`);
    }
  });
}
if (testFiles.length === 0) fail('tests', 'no test files in tests/ — game logic must be covered');
const logicDirs = ['systems', 'core', 'data'];
for (const dir of logicDirs) {
  const files = walk(join(root, 'src', dir)).filter((f) => f.endsWith('.ts'));
  const testsText = testFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const f of files) {
    const mod = relative(join(root, 'src'), f).replace(/\.ts$/, '');
    const base = mod.split('/').pop();
    if (base === 'storage') continue; // browser-only wrapper, exercised through save tests
    if (!testsText.includes(`/${mod}'`) && !testsText.includes(`/${mod}"`)) warn('tests', `src/${mod}.ts has no test importing it`);
  }
}

// ---------------------------------------------------------------- save-format safety
const savePath = join(root, 'src/core/save.ts');
const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
if (existsSync(savePath) && git.status === 0) {
  const diff = spawnSync('git', ['diff', 'HEAD', '-U0', '--', 'src/core/save.ts'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
  const changed = diff.split('\n').filter((l) => /^[+-](?![+-])/.test(l));
  const schemaTouched = changed.some((l) => /z\.|:\s*z\b/.test(l));
  const versionBumped = changed.some((l) => /SAVE_VERSION\s*=/.test(l));
  const migrationAdded = changed.some((l) => /^\+.*\d+\s*:\s*\(/.test(l) || /^\+.*migrations\[/.test(l));
  if (schemaTouched && !versionBumped) fail('saves', 'save schema changed but SAVE_VERSION was not bumped — existing player saves would fail to load');
  else if (versionBumped && !migrationAdded) fail('saves', 'SAVE_VERSION bumped without adding a migration for the previous version');
  else pass('save format');
}

// ---------------------------------------------------------------- iPhone / PWA audit
// Strip comments so a mention in a comment can't satisfy (or trip) a check.
const html = (existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '').replace(/<!--[\s\S]*?-->/g, '');
const viewport = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i)?.[0] ?? '';
if (!/viewport-fit=cover/.test(viewport)) fail('ios', 'viewport meta lacks viewport-fit=cover (canvas will not reach the screen edges)');
if (!/user-scalable=no/.test(viewport)) fail('ios', 'viewport meta lacks user-scalable=no (double-tap and pinch will zoom the game)');
if (!/rel=["']apple-touch-icon["']/.test(html)) fail('pwa', 'no apple-touch-icon link (Home Screen icon will be a screenshot)');
if (!/rel=["']manifest["']/.test(html)) fail('pwa', 'no manifest link');
if (!/touch-action:\s*none/.test(html) && !srcFiles.some((f) => /touch-action:\s*none/.test(readFileSync(f, 'utf8')))) {
  fail('ios', 'no touch-action: none — Safari will scroll/zoom on gestures');
}
if (/(src|href)=["']\/(?!\/)/.test(html)) fail('pwa', 'index.html uses root-absolute paths ("/..."); they break on GitHub Pages sub-paths — use "./"');

const manifest = readJson(join(root, 'public/manifest.webmanifest'), null);
if (manifest) {
  if (!['standalone', 'fullscreen'].includes(manifest.display)) fail('pwa', 'manifest display must be "standalone" for an app-like Home Screen launch');
  if (!manifest.orientation) warn('pwa', 'manifest has no orientation — decide portrait or landscape');
  if (typeof manifest.start_url === 'string' && manifest.start_url.startsWith('/')) fail('pwa', 'manifest start_url is root-absolute; use "./"');
  const sizes = (manifest.icons ?? []).map((i) => i.sizes);
  for (const need of ['192x192', '512x512']) if (!sizes.includes(need)) fail('pwa', `manifest missing ${need} icon`);
  for (const icon of manifest.icons ?? []) {
    const p = join(root, 'public', icon.src);
    if (!existsSync(p)) fail('pwa', `manifest icon not found: public/${icon.src}`);
    else {
      const dim = pngSize(p);
      if (dim && `${dim.w}x${dim.h}` !== icon.sizes) fail('pwa', `public/${icon.src} is ${dim.w}x${dim.h}, manifest says ${icon.sizes}`);
    }
  }
} else fail('pwa', 'public/manifest.webmanifest missing or not valid JSON');

const touchIconHref = html.match(/rel=["']apple-touch-icon["'][^>]*href=["']\.?\/?([^"']+)/)?.[1];
if (touchIconHref) {
  const p = join(root, 'public', touchIconHref);
  const dim = existsSync(p) ? pngSize(p) : null;
  if (!dim) fail('pwa', `apple-touch-icon not found or not a PNG: public/${touchIconHref}`);
  else if (dim.w !== 180 || dim.h !== 180) fail('pwa', `apple-touch-icon is ${dim.w}x${dim.h}; iPhone wants 180x180`);
}

const sw = existsSync(join(root, 'public/sw.js')) ? readFileSync(join(root, 'public/sw.js'), 'utf8') : '';
if (sw && !/const\s+CACHE\s*=/.test(sw)) warn('pwa', 'service worker has no CACHE version constant — updates may never reach players');
if (sw && git.status === 0) {
  const swChanged = (spawnSync('git', ['diff', 'HEAD', '--stat', '--', 'public/sw.js'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim();
  const lastTag = (spawnSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim();
  if (lastTag && !swChanged) {
    const since = (spawnSync('git', ['diff', lastTag, '--stat', '--', 'public/sw.js'], { cwd: root, encoding: 'utf8' }).stdout ?? '').trim();
    if (!since) warn('pwa', `public/sw.js CACHE unchanged since ${lastTag}; bump it when releasing`);
  }
}

// ---------------------------------------------------------------- assets & budgets
const assetFiles = walk(join(root, 'public'));
for (const f of assetFiles) {
  const rel = relative(root, f);
  const kb = statSync(f).size / 1024;
  const ext = extname(f).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    if (kb > config.maxImageKB) fail('budget', `${rel} is ${kb.toFixed(0)} KB (limit ${config.maxImageKB} KB) — compress or split it`);
    const dim = ext === '.png' ? pngSize(f) : null;
    if (dim && (dim.w > config.maxTextureDimension || dim.h > config.maxTextureDimension)) {
      fail('budget', `${rel} is ${dim.w}x${dim.h}; textures over ${config.maxTextureDimension}px fail on some iPhones`);
    }
  }
  if (['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus'].includes(ext)) {
    if (kb > config.maxAudioKB) fail('budget', `${rel} is ${kb.toFixed(0)} KB (limit ${config.maxAudioKB} KB)`);
    if (ext === '.wav') warn('budget', `${rel} is uncompressed WAV — convert to m4a`);
    if (['.ogg', '.opus'].includes(ext)) {
      const stem = f.slice(0, -ext.length);
      if (!['.m4a', '.mp3', '.aac'].some((e) => existsSync(stem + e))) fail('ios', `${rel} has no m4a/mp3 twin for iPhone`);
    }
  }
}

if (built) {
  const dist = walk(join(root, 'dist'));
  const total = dist.reduce((n, f) => n + statSync(f).size, 0) / 1024 / 1024;
  if (total > config.maxTotalDistMB) fail('budget', `build is ${total.toFixed(1)} MB (limit ${config.maxTotalDistMB} MB)`);
  for (const f of dist.filter((f) => f.endsWith('.js'))) {
    const gz = gzipSync(readFileSync(f)).length / 1024;
    const isEngine = /phaser/i.test(f);
    const limit = isEngine ? config.maxEngineGzipKB : config.maxEntryGzipKB;
    if (gz > limit) fail('budget', `${relative(root, f)} is ${gz.toFixed(0)} KB gzipped (limit ${limit} KB)`);
  }
  const distHtml = existsSync(join(root, 'dist/index.html')) ? readFileSync(join(root, 'dist/index.html'), 'utf8') : '';
  if (/(src|href)=["']\/(?!\/)/.test(distHtml)) fail('pwa', 'built index.html has root-absolute asset paths — set base: "./" in vite.config.ts');
  if (!existsSync(join(root, 'dist/sw.js'))) fail('pwa', 'dist/sw.js missing — offline play will not work');
  if (!existsSync(join(root, 'dist/manifest.webmanifest'))) fail('pwa', 'dist/manifest.webmanifest missing');
  if (failures.every((f) => !f.startsWith('[budget]'))) pass(`budgets (build ${total.toFixed(1)} MB)`);

  if (existsSync(join(root, 'scripts/smoke-test.mjs'))) {
    process.stdout.write('• smoke test in WebKit (iPhone) … ');
    const r = spawnSync('node', ['scripts/smoke-test.mjs'], { cwd: root, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    if (r.status === 0) { console.log('ok'); pass('smoke test (WebKit, iPhone profiles)'); }
    else if (r.status === 3 && !requireSmoke) { console.log('skipped'); warn('smoke', `${out} — not run here; CI runs it on every push`); }
    else { console.log('FAILED'); fail('smoke', `\n${out}`); }
  } else fail('smoke', 'scripts/smoke-test.mjs missing');
} else if (requireSmoke) {
  fail('smoke', 'smoke test requires a production build (do not combine --smoke with --fast)');
}

report();

function report() {
  console.log('');
  for (const p of passes) console.log(`  ✓ ${p}`);
  if (warnings.length) {
    console.log(`\nWarnings (${warnings.length}) — fix or justify before release:`);
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  if (failures.length) {
    console.log(`\nFAILED (${failures.length}) — not shippable:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log('\nPASSED — ready for an on-device playtest.\n');
  process.exit(0);
}
