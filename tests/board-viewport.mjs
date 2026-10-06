#!/usr/bin/env node
// tests/board-viewport.mjs — the gate DOO-13 was filed for: **does the 3D board get
// enough screen to be played on, at every viewport we claim to support?**
//
//   npm run build && npx vite preview --port 4373 --host 127.0.0.1 &
//   node tests/board-viewport.mjs http://127.0.0.1:4373 qa-out/viewport
//
// Optional trailing args: viewport labels to narrow the matrix, and `--require=<tag>`
// to narrow the exit code to one track's checks (see "Two defects, two tags" below).
//
//   node tests/board-viewport.mjs http://127.0.0.1:4373 qa-out/vp pixel iphone-se --require=ui
//
// ## Two defects, two tags
//
// The first run of this matrix (2026-10-06, commit 786713e) failed 338 of 589 checks
// and the failures are two unrelated bugs with two different owners, so every check
// carries the owning track:
//
//   [ui]      the play-area layout — `style.css` has no `@media` query, so the board is
//             a `1fr` column squeezed between two content-sized clue panels at every
//             width. DOO-13. **Fixed** by DOO-18 (`f301c3b`); the checks stay as the
//             regression guard.
//   [render]  `render/scene.js` calls `renderer.setSize(w, h, false)` and never
//             `setPixelRatio`, so the drawing buffer is CSS pixels: a 1x board on a 3x
//             phone screen. Separate fix, separate owner. **Fixed** by DOO-19
//             (`af5ea54`), which also capped the ratio — see SHIPPED_DPR_CAP below for
//             why that moved this gate's pass line.
//
// ## Why this gate exists at all
//
// Every gate before it measured something *adjacent* to the board and so missed a
// total collapse of the board itself:
//
//   verify-browser  asserts the canvas has a backing store and renders a frame — true
//                   of a 2x567 canvas.
//   verify-rewards  asserts the hint and mute controls fit inside a 390px viewport —
//                   they do; they are in the HUD bar, not the play area.
//   playtest reach  taps the canvas and asks which cells a pointer can address. A 2px
//                   canvas still routes `elementFromPoint` to `#scene`, and a cell is
//                   still "reached" if one synthetic pixel lands on it.
//
// All three pass on a board a person cannot see. The thing none of them read is the
// board's own geometry, so that is all this file reads.
//
// ## The two numbers
//
// **Canvas box** — `#scene`'s `getBoundingClientRect()` in CSS px, and its share of
// the viewport. Cheap, deterministic, and enough on its own to catch the collapse.
//
// **Cell aperture** — the clickable area of a cell, in CSS px², measured by rastering
// synthetic taps across the board silhouette at the *default* camera and counting how
// many raster points land on each cell (`samples * step²`). This is the number that
// says whether a finger can aim, and it is the same metric `tests/playtest.mjs` uses
// for its release verdict, so the two agree by construction rather than by eyeballing.
//
// Default camera only, deliberately. `playtest reach` already proves that orbiting and
// zooming eventually reach every cell; what is in question here is whether the board is
// playable *as it opens*, before the player has learned to fight the camera.
//
// ## Where the pass lines come from
//
// Not invented: calibrated against the configurations that are known good. Landscape
// phone, tablet and desktop all currently clear every line below by a wide margin, and
// portrait phone fails all of them — which is exactly the shape of the bug. The
// absolute floors are the platform touch-target conventions:
//
//   44x44 CSS px = 1936 px²   Apple HIG / Material (48dp) finger target — FINGER
//   24x24 CSS px =  576 px²   a mouse pointer's practical floor          — MOUSE
//
// A touch viewport is held to MOUSE as the hard fail and reported against FINGER,
// because a 6³ box at 44px per cell needs ~400 CSS px of board on its short side and
// that is the entire width of a phone. Failing MOUSE means the cells are smaller than a
// *mouse cursor* on a touch device, which is not a judgement call.

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

