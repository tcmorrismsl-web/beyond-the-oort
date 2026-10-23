import { defineConfig } from 'vitest/config';

// base './' keeps every asset path relative, so the build works from any
// sub-path (GitHub Pages serves at /<repo>/) and from the Home Screen.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Keep the engine in its own long-cached chunk; game code changes
        // often, Phaser rarely does.
        codeSplitting: {
          groups: [{ name: 'phaser', test: /node_modules[\\/]phaser/ }],
        },
      },
    },
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
