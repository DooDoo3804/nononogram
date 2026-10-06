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
//   ?fitmargin=1         framing slack (default render/scene.js FIT_MARGIN).
//   ?fit=sphere          which framing to measure (default `sphere`, the shipped one).
//                        `tan` and `legacy` reproduce the two older framings so the
//                        fill cost of tightening the frame is a measured delta rather
//                        than an argument — see DOO-22. The `coverage` column is the
//                        bridge between the two: it is the share of the canvas the
//                        board's silhouette actually covers, which is what the
//                        fragment count tracks.
//
// `window.__bench.done` flips true when every run is finished and
// `window.__bench.results` holds the rows — that is the contract
// `scripts/bench-render.mjs` drives.

import * as THREE from 'three';
import { createView, MAX_PIXEL_RATIO, FIT_MARGIN, fitRadiusFor } from '../render/scene.js';
import { createVoxelGrid, CELL_SIZE, GAP } from '../render/voxels.js';
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
const FIT_MARGIN_PARAM = Number(params.get('fitmargin') ?? FIT_MARGIN);
const FIT = params.get('fit') ?? 'sphere';
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
const view = createView(canvas, { maxPixelRatio: MAX_DPR, fitMargin: FIT_MARGIN_PARAM });
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

// The two framings that came before the shipped one, reproduced here rather than kept
// as a branch in render/scene.js — production wants one correct path, and a perf
// comparison wants all three. Both override `camera.position` after `frameCamera`, so
// they only hold until the next `resize()`; this page never resizes mid-run.
//
//   legacy  pre-DOO-22: radius from the box's longest side, canvas shape ignored.
//   tan     DOO-22 as first written: aspect-aware but an orthographic fit, which sits
//           1/cos(fov/2) = 8.2% too close and clips the near corners.
function overrideFraming(dims) {
  if (FIT === 'sphere') return;
  const dir = view.camera.position.clone().normalize();
  let distance;
  if (FIT === 'legacy') {
    const r = Math.max(dims.x, dims.y, dims.z) * 1.8 + 1;
    distance = Math.hypot(r, r * 0.85, r);
  } else if (FIT === 'tan') {
    const halfV = (view.camera.fov * Math.PI) / 360;
    distance =
      (fitRadiusFor(dims) * FIT_MARGIN_PARAM) /
      (Math.tan(halfV) * Math.min(1, view.camera.aspect));
  } else {
    throw new Error(`unknown ?fit=${FIT} (want sphere|tan|legacy)`);
  }
  view.camera.position.copy(dir).multiplyScalar(distance);
  view.controls.update();
  view.camera.updateMatrixWorld();
}

// What share of the canvas the board's silhouette covers, from the projected corners of
// the cell box. This is the quantity the fill cost actually tracks — `bufferPx` says how
// many pixels exist, this says how many of them the board asks the fragment shader for.
// Clamped to the canvas, because a clipped board cannot cost more than all of it.
function coverage(dims) {
  const span = (n) => (n - 1) * GAP + CELL_SIZE;
  const h = [span(dims.x) / 2, span(dims.y) / 2, span(dims.z) / 2];
  // `project()` reads `camera.matrixWorldInverse`, which only the renderer refreshes.
  // The camera was just re-placed, so without this the extents describe the previous
  // frame's pose.
  view.camera.updateMatrixWorld();
  let mx = 0;
  let my = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Vector3(sx * h[0], sy * h[1], sz * h[2]).project(view.camera);
        mx = Math.max(mx, Math.abs(p.x));
        my = Math.max(my, Math.abs(p.y));
      }
    }
  }
  // `clipped` is the honest companion to `coverage`: a silhouette that saturates the
  // canvas reads as high coverage precisely because part of the board is gone. The
  // tolerance is there because a correct fit lands exactly *on* the edge — tangency is
  // the goal, so bit noise at 1.0 must not read as a clip.
  return {
    coverage: Math.min(1, mx) * Math.min(1, my),
    extentX: mx,
    extentY: my,
    distance: view.camera.position.distanceTo(view.controls.target),
    clipped: Math.max(mx, my) > 1.001,
  };
}

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
  overrideFraming(dims);
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

  // Put the camera back on the opening shot before anything downstream reads it, so
  // `coverage` and the fill probe both describe one fixed, reproducible view instead of
  // wherever the spin happened to stop. The repaint and pick below give OrbitControls'
  // damping a few frames to shed the spin's residual before the probe starts.
  view.frameCamera(dims);
  overrideFraming(dims);

  // One repaint of every cell, timed: this is the cost of `setAll` on a state
  // restore, and on the instanced path it is one buffer upload rather than N
  // material swaps.
  const repaintAt = performance.now();
  grid.setAll(cells);
  const repaintMs = performance.now() - repaintAt;

  // Picking has to survive the rewrite, so prove it here too: fire a ray down the
  // camera axis at the board centre and see whether a cell answers.
  const picked = grid.pick(view.rayFrom(centerEvent(canvas)));

  const shot = coverage(dims);

  // After the window, never inside it: the sync stalls the pipeline on purpose and
  // would show up as dropped frames in the numbers above.
  const fill = await probeFill();

  const row = {
    dims: label,
    cells: cells.length,
    // The fill-rate denominator: what the DPR cap actually bought in buffer pixels.
    pixelRatio: round(view.pixelRatio(), 3),
    bufferPx: canvas.width * canvas.height,
    fit: FIT,
    fitMargin: FIT_MARGIN_PARAM,
    // Fragment demand, not just buffer size: the share of the canvas the board covers
    // and whether it is covering that much by overflowing the edge.
    coverage: round(shot.coverage, 4),
    extentX: round(shot.extentX, 4),
    extentY: round(shot.extentY, 4),
    fitDistance: round(shot.distance, 3),
    clipped: shot.clipped,
    boardPx: Math.round(shot.coverage * canvas.width * canvas.height),
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
    `fit: ${FIT} margin ${FIT_MARGIN_PARAM}   aspect ${(canvas.clientWidth / canvas.clientHeight).toFixed(3)}\n` +
    `first frame: ${perf.stats().firstFrameMs?.toFixed(0) ?? '—'}ms\n\n` +
    'dims     cells  draw  tri     fps   gap    p95    cpu     sync    cover  dropped  build   repaint  pick\n';
  const rows = results.map(
    (r) =>
      `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)}  ` +
      `${String(r.triangles).padStart(6)}  ${r.fps.toFixed(1).padStart(5)} ${r.frameMs.toFixed(2).padStart(6)} ` +
      `${r.p95Ms.toFixed(2).padStart(6)} ${r.cpuMs.toFixed(3).padStart(7)} ${r.syncMs.toFixed(2).padStart(7)} ` +
      `${(r.coverage * 100).toFixed(1).padStart(5)}%${r.clipped ? '*' : ' '}` +
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
