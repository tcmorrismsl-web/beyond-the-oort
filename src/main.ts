import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { FlightScene } from './scenes/FlightScene';
import { LandedScene } from './scenes/LandedScene';
import { MapScene } from './scenes/MapScene';
import { TitleScene } from './scenes/TitleScene';
import { CreateScene } from './scenes/CreateScene';
import { ShipScene } from './scenes/ShipScene';
import { readKey, requestPersistence, writeKey } from './core/storage';
import { freshSeed } from './core/rng';
import { Session } from './core/session';
import { SESSION_KEY } from './scenes/sessionAccess';
import { showToast } from './ui/toast';

// One playthrough shared by every scene: resumes the saved game if there is one.
const session = Session.start(freshSeed(), Date.now());
if (session.loadProblem !== null) console.warn('save could not be loaded; backed up and started fresh:', session.loadProblem);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#05060a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  input: { activePointers: 3 },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [BootScene, TitleScene, CreateScene, FlightScene, MapScene, ShipScene, LandedScene],
  callbacks: { preBoot: (g) => g.registry.set(SESSION_KEY, session) },
});

// iOS often reports the new size a moment after a rotation event, so Phaser
// can lock onto a stale, half-rotated size. Re-check the real size several
// times after any rotation/resize, plus a cheap watchdog as a safety net.
const gameParent = document.getElementById('game');
function syncGameSize(): void {
  if (!gameParent) return;
  const w = gameParent.clientWidth;
  const h = gameParent.clientHeight;
  if (w > 0 && h > 0 && (w !== Math.round(game.scale.width) || h !== Math.round(game.scale.height))) {
    game.scale.refresh();
  }
}
function scheduleSizeChecks(): void {
  for (const ms of [0, 100, 300, 700, 1200]) setTimeout(syncGameSize, ms);
}
window.addEventListener('resize', scheduleSizeChecks);
window.addEventListener('orientationchange', scheduleSizeChecks);
window.visualViewport?.addEventListener('resize', scheduleSizeChecks);
setInterval(syncGameSize, 500);

session.bus.on('saved', () => {
  showToast('Saved');
});
session.bus.on('saveFailed', () => {
  showToast('Save failed');
});
// Tell the player when they're on a new build (also makes playtests easy to
// confirm); otherwise welcome them back.
const BUILD_KEY = 'game.build';
const lastBuild = readKey(BUILD_KEY);
if (session.started !== 'new' && lastBuild !== __BUILD_ID__) showToast(`Updated · build ${__BUILD_ID__}`);
else if (session.started === 'resumed') showToast('Welcome back');
writeKey(BUILD_KEY, __BUILD_ID__);

// Pause cleanly when the player leaves the app (and keep audio from bleeding).
// Leaving is also the moment to save: iOS may kill a backgrounded web app
// without any further warning.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    session.save(Date.now());
    game.loop.sleep();
  } else {
    game.loop.wake();
  }
});
// pagehide fires on some exits where visibilitychange does not (iOS quirk).
window.addEventListener('pagehide', () => {
  session.save(Date.now());
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err: unknown) => {
      console.warn('service worker registration failed', err);
    });
  });
}

void requestPersistence();

// Test hook for scripts/smoke-test.mjs; only exists when the URL has ?smoke.
declare global {
  interface Window {
    __smoke?: {
      frame: () => number;
      activeScenes: () => string[];
      /** Knocks every camera to a wrong size, as a missed resize would. */
      breakCameras: (w: number, h: number) => void;
      size: () => { game: [number, number]; cameras: [number, number][] };
      /** Test-only: move the ship (e.g. next to a station) and read the state. */
      setShip: (x: number, y: number) => void;
      state: () => string;
    };
  }
}
if (new URLSearchParams(window.location.search).has('smoke')) {
  window.__smoke = {
    frame: () => game.loop.frame,
    activeScenes: () => game.scene.getScenes(true).map((s) => s.scene.key),
    breakCameras: (w, h) => {
      for (const sc of game.scene.getScenes(true)) for (const c of sc.cameras.cameras) c.setSize(w, h);
    },
    setShip: (x, y) => {
      session.state.ship.x = x;
      session.state.ship.y = y;
      session.state.ship.vx = 0;
      session.state.ship.vy = 0;
    },
    state: () => JSON.stringify(session.state),
    size: () => ({
      game: [game.scale.width, game.scale.height],
      cameras: game.scene.getScenes(true).flatMap((sc) => sc.cameras.cameras.map((c): [number, number] => [c.width, c.height])),
    }),
  };
}
