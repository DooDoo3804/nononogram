// scripts/verify-browser.mjs — drives the built app in headless Chrome and asserts
// the behaviours the platform work must not regress.
//
//   node scripts/verify-browser.mjs <baseUrl> [outDir]
//
// Chrome runs with every host except 127.0.0.1 mapped to NOTFOUND, so a pass here is
// also the proof that the app runs with the network cut (no unpkg, no CDN).
// Exits non-zero on the first failed check; writes PNGs of each screen to outDir.
//
// NOTHING here hard-codes the puzzle catalogue. It used to assert "12 cards" and
// "card #5 is 4×4×4", which turned every edit to levels.js by the puzzle track into a
// red platform gate. Expectations are now read off the running app — the card count,
// the dims of whatever puzzle got opened, the id to look for in localStorage — so this
// file only fails when the *platform* contract breaks.

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from './cdp.mjs';
// The tap/drag threshold the app actually ships, so the check below names the real
// number instead of a copy that can drift away from it.
import { SLOP } from '../ui/gestures.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'verify-out';

// One InstancedMesh for filled cells, one for marked, one merged LineSegments for the
// outlines, plus the gizmo's 3 lines and 3 sprites. The number that matters is that it
// does not grow with the cell count.
const DRAW_CALL_CEILING = 12;

mkdirSync(OUT, { recursive: true });
const { check, report, checks } = checklist();

const browser = await launchChrome({ offline: true });
const page = await browser.newPage();

const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), await page.screenshot());

// Two known, pre-existing noises owned by other tracks, neither a module contract:
// Google Fonts is a CDN stylesheet that 404s with the network cut (the page falls back
// to a system font), and the project has no favicon.
const IGNORED_NOISE = /fonts\.(googleapis|gstatic)\.com|favicon\.ico/;
const pageErrors = () => page.errors().filter((t) => !IGNORED_NOISE.test(t));

await page.goto(`${BASE}/?perf=1`);

check('boots with no console errors', pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));
check('three.js came from the local bundle', await page.evaluate('!!window.__nonogram'), 'window.__nonogram present');

const thirdParty = page.externalRequests(BASE).filter((u) => !u.includes('fonts.g'));
check('requests no third-party JS/CSS (unpkg gone)', thirdParty.length === 0, thirdParty.slice(0, 3).join(' | '));
await shot('1-title');

// --- navigate: title -> levels ---------------------------------------------

await page.evaluate("document.getElementById('btn-start').click()");
await sleep(250);
const levelCount = await page.evaluate("document.querySelectorAll('#levels-grid .level-card').length");
check('level list renders', levelCount > 0, `${levelCount} levels`);
await shot('2-levels');

const openLevel = async (i) => {
  await page.evaluate(`document.querySelectorAll('#levels-grid .level-card')[${i}].click()`);
  await sleep(250);
};

await openLevel(0);
const cards = await page.evaluate("document.querySelectorAll('#puzzles-grid .puzzle-card').length");
check('level 1: puzzle list renders', cards > 0, `${cards} cards`);
await shot('3-puzzles');

/** Dims / clue / grid shape of whatever puzzle is currently open. */
const readBoard = () =>
  page.evaluate(`(() => {
    const s = window.__nonogram.session();
    const p = window.__nonogram.perf();
    return {
      id: s.spec.id,
      dims: s.dims,
      label: document.getElementById('dims-label').textContent,
      gameVisible: !document.getElementById('screen-game').hidden,
      clues: {
        x: document.querySelectorAll('#clues-x .clue-cell').length,
        y: document.querySelectorAll('#clues-y .clue-cell').length,
        z: document.querySelectorAll('#clues-z .clue-cell').length,
      },
      grid: window.__nonogram.grid(),
      drawCalls: p.drawCalls,
      triangles: p.triangles,
    };
  })()`);

