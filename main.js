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
import { mountRewards } from './fx/index.js';

const SOLVED_TEXT = 'Solved! 🎉';

const canvas = document.getElementById('scene');
const query = new URLSearchParams(location.search);

// `?fitmargin=` is the framing slack, overridable here for the same reason `?perf` is
// (DOO-22): the margin decides how much of the canvas the board covers, which decides
// the cell aperture the DOO-18 gate measures, so "would 1.1 be better?" has to be a
// URL away rather than a rebuild. A bad value falls back to the shipped default.
const fitMargin = Number(query.get('fitmargin'));
const view = createView(canvas, {
  ...(Number.isFinite(fitMargin) && fitMargin > 0 ? { fitMargin } : {}),
});
const perf = createPerfMonitor(view.renderer, { overlay: query.has('perf') });

let session = null;
let grid = null;
let gizmo = null;
let openedAPuzzle = false;

const screens = mountScreens();
const clues = mountClues();
const hud = mountHud({ onUndo: () => session?.undo() });
const menu = mountMenu({
  levels: LEVELS,
  getProgress: loadProgress,
  onOpenPuzzle: openPuzzle,
  show: screens.show,
});

// The reward layer (timer, records, hints, unlocks, sound, clear celebration). It
// brings its own DOM and CSS and discovers the rest through `session`/`grid`/`view`,
// so the wiring here is three lines: mount, open, close.
const rewards = mountRewards({
  levels: LEVELS,
  view,
  openPuzzle,
  backToList: () => menu.reopenCurrentLevel(),
});

function repaintClues() {
  clues.render(session.dims, session.clues, session.currentRuns());
}

function teardownPuzzle() {
  rewards.closePuzzle();
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

  rewards.openPuzzle({ session, grid });

  screens.show('screen-game');
  view.resize();

  // Two milestones, because "first screen" is ambiguous: `first-frame` (recorded
  // by perf itself) is when anything appears, `first-puzzle` is when the player
  // can actually play. Both have to land inside the 2s budget.
  if (!openedAPuzzle) {
    openedAPuzzle = true;
    perf.mark('first-puzzle');
  }
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

// perf brackets the whole frame — callbacks, controls and the draw call — so
// `cpuMs` is the number with head room in it, not the vsync-capped frame gap.
view.onFrame(() => {
  perf.beginFrame();
  clues.setActiveAxis(view.facingAxis());
});
view.onFrameEnd(() => perf.endFrame());
view.start();

// A read-only handle for QA / perf runs: `__nonogram.perf()` in the console.
//
// `levels()` is a slim projection of the catalogue (ids and dims, not the solutions).
// `scripts/verify-browser.mjs` needs it to seed progress and reach the level-4 6³
// boards, which the reward layer gates behind a score — without it the render gate
// can only ever measure 3³.
window.__nonogram = {
  perf: () => perf.stats(),
  // Start a fresh measurement window — lets a harness separate steady-state
  // gameplay from the one-off hitch of a screen transition.
  perfReset: () => perf.reset(),
  grid: () => grid?.stats() ?? null,
  session: () => session,
  levels: () =>
    LEVELS.map((level) => ({
      id: level.id,
      puzzles: level.puzzles.map((spec) => ({ id: spec.id, dims: spec.dims })),
    })),
  rewards: rewards.debug,
};
