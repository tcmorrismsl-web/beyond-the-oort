import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// base './' keeps every asset path relative, so the build works from any
// sub-path (GitHub Pages serves at /<repo>/) and from the Home Screen.
export default defineConfig(({ mode }) => ({
  base: './',
  // Short build id shown in-game after an update (CI sets GITHUB_SHA).
  define: {
    __BUILD_ID__: JSON.stringify((loadEnv(mode, '.', '')['GITHUB_SHA'] ?? 'dev').slice(0, 7)),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Keep the engine in its own long-cached chunk; game code changes
        // often, Phaser rarely does.
        codeSplitting: {
          // Story and world content (JSON) get their own chunk too, so writing
          // more acts never pushes game code over its size budget.
          groups: [
            { name: 'phaser', test: /node_modules[\\/]phaser/ },
            { name: 'content', test: /src[\\/]data[\\/].*\.json$/ },
          ],
        },
      },
    },
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