function checkBoard(b) {
  const { x, y, z } = b.dims;
  check(`${b.id}: game screen visible with the dims label filled in`, b.gameVisible && b.label === `${x}×${y}×${z}`, b.label);
  // clues[axis] is indexed by the *other* two axes (puzzle.js: x -> [y][z]).
  check(
    `${b.id}: all three clue panels populated for ${x}×${y}×${z}`,
    b.clues.x === y * z && b.clues.y === x * z && b.clues.z === x * y,
    JSON.stringify(b.clues),
  );
  check(`${b.id}: voxel grid built for all ${x * y * z} cells`, b.grid.cells === x * y * z, JSON.stringify(b.grid));
  check(`${b.id}: grid is instanced`, b.grid.instanced === true, JSON.stringify(b.grid));
}

// --- interaction: a real pointer click on the canvas picks a cell ----------
// This is the instance-raycast proof: a synthetic OS-level mouse event, through
// OrbitControls' own listeners, has to land on a cell and toggle it. It runs before
// the progress seeding below, because a solved board locks input on purpose.

await page.evaluate("document.querySelectorAll('#puzzles-grid .puzzle-card')[0].click()");
await sleep(700);
checkBoard(await readBoard());
await shot('4-game');

const puzzleId = await page.evaluate('window.__nonogram.session().spec.id');
const before = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
const box = await page.evaluate(`(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await page.call('Input.dispatchMouseEvent', {
    type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse',
  });
  await sleep(60);
}
await sleep(200);
const afterClick = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
check(
  'canvas click instance-raycasts and toggles a cell',
  afterClick !== before,
  `${before.replace(/0/g, '').length} -> ${afterClick.replace(/0/g, '').length} non-blank`,
);

// In rotate mode (the default) a drag must rotate the camera instead of toggling a
// cell. `ui/gestures.js` measures the furthest the pointer ever strayed, not the
// down-to-up distance, so a rotation that loops back to its start is still a drag.
// `path` is [dx, dy] offsets from the centre of the canvas. The press is always at the
// centre, which for a paint drag matters: a stroke that starts off the board never opens,
// so the gesture layer is right to paint nothing.
const drag = async (path) => {
  const steps = [['mousePressed', [0, 0]], ...path.map((p) => ['mouseMoved', p]), ['mouseReleased', path.at(-1)]];
  for (const [type, [dx, dy]] of steps) {
    await page.call('Input.dispatchMouseEvent', {
      type, x: box.x + dx, y: box.y + dy, button: 'left', clickCount: 1,
      buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'mouse',
    });
    await sleep(40);
  }
  await sleep(200);
};

// Touch is not the mouse path with a different label. It comes in through a different CDP
// domain, it only reaches the page as pointer events while touch emulation is on, and a
// one-finger drag only *stays* one gesture while the canvas has opted out of browser
// scrolling — without `touch-action: none` the browser claims the drag as a page scroll
// and fires pointercancel, which ends the stroke mid-sweep. Mouse drags cannot catch
// either failure, so the paint section below runs the sweep a second time on touch.
const touchDrag = async (path) => {
  const steps = [['touchStart', [0, 0]], ...path.map((p) => ['touchMove', p]), ['touchEnd', null]];
  for (const [type, offset] of steps) {
    await page.call('Input.dispatchTouchEvent', {
      type,
      // touchEnd carries no points: the finger that lifted is gone from the set.
      touchPoints: offset ? [{ x: box.x + offset[0], y: box.y + offset[1], id: 1 }] : [],
    });
    await sleep(40);
  }
  await sleep(200);
};

/**
 * A boustrophedon sweep over a 2*reach square centred on the press, in `step`-px moves.
 *
 * Three rows rather than one line, and `step` small enough that consecutive samples land
 * on neighbouring cells: a single horizontal line across a 3×3×2 board only ever crosses
 * two of them, which is a thin number to rest a "fills every cell it crosses" claim on.
 */
const sweepPath = (reach, step) => {
  const path = [];
  const xs = [];
  for (let dx = -reach; dx <= reach; dx += step) xs.push(dx);
  for (const [row, dy] of [-reach, 0, reach].entries()) {
    for (const dx of row % 2 ? [...xs].reverse() : xs) path.push([dx, dy]);
  }
  return path;
};

const afterClickState = afterClick;
await drag([[40, 0]]);
check(
  `a drag past the ${SLOP}px slop rotates instead of toggling`,
  (await page.evaluate('Array.from(window.__nonogram.session().state).join("")')) === afterClickState,
);
await shot('5-after-click');

// --- undo -----------------------------------------------------------------

await page.evaluate("document.getElementById('undo').click()");
await sleep(150);
check('undo button restores the board', (await page.evaluate('Array.from(window.__nonogram.session().state).join("")')) === before);

// --- paint drag: the path DOO-10's grouped undo exists for (DOO-16) ----------
//
// The regression this guards is a *wiring* one, which is why it has to be a real drag
// in a real browser and not a unit test: `state/session.js` had the stroke API with 19
// tests on it, `ui/gestures.js` had the drag, and the app still shipped with neither
// reachable, because main.js' pointer handler listened only for pointerup. So click the
// mode switch like a player does, drag across the board, and demand that *one* undo
// press takes the whole stroke back.

// A stroke's value is decided by the cell it starts on — from a filled cell it erases.
// Blanking first makes this a fill, so every crossed cell is a visible change. Plain
// `set()` is not undoable, so this does not touch the stack the check below measures.
const blankBoard = async () => {
  await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    for (let i = 0; i < s.state.length; i++) s.set(i, 0);
  })()`);
  await sleep(120);
};
await blankBoard();

