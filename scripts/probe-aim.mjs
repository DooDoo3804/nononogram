// scripts/probe-aim.mjs — how big a target is each cell, with and without the depth
// cursor (DOO-17).
//
//   node scripts/probe-aim.mjs <baseUrl> <outJson> [--platform=desktop|mobile]
//                              [--puzzles=l4-cat,l3-rocket] [--step=12]
//                              [--orbit=az,el] [--zoom=ticks]
//
// ## What it measures
//
// For one camera — the shot the puzzle opens on, no orbit, no dolly, no pan — it rasters
// the board with synthetic taps and counts how many raster points land on each cell.
// `samples * step²` is that cell's clickable area in CSS px². It does this once per
// depth-cursor position, 0 to max, and keeps each cell's best:
//
//   depth 0            is the board exactly as it ships today. This is the baseline.
//   best over depths   is what a player with the cursor can aim at.
//
// Both halves come off the same raster code at the same camera, so the comparison has
// no second copy of the projection in it and no "but you swept different angles" in it
// either. The camera never moves: the claim being tested is that the cursor removes the
// need to move it, so moving it would be measuring something else.
//
// The cursor is driven with real CDP key events through the shipped `[`/`]` binding,
// never by calling into the grid, and the smallest-aperture cell of each run is then
// confirmed with a real click through Chrome's own hit-testing. A synthetic number that
// no real click can reproduce is not evidence.
//
// ## Thresholds
//
//   24x24 CSS px =  576 px²   a mouse pointer's practical floor
//   44x44        = 1936 px²   a finger's
//
// Same numbers tests/board-viewport.mjs and tests/playtest.mjs use, so the output is
// comparable with the table in DOO-17. Desktop is 1280x860 for the same reason.
//
// ## Why the raster step is 12
//
// Fine enough that a cell sitting exactly on the mouse floor still collects ~4 samples,
// so "is this cell above 576 px²" is answerable; coarse enough that a full sweep of a
// 6³ board at seven cursor depths is a couple of minutes rather than an hour. Every
// area it reports is therefore quantized to 144 px², and the run records `rasterStep`
// so a tighter re-run is comparable.

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname } from 'node:path';
import { launchChrome, checklist } from './cdp.mjs';

const MOUSE_PX2 = 24 * 24;   //  576
const FINGER_PX2 = 44 * 44;  // 1936

const PLATFORMS = {
  // The viewport DOO-17 measured on, so the numbers sit next to its table.
  desktop: {
    label: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1,
    mobile: false, touch: false, floor: MOUSE_PX2, floorName: '24×24 mouse',
  },
  // Pixel-class Android. No CPU throttle: this probe measures geometry, and a 4x
  // throttle would only make a 10,000-tap raster four times longer.
  mobile: {
    label: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625,
    mobile: true, touch: true, floor: FINGER_PX2, floorName: '44×44 finger',
  },
};

const [BASE = 'http://127.0.0.1:4473', OUT = 'verify-out/aim.json', ...flags] = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const platform = PLATFORMS[flag('platform', 'desktop')];
if (!platform) throw new Error(`unknown platform — want ${Object.keys(PLATFORMS).join(' | ')}`);
const step = Number(flag('step', 12));
const wanted = flag('puzzles', 'l4-cat,l3-rocket').split(',').filter(Boolean);
// `--orbit=az,el` as fractions of a full turn, applied once before the depth sweep.
// Default none: the headline claim is about the camera the puzzle opens on.
const orbit = flag('orbit', '') ? flag('orbit', '').split(',').map(Number) : null;
/** `--zoom=N` dolly notches applied once before the depth sweep. Default none. */
const zoomTicks = Number(flag('zoom', 0)) || 0;

// --- the in-page probe -------------------------------------------------------
// Everything it reads is already public: `window.__nonogram` and the DOM. Re-installed
// after every puzzle open, because it latches onto that session's `cell` event.

