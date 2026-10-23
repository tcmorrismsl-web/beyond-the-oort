import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { FlightScene } from './scenes/FlightScene';
import { requestPersistence } from './core/storage';
import { freshSeed } from './core/rng';
import { Session } from './core/session';
import { SESSION_KEY } from './scenes/sessionAccess';

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
  scene: [BootScene, FlightScene],
  callbacks: { preBoot: (g) => g.registry.set(SESSION_KEY, session) },
});

// Brief on-screen confirmation for saves, so the player can trust them.
const toast = document.getElementById('toast');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string): void {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1500);
}
session.bus.on('saved', () => {
  showToast('Saved');
});
session.bus.on('saveFailed', () => {
  showToast('Save failed');
});
if (session.started === 'resumed') showToast('Welcome back');

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
    __smoke?: { frame: () => number; activeScenes: () => string[] };
  }
}
if (new URLSearchParams(window.location.search).has('smoke')) {
  window.__smoke = {
    frame: () => game.loop.frame,
    activeScenes: () => game.scene.getScenes(true).map((s) => s.scene.key),
  };
}
