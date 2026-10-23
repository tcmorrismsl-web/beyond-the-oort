import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// House rules exist to catch the bugs that only show up on an iPhone or
// after a player has a save file. Each message says why.
const restrictedGlobals = [
  { name: 'localStorage', message: 'Use src/core/storage.ts — Safari can throw on storage access.' },
  { name: 'sessionStorage', message: 'Use src/core/storage.ts — Safari can throw on storage access.' },
  { name: 'alert', message: 'Blocks the game loop and looks broken in a standalone PWA. Use an in-game dialog.' },
];

const restrictedProperties = [
  { object: 'Math', property: 'random', message: 'Use the seeded RNG in src/core/rng.ts so runs are reproducible and testable.' },
  { object: 'navigator', property: 'vibrate', message: 'Not supported on iPhone Safari. Design feedback that does not depend on it.' },
  { property: 'requestFullscreen', message: 'The Fullscreen API is unavailable on iPhone. Full screen comes from installing the PWA.' },
  { property: 'webkitRequestFullscreen', message: 'Unavailable on iPhone. Full screen comes from installing the PWA.' },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals],
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'eqeqeq': ['error', 'always'],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // Game rules stay engine-free so they are testable and reusable.
    files: ['src/systems/**', 'src/core/**', 'src/data/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'phaser', message: 'systems/core/data must not depend on Phaser — keep rules pure; scenes do the drawing.' }],
        patterns: [{ group: ['**/scenes/**', '**/ui/**'], message: 'Logic layers must not import scenes or UI.' }],
      }],
    },
  },
  { files: ['src/core/storage.ts'], rules: { 'no-restricted-globals': 'off' } },
  { files: ['src/core/rng.ts'], rules: { 'no-restricted-properties': 'off' } },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
);
