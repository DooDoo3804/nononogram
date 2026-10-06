import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `base: './'` keeps the build relative-path only, so the dist/ folder can be
// dropped on any static host (or opened from a subpath) without rewriting URLs.
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    // `bench/` ships with the app on purpose. The 60fps budget is written against a
    // mid-range Android, and the only honest way to read that is to open
    // `<deploy>/bench/` on the phone itself — a harness that only exists on a
    // developer's laptop cannot measure the device the budget talks about.
    // It shares the `three` chunk, so it adds ~3kB to the artifact.
    // three.js is the only heavy dependency — splitting it out keeps the app
    // chunk small enough to re-download on every deploy without re-fetching three.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench/index.html'),
      },
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