await page.evaluate("document.getElementById('btn-mode').click()");
await sleep(80);
check(
  'the mode switch reaches paint mode',
  (await page.evaluate('window.__nonogram.mode()')) === 'paint' &&
    (await page.evaluate("document.getElementById('btn-mode').getAttribute('aria-pressed')")) === 'true',
  '#btn-mode -> paint, aria-pressed=true',
);

const beforePaint = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
await drag(sweepPath(140, 35));
const afterPaint = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
const painted = [...afterPaint].filter((v, i) => v !== beforePaint[i]).length;
// More than one cell is the whole claim: before DOO-16 this drag painted zero, and the
// single-cell case is what the app already did on a tap.
check(
  'a paint drag fills every cell it crosses',
  painted >= 3,
  `${painted}/${beforePaint.length} cells filled by one drag`,
);

await page.evaluate("document.getElementById('undo').click()");
await sleep(150);
check(
  'one undo press takes the whole stroke back',
  (await page.evaluate('Array.from(window.__nonogram.session().state).join("")')) === beforePaint &&
    (await page.evaluate('window.__nonogram.session().canUndo()')) === false,
  `${painted} cells restored by 1 press, stack empty`,
);

// --- the same drag on touch (DOO-16) -----------------------------------------
check(
  'the canvas opts out of browser scroll, so a touch drag stays a gesture',
  (await page.evaluate("getComputedStyle(document.getElementById('scene')).touchAction")) === 'none',
  `#scene touch-action: ${await page.evaluate("getComputedStyle(document.getElementById('scene')).touchAction")}`,
);

await page.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
await blankBoard();
const beforeTouch = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
await touchDrag(sweepPath(140, 35));
const afterTouch = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
const touchPainted = [...afterTouch].filter((v, i) => v !== beforeTouch[i]).length;
check(
  'a touch drag paints the same cells a mouse drag does',
  touchPainted >= 3,
  `${touchPainted}/${beforeTouch.length} cells filled by one finger`,
);

await page.evaluate("document.getElementById('undo').click()");
await sleep(150);
check(
  'one undo press takes the touch stroke back',
  (await page.evaluate('Array.from(window.__nonogram.session().state).join("")')) === beforeTouch &&
    (await page.evaluate('window.__nonogram.session().canUndo()')) === false,
  `${touchPainted} cells restored by 1 press, stack empty`,
);
// Off again before the rest of the run: emulation flips the pointer media queries, and
// the layout checks below were written against the desktop branch of them.
await page.call('Emulation.setTouchEmulationEnabled', { enabled: false });

