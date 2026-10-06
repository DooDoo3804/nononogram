// tests/playtest.mjs — the QA playtest harness for DOO-8.
//
// OWNER: QA track. Touches no production code: everything it needs it gets from the
// shipped `window.__nonogram` handle, from the DOM, and from dispatched input events.
//
//   node tests/playtest.mjs reach <baseUrl> <outDir> [--dims=6x6x6,…] [--step=6]
//   node tests/playtest.mjs play  <baseUrl> <outDir> [--platform=desktop|mobile]
//   node tests/playtest.mjs edge  <baseUrl> <outDir>
//
// ## Why this exists on top of scripts/verify-browser.mjs
//
// The platform gate proves the render contract: a click raycasts, the dims label is
// right, draw calls stay flat. It proves nothing about whether a *person* can finish a
// puzzle. The gap this harness was written to measure:
//
//   render/voxels.js raycasts against a `hit` InstancedMesh that covers **every** cell,
//   visible or not, and `pick()` takes `intersectObject(...)[0]` — the nearest hit. So
//   the cell a click lands on is always the frontmost cell of the box along that ray,
//   whatever its state. Marking a cell does not remove its hit box.
//
//   21 of the 24 shapes have filled cells that are strictly inside the box (l4-cat has
//   56 of them). If the frontmost-hit rule means those cells cannot be clicked, those
//   puzzles cannot be finished — and no solver check would ever see it, because the
//   solver works on the grid, not on the camera.
//
// So `reach` answers one question per box size: **which cells can a pointer actually
// address, and at what interaction cost?** It answers it by tapping, not by re-deriving
// the projection — every sample goes through the production
// `pointerup -> view.rayFrom -> grid.pick -> session.cycle` path and the answer is read
// off the `cell` event the session emits. There is no second copy of the math here to
// drift out of agreement with the renderer.
//
// ## What is synthetic and what is real
//
// Two different claims need two different kinds of event, so the harness uses both and
// never conflates them:
//
//   synthetic `canvas.dispatchEvent(new PointerEvent(...))` — thousands of samples, used
//     to map pixel -> cell. Exercises the real listener, the real raycast, the real
//     session. Does NOT exercise the browser's own hit-testing, so it cannot see an
//     overlay stealing the tap.
//   real `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent` via CDP — slower, used
//     for the playthroughs and for a routing spot-check at every orientation. These go
//     through Chrome's hit-testing, so an element covering the canvas shows up here.
//
// A cell is only ever reported reachable if a real event has landed on it.
//
// One production-adjacent stub, disclosed because it is a stub: OrbitControls calls
// `setPointerCapture(event.pointerId)` on pointerdown, which throws for a synthetic
// pointer id that the browser has no record of. `install()` replaces the three capture
// methods on the canvas element with no-ops for the duration of a run. It changes no
// repo file and does not affect the real-event paths.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

// --- platforms ---------------------------------------------------------------
// The mobile profile is a mid-range Android: Pixel-class viewport, 2.625 DPR, touch
// on, and the 4x CPU throttle DOO-7 used as its stand-in for a slower phone.

export const PLATFORMS = {
  desktop: { label: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, touch: false },
  mobile: { label: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4, touch: true },
};

// Known noise owned by other tracks, same list scripts/verify-browser.mjs filters.
const IGNORED_NOISE = /fonts\.(googleapis|gstatic)\.com|favicon\.ico/;

const parseDims = (s) => {
  const [x, y, z] = s.split('x').map(Number);
  return { x, y, z };
};
const dimsKey = (d) => `${d.x}x${d.y}x${d.z}`;

// --- the in-page probe -------------------------------------------------------
// Injected as one expression so it can be re-installed after every navigation.
// Everything it reads is already public: `window.__nonogram` and the DOM.

