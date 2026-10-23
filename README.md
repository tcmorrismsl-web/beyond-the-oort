# Beyond the Oort

A space RPG for iPhone, built as an installable web app (Phaser 4 + TypeScript + Vite).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, reachable from your phone on the same Wi-Fi |
| `npm run check` | **Quality gate** — types, lint, tests, build, iPhone/PWA audit, budgets. Must pass before any commit or release. |
| `npm run build` | Production build into `dist/` |
| `npm test` | Unit tests only |

## Play it on your iPhone

1. Push to GitHub and enable **Settings → Pages → GitHub Actions** (the included workflow builds and deploys).
2. Open `https://<user>.github.io/<repo>/` in Safari.
3. Tap **Share → Add to Home Screen**. Launch it from the icon for full-screen play and offline support.

## Layout

```
src/core/      rng, storage, saves (no Phaser)
src/systems/   game rules as pure functions (no Phaser)
src/data/      JSON content + validation
src/ui/        input and HUD helpers
src/scenes/    Phaser scenes: thin glue between systems and the screen
tests/         unit tests for everything outside scenes
```