// --- the viewport matrix -----------------------------------------------------
// Real devices, CSS px and DPR as the device reports them. `group` pairs a phone's
// two orientations so the orientation-parity check can find them.

export const VIEWPORTS = [
  { label: 'iphone-se',      group: 'se',     orient: 'portrait',  width: 375, height: 667,  deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'galaxy-s',       group: 'galaxy', orient: 'portrait',  width: 360, height: 740,  deviceScaleFactor: 3,     mobile: true,  touch: true },
  { label: 'iphone-pro',     group: 'pro',    orient: 'portrait',  width: 393, height: 852,  deviceScaleFactor: 3,     mobile: true,  touch: true },
  { label: 'pixel',          group: 'pixel',  orient: 'portrait',  width: 412, height: 915,  deviceScaleFactor: 2.625, mobile: true,  touch: true },
  { label: 'pixel-land',     group: 'pixel',  orient: 'landscape', width: 915, height: 412,  deviceScaleFactor: 2.625, mobile: true,  touch: true },
  { label: 'iphone-se-land', group: 'se',     orient: 'landscape', width: 667, height: 375,  deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'ipad',           group: 'ipad',   orient: 'portrait',  width: 768, height: 1024, deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'desktop',        group: 'desk',   orient: 'landscape', width: 1280, height: 860, deviceScaleFactor: 1,    mobile: false, touch: false },
];

const FINGER_PX2 = 44 * 44; // 1936
const MOUSE_PX2 = 24 * 24;  //  576

// The retina cap shipped in `render/scene.js` (MAX_PIXEL_RATIO). The backing-store check
// below asks for `min(dpr, cap)`, not `dpr`, and the difference is not cosmetic: DOO-19
// priced the fill cost of the drawing buffer and capped the ratio at 2, so on a DPR
// 2.625/3 phone a *correct* renderer draws at 2x. The first draft of this gate demanded
// the full device ratio, which the cap makes unreachable by construction — it reported 56
// failures that were the cap working as designed. `min()` keeps every bit of the defect
// it was written to catch (drop `setPixelRatio` and all seven DPR>1 viewports read 1x,
// missing the line) and adds one the old form could not express: a buffer *above* the cap,
// i.e. someone raising it past what the fill-rate measurement bought.
//
// Hard-coded rather than imported from `render/scene.js`, for the same reason
// `tests/phone-bench.mjs` hard-codes it: a gate that asks the renderer what ratio it chose
// cannot notice the cap being quietly lowered. Changing the cap should break this file and
// make someone re-read the measurement.
const SHIPPED_DPR_CAP = 2;
// Tolerance on the measured ratio. The slack needed is real but small: `scene.width` is a
// rounded `getBoundingClientRect()` while three.js floors `clientWidth * ratio`, so the two
// can disagree by ~1px — at the 200px board floor that is 2/200 = 0.01. 0.05 leaves 5x
// headroom and still fails a 1x buffer on every retina viewport by a factor of 20.
const DPR_TOLERANCE = 0.05;

// Board box floors. 200 CSS px on the short side is the smallest square that can host
// a 6-wide face at a hair over the mouse floor; 22% of the viewport is the share the
// board holds in every currently-good configuration (landscape phone is the tightest at
// 31%, desktop the loosest at 54%), rounded down to leave a layout designer room.
const MIN_SHORT_SIDE = 200;
const MIN_VIEWPORT_SHARE = 0.22;

// Raster step for the aperture pass. 12 CSS px is fine enough that a cell at the mouse
// floor (24x24) still collects ~4 samples, and coarse enough that a desktop board is a
// few thousand taps rather than a hundred thousand.
const RASTER_STEP = 12;

const IGNORED_NOISE = /fonts\.(googleapis|gstatic)\.com|favicon\.ico/;

// --- in-page probe -----------------------------------------------------------
// A cut-down cousin of `tests/playtest.mjs`'s PROBE: this gate never orbits, zooms or
// replays a pixel, so it needs only `rect`, `bbox`, `raster` and `layout`. Kept local
// rather than imported because playtest.mjs builds its probe as one string expression
// for re-injection; sharing it would mean exporting that string and coupling two gates
// that fail for unrelated reasons.