const PROBE = `(() => {
  const canvas = document.getElementById('scene');
  // See the header note: synthetic pointer ids have no browser-side pointer to capture.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  let hits = [];
  let offCell = null;

  const session = () => window.__nonogram.session();

  function listen() {
    offCell?.();
    offCell = session().on('cell', ({ i }) => hits.push(i));
  }

  function fire(type, px, py, extra = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: px, clientY: py, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window, ...extra,
    }));
  }

  /** One synthetic tap. -> the cell index it landed on, or null. */
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

    /**
     * Tap a grid of pixels across the canvas and report which cell each one hit.
     *
     * Every tap is reverted to BLANK immediately, so the board is unchanged at the end
     * and can never drift into the solved state mid-sweep (which would lock input and
     * silently truncate the map).
     *
     * ## Why the pixel per cell is the centroid and not the first hit
     *
     * The scan runs top-left to bottom-right, so the first pixel that reaches a cell is
     * always on the top-left edge of its on-screen footprint — one pixel from its
     * neighbour or from empty space. Replaying that pixel later is a coin flip: a
     * sub-pixel difference in where OrbitControls' damping settled the camera moves the
     * silhouette and the tap lands elsewhere. So each cell keeps the centroid of every
     * pixel that reached it, which is well inside a cell's (convex) footprint, and the
     * centroid is re-tapped here to confirm it still picks the same cell before it is
     * reported. A cell whose centroid does not confirm falls back to the recorded hit
     * closest to it.
     *
     * ## Why the hit count travels with the pixel
     *
     * "Reachable" turned out to be the wrong question on its own. Some interior cells
     * are reachable only through a gap between two nearer cells, and that gap is a
     * couple of pixels wide — a target no person can hit on purpose, and one a 1px
     * camera difference moves off. "samples" is how many raster points landed on the
     * cell, so samples * step * step is roughly the cell's clickable area in CSS px2,
     * which is the number the release verdict actually needs.
     *
     * -> { map: { cellIndex: { px, samples } }, taps, landed, refined }
     */
    raster(step, box) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      const x0 = Math.max(r.left, box?.left ?? r.left);
      const y0 = Math.max(r.top, box?.top ?? r.top);
      const x1 = Math.min(r.left + r.width, (box?.left ?? r.left) + (box?.width ?? r.width));
      const y1 = Math.min(r.top + r.height, (box?.top ?? r.top) + (box?.height ?? r.height));

      const acc = new Map(); // cell -> { n, sx, sy, pts: [[px, py], …] }
      let taps = 0;
      let landed = 0;
      for (let py = Math.round(y0 + step / 2); py < y1; py += step) {
        for (let px = Math.round(x0 + step / 2); px < x1; px += step) {
          taps++;
          const i = tap(px, py);
          if (i === null) continue;
          landed++;
          s.set(i, 0);
          let a = acc.get(i);
          if (!a) acc.set(i, (a = { n: 0, sx: 0, sy: 0, pts: [] }));
          a.n++; a.sx += px; a.sy += py; a.pts.push([px, py]);
        }
      }

      const map = {};
      let refined = 0;
      for (const [i, a] of acc) {
        const c = [Math.round(a.sx / a.n), Math.round(a.sy / a.n)];
        let px = c;
        if (tap(c[0], c[1]) === i) {
          s.set(i, 0);
        } else {
          s.set(i, 0);
          // Centroid missed — the footprint is concave, or it straddles a gap. Take the
          // recorded hit nearest the centroid: a pixel known to reach this cell.
          refined++;
          let bestD = Infinity;
          for (const p of a.pts) {
            const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
            if (d < bestD) { bestD = d; px = p; }
          }
        }
        map[i] = { px, samples: a.n };
      }
      return { map, taps, landed, refined };
    },

    /**
     * Screen bounding box of the whole board, found with a coarse pass.
     *
     * The board covers well under half the canvas, and the fine raster is the cost of
     * this whole mode, so clipping it to the board is a 3-4x saving per sweep step.
     * Padded by one coarse step so the fine pass cannot clip a silhouette edge.
     */
    bbox(coarse = 20) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let py = Math.round(r.top + coarse / 2); py < r.top + r.height; py += coarse) {
        for (let px = Math.round(r.left + coarse / 2); px < r.left + r.width; px += coarse) {
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
      if (!Number.isFinite(x0)) return { left: r.left, top: r.top, width: r.width, height: r.height };
      return {
        left: x0 - coarse, top: y0 - coarse,
        width: x1 - x0 + 2 * coarse, height: y1 - y0 + 2 * coarse,
      };
    },

    /** Rotate via OrbitControls' own drag path. dx/dy in px. */
    orbit(dx, dy, steps = 6) {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      fire('pointerdown', cx, cy, { button: 0, buttons: 1 });
      for (let n = 1; n <= steps; n++) {
        fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 1 });
      }
      fire('pointerup', cx + dx, cy + dy, { button: 0, buttons: 0 });
      return true;
    },

    /**
     * Pan via a right-button drag — OrbitControls' default RIGHT binding, and the
     * affordance that lets a player slide the camera's target sideways instead of
     * swinging around it. Deep inside the box, pan is the only way to get next to a
     * particular cell: orbit and dolly both aim at the centre.
     */
    pan(dx, dy, steps = 5) {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      fire('pointerdown', cx, cy, { button: 2, buttons: 2 });
      for (let n = 1; n <= steps; n++)
        fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 2 });
      fire('pointerup', cx + dx, cy + dy, { button: 2, buttons: 0 });
      return true;
    },

    /**
     * Raster a small window centred on the canvas and report which of \`targets\` it hit.
     * Used by the targeted probe, where the camera sits inside the box and the only
     * question is "is this particular cell in front of me now".
     */
    probeCentre(targets, half = 90, step = 3) {
      listen();
      const s = session();
      const want = new Set(targets);
      const found = {};
      const r = canvas.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      for (let py = cy - half; py <= cy + half; py += step) {
        for (let px = cx - half; px <= cx + half; px += step) {
          if (px < r.left || py < r.top || px > r.right || py > r.bottom) continue;
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (want.has(i) && !found[i]) found[i] = [px, py];
        }
      }
      return found;
    },

    /** Dolly via the wheel, the same affordance a mouse user has. */
    zoom(deltaY, ticks = 1) {
      const r = canvas.getBoundingClientRect();
      for (let n = 0; n < ticks; n++) {
        canvas.dispatchEvent(new WheelEvent('wheel', {
          deltaY, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
          bubbles: true, cancelable: true,
        }));
      }
      return true;
    },

    /**
     * Re-find the pixel that reaches \`cell\` right now, searching outward from a hint.
     *
     * Needed because OrbitControls applies damping per *frame*, so the camera a replayed
     * drag settles on is only equal to the original within an epsilon that depends on how
     * many frames elapsed. For a cell with a wide footprint that is irrelevant; for one
     * reachable through a two-pixel gap it is the difference between hitting it and
     * hitting the cell behind it. So the recorded pixel is treated as a hint and the
     * exact pixel is re-derived against the camera as it actually is.
     *
     * -> { px, samples, radius } | null
     */
    findPixel(cell, hint, radius = 14, step = 2) {
      listen();
      const s = session();
      // A playthrough calls this with cells already filled from earlier groups, so the
      // probe has to put the board back exactly, not blank it.
      const before = Array.from(s.state);
      const hits = [];
      for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const px = hint[0] + dx, py = hint[1] + dy;
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, before[i]);
          if (i === cell) hits.push([px, py]);
        }
      }
      if (!hits.length) {
        for (let i = 0; i < s.state.length; i++) if (s.state[i] !== before[i]) s.set(i, before[i]);
        return null;
      }
      // Centroid of the local hits, then confirm it still lands on the cell.
      const cx = Math.round(hits.reduce((a, p) => a + p[0], 0) / hits.length);
      const cy = Math.round(hits.reduce((a, p) => a + p[1], 0) / hits.length);
      let px = [cx, cy];
      if (tap(cx, cy) !== cell) {
        let bestD = Infinity;
        for (const p of hits) {
          const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
          if (d < bestD) { bestD = d; px = p; }
        }
      }
      // leave the board exactly as we found it
      for (let i = 0; i < s.state.length; i++) if (s.state[i] !== before[i]) s.set(i, before[i]);
      return { px, samples: hits.length, radius };
    },

    /** Whatever element the browser would route a tap at (px, py) to. */
    elementAt(px, py) {
      const el = document.elementFromPoint(px, py);
      return el ? { tag: el.tagName, id: el.id, cls: el.className?.toString?.() ?? '' } : null;
    },

    board() { return Array.from(session().state); },
    solution() { return Array.from(session().solution); },
    solved() { return session().solved; },
    spec() { const s = session().spec; return { id: s.id, dims: s.dims, name: s.name }; },

    /** Put the board back to all-BLANK without going through undo. */
    clearBoard() {
      const s = session();
      for (let i = 0; i < s.state.length; i++) if (s.state[i] !== 0) s.set(i, 0);
      return true;
    },
  };
})()`;