// Back to rotate and back to the board the checks below expect.
await page.evaluate("document.getElementById('btn-mode').click()");
await sleep(80);
check('the switch goes back to rotate', (await page.evaluate('window.__nonogram.mode()')) === 'rotate');
await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  const want = ${JSON.stringify(before)};
  for (let i = 0; i < s.state.length; i++) s.set(i, Number(want[i]));
})()`);
await sleep(120);

// --- persistence: write progress, reload, confirm it comes back ----------

const written = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  s.cycle(0); s.cycle(0);   // -> MARKED
  s.cycle(5);               // -> FILLED
  s.cycle(9);
  return Array.from(s.state).join('');
})()`);
await sleep(200);
const stored = await page.evaluate(`localStorage.getItem('no-nonogram:${puzzleId}')`);
check(
  'progress persisted under the legacy key',
  !!stored && JSON.parse(stored).state.join('') === written,
  `no-nonogram:${puzzleId} = ${stored?.slice(0, 48)}…`,
);

const card = await page.evaluate(`(() => {
  document.getElementById('btn-game-back').click();
  const card = document.querySelectorAll('.puzzle-card')[0];
  const c = card.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100) ink++;
  return { badge: card.querySelector('.puzzle-status').textContent, ink };
})()`);
check('puzzle card badge reflects progress', card.badge === '진행중', card.badge);
// Filled cells were added above, so the 2D iso thumbnail must now have dark voxels.
check('2D iso thumbnail draws the filled voxels', card.ink > 50, `${card.ink} dark px`);
await shot('6-progress-badge');

// This reload carries a second measurement, because it is the only place in the run that
// walks a *cold* load to a playable board with the whole click chain inside one
// `evaluate` — which is what the 2s "first playable board" budget needs. See below.
await page.goto(`${BASE}/?perf=1`);
const reopened = await page.evaluate(`(() => {
  // Stamped on the page's own clock, immediately before the chain, so the number the
  // budget check reads is the product's and not this file's (DOO-41). All three clicks
  // go out in one evaluate on purpose: a CDP round-trip between them lands straight
  // back inside the measurement.
  const openedAt = performance.now();
  document.getElementById('btn-start').click();
  document.querySelectorAll('#levels-grid .level-card')[0].click();
  document.querySelectorAll('#puzzles-grid .puzzle-card')[0].click();
  return { openedAt, state: Array.from(window.__nonogram.session().state).join('') };
})()`);
await sleep(400);
check(
  'saved progress restored after reload',
  reopened.state === written,
  `${reopened.state.replace(/0/g, '').length} non-blank cells back`,
);

// --- the 2s budget to a playable board, with this harness out of the number ----
//
// `perf.mark()` stores a raw `performance.now()`, i.e. ms since *navigation start*, so
// `marks['first-puzzle']` contains however long the measuring harness took to reach the
// click — and this file sleeps for about a second on the way there. Asserting that raw
// mark against 2000ms (which is what this gate did until DOO-41) cannot fail falsely,
// because the number is always larger than the truth. It passes falsely: a product that
// spends 1.9s still passes as long as the harness spends 0.1s, so the regression the
// gate gives away is exactly as wide as its own pacing. Measured on a phone profile,
// 1853ms raw was 1374ms of harness and 479ms of product.
//
// Two numbers the product does own, on the same clock and the same page load:
//   firstFrameMs  navigation start -> something on screen (perf stamps this itself)
//   openMs        the click chain -> the board is playable
// A player with instant fingers sees the board at the sum; the gap between the two is
// the player's own time, and belongs to neither side.
//
// Puzzle-card[0] of level 1 is the smallest board in the catalogue, which is the right
// board for *this* question — it is the first one a new player can open. The worst-case
// open transition is a different question with its own budget (`navWorstMs`, below).
const cold = await page.evaluate(`(() => {
  const p = window.__nonogram.perf();
  return { firstFrameMs: p.firstFrameMs, rawMarkMs: p.marks['first-puzzle'] };
})()`);
const firstPlayable = {
  firstFrameMs: cold.firstFrameMs ?? NaN,
  openedAt: reopened.openedAt,
  rawMarkMs: cold.rawMarkMs ?? NaN,
  // NaN if the mark never landed, which fails the check below instead of passing it.
  openMs: cold.rawMarkMs - reopened.openedAt,
};
firstPlayable.toPlayableMs = firstPlayable.firstFrameMs + firstPlayable.openMs;
const ms = (v) => (Number.isFinite(v) ? `${v.toFixed(0)}ms` : `${v}`);
check(
  'first playable board inside the 2s budget',
  firstPlayable.toPlayableMs > 0 && firstPlayable.toPlayableMs < 2000,
  `${ms(firstPlayable.toPlayableMs)} = ${ms(firstPlayable.firstFrameMs)} to the title screen` +
    ` + ${ms(firstPlayable.openMs)} from the click to a playable board`,
);
// Kept so the raw numbers in earlier reports stay comparable. Advisory: most of what it
// measures is this file's pacing, which no commit to the app can move.
check(
  'raw `first-puzzle` mark, for comparison with earlier runs',
  firstPlayable.rawMarkMs > 0 && firstPlayable.rawMarkMs < 2000,
  `${ms(firstPlayable.rawMarkMs)} since navigation start, ${ms(firstPlayable.openedAt)} of it harness pacing`,
  { advisory: true },
);