const PROBE = `(() => {
  const canvas = document.getElementById('scene');
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  let hits = [];
  let offCell = null;
  const session = () => window.__nonogram.session();
  const listen = () => { offCell?.(); offCell = session().on('cell', ({ i }) => hits.push(i)); };

  function fire(type, px, py, extra = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: px, clientY: py, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window, ...extra,
    }));
  }
  function tap(px, py) {
    hits = [];
    fire('pointerdown', px, py, { button: 0, buttons: 1 });
    fire('pointerup', px, py, { button: 0, buttons: 0 });
    return hits.length ? hits[0] : null;
  }
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  };

  return {
    install() { listen(); return true; },

    /** The play area's boxes, so a failure can name which element ate the space. */
    layout() {
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        scene: box(document.getElementById('scene')),
        board: box(document.getElementById('board')),
        clueTop: box(document.querySelector('.clue-panel--top')),
        clueLeft: box(document.querySelector('.clue-panel--left')),
        clueRight: box(document.querySelector('.clue-panel--right')),
        // The canvas' backing store, which is what WebGL actually draws into. A
        // 2px-wide element with a stale 1000px buffer would read as "fine" from the
        // CSS box alone; it is not fine, and vice versa.
        backing: { width: document.getElementById('scene').width, height: document.getElementById('scene').height },
      };
    },

    /**
     * Screen bbox of the painted board, found by coarse tapping. Returns null when no
     * tap anywhere on the canvas reaches a cell — i.e. the board is not on screen at
     * all, which is a distinct failure from "on screen but tiny".
     */
    bbox(coarse = 10) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let py = r.top + coarse / 2; py < r.top + r.height; py += coarse) {
        for (let px = r.left + coarse / 2; px < r.left + r.width; px += coarse) {
          const i = tap(Math.round(px), Math.round(py));
          if (i === null) continue;
          s.set(i, 0);
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
      if (!Number.isFinite(x0)) return null;
      return {
        left: Math.round(x0 - coarse), top: Math.round(y0 - coarse),
        width: Math.round(x1 - x0 + 2 * coarse), height: Math.round(y1 - y0 + 2 * coarse),
      };
    },

    /**
     * Tap a grid over \`region\` and return each reached cell's sample count.
     * Every tap is reverted, so the board is BLANK at the end and can never trip the
     * solved state mid-pass (which locks input and would truncate the map).
     */
    raster(step, region) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      const x0 = Math.max(r.left, region?.left ?? r.left);
      const y0 = Math.max(r.top, region?.top ?? r.top);
      const x1 = Math.min(r.right, (region?.left ?? r.left) + (region?.width ?? r.width));
      const y1 = Math.min(r.bottom, (region?.top ?? r.top) + (region?.height ?? r.height));
      const acc = new Map();
      let taps = 0, landed = 0;
      for (let py = y0 + step / 2; py < y1; py += step) {
        for (let px = x0 + step / 2; px < x1; px += step) {
          taps++;
          const i = tap(Math.round(px), Math.round(py));
          if (i === null) continue;
          landed++;
          s.set(i, 0);
          acc.set(i, (acc.get(i) ?? 0) + 1);
        }
      }
      return { samples: Object.fromEntries(acc), taps, landed };
    },

    /** Whatever element the browser would route a tap at the canvas centre to. */
    centreRoute() {
      const r = canvas.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return el ? \`\${el.tagName}#\${el.id || '-'}\` : null;
    },

    spec() { const s = session().spec; return { id: s.id, dims: s.dims, name: s.name }; },
  };
})()`;

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

const dimsKey = (d) => `${d.x}x${d.y}x${d.z}`;