async function installProbe(page) {
  await page.evaluate(`window.__qa = ${PROBE}; window.__qa.install()`);
}

// --- navigation helpers ------------------------------------------------------

/**
 * Seed every puzzle as cleared so the reward layer's level gates are open.
 *
 * Seeding alone is not enough to then *play* one: `createSession` reads the same
 * `solved` flag and locks input on a cleared board, so a seeded puzzle opens
 * unplayable. `openPuzzle` therefore drops the target puzzle's own key right before
 * opening it — every other puzzle stays cleared (so the level gate is open), and the
 * one under test opens blank.
 */
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

/** Flat [{ levelIndex, puzzleIndex, id, dims }] in play order. */
const CATALOGUE = `(() => {
  const out = [];
  window.__nonogram.levels().forEach((level, li) =>
    level.puzzles.forEach((p, pi) =>
      out.push({ levelIndex: li, puzzleIndex: pi, id: p.id, dims: p.dims })));
  return out;
})()`;

/**
 * Walk the real menu to a puzzle: title -> levels -> level card -> puzzle card.
 * Clicks the DOM the way a player does rather than calling openPuzzle directly, so a
 * card that is locked or missing fails here instead of being skipped.
 */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }, { fresh = true } = {}) {
  await page.evaluate(`(() => {
    ${fresh ? `localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});` : ''}
    const show = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    show('#levels-grid .level-card', ${levelIndex});
    show('#puzzles-grid .puzzle-card', ${puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 15_000 },
  );
  // Let OrbitControls' damping settle so the camera is where frameCamera put it.
  await sleep(350);
  await installProbe(page);
}

// --- real input --------------------------------------------------------------

/** A real OS-level click or tap at a client pixel, through Chrome's hit-testing. */
async function realTap(page, px, py, { touch }) {
  if (touch) {
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

/**
 * Real-event spot check: tap a pixel the synthetic raster says reaches `cell` and
 * confirm the production path agrees end to end. This is what makes the synthetic map
 * admissible — if Chrome routes the tap somewhere else (an overlay over the canvas),
 * the cell does not change and the check fails.
 */
async function confirmWithRealTap(page, cell, hint, platform) {
  await page.evaluate('window.__qa.clearBoard()');
  // Re-localize first: the question is "can a real tap reach this cell at this camera",
  // not "is the pixel recorded minutes ago still byte-exact after damping".
  const found = await page
    .evaluate(`JSON.stringify(window.__qa.findPixel(${cell}, ${JSON.stringify(hint)}, 14, 2))`)
    .then(JSON.parse);
  if (!found) return { ok: false, changed: [], routed: null, relocated: false };
  const [px, py] = found.px;
  await realTap(page, px, py, platform);
  await sleep(120);
  // Diff the whole board rather than reading the one cell: when a tap lands on the
  // wrong cell, "which cell did it hit" is the diagnostic that separates a harness
  // artefact (a neighbour, 1px away) from a real routing bug (nothing at all, or an
  // overlay eating the event).
  const changed = await page
    .evaluate('JSON.stringify(window.__qa.board().map((v, i) => [i, v]).filter(([, v]) => v !== 0))')
    .then(JSON.parse);
  const routed = await page.evaluate(`JSON.stringify(window.__qa.elementAt(${px}, ${py}))`);
  await page.evaluate('window.__qa.clearBoard()');
  return {
    ok: changed.length === 1 && changed[0][0] === cell && changed[0][1] === 1,
    changed,
    routed,
    relocated: true,
    localSamples: found.samples,
  };
}

// --- mode: reach -------------------------------------------------------------

/**
 * The orientation sweep. Each entry is an interaction a player can perform from the
 * board as it opens, described in the same terms the bug report uses.
 *
 * `cost` is what the sweep is really measuring: how much camera work a cell costs.
 *   0  the board as it opens
 *   1  orbit only — drag the board around
 *   2  orbit + dolly in, camera still outside the box
 *   3  dolly past the shell, camera inside the box
 */
function sweepPlan() {
  const steps = [{ name: 'default', cost: 0, acts: [] }];

  // Cost 1 — orbit only. 8 azimuths x 3 elevations. A drag of `clientHeight` px is a
  // full 2*pi of azimuth in OrbitControls, so h/8 px per 45 degrees.
  for (const az of [0, 1, 2, 3, 4, 5, 6, 7]) {
    for (const el of [-1, 0, 1]) {
      if (az === 0 && el === 0) continue;
      steps.push({
        name: `orbit az=${az * 45}deg el=${el * 30}deg`,
        cost: 1,
        acts: [{ kind: 'orbit', dx: az / 8, dy: el / 12 }],
      });
    }
  }

  // Cost 2/3 — dolly in, then orbit again at that distance. OrbitControls' wheel zoom
  // is multiplicative (0.95 per tick), so 14 ticks is ~0.49x and 26 is ~0.26x of the
  // opening distance; the opening distance is max(dims)*1.8+1, so 26 ticks puts the
  // camera inside the box for every size in the catalogue.
  //
  // Four azimuths per zoom band rather than eight: the orbit band above already reaches
  // all but a handful of cells, so these steps exist to pick up the stragglers and to
  // widen apertures, not to discover whole new regions.
  for (const [ticks, cost] of [[14, 2], [26, 3]]) {
    for (const az of [0, 2, 4, 6]) {
      steps.push({
        name: `zoom ${ticks}t + orbit az=${az * 45}deg`,
        cost,
        acts: [{ kind: 'zoom', ticks }, { kind: 'orbit', dx: az / 8, dy: 0 }],
      });
    }
  }
  return steps;
}

async function applyActs(page, acts) {
  const rect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
  for (const act of acts) {
    if (act.kind === 'orbit') {
      // dx/dy are fractions of a full turn; OrbitControls maps clientHeight px -> 2*pi.
      await page.evaluate(`window.__qa.orbit(${act.dx * rect.height}, ${act.dy * rect.height}, 8)`);
    } else if (act.kind === 'zoom') {
      await page.evaluate(`window.__qa.zoom(-120, ${act.ticks})`);
    }
    // Damping needs frames, not time — but frames are time here. 0.05 damping settles
    // to under a pixel of movement in well under 400ms at 60fps.
    await sleep(420);
  }
}

async function runReach(page, platform, { dimsList, step, out, check }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const byDims = new Map();
  for (const entry of catalogue) {
    const key = dimsKey(entry.dims);
    if (!byDims.has(key)) byDims.set(key, entry);
  }

  const wanted = dimsList?.length ? dimsList.map(dimsKey) : [...byDims.keys()];
  const plan = sweepPlan();
  const results = {};

  for (const key of wanted) {
    const entry = byDims.get(key);
    if (!entry) {
      console.log(`  (no puzzle has dims ${key} — skipped)`);
      continue;
    }
    const total = entry.dims.x * entry.dims.y * entry.dims.z;
    // cheapest interaction cost at which each cell first became reachable
    const costOf = new Map();
    // cell -> the orientation where its clickable aperture is *largest*. The whole sweep
    // runs (no early exit on full coverage) because the first orientation that reaches a
    // cell is often the one where it is a 2px sliver; `play` wants the easiest shot, and
    // the verdict wants the aperture of the easiest shot.
    const bestOf = new Map();
    const perStep = [];
    const startedAt = Date.now();
    let box = null;

    for (const s of plan) {
      // A fresh open resets the camera, so each sweep step starts from the same place
      // and its `cost` means what it says.
      await openPuzzle(page, entry);
      await applyActs(page, s.acts);
      // The board's screen box changes with the camera, so it is re-found per step.
      box = await page.evaluate('JSON.stringify(window.__qa.bbox(20))').then(JSON.parse);
      const { map, taps, landed, refined } = await page
        .evaluate(`JSON.stringify(window.__qa.raster(${step}, ${JSON.stringify(box)}))`)
        .then(JSON.parse);

      let fresh = 0;
      let improved = 0;
      for (const [cellStr, hit] of Object.entries(map)) {
        const cell = Number(cellStr);
        if (!costOf.has(cell)) { costOf.set(cell, s.cost); fresh++; }
        const prev = bestOf.get(cell);
        if (!prev || hit.samples > prev.samples) {
          bestOf.set(cell, { px: hit.px, samples: hit.samples, step: s.name, acts: s.acts, cost: s.cost });
          if (prev) improved++;
        }
      }
      perStep.push({ name: s.name, cost: s.cost, taps, landed, refined, cells: Object.keys(map).length, fresh });
      if (fresh || improved) {
        console.log(
          `  ${key}  ${s.name.padEnd(38)} reached ${String(Object.keys(map).length).padStart(3)}` +
            `  (+${fresh} new, ${improved} wider, ${costOf.size}/${total})`,
        );
      }
    }

    // Real-event confirmation: the synthetic map is only admissible for cells a real tap
    // has also landed on. Sampled across the cost bands plus — deliberately — the cell
    // with the *smallest* aperture, which is where a real tap is most likely to miss.
    const sample = [];
    for (const cost of [0, 1, 2, 3]) {
      const cells = [...costOf.entries()].filter(([, c]) => c === cost).map(([cell]) => cell);
      if (cells.length) sample.push(cells[Math.floor(cells.length / 2)]);
    }
    const tightest = [...bestOf.entries()].sort((a, b) => a[1].samples - b[1].samples)[0];
    if (tightest && !sample.includes(tightest[0])) sample.push(tightest[0]);
    const confirmations = [];
    for (const cell of sample) {
      const { px, acts, samples } = bestOf.get(cell);
      await openPuzzle(page, entry);
      await applyActs(page, acts);
      const got = await confirmWithRealTap(page, cell, px, platform);
      confirmations.push({ cell, cost: costOf.get(cell), samples, apertureCssPx2: samples * step * step, ...got });
      check(
        `${platform.label} ${key}: a real ${platform.touch ? 'tap' : 'click'} reaches cell ${cell} (cost ${costOf.get(cell)})`,
        got.ok,
        `changed=${JSON.stringify(got.changed)} routed to ${got.routed}`,
      );
    }

    // Aperture distribution, in CSS px² of clickable area at each cell's best angle.
    // 44x44 = 1936 px² is the usual floor for a finger-sized target; 24x24 = 576 for a
    // mouse. Both bands are reported so the verdict can say which platform is hurt.
    const apertures = [...bestOf.entries()].map(([cell, b]) => ({
      cell, samples: b.samples, px2: b.samples * step * step, cost: b.cost,
    }));
    const sortedAp = [...apertures].sort((a, b) => a.px2 - b.px2);

    results[key] = {
      dims: entry.dims,
      viaPuzzle: entry.id,
      total,
      rasterStep: step,
      reached: costOf.size,
      byCost: [0, 1, 2, 3].map((c) => [...costOf.values()].filter((v) => v === c).length),
      unreachable: Array.from({ length: total }, (_, i) => i).filter((i) => !costOf.has(i)),
      cheapestCost: Object.fromEntries(costOf),
      // cell -> { px, step, acts, samples }: the pixel, the camera moves that reach it,
      // and its aperture there. `play` replays exactly this, which is what makes the two
      // modes agree, and the report reads its numbers off the same record.
      pixelByCell: Object.fromEntries(bestOf),
      aperture: {
        min: sortedAp[0]?.px2 ?? 0,
        median: sortedAp[Math.floor(sortedAp.length / 2)]?.px2 ?? 0,
        underMouse24: apertures.filter((a) => a.px2 < 576).length,
        underFinger44: apertures.filter((a) => a.px2 < 1936).length,
        tightest: sortedAp.slice(0, 12),
      },
      perStep,
      confirmations,
      elapsedMs: Date.now() - startedAt,
    };

    const r = results[key];
    console.log(
      `  ${key}: ${r.reached}/${total} reachable  ` +
        `[cost0=${r.byCost[0]} orbit=${r.byCost[1]} zoom=${r.byCost[2]} inside=${r.byCost[3]}]  ` +
        `aperture min=${r.aperture.min}px² med=${r.aperture.median}px²  ` +
        `<24px:${r.aperture.underMouse24} <44px:${r.aperture.underFinger44}  ` +
        `${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
    );
    check(`${platform.label} ${key}: every cell of the box is reachable by pointer`, r.reached === total,
      `${r.reached}/${total}, ${r.unreachable.length} unreachable`);

    // Written per size, not once at the end: a full sweep is tens of minutes, and a
    // crash or a kill on the last size used to throw away every size before it.
    writeFileSync(join(out, `reach-${platform.label}.json`), JSON.stringify(results, null, 2));
  }

  return results;
}