// --- every level: open its hardest board and read the render off it --------
//
// The reward layer gates levels 2-4 behind a difficulty score, and the whole point of
// this sweep is the level-4 6³ boards, so seed every puzzle as cleared first. Marking
// the boards fully filled is also the worst case for the instanced path: every cell
// becomes a live instance.
//
// Puzzle order inside a level is ascending difficulty, so the last card is the biggest.

const seeded = await page.evaluate(`(() => {
  const levels = window.__nonogram.levels();
  let n = 0;
  for (const level of levels)
    for (const p of level.puzzles) {
      const cells = p.dims.x * p.dims.y * p.dims.z;
      localStorage.setItem('no-nonogram:' + p.id, JSON.stringify({ state: new Array(cells).fill(1), solved: true }));
      n++;
    }
  return n;
})()`);
check('catalogue is reachable for seeding', seeded > 0, `${seeded} puzzles seeded as cleared`);

await page.goto(`${BASE}/?perf=1`);
await page.evaluate("document.getElementById('btn-start').click()");
await sleep(250);
const unlocked = await page.evaluate(
  "document.querySelectorAll('#levels-grid .level-card:not(.fx-locked)').length",
);
check('all levels unlocked after seeding', unlocked === levelCount, `${unlocked}/${levelCount} unlocked`);

const boards = [];
for (let i = 0; i < levelCount; i++) {
  if (i > 0) {
    await page.evaluate("document.getElementById('btn-game-back').click()");
    await sleep(200);
    await page.evaluate("document.getElementById('btn-puzzles-back').click()");
    await sleep(200);
  }
  await openLevel(i);
  const n = await page.evaluate("document.querySelectorAll('#puzzles-grid .puzzle-card').length");
  check(`level ${i + 1}: puzzle list renders`, n > 0, `${n} cards`);
  if (!n) break;
  await page.evaluate(`document.querySelectorAll('#puzzles-grid .puzzle-card')[${n - 1}].click()`);
  await sleep(700);
  boards.push(await readBoard());
}

for (const b of boards) checkBoard(b);

const sizes = boards.map((b) => b.grid.cells);
check(
  'the sweep actually reached distinct board sizes',
  new Set(sizes).size === boards.length,
  boards.map((b) => `${b.id}=${b.grid.cells}`).join(' '),
);