/** Walk the real menu to a puzzle, the way a player does. */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }) {
  await page.evaluate(`(() => {
    localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});
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
  await sleep(350); // let OrbitControls' damping settle where frameCamera put it
  await page.evaluate('window.__qa.install()');
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// --- run ---------------------------------------------------------------------

const BASE = process.argv[2] ?? 'http://127.0.0.1:4373';
const OUT = process.argv[3] ?? 'qa-out/viewport';
const rest = process.argv.slice(4);
// positional extras narrow the viewport matrix; --require=<tag> narrows the exit code
const only = rest.filter((a) => !a.startsWith('-'));
const require_ = rest.find((a) => a.startsWith('--require='))?.split('=')[1] ?? null;

mkdirSync(OUT, { recursive: true });
const { check, report, checks } = checklist();

const browser = await launchChrome({ offline: true, windowSize: '1280,900' });
const page = await browser.newPage();

const results = [];
let catalogue = null;

try {
  for (const vp of VIEWPORTS) {
    if (only.length && !only.includes(vp.label)) continue;

    await page.emulate(vp);
    await page.goto(`${BASE}/`);
    await page.evaluate('localStorage.clear()');
    await page.evaluate(SEED_ALL_CLEARED);
    await page.goto(`${BASE}/`);
    await page.evaluate(`window.__qa = ${PROBE}`);

    catalogue ??= await page.evaluate(CATALOGUE);
    // One puzzle per distinct box size, in play order — the sizes are the thing that
    // drives clue-panel width, so 3³/4³/5³/6³ is the whole interesting range.
    const bySize = new Map();
    for (const e of catalogue) if (!bySize.has(dimsKey(e.dims))) bySize.set(dimsKey(e.dims), e);

    console.log(`\n${vp.label}  ${vp.width}x${vp.height} @${vp.deviceScaleFactor}  (${vp.orient})`);

    for (const [key, entry] of bySize) {
      await openPuzzle(page, entry);
      await page.evaluate(`window.__qa = ${PROBE}; window.__qa.install()`);

      const layout = await page.evaluate('JSON.stringify(window.__qa.layout())').then(JSON.parse);
      const route = await page.evaluate('window.__qa.centreRoute()');
      const silhouette = await page.evaluate('JSON.stringify(window.__qa.bbox(10))').then(JSON.parse);

      let aperture = { cells: 0, min: 0, p10: 0, median: 0, underMouse: 0, underFinger: 0, taps: 0 };
      if (silhouette) {
        const { samples, taps, landed } = await page
          .evaluate(`JSON.stringify(window.__qa.raster(${RASTER_STEP}, ${JSON.stringify(silhouette)}))`)
          .then(JSON.parse);
        const px2 = Object.values(samples).map((n) => n * RASTER_STEP * RASTER_STEP).sort((a, b) => a - b);
        aperture = {
          cells: px2.length,
          min: px2[0] ?? 0,
          p10: percentile(px2, 0.1),
          median: percentile(px2, 0.5),
          underMouse: px2.filter((a) => a < MOUSE_PX2).length,
          underFinger: px2.filter((a) => a < FINGER_PX2).length,
          taps, landed,
        };
      }

      const scene = layout.scene;
      const shortSide = Math.min(scene.width, scene.height);
      const share = (scene.width * scene.height) / (layout.viewport.width * layout.viewport.height);

      const row = {
        viewport: vp.label, orient: vp.orient, group: vp.group,
        vw: layout.viewport.width, vh: layout.viewport.height, dpr: layout.viewport.dpr,
        puzzle: entry.id, dims: key,
        scene, shortSide, share: Number(share.toFixed(3)),
        clueLeftW: layout.clueLeft?.width ?? 0,
        clueRightW: layout.clueRight?.width ?? 0,
        clueTopH: layout.clueTop?.height ?? 0,
        backing: layout.backing,
        centreRoute: route,
        silhouette,
        aperture,
      };
      results.push(row);

      console.log(
        `  ${key}  ${String(entry.id).padEnd(10)} canvas ${String(scene.width).padStart(4)}x${String(scene.height).padStart(3)}` +
          `  short=${String(shortSide).padStart(3)}  share=${(share * 100).toFixed(0).padStart(2)}%` +
          `  clues L${row.clueLeftW}/R${row.clueRightW}/T${row.clueTopH}` +
          `  aperture med=${String(aperture.median).padStart(5)}px² min=${String(aperture.min).padStart(4)}` +
          `  <24px:${aperture.underMouse}/${aperture.cells} <44px:${aperture.underFinger}/${aperture.cells}`,
      );

      writeFileSync(join(OUT, `shot-${vp.label}-${key}.png`), await page.screenshot());
    }
  }

  // --- verdict ---------------------------------------------------------------

  // Checks are tagged with the track that owns the fix, because this matrix turned up
  // two independent defects and a single pass/fail number would make either one look
  // like the other's fault. `--require=<tag>` narrows the exit code to one track, so
  // each owner can verify their own fix without waiting on the other's.
  console.log('\n--- checks ---');
  for (const r of results) {
    const where = `${r.viewport} ${r.dims}`;
    check(`[ui] ${where}: board short side >= ${MIN_SHORT_SIDE}px`, r.shortSide >= MIN_SHORT_SIDE,
      `${r.scene.width}x${r.scene.height}, short=${r.shortSide}px`);
    check(`[ui] ${where}: board holds >= ${(MIN_VIEWPORT_SHARE * 100).toFixed(0)}% of the viewport`,
      r.share >= MIN_VIEWPORT_SHARE, `${(r.share * 100).toFixed(1)}%`);
    check(`[ui] ${where}: the board is actually painted on screen`, !!r.silhouette,
      r.silhouette ? `${r.silhouette.width}x${r.silhouette.height}` : 'no tap anywhere reached a cell');
    check(`[ui] ${where}: median cell aperture >= ${MOUSE_PX2}px² (24x24, mouse floor)`,
      r.aperture.median >= MOUSE_PX2, `median=${r.aperture.median}px² over ${r.aperture.cells} cells`);
    // Owned by the render track, not the layout: a correct layout with a 1x buffer is
    // still a blurry board, so the matrix reads it here under its own tag. The expected
    // ratio is the capped one — see SHIPPED_DPR_CAP.
    const wantRatio = Math.min(r.dpr, SHIPPED_DPR_CAP);
    const gotRatio = r.scene.width > 0 ? r.backing.width / r.scene.width : 0;
    check(
      `[render] ${where}: canvas backing store is CSS box x min(DPR, ${SHIPPED_DPR_CAP})`,
      r.scene.width > 0 && Math.abs(gotRatio - wantRatio) < DPR_TOLERANCE,
      `${r.backing.width}x${r.backing.height} for ${r.scene.width}x${r.scene.height} ` +
        `→ ${gotRatio.toFixed(3)}x, want ${wantRatio.toFixed(3)}x (device @${r.dpr}` +
        `${r.dpr > SHIPPED_DPR_CAP ? ', cap engaged' : ''})`,
    );
  }

  // Finger-floor coverage is reported, not fatal: at 6³ it needs ~400 CSS px of board
  // on the short side, which is a whole phone width, so a layout can be correct and
  // still miss it. A regression here is still worth seeing.
  for (const r of results.filter((x) => VIEWPORTS.find((v) => v.label === x.viewport)?.touch)) {
    const pct = r.aperture.cells ? (100 * (r.aperture.cells - r.aperture.underFinger)) / r.aperture.cells : 0;
    console.log(`  note  ${r.viewport} ${r.dims}: ${pct.toFixed(0)}% of visible cells are finger-sized (>=44x44)`);
  }

  // Orientation parity: rotating a phone must not cost the board most of its area.
  // This is the self-calibrating line — it needs no magic constant, and it is the one
  // that makes "portrait is a second-class layout" a hard failure rather than taste.
  for (const group of new Set(results.map((r) => r.group))) {
    const rows = results.filter((r) => r.group === group);
    const orients = new Set(rows.map((r) => r.orient));
    if (orients.size < 2) continue;
    for (const dims of new Set(rows.map((r) => r.dims))) {
      const p = rows.find((r) => r.dims === dims && r.orient === 'portrait');
      const l = rows.find((r) => r.dims === dims && r.orient === 'landscape');
      if (!p || !l) continue;
      const pa = p.scene.width * p.scene.height;
      const la = l.scene.width * l.scene.height;
      check(`[ui] ${group} ${dims}: portrait board area >= 80% of landscape`, pa >= 0.8 * la,
        `portrait ${pa}px² vs landscape ${la}px² (${((100 * pa) / (la || 1)).toFixed(0)}%)`);
    }
  }

  // Capping at `min(dpr, 2)` costs the DPR-1 desktop row its teeth — 1x is both the right
  // answer and what a renderer that forgot `setPixelRatio` produces. So the matrix has to
  // keep at least one viewport whose device ratio is *above* the cap and one at or below
  // it: the first proves the cap is enforced, the second proves the ratio is still read
  // from the device rather than pinned to a constant. Trimming VIEWPORTS down to DPR-1
  // entries would otherwise make this whole tag unfalsifiable while still printing green.
  const measured = results.filter((r) => r.scene.width > 0);
  check(`[render] the matrix exercises the cap (some viewport has DPR > ${SHIPPED_DPR_CAP})`,
    measured.some((r) => r.dpr > SHIPPED_DPR_CAP + DPR_TOLERANCE),
    `device DPRs measured: ${[...new Set(measured.map((r) => r.dpr))].sort((a, b) => a - b).join(', ')}`);
  check(`[render] the matrix also covers DPR <= ${SHIPPED_DPR_CAP}, where the cap is inert`,
    measured.some((r) => r.dpr <= SHIPPED_DPR_CAP + DPR_TOLERANCE),
    `device DPRs measured: ${[...new Set(measured.map((r) => r.dpr))].sort((a, b) => a - b).join(', ')}`);

  const errs = page.errors().filter((t) => !IGNORED_NOISE.test(t));
  check('[ui] no console errors across the whole matrix', errs.length === 0, errs.slice(0, 3).join(' | '));

  writeFileSync(join(OUT, 'board-viewport.json'), JSON.stringify({
    base: BASE,
    thresholds: {
      MIN_SHORT_SIDE, MIN_VIEWPORT_SHARE, MOUSE_PX2, FINGER_PX2, RASTER_STEP,
      SHIPPED_DPR_CAP, DPR_TOLERANCE,
    },
    results,
    checks,
  }, null, 2));

  const failed = report();

  // Per-track tally, then the exit code. `--require=ui` (or `render`) narrows the exit
  // code to one track's checks; with no flag, any failure is a failure.
  const tags = [...new Set(checks.map((c) => c.name.match(/^\[(\w+)\]/)?.[1] ?? 'other'))];
  console.log('');
  for (const tag of tags) {
    const mine = checks.filter((c) => c.name.startsWith(`[${tag}]`));
    const bad = mine.filter((c) => !c.pass);
    console.log(`  [${tag}]  ${mine.length - bad.length}/${mine.length} passed${bad.length ? `  — ${bad.length} FAILED` : ''}`);
  }

  console.log(`\nwrote ${join(OUT, 'board-viewport.json')} and ${results.length} screenshots`);
  if (failed.length) {
    console.log(`\n${failed.length} FAILED (first 40):`);
    for (const f of failed.slice(0, 40)) console.log(`  - ${f.name}  — ${f.detail}`);
    if (failed.length > 40) console.log(`  ... and ${failed.length - 40} more (all of them are in board-viewport.json)`);
  }
  const gating = require_
    ? failed.filter((f) => f.name.startsWith(`[${require_}]`))
    : failed;
  if (require_) console.log(`\n--require=${require_}: ${gating.length} gating failure(s)`);
  await browser.close();
  process.exit(gating.length ? 1 : 0);
} catch (err) {
  console.error(err);
  await browser.close();
  process.exit(2);
}