// --- mode: play --------------------------------------------------------------

/**
 * Finish one puzzle with real input only.
 *
 * Cells are clicked in groups by the sweep step that reaches them, so the camera is
 * moved once per group rather than once per cell. A cell the sweep never reached is
 * recorded as `stranded` and left alone — the run reports the puzzle as unfinishable
 * rather than quietly reaching into `session` to fake a clear.
 */
async function playPuzzle(page, entry, reach, platform, { out, check }) {
  const key = dimsKey(entry.dims);
  const plan = reach[key];
  if (!plan) throw new Error(`no reachability map for ${key} — run \`reach\` first`);

  await openPuzzle(page, entry);
  await page.evaluate('window.__qa.clearBoard()');
  const solution = await page.evaluate('JSON.stringify(window.__qa.solution())').then(JSON.parse);
  const needed = solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  // Group the needed cells by the sweep step that reaches them, so the camera moves
  // once per group instead of once per cell.
  const pixelByCell = plan.pixelByCell ?? {};
  const groups = new Map();
  const stranded = [];
  for (const cell of needed) {
    const rec = pixelByCell[cell];
    if (!rec) { stranded.push(cell); continue; }
    if (!groups.has(rec.step)) groups.set(rec.step, { acts: rec.acts, cells: [] });
    groups.get(rec.step).cells.push({ cell, px: rec.px });
  }

  const startedAt = Date.now();
  let clicks = 0;
  const misses = [];

  for (const [stepName, group] of groups) {
    // `fresh: false` is load-bearing: a fresh open drops the puzzle's saved board, which
    // would wipe every group played before this one. The board has to come back from
    // storage so the groups accumulate into one playthrough.
    await openPuzzle(page, entry, { fresh: false });
    await applyActs(page, group.acts);

    // Tap the whole group, then diff once. Reading the board after every tap doubles the
    // CDP round trips for a run that is already thousands of them; cells that did not
    // land are retried individually below, which is where the per-cell detail is needed.
    const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    const wanted = group.cells.filter(({ cell }) => board[cell] !== 1);

    // Re-localize every pixel against the camera as it actually settled, in one page
    // call, before any real tap goes out. See `findPixel` for why the recorded pixel is
    // only a hint.
    const located = await page
      .evaluate(`JSON.stringify(${JSON.stringify(wanted)}.map((w) => {
        const f = window.__qa.findPixel(w.cell, w.px, 14, 2);
        return f ? { cell: w.cell, px: f.px, samples: f.samples } : { cell: w.cell, px: null };
      }))`)
      .then(JSON.parse);

    const todo = [];
    for (const l of located) {
      if (!l.px) { misses.push({ cell: l.cell, stepName, reason: 'no pixel reaches it at this angle' }); continue; }
      todo.push({ cell: l.cell, px: l.px });
    }
    for (const { px } of todo) {
      await realTap(page, px[0], px[1], platform);
      clicks++;
    }
    await sleep(150);

    const after = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    for (const { cell, px } of todo) {
      if (after[cell] === 1) continue;
      // Retry once on its own: a tap can miss because the cell cycled past FILLED (it
      // was already MARKED from a stray earlier tap) rather than because it is unaimable.
      await page.evaluate(`window.__nonogram.session().set(${cell}, 0)`);
      await realTap(page, px[0], px[1], platform);
      clicks++;
      await sleep(120);
      const value = await page.evaluate(`window.__nonogram.session().state[${cell}]`);
      if (value !== 1) misses.push({ cell, px, stepName, value });
    }
  }

  // --- correction pass -------------------------------------------------------
  // A tap aimed at one cell can land on another along the same ray, which leaves a cell
  // filled that the solution does not want. A player would spot that and click it back,
  // so the harness does too — and counts it, because "how many corrective taps did this
  // board cost" is a usability number, not noise to be hidden.
  let corrections = 0;
  for (let round = 0; round < 3; round++) {
    const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    const strays = board
      .map((v, i) => ({ i, v }))
      .filter(({ i, v }) => v !== 0 && solution[i] !== 1)
      .filter(({ i }) => pixelByCell[i]);
    if (!strays.length) break;
    for (const { i, v } of strays) {
      const rec = pixelByCell[i];
      await openPuzzle(page, entry, { fresh: false });
      await applyActs(page, rec.acts);
      // FILLED -> MARKED -> BLANK is two taps; MARKED -> BLANK is one.
      for (let n = 0; n < (v === 1 ? 2 : 1); n++) {
        await realTap(page, rec.px[0], rec.px[1], platform);
        corrections++;
        await sleep(90);
      }
    }
  }

  const solved = await page.evaluate('window.__qa.solved()');
  const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
  const wrong = board.filter((v, i) => (v === 1) !== (solution[i] === 1)).length;

  // the clear celebration is the reward layer's completion signal
  const celebrated = await page.evaluate(
    "!!document.querySelector('.fx-clear.fx-clear--on') || !!document.querySelector('.fx-clear')",
  );
  const record = await page.evaluate(`localStorage.getItem('no-nonogram:${entry.id}')`);

  const result = {
    id: entry.id,
    dims: entry.dims,
    needed: needed.length,
    clicks,
    corrections,
    stranded,
    misses,
    solved,
    wrongCells: wrong,
    celebrated,
    record: record ? JSON.parse(record) : null,
    elapsedMs: Date.now() - startedAt,
  };

  check(
    `${platform.label} ${entry.id}: finished with real ${platform.touch ? 'taps' : 'clicks'} only`,
    solved && stranded.length === 0 && misses.length === 0,
    `${clicks} ${platform.touch ? 'taps' : 'clicks'} for ${needed.length} cells, ` +
      `${corrections} corrective, ${stranded.length} stranded, ${misses.length} missed, ` +
      `${wrong} wrong, solved=${solved}`,
  );
  if (solved) {
    check(`${platform.label} ${entry.id}: clear celebration fired`, celebrated);
    check(`${platform.label} ${entry.id}: record persisted as solved`, result.record?.solved === true,
      JSON.stringify(result.record)?.slice(0, 80));
  }
  void out;
  return result;
}

