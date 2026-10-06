import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Tests, build configs and CLI tooling run in node, not the browser. Every `.mjs`
  // here is a node script by convention — the browser code is `.js` bundled by Vite —
  // so this stays correct as the puzzle/QA tracks add their own report scripts.
  {
    files: ['**/*.test.js', '**/*.mjs', 'tests/**', 'scripts/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