const PROBE = `(() => {
  const canvas = document.getElementById('scene');
  // OrbitControls calls setPointerCapture on pointerdown, which throws for a synthetic
  // pointer id the browser has no record of. No-ops for the duration of the run; the
  // real-click path below does not go through these.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  let hits = [];
  let off = null;
  const session = () => window.__nonogram.session();
  function listen() { off?.(); off = session().on('cell', ({ i }) => hits.push(i)); }

  function fire(type, px, py, extra = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: px, clientY: py, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window, ...extra,
    }));
  }

  /** One synthetic tap through the production listener. -> cell index | null */
  function tap(px, py) {
    hits = [];
    fire('pointerdown', px, py, { button: 0, buttons: 1 });
    fire('pointerup', px, py, { button: 0, buttons: 0 });
    return hits.length ? hits[0] : null;
  }

  return {
    install() { listen(); return true; },

    rect() {
      const r = canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },

    /** Coarse pass for the board's screen box — the fine raster is clipped to it. */
    bbox(coarse = 24) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let py = Math.round(r.top + coarse / 2); py < r.top + r.height; py += coarse)
        for (let px = Math.round(r.left + coarse / 2); px < r.left + r.width; px += coarse) {
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      if (!Number.isFinite(x0)) return { left: r.left, top: r.top, width: r.width, height: r.height };
      return {
        left: x0 - coarse, top: y0 - coarse,
        width: x1 - x0 + 2 * coarse, height: y1 - y0 + 2 * coarse,
      };
    },

    /**
     * Tap a grid of pixels and report which cell each one hit.
     *
     * Every tap is reverted immediately, so the board is unchanged at the end and can
     * never drift into the solved state mid-raster — which would lock input and
     * silently truncate the map into a result that looks like unreachable cells.
     *
     * The pixel kept per cell is the centroid of every point that reached it, re-tapped
     * to confirm it still lands there: the first hit is always on the top-left edge of
     * the footprint, one pixel from a neighbour, and replaying it later is a coin flip.
     * A centroid that misses (a concave footprint) falls back to the recorded hit
     * nearest to it.
     *
     * -> { map: { cell: { px, samples } }, taps, landed, refined }
     */
    raster(gap, box) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      const x0 = Math.max(r.left, box?.left ?? r.left);
      const y0 = Math.max(r.top, box?.top ?? r.top);
      const x1 = Math.min(r.left + r.width, (box?.left ?? r.left) + (box?.width ?? r.width));
      const y1 = Math.min(r.top + r.height, (box?.top ?? r.top) + (box?.height ?? r.height));

      const acc = new Map();
      let taps = 0, landed = 0;
      for (let py = Math.round(y0 + gap / 2); py < y1; py += gap)
        for (let px = Math.round(x0 + gap / 2); px < x1; px += gap) {
          taps++;
          const i = tap(px, py);
          if (i === null) continue;
          landed++;
          s.set(i, 0);
          let a = acc.get(i);
          if (!a) acc.set(i, (a = { n: 0, sx: 0, sy: 0, pts: [] }));
          a.n++; a.sx += px; a.sy += py; a.pts.push([px, py]);
        }

      const map = {};
      let refined = 0;
      for (const [i, a] of acc) {
        const c = [Math.round(a.sx / a.n), Math.round(a.sy / a.n)];
        let px = c;
        const landedOnIt = tap(c[0], c[1]) === i;
        s.set(i, 0);
        if (!landedOnIt) {
          refined++;
          let best = Infinity;
          for (const p of a.pts) {
            const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
            if (d < best) { best = d; px = p; }
          }
        }
        map[i] = { px, samples: a.n };
      }
      return { map, taps, landed, refined };
    },

    /**
     * Rotate through OrbitControls' own drag path. dx/dy in px.
     *
     * Only used by \`--orbit\`, which exists to answer one question: a cell on the
     * *front* face is clipped by its in-plane neighbours and no depth cursor can widen
     * it, because peeling is what removes it. Does a small rotation recover it? That is
     * a measurement, not an assertion, so the probe has to be able to make it.
     */
    orbit(dx, dy, steps = 8) {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      fire('pointerdown', cx, cy, { button: 0, buttons: 1 });
      for (let n = 1; n <= steps; n++)
        fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 1 });
      fire('pointerup', cx + dx, cy + dy, { button: 0, buttons: 0 });
      return true;
    },

    /**
     * Dolly in through OrbitControls' wheel path, \`ticks\` notches (0.95 each).
     *
     * Behind \`--zoom\`, and it answers the one question the depth cursor cannot: a cell's
     * aperture is capped by how big the board is drawn, and on a phone that cap is below
     * the finger floor however well the cursor aims. Wheel rather than pinch because the
     * transform is the same one and CDP can dispatch it; on touch the affordance is a
     * pinch, so a number from here is about the geometry, not about the gesture.
     */
    zoom(deltaY, ticks = 1) {
      const r = canvas.getBoundingClientRect();
      for (let n = 0; n < ticks; n++)
        canvas.dispatchEvent(new WheelEvent('wheel', {
          deltaY, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          bubbles: true, cancelable: true,
        }));
      return true;
    },

    /** Re-find the pixel that reaches \`cell\` right now, searching out from a hint. */
    findPixel(cell, hint, radius = 14, gap = 2) {
      listen();
      const s = session();
      const found = [];
      for (let dy = -radius; dy <= radius; dy += gap)
        for (let dx = -radius; dx <= radius; dx += gap) {
          const px = hint[0] + dx, py = hint[1] + dy;
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (i === cell) found.push([px, py]);
        }
      if (!found.length) return null;
      const cx = Math.round(found.reduce((a, p) => a + p[0], 0) / found.length);
      const cy = Math.round(found.reduce((a, p) => a + p[1], 0) / found.length);
      let px = [cx, cy];
      const ok = tap(cx, cy) === cell;
      s.set(cell, 0);
      if (!ok) {
        let best = Infinity;
        for (const p of found) {
          const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
          if (d < best) { best = d; px = p; }
        }
      }
      return { px, samples: found.length };
    },

    /** Cell indices the answer needs filled — the ones a player must be able to hit. */
    required() {
      return Array.from(session().solution).flatMap((v, i) => (v ? [i] : []));
    },

    board() { return Array.from(session().state); },
    clearBoard() {
      const s = session();
      for (let i = 0; i < s.state.length; i++) if (s.state[i] !== 0) s.set(i, 0);
      return true;
    },
    cursor() { return window.__nonogram.peel(); },
    elementAt(px, py) {
      const el = document.elementFromPoint(px, py);
      return el ? \`\${el.tagName}#\${el.id}\` : null;
    },
  };
})()`;

