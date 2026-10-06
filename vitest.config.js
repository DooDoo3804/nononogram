import { defineConfig } from 'vitest/config';

// Every module under test (puzzle.js, levels.js, state/) is deliberately free of
// DOM and WebGL dependencies, so the plain node environment is enough — no jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    // Any `*.test.js` in the repo is part of the gate, wherever its owner keeps it:
    // the platform tests live in tests/, the puzzle track keeps theirs next to
    // solver.js / shapes/. Narrowing this to one directory would silently drop a
    // whole track's suite out of `npm test`.
    include: ['**/*.test.js'],
    exclude: ['node_modules/**', 'dist/**'],
    // Solver uniqueness proofs are search-bound and can run for tens of seconds on
    // the 6³ puzzles — the 5s default would fail them for being slow, not wrong.
    testTimeout: 30_000,
    reporters: 'default',
  },
});