// --- mode: probe -------------------------------------------------------------

/**
 * Targeted hunt for specific cells the broad sweep never reached.
 *
 * The broad sweep is a 35-orientation *sample*, so "not found" there means "not found",
 * not "impossible". Before a puzzle can be called unfinishable, the cells it needs have
 * to survive a search that uses every camera affordance the player has — including the
 * two the sweep barely touches: dollying the camera *inside* the box, and panning the
 * target sideways once inside (orbit and dolly both aim at the centre, so pan is the
 * only way to get next to a particular cell).
 *
 * Every hit is re-confirmed with a real CDP event before it counts.
 */
async function runProbe(page, platform, { puzzleId, cells, out, check }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const entry = catalogue.find((c) => c.id === puzzleId);
  if (!entry) throw new Error(`no puzzle ${puzzleId}`);

  const remaining = new Set(cells);
  const found = {};
  let configs = 0;
  const startedAt = Date.now();

  // Inside-the-box bands: 0.95^n of the opening distance max(dims)*1.8+1. At 6³ the
  // opening distance is 11.8 and the box half-diagonal is ~6, so 20 ticks (~0.36x) is
  // already inside and 36 (~0.16x) is deep inside.
  for (const ticks of [18, 22, 26, 30, 34]) {
    for (const az of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const [dx, dy] of [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25], [-0.25, -0.25], [0.25, 0.25]]) {
        if (!remaining.size) break;
        await openPuzzle(page, entry);
        const rect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
        await page.evaluate(`window.__qa.zoom(-120, ${ticks})`);
        await sleep(260);
        if (az) {
          await page.evaluate(`window.__qa.orbit(${(az / 8) * rect.height}, 0, 8)`);
          await sleep(260);
        }
        if (dx || dy) {
          await page.evaluate(`window.__qa.pan(${dx * rect.width}, ${dy * rect.height}, 5)`);
          await sleep(260);
        }
        configs++;
        const hit = await page
          .evaluate(`JSON.stringify(window.__qa.probeCentre(${JSON.stringify([...remaining])}, 90, 3))`)
          .then(JSON.parse);
        for (const [cellStr, px] of Object.entries(hit)) {
          const cell = Number(cellStr);
          if (!remaining.has(cell)) continue;
          // only counts if a real event lands on it too
          const got = await confirmWithRealTap(page, cell, px, platform);
          if (!got.ok) continue;
          remaining.delete(cell);
          found[cell] = { ticks, az: az * 45, pan: [dx, dy], px, confirmed: true };
          console.log(`  ${puzzleId} cell ${cell}: reached at zoom ${ticks}t az ${az * 45}deg pan [${dx},${dy}] — real click CONFIRMED`);
        }
      }
    }
  }

  const stillUnreachable = [...remaining];
  console.log(
    `\n  ${puzzleId}: ${cells.length - stillUnreachable.length}/${cells.length} of the sweep's unreachable cells ` +
      `were reached by the targeted probe (${configs} camera configs, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
  );
  if (stillUnreachable.length) console.log(`  still unreachable: ${stillUnreachable.join(' ')}`);

  check(
    `${platform.label} ${puzzleId}: every required cell is reachable by some camera the player can reach`,
    stillUnreachable.length === 0,
    `${stillUnreachable.length} cells survived ${configs} camera configs: ${stillUnreachable.join(' ')}`,
  );

  writeFileSync(join(out, `probe-${puzzleId}.json`), JSON.stringify({ puzzleId, cells, found, stillUnreachable, configs }, null, 2));
  return { found, stillUnreachable, configs };
}

// --- mode: edge --------------------------------------------------------------

/**
 * The paths a player takes that are not "click cells until solved": leaving a puzzle
 * half-done, reloading, switching tabs, undoing, re-opening a cleared board.
 *
 * Every assertion here is on observable state — localStorage, the DOM, the session —
 * reached by clicking the real controls, never by calling into the reward layer.
 */
async function runEdge(page, platform, { out, check, base }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const target = catalogue[1]; // level 1, puzzle 2 — small board, always unlocked
  // Observations that are not pass/fail. Empty right now: the one note this used to
  // carry (stroke-undo unreachable) became a real assertion at E6 once DOO-16 wired the
  // caller up. Kept because the edge JSON's shape is part of the report's inputs.
  const notes = [];

  // --- E1 partial progress survives a reload, MARKED cells included -----------
  await openPuzzle(page, target);
  const written = await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    s.cycle(0);               // FILLED
    s.cycle(1); s.cycle(1);   // MARKED
    s.cycle(2);
    return Array.from(s.state).join('');
  })()`);
  await sleep(200);
  await page.goto(`${base}/?perf=1`);
  await openPuzzle(page, target, { fresh: false });
  const restored = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: a half-finished board (incl. MARKED cells) survives a reload', restored === written,
    `${written} -> ${restored}`);

  // --- E2 the elapsed timer survives a reload ---------------------------------
  const t1 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1600);
  await page.evaluate('window.__nonogram.rewards.attempt().flush()');
  const t2 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await page.goto(`${base}/?perf=1`);
  await openPuzzle(page, target, { fresh: false });
  const t3 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  check('edge: the attempt timer accumulates and survives a reload', t2 > t1 && t3 >= t2 - 200,
    `${t1.toFixed(0)}ms -> ${t2.toFixed(0)}ms -> after reload ${t3.toFixed(0)}ms`);

  // --- E3 walking back to the list pauses the timer ---------------------------
  await page.evaluate("document.getElementById('btn-game-back').click()");
  await sleep(300);
  const pausedRunning = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  const pausedAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1200);
  const stillAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  check('edge: leaving the puzzle for the list stops the timer', pausedRunning === false && Math.abs(stillAt - pausedAt) < 100,
    `running=${pausedRunning}, ${pausedAt.toFixed(0)}ms -> ${stillAt.toFixed(0)}ms after 1.2s on the list`);

  // --- E4 a hidden tab pauses the timer ---------------------------------------
  await openPuzzle(page, target, { fresh: false });
  await sleep(300);
  const runningOnScreen = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  // Emulation.setPageVisibility does not exist in CDP; the production listener is on
  // `visibilitychange`, so drive the real property the way the browser would.
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await sleep(250);
  const hiddenRunning = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  const hiddenAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1200);
  const hiddenStill = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await sleep(250);
  const resumed = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  check('edge: a backgrounded tab pauses the timer and coming back resumes it',
    runningOnScreen && hiddenRunning === false && Math.abs(hiddenStill - hiddenAt) < 100 && resumed === true,
    `onscreen=${runningOnScreen} hidden=${hiddenRunning} drift=${(hiddenStill - hiddenAt).toFixed(0)}ms resumed=${resumed}`);

  // --- E5 undo, by real clicks on the real button -----------------------------
  await openPuzzle(page, target);
  const rect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
  const centre = [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
  await realTap(page, centre[0], centre[1], platform);
  await sleep(150);
  const afterOne = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  const undoBtn = await page.evaluate("!!document.getElementById('undo') && !document.getElementById('undo').disabled");
  await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: undo reverts a real click', undoBtn && /^0+$/.test(afterUndo) && afterOne !== afterUndo,
    `${afterOne} -> ${afterUndo}`);

  // Undo with nothing on the stack must be a safe no-op, not an exception.
  for (let n = 0; n < 4; n++) await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterOverUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: undo past the start of the stack is a no-op', /^0+$/.test(afterOverUndo), afterOverUndo);

  // --- E6 drag painting, and one undo for the whole stroke (DOO-10 + DOO-16) ---
  // This slot used to just assert beginStroke/endStroke *existed* and then print a note
  // saying nothing called them. That was true when it was written and stopped being true
  // at DOO-16, which restored ui/gestures.js — but the note was a hardcoded string, so
  // it kept printing a defect that no longer existed. A release report that cries wolf
  // is worse than one that stays quiet, so it now drives the feature instead.
  //
  // Two things have to hold for DOO-10's grouped undo to mean anything to a player:
  // a drag must paint more than one cell, and ONE undo press must take the whole drag
  // back. Both are driven the way a player does it — `#btn-mode` for paint mode (the
  // `__nonogram.mode()` handle is read-only on purpose) and real CDP input for the drag.
  await openPuzzle(page, target);
  const paintRect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
  const modeBefore = await page.evaluate('window.__nonogram.mode()');
  await page.evaluate("document.getElementById('btn-mode').click()");
  await sleep(150);
  const modeAfter = await page.evaluate('window.__nonogram.mode()');

  // A horizontal sweep through the middle of the board, which crosses several columns of
  // the front face at any camera angle. Stepping in 6px increments keeps every move
  // inside one cell's width so no crossing is skipped.
  const dragY = Math.round(paintRect.top + paintRect.height / 2);
  const dragX0 = Math.round(paintRect.left + paintRect.width * 0.35);
  const dragX1 = Math.round(paintRect.left + paintRect.width * 0.65);
  const touch = platform.touch;
  const pt = (x) => [{ x, y: dragY, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  if (touch) {
    await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(dragX0) });
  } else {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: dragX0, y: dragY, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse',
    });
  }
  for (let x = dragX0 + 6; x <= dragX1; x += 6) {
    if (touch) await page.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x) });
    else {
      await page.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y: dragY, button: 'left', buttons: 1, pointerType: 'mouse',
      });
    }
  }
  if (touch) await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: dragX1, y: dragY, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse',
    });
  }
  await sleep(200);

  const painted = await page
    .evaluate('JSON.stringify(window.__qa.board().map((v, i) => [i, v]).filter(([, v]) => v !== 0))')
    .then(JSON.parse);
  // One press, not a loop: the whole point of the stroke group is that a drag costs the
  // player a single undo. Looping here would pass even with no grouping at all.
  await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterStrokeUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');

  check('edge: a drag paints a stroke of several cells (DOO-16 restored the caller)',
    modeAfter === 'paint' && painted.length >= 2,
    `#btn-mode: ${modeBefore} -> ${modeAfter}; drag ${dragX0}->${dragX1}px painted ${painted.length} cells ` +
    `[${painted.map(([i]) => i).join(',')}]`);
  check('edge: one undo press takes the entire painted stroke back (DOO-10 grouping)',
    painted.length >= 2 && /^0+$/.test(afterStrokeUndo),
    `${painted.length} cells painted -> after ONE undo: ${afterStrokeUndo}`);

  // Leave the board in rotate mode so nothing after this inherits paint mode.
  if (modeAfter === 'paint') await page.evaluate("document.getElementById('btn-mode').click()");

  // --- E7 a hint costs points and the board stays consistent ------------------
  await openPuzzle(page, target);
  const hintBefore = await page.evaluate('window.__nonogram.rewards.attempt().hints()');
  await page.evaluate('window.__nonogram.rewards.hint()');
  await sleep(250);
  const banner = await page.evaluate("document.querySelector('.fx-banner')?.textContent?.slice(0, 60) ?? ''");
  await page.evaluate('window.__nonogram.rewards.hint()');
  await sleep(250);
  const hintAfter = await page.evaluate('window.__nonogram.rewards.attempt().hints()');
  const boardAfterHint = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
  const solutionNow = await page.evaluate('JSON.stringify(window.__qa.solution())').then(JSON.parse);
  const hintWrong = boardAfterHint.filter((v, i) => v === 1 && solutionNow[i] !== 1).length;
  check('edge: two hint presses escalate 1 -> 2, charge points, and place only correct cells',
    hintAfter > hintBefore && hintWrong === 0 && banner.length > 0,
    `points ${hintBefore} -> ${hintAfter}, ${hintWrong} wrong cells placed, banner="${banner}"`);

  // --- E8 a cleared board reopens locked, with the timer stopped --------------
  await openPuzzle(page, target);
  await page.evaluate('window.__nonogram.rewards.solveNow()');
  await sleep(600);
  const solvedNow = await page.evaluate('window.__qa.solved()');
  await page.evaluate("document.getElementById('btn-game-back').click()");
  await sleep(300);
  await openPuzzle(page, target, { fresh: false });
  const reopened = await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    const before = Array.from(s.state).join('');
    s.cycle(0);
    return { solved: s.solved, locked: Array.from(s.state).join('') === before,
             canUndo: s.canUndo(), running: window.__nonogram.rewards.attempt().running() };
  })()`);
  check('edge: a cleared board reopens solved, input-locked, undo-locked, timer stopped',
    solvedNow && reopened.solved && reopened.locked && !reopened.canUndo && !reopened.running,
    JSON.stringify(reopened));

  // --- E9 level gating: locked before the clears, open after ------------------
  await page.evaluate('localStorage.clear()');
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  const lockedAtStart = await page.evaluate(
    "Array.from(document.querySelectorAll('#levels-grid .level-card')).map((c) => c.classList.contains('fx-locked'))",
  );
  await page.evaluate(SEED_ALL_CLEARED);
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  const lockedAfter = await page.evaluate(
    "Array.from(document.querySelectorAll('#levels-grid .level-card')).map((c) => c.classList.contains('fx-locked'))",
  );
  check('edge: levels 2-4 start locked and open once the earlier levels are cleared',
    lockedAtStart[0] === false && lockedAtStart.slice(1).every(Boolean) && lockedAfter.every((l) => l === false),
    `fresh=[${lockedAtStart}] seeded=[${lockedAfter}]`);

  // --- E10 a locked level card tells the player why ---------------------------
  await page.evaluate('localStorage.clear()');
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  await page.evaluate("document.querySelectorAll('#levels-grid .level-card')[1].click()");
  await sleep(400);
  const blocked = await page.evaluate(`(() => ({
    stillOnLevels: !document.getElementById('screen-levels').hidden,
    toast: document.querySelector('.fx-toast')?.textContent?.slice(0, 80) ?? '',
    badge: document.querySelectorAll('#levels-grid .level-card')[1]?.textContent?.slice(0, 80) ?? '',
  }))()`);
  check('edge: tapping a locked level is refused with a reason, not silently',
    blocked.stillOnLevels && (blocked.toast.length > 0 || /잠김|\d+점/.test(blocked.badge)),
    JSON.stringify(blocked));

  writeFileSync(join(out, `edge-${platform.label}.json`), JSON.stringify({ notes }, null, 2));
  for (const n of notes) console.log(`  note   ${n.name}\n         ${n.detail}`);
  return { notes };
}

// --- entry point -------------------------------------------------------------

const [mode = 'reach', BASE = 'http://127.0.0.1:4273', OUT = 'qa-out'] = process.argv.slice(2);
const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

mkdirSync(OUT, { recursive: true });
const { check, report, checks } = checklist();
const platform = PLATFORMS[flags.platform ?? 'desktop'];
if (!platform) throw new Error(`unknown platform ${flags.platform}`);

const browser = await launchChrome({ offline: true, windowSize: `${platform.width},${platform.height}` });
const page = await browser.newPage();
await page.emulate(platform);

const pageErrors = () => page.errors().filter((t) => !IGNORED_NOISE.test(t));

console.log(`\n=== ${mode} · ${platform.label} ${platform.width}x${platform.height}@${platform.deviceScaleFactor} cpu/${platform.cpuThrottle} ===\n`);

await page.goto(`${BASE}/?perf=1`);
await page.evaluate('localStorage.clear()');
await page.goto(`${BASE}/?perf=1`);
await page.evaluate(SEED_ALL_CLEARED);
await page.goto(`${BASE}/?perf=1`);
check(`${platform.label}: boots with no console errors`, pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));

let payload = null;
if (mode === 'reach') {
  const dimsList = flags.dims ? flags.dims.split(',').map(parseDims) : null;
  payload = await runReach(page, platform, {
    dimsList,
    step: Number(flags.step ?? 6),
    out: OUT,
    check,
  });
} else if (mode === 'play') {
  // `play` replays the map `reach` wrote for this platform: same pixels, same camera
  // moves, but every cell clicked with a real event and the puzzle taken to `solved`.
  const reach = JSON.parse(readFileSync(join(OUT, `reach-${platform.label}.json`), 'utf8'));
  const catalogue = await page.evaluate(CATALOGUE);
  const only = flags.only ? new Set(flags.only.split(',')) : null;
  const plays = [];
  for (const entry of catalogue) {
    if (only && !only.has(entry.id)) continue;
    const result = await playPuzzle(page, entry, reach, platform, { out: OUT, check });
    plays.push(result);
    console.log(
      `  ${entry.id.padEnd(12)} ${dimsKey(entry.dims).padEnd(6)} ` +
        `need=${String(result.needed).padStart(3)} ${String(result.clicks).padStart(3)} ${platform.touch ? 'taps' : 'clicks'} ` +
        `+${String(result.corrections).padStart(2)} fix  solved=${String(result.solved).padEnd(5)} ` +
        `stranded=${result.stranded.length} missed=${result.misses.length} wrong=${result.wrongCells}  ` +
        `${(result.elapsedMs / 1000).toFixed(0)}s`,
    );
  }
  const finished = plays.filter((p) => p.solved).length;
  check(`${platform.label}: all ${plays.length} puzzles finished with real input`, finished === plays.length,
    `${finished}/${plays.length}`);
  payload = plays;
} else if (mode === 'probe') {
  payload = await runProbe(page, platform, {
    puzzleId: flags.puzzle,
    cells: flags.cells.split(',').map(Number),
    out: OUT,
    check,
  });
} else if (mode === 'edge') {
  payload = await runEdge(page, platform, { out: OUT, check, base: BASE });
} else {
  throw new Error(`mode \`${mode}\` is not wired up in this revision`);
}

const errorsAtEnd = pageErrors();
check(`${platform.label}: no console errors across the whole run`, errorsAtEnd.length === 0, errorsAtEnd.slice(0, 4).join(' | '));

writeFileSync(join(OUT, `playtest-${mode}-${platform.label}.json`), JSON.stringify({ mode, platform, payload, checks }, null, 2));
await browser.close();
process.exit(report().length ? 1 : 0);

export { playPuzzle, runReach, sweepPlan, openPuzzle, realTap };
