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
import { mountPeel } from './render/peel.js';
import { mountScreens } from './ui/screens.js';
import { mountMenu } from './ui/menu.js';
import { mountClues } from './ui/clues.js';
import { mountHud } from './ui/hud.js';
import { mountGestures } from './ui/gestures.js';
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
const hud = mountHud({
  onUndo: () => session?.undo(),
  onToggleMode: () => gestures.toggleMode(),
});
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
// All of it lives in ui/gestures.js: tap vs long press vs drag vs pinch is one
// decision, and splitting it across main.js and a module is how DOO-16 happened — the
// inline handler that used to be here was pointerup-only, so the paint drag the module
// implements (and DOO-10's grouped undo exists for) was unreachable.
const gestures = mountGestures({
  canvas,
  view,
  getSession: () => session,
  getGrid: () => grid,
  onModeChange: (mode, opts) => hud.setMode(mode, opts),
});
hud.setMode(gestures.mode());

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

// --- depth cursor --------------------------------------------------------------
// `[` and `]` peel layers off whichever face of the box the camera is looking at, so
// an interior cell can be a full cell-sized click target instead of a sliver between
// the cells in front of it (DOO-17). Mounted here and nowhere else: the cursor is a
// view onto the board, so nothing in `state/` knows it exists.
//
// The keyboard binding is a desktop stopgap. The on-screen control, and teaching the
// player it is there, is DOO-28 on the UI/UX track — it should drive this object
// rather than reach into the grid.
const peel = mountPeel({ view, getGrid: () => grid });

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
  // Read-only on purpose: the harness clicks `#btn-mode` like a player does, and reads
  // this to assert the click landed. A `setMode` here would let a test pass while the
  // button it is meant to prove stayed broken.
  mode: () => gestures.mode(),
  levels: () =>
    LEVELS.map((level) => ({
      id: level.id,
      puzzles: level.puzzles.map((spec) => ({ id: spec.id, dims: spec.dims })),
    })),
  rewards: rewards.debug,
  // Read-only, like `mode()` above: the aim probe drives the cursor with real key
  // events and reads this to assert where it landed. A setter here would let a
  // measurement pass while the binding a player uses stayed broken.
  peel: () => peel.state(),
};
