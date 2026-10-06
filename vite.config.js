import { defineConfig } from 'vite';

// `base: './'` keeps the build relative-path only, so the dist/ folder can be
// dropped on any static host (or opened from a subpath) without rewriting URLs.
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    // three.js is the only heavy dependency — splitting it out keeps the app
    // chunk small enough to re-download on every deploy without re-fetching three.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