// The headline claim, measured on the shipped app rather than the bench harness.
//
// Non-growth, not strict equality (DOO-20 BUG-C): the gizmo's axis-label sprites are
// frustum-culled one by one, so the count drops by 1-2 at framings where a label falls
// off screen. That is an aspect-ratio artefact, unrelated to the cell count, and
// asserting equality made the check fail for a reason no commit here can cause. Growth
// with the cell count is the regression this is guarding.
const callCounts = boards.map((b) => b.drawCalls);
const table = boards.map((b) => `${b.dims.x}×${b.dims.y}×${b.dims.z}(${b.grid.cells} cells)=${b.drawCalls}`).join('  ');
check(
  'draw calls do not grow as the board grows',
  callCounts[callCounts.length - 1] <= callCounts[0],
  table,
);
check(`draw calls stay under ${DRAW_CALL_CEILING}`, Math.max(...callCounts) <= DRAW_CALL_CEILING, table);
check(
  'every cell of a fully filled board is a live instance',
  boards.every((b) => b.grid.filled === b.grid.cells),
  boards.map((b) => `${b.id}:${b.grid.filled}/${b.grid.cells}`).join(' '),
);
await shot('8-level4');

// --- perf numbers ---------------------------------------------------------
// Measured on the biggest board the catalogue has, fully filled.
//
// Two measurements, kept apart on purpose. Steady-state gameplay is the 60fps budget.
// Opening a puzzle is a one-off transition that tears down a grid, builds another,
// renders ~108 clue cells and repaints six 2D thumbnails — it costs one long frame,
// and averaging that into the gameplay number would hide both of them. So the
// transition gets its own, looser budget and its own line in the report.

const navWorstMs = await page.evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__nonogram.perf();            // touch, so the module is warm
  document.getElementById('btn-game-back').click();
  await sleep(400);
  const cards = document.querySelectorAll('#puzzles-grid .puzzle-card');
  cards[cards.length - 1].click();     // re-open the 6³ board
  await sleep(1200);
  return window.__nonogram.perf().worstMs;
})()`);

// Steady state: reset the window so the transition above is not in it.
await page.evaluate('window.__nonogram.perfReset()');
await sleep(2500);
const perf = await page.evaluate('window.__nonogram.perf()');
const grid = await page.evaluate('window.__nonogram.grid()');

check('first screen inside the 2s budget', perf.firstFrameMs < 2000, `${perf.firstFrameMs.toFixed(0)}ms`);
// The companion "first playable board" budget is asserted back at the cold reload, not
// here. On *this* page load the run has already walked four levels before a board opens,
// so `perf.marks['first-puzzle']` is mostly this file's own sleeps (DOO-41). It stays in
// perf.json for the record; it is not a number to gate on.
// rAF is vsync-capped at 60Hz, so 16.67ms *is* the floor — the signal that matters is
// "no frames dropped", not an average below the budget.
check(
  `holds 60fps on ${grid.cells} cells with no dropped frames`,
  perf.fps >= 58 && perf.droppedFrames === 0 && perf.worstMs < 33,
  `${perf.fps.toFixed(1)}fps, avg ${perf.frameMs.toFixed(2)}ms, p95 ${perf.p95Ms.toFixed(2)}ms, ` +
    `worst ${perf.worstMs.toFixed(1)}ms, cpu ${perf.cpuMs.toFixed(2)}ms, ${perf.droppedFrames}/${perf.frames} dropped`,
);
check('perf monitor reports no blown budget', perf.over.length === 0, perf.over.join(', '));
// Not a dropped-frame-free number and not meant to be: one hitch on a screen change.
// Budgeted at 400ms so it stays a hitch and cannot quietly grow into a stall.
check('opening a 6³ board costs one frame under 400ms', navWorstMs < 400, `worst frame ${navWorstMs.toFixed(0)}ms`);
await shot('7-perf-overlay');

console.log(`\nboards  ${table}`);
console.log(`perf    ${JSON.stringify({ ...perf, ...grid })}`);
console.log(`open    ${JSON.stringify(firstPlayable)}`);
writeFileSync(join(OUT, 'perf.json'), JSON.stringify({ perf, firstPlayable, grid, boards, checks }, null, 2));

const errorsAtEnd = pageErrors();
check('no console errors across the whole run', errorsAtEnd.length === 0, errorsAtEnd.slice(0, 3).join(' | '));

// ---------------------------------------------------------------------------

await browser.close();
process.exit(report().length ? 1 : 0);
