// tests/probe-l3bird-unfixed.mjs — why did 12 real taps fail to clear two cells?
// (DOO-8, defect L)
//
// The 2026-10-07 mobile `play` run reported, on `l3-bird` and nowhere else:
//
//   FAIL  mobile l3-bird: the correction pass left no reachable cell wrong
//         — 2 unfixed after 12 corrective taps:
//           [{"cell":119,"state":1,"want":0},{"cell":124,"state":1,"want":0}]
//
// That run used the harness *with* defects D and E already fixed, so unlike the
// pre-04:18 desktop log this is not a known-harness-bug artifact. It is the only
// failure on the fixed harness, which is why it gets its own probe.
//
// ## What the numbers already tell us, before this probe runs
//
// `playtest.mjs` corrects a cell with `taps = ((want - v) % 3 + 3) % 3` — the distance
// around BLANK -> FILLED -> MARKED -> BLANK. For v=1 (FILLED), want=0 that is 2 taps,
// and the loop runs at most 3 rounds. 2 cells x 2 taps x 3 rounds = 12, which is
// exactly the `corrections` the log printed. So the correction loop ran to its cap and
// every tap it meant to dispatch was dispatched. The cells simply never moved.
//
// They also never moved *anything else*: `wrong` stayed at 2. In a 3-state ring no cell
// returns to its own value after 2 taps, so had the ray landed on some neighbour instead,
// that neighbour would have shifted by +2 (mod 3) and shown up as a new wrong cell. None
// did. Therefore all 12 taps were no-ops — `pick()` returned null, or input was locked.
//
// ## What is already ruled out, by reading the source rather than guessing
//
//   * peel depth carried over from an earlier, deeper step. `render/peel.js:79-86`
//     rebinds on a new grid and zeroes `depth` with it, and `openPuzzle` walks the menu
//     so every re-open builds a new grid. Both cells are on layer z=4, which the cursor
//     (axis z, sign +1) takes off first, so an inherited depth *would* have hidden them —
//     it just cannot be inherited.
//   * a cell the map could not reach. Both are in `pixelByCell` with large apertures
//     (1146 and 629 raster samples), so they are not `stranded`, and `offCanvas` passed.
//
// ## What this probe discriminates, and why each is live
//
//   A. input locked. `state/session.js:96-119` makes `set`/`cycle` return null once
//      `solved` is true, and `createSession` restores that flag from localStorage. The
//      correction pass re-opens with `{ fresh: false }`, which is the one path that does
//      *not* drop the puzzle's key (`playtest.mjs:815-817`) — it inherits whatever is
//      stored. SEED_ALL_CLEARED writes `solved: true` for every puzzle.
//   B. overlay occlusion. `offCanvas` only asks whether the pixel is inside the canvas
//      rect; it never asks what the topmost element at that pixel *is*. Both recorded
//      pixels sit at x=206/207, the horizontal centre of the 412px viewport, at y=718
//      and y=510 — and `#peel`, `#btn-undo` and the fx band all live in those bands.
//      A pixel under a DOM control passes `offCanvas` and is still untappable.
//   C. the camera not reproducing. The correction pass calls `applyActs(..., { probe:
//      false })` and throws the result away, so nothing checks that `zoom 26t` landed
//      where the map recorded it. The passing "every camera move the map recorded was
//      reproduced" check covers the main pass only. A zoom clamped short leaves the
//      recorded pixel over background, where a tap hits nothing and breaks nothing.
//
// Setup here writes the board through `session.set` rather than playing it, and says so
// in the output: the claim under test is about the *correction* path — whether a real
// tap at the recorded pixel can clear an already-wrong cell — not about solving l3-bird.
// Extras are written before the solution cells so `filledOnly()` never matches and
// `solved` cannot latch during setup.
//
// Usage
//   npx vite preview --port 4294 --strictPort --host 127.0.0.1
//   node tests/probe-l3bird-unfixed.mjs http://127.0.0.1:4294 qa-out/doo8/out/l3bird.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const [
  BASE = 'http://127.0.0.1:4294',
  OUT = 'qa-out/doo8/out/l3bird.json',
  ...flags
] = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PUZZLE = flag('puzzle', 'l3-bird');
const REACH = flag('reach', 'qa-out/doo8/out/reach-mobile.json');
/** The two cells the run left unfixed. Overridable so the probe outlives this instance. */
const TARGETS = flag('cells', '119,124').split(',').map(Number);

// The platform record the failing run used, copied from playtest.mjs:121.
const MOBILE = {
  label: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625,
  mobile: true, cpuThrottle: 4, touch: true,
};

const { check, report } = checklist();

