// main.js — bootstrap and wiring, nothing else.
//
// The three layers never reach into each other: `ui/` talks to the DOM, `render/`
// talks to WebGL, `state/` holds the rules, and this file is the only place that
// knows all three exist. A click goes ui/render -> session; the session emits, and
// render/ui react.

import { LEVELS } from './levels.js';
import { loadProgress } from './state/progress.js';
import { createSession } from './state/session.js';
import { createView } from './render/scene.js';
import { createVoxelGrid } from './render/voxels.js';
import { createAxisGizmo } from './render/gizmo.js';
import { createPerfMonitor } from './render/perf.js';
import { mountScreens } from './ui/screens.js';
import { mountMenu } from './ui/menu.js';
import { mountClues } from './ui/clues.js';
import { mountHud } from './ui/hud.js';

const SOLVED_TEXT = 'Solved! 🎉';

const canvas = document.getElementById('scene');
const view = createView(canvas);
const perf = createPerfMonitor(view.renderer, {
  overlay: new URLSearchParams(location.search).has('perf'),
});

let session = null;
let grid = null;
let gizmo = null;

const screens = mountScreens();
const clues = mountClues();
const hud = mountHud({ onUndo: () => session?.undo() });
const menu = mountMenu({
  levels: LEVELS,
  getProgress: loadProgress,
  onOpenPuzzle: openPuzzle,
  show: screens.show,
});

function repaintClues() {
  clues.render(session.dims, session.clues, session.currentRuns());
}

function teardownPuzzle() {
  if (grid) {
    view.scene.remove(grid.group);
    grid.dispose();
    grid = null;
  }
  if (gizmo) {
    view.scene.remove(gizmo.group);
    gizmo.dispose();
    gizmo = null;
  }
}

function openPuzzle(spec) {
  teardownPuzzle();
  session = createSession(spec);

  grid = createVoxelGrid(session.dims);
  grid.setAll(session.state);
  view.scene.add(grid.group);

  gizmo = createAxisGizmo(session.dims);
  view.scene.add(gizmo.group);

  view.frameCamera(session.dims);

  hud.setDims(`${session.dims.x}×${session.dims.y}×${session.dims.z}`);
  hud.setStatus(session.solved ? SOLVED_TEXT : '');
  repaintClues();

  session.on('cell', ({ i, value }) => {
    grid.setState(i, value);
    repaintClues();
  });
  session.on('solved', () => hud.setStatus(SOLVED_TEXT));

  screens.show('screen-game');
  view.resize();
}

// --- pointer input -------------------------------------------------------------
// OrbitControls also listens for pointerdown/up on the canvas to rotate the camera,
// so only treat this as a click (toggle a cell) when the pointer barely moved.
const DRAG_THRESHOLD = 5;
let downX = 0;
let downY = 0;

canvas.addEventListener('pointerdown', (event) => {
  downX = event.clientX;
  downY = event.clientY;
});

canvas.addEventListener('pointerup', (event) => {
  if (Math.hypot(event.clientX - downX, event.clientY - downY) >= DRAG_THRESHOLD) return;
  if (!session || session.solved) return;
  const i = grid.pick(view.rayFrom(event));
  if (i !== null) session.cycle(i);
});

// --- navigation ----------------------------------------------------------------

document.getElementById('btn-start').addEventListener('click', () => {
  menu.renderLevels();
  screens.show('screen-levels');
});
document.getElementById('btn-levels-back').addEventListener('click', () => screens.show('screen-main'));
document.getElementById('btn-puzzles-back').addEventListener('click', () => screens.show('screen-levels'));
// Re-rendering the level repaints the thumbnails and badges with the progress the
// player just made.
document.getElementById('btn-game-back').addEventListener('click', () => menu.reopenCurrentLevel());

window.addEventListener('resize', () => view.resize());

view.onFrame(() => {
  perf.tick();
  clues.setActiveAxis(view.facingAxis());
});
view.start();

// A read-only handle for QA / perf runs: `__nonogram.perf()` in the console.
window.__nonogram = {
  perf: () => perf.stats(),
  grid: () => grid?.stats() ?? null,
  session: () => session,
};
