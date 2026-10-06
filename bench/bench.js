// bench/bench.js — the render perf harness.
//
// The shipped catalogue tops out below 6³ until the puzzle track lands level 4, and
// a draw-call claim about 216 cells has to be measured on 216 cells. This page builds
// a voxel grid at *any* dims straight off `render/`, spins the camera so OrbitControls
// damping and the matrix updates are in the measurement, and reports the numbers.
//
// It is also the only way to get a real reading off a real phone: open
// `<deploy>/bench/?suite=3x3x3,4x4x4,5x5x5,6x6x6` on the device and read the panel.
//
//   ?suite=6x6x6,5x5x5   dims to run, in order        (default: the level curve)
//   ?sec=4               measurement window per dims  (default 4)
//   ?fill=0.45           fraction of cells FILLED     (default 0.45)
//   ?spin=1              orbit the camera while measuring (default on)
//   ?maxdpr=2            retina cap (default render/scene.js MAX_PIXEL_RATIO).
//                        This is the knob that picked the shipped cap: fill cost
//                        scales with buffer area, so sweeping it on the mobile
//                        profile is how the DOO-19 ceiling was measured.
//
// `window.__bench.done` flips true when every run is finished and
// `window.__bench.results` holds the rows — that is the contract
// `scripts/bench-render.mjs` drives.

import { createView, MAX_PIXEL_RATIO } from '../render/scene.js';
import { createVoxelGrid } from '../render/voxels.js';
import { createAxisGizmo } from '../render/gizmo.js';
import { createPerfMonitor, FRAME_BUDGET_MS, FIRST_SCREEN_BUDGET_MS } from '../render/perf.js';
import { mulberry32 } from '../puzzle.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

const params = new URLSearchParams(location.search);
const SUITE = (params.get('suite') ?? '3x3x3,4x4x4,5x5x5,6x6x6')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(parseDims)
  .filter(Boolean);
const SECONDS = Number(params.get('sec') ?? 4);
const FILL = Number(params.get('fill') ?? 0.45);
const SPIN = params.get('spin') !== '0';
const MAX_DPR = Number(params.get('maxdpr') ?? MAX_PIXEL_RATIO);
// Each sync sample stalls the pipeline for one whole frame's raster, so on software
// raster at 2.6Mpx this probe costs ~100ms a sample. 24 is enough for a median and a
// p95; `?sync=0` turns it off when only the frame-pacing columns are wanted.
const SYNC_SAMPLES = Number(params.get('sync') ?? 24);

function parseDims(text) {
  const parts = text.toLowerCase().split('x').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 32)) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

const canvas = document.getElementById('scene');
const report = document.getElementById('report');
const view = createView(canvas, { maxPixelRatio: MAX_DPR });
const perf = createPerfMonitor(view.renderer, { overlay: params.has('perf') });

view.onFrame(() => perf.beginFrame());
view.onFrameEnd(() => perf.endFrame());
view.resize();
view.start();
window.addEventListener('resize', () => view.resize());

// A deterministic board with all three cell states in it, so the measurement covers
// the opaque instanced mesh, the transparent marked one and the empty cells at once.
function makeBoard(dims, fill) {
  const total = dims.x * dims.y * dims.z;
  const rand = mulberry32(total * 7919);
  const cells = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const r = rand();
    cells[i] = r < fill ? FILLED : r < fill + (1 - fill) * 0.35 ? MARKED : BLANK;
  }
  return cells;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Fill-rate probe — the number a DPR cap decision needs, and the one neither
// existing frame metric can supply. `frameMs` is vsync-capped and `cpuMs` brackets
// only our own code; the GPU rasterizes asynchronously, so a board drawn into a 9x
// buffer posts the same flat 60.0fps as a 1x one right up until it misses vsync
// outright. Forcing a pipeline sync after the draw puts the raster cost on the clock.
//
// readPixels rather than gl.finish(): finish() is advisory and several drivers return
// immediately, but a pixel read cannot be served before the frame it reads is done.
//
// The result includes draw-call submission, so the fill cost of a cap is the
// *difference* against the same board at cap 1, not the absolute number.
async function probeFill(samples = SYNC_SAMPLES) {
  if (samples <= 0) return { syncMs: 0, syncP95Ms: 0, syncMinMs: 0 };
  const gl = view.renderer.getContext();
  const px = new Uint8Array(4);
  const times = [];
  for (let i = 0; i < samples; i++) {
    await nextFrame();
    const at = performance.now();
    view.renderer.render(view.scene, view.camera);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    times.push(performance.now() - at);
  }
  times.sort((a, b) => a - b);
  return {
    syncMs: times[Math.floor(times.length * 0.5)],
    syncP95Ms: times[Math.floor(times.length * 0.95)],
    syncMinMs: times[0],
  };
}