/** Seed every puzzle cleared so the level gates open — playtest.mjs:788. */
const SEED_ALL_CLEARED = `(() => {
  let n = 0;
  for (const level of window.__nonogram.levels())
    for (const p of level.puzzles) {
      const cells = p.dims.x * p.dims.y * p.dims.z;
      localStorage.setItem('no-nonogram:' + p.id,
        JSON.stringify({ state: new Array(cells).fill(0), solved: true }));
      n++;
    }
  return n;
})()`;

const CATALOGUE = `(() => {
  const out = [];
  window.__nonogram.levels().forEach((level, li) =>
    level.puzzles.forEach((p, pi) =>
      out.push({ levelIndex: li, puzzleIndex: pi, id: p.id, dims: p.dims })));
  return out;
})()`;

const frames = (page, n) => page.evaluate(`new Promise((res) => {
  let left = ${Math.max(1, n)};
  const tick = () => (--left <= 0 ? res(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
})`);

/**
 * Walk the real menu to the puzzle. `fresh` mirrors `playtest.mjs:815` exactly: only a
 * fresh open drops the puzzle's own save, which is the whole of candidate A.
 */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }, { fresh = true } = {}) {
  await page.evaluate(`(() => {
    ${fresh ? `localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});` : ''}
    const click = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    click('#levels-grid .level-card', ${levelIndex});
    click('#puzzles-grid .puzzle-card', ${puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 15_000 },
  );
  await frames(page, 48);
}

/** A real OS-level tap, through Chrome's own hit-testing — playtest.mjs:853. */
async function realTap(page, px, py) {
  const points = [{ x: px, y: py, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frames(page, 6);
}

/** The reach map's zoom act, as `__qa.zoom` performs it — playtest.mjs:271. */
const zoomBy = (page, ticks) => page.evaluate(`(() => {
  const c = document.getElementById('scene');
  const r = c.getBoundingClientRect();
  for (let n = 0; n < ${ticks}; n++)
    c.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      bubbles: true, cancelable: true,
    }));
  return true;
})()`);

/** Everything that could make a tap a no-op, read at one instant. */
const snapshot = (page, id, px, py) => page.evaluate(`(() => {
  const s = window.__nonogram.session();
  const el = document.elementFromPoint(${px}, ${py});
  const raw = localStorage.getItem('no-nonogram:' + ${JSON.stringify(id)});
  const canvas = document.getElementById('scene');
  const cr = canvas.getBoundingClientRect();
  return JSON.stringify({
    sessionSolved: !!(s && s.solved),
    storedSolved: raw ? !!JSON.parse(raw).solved : null,
    peel: window.__nonogram.peel(),
    grid: window.__nonogram.grid(),
    canvasRect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
    // The question offCanvas never asks: what is actually on top at this pixel?
    topAt: el ? { tag: el.tagName, id: el.id || null, cls: el.className || null } : null,
    overCanvas: el === canvas,
    state: s ? Array.from(s.state) : null,
  });
})()`).then(JSON.parse);

mkdirSync(dirname(OUT), { recursive: true });

const reach = JSON.parse(readFileSync(REACH, 'utf8'));

const browser = await launchChrome({ offline: true, windowSize: `${MOBILE.width},${MOBILE.height}` });
const page = await browser.newPage();
await page.emulate(MOBILE);

console.log(`\n=== probe l3bird-unfixed · ${MOBILE.label} ${MOBILE.width}x${MOBILE.height}`
  + `@${MOBILE.deviceScaleFactor} cpu/${MOBILE.cpuThrottle} ===\n`);

const findings = [];
try {
  await page.goto(`${BASE}/?perf=1`);
  await page.evaluate('localStorage.clear()');
  await page.goto(`${BASE}/?perf=1`);
  await page.evaluate(SEED_ALL_CLEARED);
  await page.goto(`${BASE}/?perf=1`);

  const catalogue = await page.evaluate(CATALOGUE);
  const entry = catalogue.find((e) => e.id === PUZZLE);
  if (!entry) throw new Error(`no puzzle ${PUZZLE} in the catalogue`);
  const dimsKey = `${entry.dims.x}x${entry.dims.y}x${entry.dims.z}`;
  const map = reach[dimsKey];
  if (!map) throw new Error(`no reach map for ${dimsKey} in ${REACH}`);

  // The map the play harness aims with: camera-only records, plus the cursor records for
  // the cells the camera alone cannot reach (this is what defect D's fix merged in).
  const pixelByCell = { ...(map.cursor?.pixelByCell ?? {}), ...map.pixelByCell };

  await openPuzzle(page, entry, { fresh: true });

  // Rebuild the exact board the correction pass faced: the solution, plus the two extra
  // FILLED cells. Extras first so `solved` cannot latch part-way through.
  const setup = await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    const extras = ${JSON.stringify(TARGETS)};
    for (const i of extras) s.set(i, 1);
    let filled = 0;
    s.solution.forEach((v, i) => { if (v === 1 && !extras.includes(i)) { s.set(i, 1); filled++; } });
    return JSON.stringify({ filled, extras, solved: s.solved, total: s.state.length });
  })()`).then(JSON.parse);

  check(`${PUZZLE}: setup put the board one step from solved, not solved`,
    setup.solved === false,
    `${setup.filled} solution cells + ${setup.extras.length} extra FILLED, solved=${setup.solved}`);

  for (const cell of TARGETS) {
    const rec = pixelByCell[String(cell)];
    if (!rec) {
      check(`${PUZZLE} cell ${cell}: the map has a pixel for it`, false, 'absent from pixelByCell');
      continue;
    }
    const [px, py] = rec.px;

    // Mirror the correction pass: re-open non-fresh, then replay the record's acts.
    await openPuzzle(page, entry, { fresh: false });
    const onOpen = await snapshot(page, entry.id, px, py);

    for (const act of rec.acts) {
      if (act.kind === 'zoom' && act.ticks > 0) await zoomBy(page, act.ticks);
      if (act.kind === 'peel') {
        // The record asks for a depth; drive the real stepper, as the harness does.
        for (let n = 0; n < act.depth; n++) {
          await page.evaluate("document.getElementById('peel-more').click()");
          await frames(page, 4);
        }
      }
      // orbit dx=0,dy=0 is a deliberate no-op in the plan (playtest.mjs:1081).
    }
    await frames(page, 24);

    const before = await snapshot(page, entry.id, px, py);
    const taps = [];
    // The same count the correction pass used: FILLED -> MARKED -> BLANK.
    for (let n = 0; n < 2; n++) {
      const pre = (await snapshot(page, entry.id, px, py)).state;
      await realTap(page, px, py);
      const post = await snapshot(page, entry.id, px, py);
      const moved = [];
      pre.forEach((v, i) => { if (v !== post.state[i]) moved.push({ cell: i, from: v, to: post.state[i] }); });
      taps.push({ n: n + 1, movedCells: moved, targetState: post.state[cell] });
    }

    const after = await snapshot(page, entry.id, px, py);
    const finding = {
      cell, px: [px, py], rec: { step: rec.step, cost: rec.cost, peel: rec.peel ?? 0, samples: rec.samples },
      storedSolvedOnOpen: onOpen.storedSolved,
      sessionSolvedOnOpen: onOpen.sessionSolved,
      peelAfterActs: after.peel,
      gridWindow: after.grid?.window ?? null,
      pickable: after.grid?.pickable ?? null,
      topAt: after.topAt,
      overCanvas: after.overCanvas,
      canvasRect: after.canvasRect,
      stateBefore: before.state[cell],
      stateAfter: after.state[cell],
      taps,
      cleared: after.state[cell] === 0,
    };
    findings.push(finding);

    // Candidate A — was input locked the moment the pass re-opened the puzzle?
    check(`${PUZZLE} cell ${cell}: a non-fresh re-open did not inherit a cleared save`,
      onOpen.storedSolved !== true && onOpen.sessionSolved === false,
      `stored solved=${onOpen.storedSolved}, session solved=${onOpen.sessionSolved}`);

    // Candidate B — is the recorded pixel actually the canvas's to receive?
    check(`${PUZZLE} cell ${cell}: the recorded pixel's topmost element is the canvas`,
      after.overCanvas === true,
      `elementFromPoint(${px},${py}) = ${after.topAt
        ? `<${after.topAt.tag.toLowerCase()}${after.topAt.id ? ' id=' + after.topAt.id : ''}>`
        : 'null'}`);

    // Candidate C — did the cell's own layer survive the acts?
    check(`${PUZZLE} cell ${cell}: the acts left its layer on the board`,
      (after.peel?.depth ?? 0) === (rec.peel ?? 0),
      `peel depth ${after.peel?.depth ?? 0}, record wanted ${rec.peel ?? 0}, window `
        + `${JSON.stringify(after.grid?.window ?? null)}`);

    // The claim itself.
    check(`${PUZZLE} cell ${cell}: 2 real taps at the recorded pixel cleared it`,
      finding.cleared,
      `state ${finding.stateBefore} -> ${finding.stateAfter}; taps moved `
        + `${JSON.stringify(taps.map((t) => t.movedCells))}`);
  }

  writeFileSync(OUT, `${JSON.stringify({
    probe: 'l3bird-unfixed', puzzle: PUZZLE, platform: MOBILE,
    base: BASE, reach: REACH, setup, findings,
  }, null, 2)}\n`);
  console.log(`\nwrote ${OUT}`);
} finally {
  await browser.close();
}

process.exit(report().length ? 1 : 0);