/** Seed every puzzle cleared so the reward layer's level gates are open. */
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

/**
 * Walk the real menu to a puzzle, dropping its own save first.
 *
 * Seeding every puzzle cleared opens the level gates, but `createSession` reads the same
 * `solved` flag and locks input on a cleared board — so the one under test has to have
 * its key removed right before opening, or it opens unplayable.
 */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }) {
  await page.evaluate(`(() => {
    localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});
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
  // Let OrbitControls' damping settle so the camera is where frameCamera put it.
  await sleep(350);
  await page.evaluate(`window.__aim = ${PROBE}; window.__aim.install()`);
}

/** A real key press through Chrome, so the shipped `[`/`]` binding is what moves the cursor. */
async function realKey(page, key) {
  const code = key === ']' ? 'BracketRight' : key === '[' ? 'BracketLeft' : 'Backslash';
  const vk = key === ']' ? 221 : key === '[' ? 219 : 220;
  for (const type of ['keyDown', 'keyUp']) {
    await page.call('Input.dispatchKeyEvent', {
      type, key, code, text: type === 'keyDown' ? key : undefined,
      windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
  await sleep(60);
}

/** A real click or tap at a client pixel, through Chrome's own hit-testing. */
async function realTap(page, px, py) {
  if (platform.touch) {
    const points = [{ x: px, y: py, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
    await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.call('Input.dispatchMouseEvent', {
      type, x: px, y: py, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse',
    });
  }
}

const quantiles = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;

/**
 * min / median / how many fall under each floor, over one set of cells.
 *
 * A cell no raster point reached counts as 0 px², so it is inside both `under*` counts
 * as well as being listed in `unreached`. An unreachable cell is the limit case of an
 * un-aimable one, and splitting them would let a run report "0 cells under the floor"
 * while some cells had no target at all. `min` and `median` are over reached cells only,
 * because a median dragged to 0 by unreachable cells says nothing about the rest.
 */
function summarize(areaOf, cells) {
  const areas = cells.map((c) => areaOf.get(c) ?? 0);
  const reached = areas.filter((a) => a > 0);
  const sorted = [...reached].sort((a, b) => a - b);
  return {
    cells: cells.length,
    reached: reached.length,
    unreached: cells.filter((c) => !(areaOf.get(c) > 0)),
    min: sorted[0] ?? 0,
    p10: quantiles(sorted, 0.1),
    median: quantiles(sorted, 0.5),
    underMouse24: areas.filter((a) => a < MOUSE_PX2).length,
    underFinger44: areas.filter((a) => a < FINGER_PX2).length,
  };
}

const pct = (n, of) => (of ? `${((100 * n) / of).toFixed(0)}%` : '—');

// --- run ---------------------------------------------------------------------

const { check, report } = checklist();
const browser = await launchChrome({ offline: true });
const page = await browser.newPage();
await page.emulate(platform);
await page.goto(BASE);

check('the app booted', await page.evaluate('!!window.__nonogram'), BASE);
check(
  'the depth cursor is wired into the page',
  !!(await page.evaluate('typeof window.__nonogram.peel === "function"')),
  '__nonogram.peel()',
);

const seeded = await page.evaluate(SEED_ALL_CLEARED);
const catalogue = await page.evaluate(CATALOGUE);
console.log(`\n${platform.label} ${platform.width}×${platform.height}@${platform.deviceScaleFactor}` +
  `  raster step ${step}px  floor ${platform.floor}px² (${platform.floorName})` +
  `  gl=${await page.glRenderer()}  ${seeded} puzzles seeded\n`);

const results = {};

for (const id of wanted) {
  const entry = catalogue.find((c) => c.id === id);
  if (!entry) {
    console.log(`  (no puzzle ${id} in the catalogue — skipped)`);
    continue;
  }
  const total = entry.dims.x * entry.dims.y * entry.dims.z;
  const startedAt = Date.now();
  await openPuzzle(page, entry);

  if (zoomTicks) {
    await page.evaluate(`window.__aim.zoom(-120, ${zoomTicks})`);
    await sleep(500);
  }
  if (orbit) {
    // OrbitControls maps a drag of clientHeight px to a full 2*pi of azimuth, so the
    // fractions above convert straight into pixels.
    const rect = await page.evaluate('JSON.stringify(window.__aim.rect())').then(JSON.parse);
    await page.evaluate(`window.__aim.orbit(${orbit[0] * rect.height}, ${(orbit[1] ?? 0) * rect.height}, 8)`);
    await sleep(500); // damping settles in frames, and frames are time here
  }

  const required = await page.evaluate('JSON.stringify(window.__aim.required())').then(JSON.parse);
  const cursor0 = await page.evaluate('JSON.stringify(window.__aim.cursor())').then(JSON.parse);
  const maxDepth = cursor0.max;

  // cell -> best { area, depth, px } over every cursor depth, and the depth-0 areas on
  // their own, which are the board as it ships.
  const best = new Map();
  const baseArea = new Map();
  const perDepth = [];

  for (let depth = 0; depth <= maxDepth; depth++) {
    if (depth > 0) await realKey(page, ']');
    const live = await page.evaluate('JSON.stringify(window.__aim.cursor())').then(JSON.parse);
    if (live.depth !== depth) {
      check(`${id}: the ] key moved the cursor to depth ${depth}`, false, `cursor reports ${live.depth}`);
      break;
    }
    const box = await page.evaluate('JSON.stringify(window.__aim.bbox(24))').then(JSON.parse);
    const { map, taps, landed } = await page
      .evaluate(`JSON.stringify(window.__aim.raster(${step}, ${JSON.stringify(box)}))`)
      .then(JSON.parse);

    let fresh = 0;
    for (const [cellStr, hit] of Object.entries(map)) {
      const cell = Number(cellStr);
      const area = hit.samples * step * step;
      if (depth === 0) baseArea.set(cell, area);
      const prev = best.get(cell);
      if (!prev) fresh++;
      if (!prev || area > prev.area) best.set(cell, { area, depth, px: hit.px });
    }
    perDepth.push({
      depth, axis: live.axis, sign: live.sign, window: live.window,
      taps, landed, cells: Object.keys(map).length, fresh, reachedSoFar: best.size,
    });
    console.log(
      `  ${id} depth ${depth} (${live.axis}${live.sign < 0 ? '-' : '+'})` +
        `  reached ${String(Object.keys(map).length).padStart(3)}  +${String(fresh).padStart(3)} new` +
        `  ${String(best.size).padStart(3)}/${total} cumulative`,
    );
  }

  // Back to the whole board, through the shipped binding.
  await realKey(page, '\\');
  const afterReset = await page.evaluate('JSON.stringify(window.__aim.cursor())').then(JSON.parse);
  check(`${id}: the reset key puts the whole board back`,
    afterReset.depth === 0 && afterReset.window === null, JSON.stringify(afterReset));

  const bestArea = new Map([...best].map(([cell, b]) => [cell, b.area]));
  const all = Array.from({ length: total }, (_, i) => i);
  const summary = {
    baseline: { all: summarize(baseArea, all), required: summarize(baseArea, required) },
    cursor: { all: summarize(bestArea, all), required: summarize(bestArea, required) },
  };

  // Real-click confirmation on the tightest required cell the cursor found: the one a
  // real click is most likely to miss. Driven to the depth that produced it, with the
  // shipped key, then clicked through Chrome's hit-testing.
  const tightest = required
    .filter((c) => best.has(c))
    .sort((a, b) => best.get(a).area - best.get(b).area)[0];
  let confirmation = null;
  if (tightest !== undefined) {
    const want = best.get(tightest);
    await page.evaluate('window.__aim.clearBoard()');
    for (let n = 0; n < want.depth; n++) await realKey(page, ']');
    const found = await page
      .evaluate(`JSON.stringify(window.__aim.findPixel(${tightest}, ${JSON.stringify(want.px)}, 14, 2))`)
      .then(JSON.parse);
    if (found) {
      await realTap(page, found.px[0], found.px[1]);
      await sleep(140);
      const changed = await page
        .evaluate('JSON.stringify(window.__aim.board().map((v, i) => [i, v]).filter(([, v]) => v !== 0))')
        .then(JSON.parse);
      const routed = await page.evaluate(`window.__aim.elementAt(${found.px[0]}, ${found.px[1]})`);
      confirmation = {
        cell: tightest, depth: want.depth, area: want.area, px: found.px, routed, changed,
        ok: changed.length === 1 && changed[0][0] === tightest && changed[0][1] === 1,
      };
    } else {
      confirmation = { cell: tightest, depth: want.depth, area: want.area, ok: false, reason: 'no pixel' };
    }
    await page.evaluate('window.__aim.clearBoard()');
    await realKey(page, '\\');
    check(
      `${id}: a real ${platform.touch ? 'tap' : 'click'} lands on the tightest required cell ` +
        `(cell ${tightest}, ${confirmation.area}px² at depth ${confirmation.depth})`,
      confirmation.ok,
      `routed to ${confirmation.routed}, changed ${JSON.stringify(confirmation.changed)}`,
    );
  }

  results[id] = {
    id, dims: entry.dims, total, requiredCells: required.length, maxDepth,
    rasterStep: step, platform: platform.label,
    viewport: [platform.width, platform.height, platform.deviceScaleFactor],
    summary, perDepth, confirmation, orbit, zoomTicks,
    bestByCell: Object.fromEntries([...best].map(([c, b]) => [c, [b.area, b.depth]])),
    elapsedMs: Date.now() - startedAt,
  };

  const row = (label, s) =>
    `    ${label.padEnd(10)} reached ${String(s.reached).padStart(3)}/${String(s.cells).padStart(3)}` +
    `  min ${String(s.min).padStart(6)}  p10 ${String(s.p10).padStart(6)}  med ${String(s.median).padStart(6)}` +
    `  <24px ${String(s.underMouse24).padStart(3)} (${pct(s.underMouse24, s.cells).padStart(4)})` +
    `  <44px ${String(s.underFinger44).padStart(3)} (${pct(s.underFinger44, s.cells).padStart(4)})`;

  console.log(`\n  ${id} ${entry.dims.x}×${entry.dims.y}×${entry.dims.z}` +
    ` — ${required.length} of ${total} cells the answer needs,` +
    ` ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  console.log('    — every cell —');
  console.log(row('shipped', summary.baseline.all));
  console.log(row('cursor', summary.cursor.all));
  console.log('    — cells the answer needs —');
  console.log(row('shipped', summary.baseline.required));
  console.log(row('cursor', summary.cursor.required));
  console.log('');

  const req = summary.cursor.required;
  check(`${id}: every cell the answer needs is reachable without moving the camera`,
    req.reached === req.cells, `${req.reached}/${req.cells}, missing ${JSON.stringify(req.unreached)}`);
  check(`${id}: every cell the answer needs clears the 24×24 mouse floor`,
    req.min >= MOUSE_PX2, `smallest is ${req.min}px², floor ${MOUSE_PX2}px²`);
  // Advisory, and not because the number is unreliable: it is the one part of the
  // aperture problem the depth cursor cannot reach. A cell's area is capped by how
  // large the board is drawn, and on a 402×579 phone canvas a 6³ cell is ~30 CSS px
  // whatever the cursor does — so the finger floor is a framing/zoom question (and the
  // `--zoom` flag prices it), not a picking one. Gating on it here would red-light the
  // cursor for a budget it does not control, and a gate that red-lights what no commit
  // in this file can fix gets ignored.
  check(`${id}: every cell the answer needs clears the 44×44 finger floor`,
    req.min >= FINGER_PX2,
    `smallest is ${req.min}px², floor ${FINGER_PX2}px² — capped by board size on screen, not by aiming`,
    { advisory: true });
  check(`${id}: the whole box is reachable without moving the camera`,
    summary.cursor.all.reached === total,
    `${summary.cursor.all.reached}/${total}, missing ${JSON.stringify(summary.cursor.all.unreached)}`);
}

const errors = page.errors().filter((e) => !/favicon/.test(e));
check('no console errors during the run', errors.length === 0, errors.join(' | ') || 'none');

const glRenderer = await page.glRenderer();
const failed = report();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  base: BASE, platform: platform.label, rasterStep: step,
  floors: { mouse: MOUSE_PX2, finger: FINGER_PX2 },
  glRenderer, results, failed: failed.map((c) => c.name),
}, null, 2));
console.log(`wrote ${OUT}`);

await browser.close();
process.exit(failed.length ? 1 : 0);