const results = [];
window.__bench = { results, done: false, perf: () => perf.stats() };

async function run(dims) {
  const label = `${dims.x}x${dims.y}x${dims.z}`;
  const cells = makeBoard(dims, FILL);

  const buildAt = performance.now();
  const grid = createVoxelGrid(dims);
  grid.setAll(cells);
  view.scene.add(grid.group);
  const gizmo = createAxisGizmo(dims);
  view.scene.add(gizmo.group);
  view.frameCamera(dims);
  const buildMs = performance.now() - buildAt;

  // Let shader compiles and the first upload of the instance matrices land outside
  // the window — they are a first-screen cost, measured separately, not a frame cost.
  for (let i = 0; i < 20; i++) await nextFrame();

  // OrbitControls' own autoRotate rather than nudging camera.position by hand:
  // controls.update() runs after the frame callbacks and would overwrite a manual
  // position anyway, and this keeps the damping maths inside the measurement.
  perf.reset();
  view.controls.autoRotate = SPIN;
  view.controls.autoRotateSpeed = 2.4;
  await sleep(SECONDS * 1000);
  view.controls.autoRotate = false;
  const s = perf.stats();

  // One repaint of every cell, timed: this is the cost of `setAll` on a state
  // restore, and on the instanced path it is one buffer upload rather than N
  // material swaps.
  const repaintAt = performance.now();
  grid.setAll(cells);
  const repaintMs = performance.now() - repaintAt;

  // Picking has to survive the rewrite, so prove it here too: fire a ray down the
  // camera axis at the board centre and see whether a cell answers.
  const picked = grid.pick(view.rayFrom(centerEvent(canvas)));

  // After the window, never inside it: the sync stalls the pipeline on purpose and
  // would show up as dropped frames in the numbers above.
  const fill = await probeFill();

  const row = {
    dims: label,
    cells: cells.length,
    // The fill-rate denominator: what the DPR cap actually bought in buffer pixels.
    pixelRatio: round(view.pixelRatio(), 3),
    bufferPx: canvas.width * canvas.height,
    ...grid.stats(),
    drawCalls: s.drawCalls,
    triangles: s.triangles,
    fps: round(s.fps, 1),
    frameMs: round(s.frameMs, 2),
    p95Ms: round(s.p95Ms, 2),
    worstMs: round(s.worstMs, 2),
    cpuMs: round(s.cpuMs, 3),
    cpuWorstMs: round(s.cpuWorstMs, 3),
    droppedFrames: s.droppedFrames,
    frames: s.frames,
    buildMs: round(buildMs, 2),
    repaintMs: round(repaintMs, 3),
    syncMs: round(fill.syncMs, 3),
    syncP95Ms: round(fill.syncP95Ms, 3),
    syncMinMs: round(fill.syncMinMs, 3),
    picked,
    over: s.over,
  };
  results.push(row);

  view.scene.remove(grid.group);
  grid.dispose();
  view.scene.remove(gizmo.group);
  gizmo.dispose();
  await nextFrame();
  return row;
}

const round = (n, places) => Number(n.toFixed(places));

function centerEvent(el) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function render() {
  const head =
    `budget: cpu ≤ ${FRAME_BUDGET_MS.toFixed(1)}ms/frame, 0 dropped, ` +
    `first screen ≤ ${FIRST_SCREEN_BUDGET_MS}ms   (window ${SECONDS}s, fill ${FILL}, spin ${SPIN ? 'on' : 'off'})\n` +
    `dpr: device ${devicePixelRatio} cap ${MAX_DPR} → buffer ${view.pixelRatio()}x ` +
    `(${canvas.width}x${canvas.height} for ${canvas.clientWidth}x${canvas.clientHeight} css)\n` +
    `first frame: ${perf.stats().firstFrameMs?.toFixed(0) ?? '—'}ms\n\n` +
    'dims     cells  draw  tri     fps   gap    p95    cpu     sync    dropped  build   repaint  pick\n';
  const rows = results.map(
    (r) =>
      `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)}  ` +
      `${String(r.triangles).padStart(6)}  ${r.fps.toFixed(1).padStart(5)} ${r.frameMs.toFixed(2).padStart(6)} ` +
      `${r.p95Ms.toFixed(2).padStart(6)} ${r.cpuMs.toFixed(3).padStart(7)} ${r.syncMs.toFixed(2).padStart(7)} ` +
      `${String(r.droppedFrames).padStart(8)} ${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
      `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
      (r.over.length ? `   ⚠ ${r.over.join(',')}` : ''),
  );
  report.textContent = head + rows.join('\n') + (window.__bench.done ? '\n\ndone.' : '\n\nrunning…');
}

for (const dims of SUITE) {
  render();
  await run(dims);
}
window.__bench.done = true;
render();
console.log('[bench]', JSON.stringify(results));
