#!/usr/bin/env node
// tests/thumb-dpr.mjs — the gate DOO-21 was filed for: **does a puzzle-card thumbnail
// get the pixels the display actually has?**
//
//   npm run build && npx vite preview --port 4473 --strictPort --host 127.0.0.1 &
//   node tests/thumb-dpr.mjs http://127.0.0.1:4473 qa-out/thumb [label]
//
// `label` only names the output files, so the same command can capture a before and an
// after without one overwriting the other.
//
// ## The defect
//
// `canvas.width` is the drawing buffer; the CSS box is separate. A 2D canvas is no
// different from WebGL here, which is why this is the same bug as DOO-19 (`#scene` left
// at 1x) in a second place. `ui/menu.js` set the buffer to `THUMB_SIZE` CSS pixels, so
// on a DPR-2 phone every thumbnail held a quarter of the pixels under it and on DPR 3 a
// ninth, with the compositor inventing the rest.
//
// ## Why a gate separate from board-viewport.mjs
//
// That file reads the *board's* geometry and runs a per-viewport tap raster to do it —
// minutes of work to answer a question about the play area. This one never opens a
// board. Bolting a menu-screen check onto a board gate would make the cheap check pay
// the expensive one's runtime and blur what either file fails for.
//
// ## The two numbers
//
// **backing / css** — `canvas.width` over `getBoundingClientRect().width`. The
// acceptance criterion itself: it must be `min(dpr, cap)`, not `dpr` (the cap is real —
// see SHIPPED_DPR_CAP) and not 1 (the bug).
//
// **Fringe share** — what the sharpness is actually worth, in pixels. The compositor
// stretches the buffer over the CSS box at the device ratio, so re-drawing the buffer
// into a canvas of exactly that device size runs the same bilinear filter and yields
// what the screen shows. A pixel is *fringe* if it is neither the voxel colour nor the
// background: a blend the upscale invented. A 1x buffer on a 3x screen has to invent 8
// of every 9 pixels; a buffer that matches the screen blends only where the drawing
// genuinely has an edge.
//
// It is read **against the 1x row**, not against a fixed percentage, because the raw
// share is a property of the drawing as much as of the buffer. DOO-24 grew the
// silhouette from 37% of the canvas to 74%, which put ~1.56x as much edge under the
// sampler on every viewport at once — including the 1x one, where there is no upscale to
// blame:
//
//   viewport     dpr     1x buffer   DOO-21     DOO-24     vs its own 1x row
//   iphone-se    2         16.82%     5.79%      8.69%     1.62x -> 0.56x -> 0.54x
//   galaxy-s     3         16.25%     8.92%     12.89%     1.56x -> 0.86x -> 0.79x
//   pixel        2.625     16.26%     9.14%     13.08%     1.56x -> 0.88x -> 0.81x
//   ipad         2         16.82%     5.79%      8.69%     1.62x -> 0.56x -> 0.54x
//   desktop      1         10.39%    10.39%     16.24%     the baseline itself
//
// The ratio is what the defect actually moves, and it moves it the other way: a matched
// buffer lands *below* its own 1x row (the same CSS-px edge is described by more samples,
// so a smaller share of device pixels is a blend at all), while the 1x-on-retina bug
// lands ~1.6x above it. A fixed ceiling could not tell DOO-24's bigger drawing apart from
// a lost buffer; this can, and it needs no recalibration the next time the art changes.
//
// What a ratio alone cannot see is a softening that is *uniform* across the rows, since
// that moves its own denominator. So the 1x row itself is held to one absolute band —
// MIN/MAX_BASELINE_FRINGE_PCT — and the retina rows to the ratio. Two readings, two
// different failures: "the reference drawing changed character" and "this buffer is
// smaller than its display".

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

// A cut of tests/board-viewport.mjs's matrix — the four retina devices plus the 1x
// desktop that proves the fix costs nothing where there is nothing to fix. Copied
// rather than imported: that file is a gate script whose module body runs the whole
// board sweep on import.
const VIEWPORTS = [
  { label: 'iphone-se', width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  { label: 'galaxy-s', width: 360, height: 740, deviceScaleFactor: 3, mobile: true },
  { label: 'pixel', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true },
  { label: 'ipad', width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  { label: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false },
];

// `MAX_PIXEL_RATIO` from render/scene.js, which `ui/menu.js` shares on purpose — one
// retina policy for the whole app. Hard-coded for the same reason
// tests/board-viewport.mjs hard-codes it: a gate that asks the app what ratio it chose
// cannot notice the cap being quietly changed.
const SHIPPED_DPR_CAP = 2;
// `scene.width` is a rounded getBoundingClientRect() against an integer buffer, so the
// two can disagree by a fraction of a pixel. 0.05 is 5x the slack needed and still
// fails a 1x buffer on every retina viewport by a factor of 20.
const DPR_TOLERANCE = 0.05;
// The fringe ceiling, as a share of the 1x row's fringe (see the table above). The worst
// measured pass is 0.81 (pixel, which still upscales 2x -> 2.625x); the defect sits at
// 1.56-1.62. 1.0 is the natural line between them — "no worse than the same drawing with
// nothing to upscale" — and leaves 23% of headroom over the worst pass. It is the backstop
// for a change that keeps the buffer size but loses the sharpness some other way; the
// backing/css ratio above is the primary assertion.
const MAX_FRINGE_VS_1X = 1.0;
// A blank canvas has no fringe at any ratio, which would pass the ratio check vacuously.
// The 1x baseline has to actually contain a drawing: antialiased isometric diagonals over
// most of a 100px card cannot come in under this.
const MIN_BASELINE_FRINGE_PCT = 5;
// The other end of the same band, and the one thing reading fringe as a ratio gave up.
// The denominator is measured in the same run, so a regression that softens the drawing
// *uniformly* — a shadowBlur, a mid-tone edge stroke, geometry landing on half-pixels —
// lifts every row together and the ratio shrugs. One absolute reading, on the 1x row
// only, keeps a tripwire on that without re-coupling the per-row checks to how large the
// silhouette happens to be. Measured on the real card by blurring it before the sampler:
//
//   sharp (DOO-24)   16.24%   1.00x
//   blur(0.5px)      24.06%   1.48x   passes — the band is coarse, and says so
//   blur(1px)        37.57%   2.31x   convicted
//   blur(1.5px)      46.56%   2.87x   convicted
//
// 30 sits above a silhouette that grows again — DOO-24 itself moved this row 10.39 ->
// 16.24, and another step of that size lands at ~25 — and below a softening bad enough to
// see. It catches the gross case, not a subtle one; the ratio and backing/css carry the
// per-row work. Raise it deliberately when the art changes, with the new reading in here.
const MAX_BASELINE_FRINGE_PCT = 30;

const BASE = process.argv[2] ?? 'http://127.0.0.1:4473';
const OUT = process.argv[3] ?? 'qa-out/thumb';
const LABEL = process.argv[4] ?? 'now';

mkdirSync(OUT, { recursive: true });

// Without a server on BASE the first `goto` lands on an error page, and the failure
// surfaces much later as `SecurityError: ... localStorage` — an opaque origin denying
// storage, which reads like a browser bug rather than "nothing is serving". Say it here.
const reachable = await fetch(`${BASE}/`, { method: 'GET' }).then(
  (r) => r.ok,
  () => false,
);
if (!reachable) {
  console.error(`nothing serving at ${BASE} — start one first:\n`);
  console.error(`  npx vite --port ${new URL(BASE).port} --strictPort --host 127.0.0.1 &\n`);
  process.exit(2);
}

const { check, report, checks } = checklist();

// The thumbnail previews the player's *progress*, not the answer, so a card with no
// saved progress is a blank cream square and says nothing about sharpness.
// `__nonogram.levels()` deliberately withholds the solutions, so seed a synthetic shape:
// a centred step pyramid, deterministic, filling most of the box, every tier an internal
// voxel edge — which is the detail a 1x buffer destroys and a matched buffer keeps.
const SEED = `(() => {
  const p = window.__nonogram.levels()[3].puzzles[0];
  const { x: dx, y: dy, z: dz } = p.dims;
  const state = new Array(dx * dy * dz).fill(0);
  for (let x = 0; x < dx; x++)
    for (let y = 0; y < dy; y++)
      for (let z = 0; z < dz; z++) {
        const inset = Math.max(Math.abs(x - (dx - 1) / 2), Math.abs(z - (dz - 1) / 2));
        if (y < dy - inset) state[(x * dy + y) * dz + z] = 1;
      }
  localStorage.setItem('no-nonogram:' + p.id, JSON.stringify({ state, solved: false }));
  return { id: p.id, dims: p.dims, filled: state.filter(Boolean).length, of: state.length };
})()`;

// Sampled inside an 8px inset so the gold frame is excluded. `drawThumb`'s two stroke
// widths are literals in buffer pixels, so the frame gets thinner as the ratio rises —
// a real effect, but a different one, and leaving it in would let "fewer frame pixels"
// masquerade as "less blur".
const FRINGE = `
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  function fringeShare(src, cssWidth) {
    const n = Math.round(cssWidth * devicePixelRatio);
    const dst = document.createElement('canvas');
    dst.width = dst.height = n;
    const c = dst.getContext('2d');
    c.drawImage(src, 0, 0, n, n);
    const inset = Math.round(8 * devicePixelRatio);
    const w = n - 2 * inset;
    const d = c.getImageData(inset, inset, w, w).data;
    const VOXEL = 36.6, BG = 221.6, TOL = 24;   // #2c2417, #ecdfc0, +-13% of the gap
    let fringe = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = luma(d, i);
      if (Math.abs(L - VOXEL) > TOL && Math.abs(L - BG) > TOL) fringe++;
    }
    return { pct: +(100 * fringe / (w * w)).toFixed(2), of: w * w };
  }

  // The same card with the defect put back: the buffer resampled down to the CSS size,
  // which is what \`canvas.width = THUMB_SIZE\` produced before DOO-21. Feeding that to
  // fringeShare upscales it to the device size exactly as the compositor would. Slightly
  // conservative — a native 100px render antialiases a touch harder than a downsample of
  // a 200px one — so if this still reads as a defect, the real one does too.
  function as1x(src, cssWidth) {
    const one = document.createElement('canvas');
    one.width = one.height = Math.round(cssWidth);
    one.getContext('2d').drawImage(src, 0, 0, one.width, one.height);
    return fringeShare(one, cssWidth);
  }
`;

// Walks the real menu — start, level 4, read the cards — so a card that renders only
// through some path this gate invents cannot pass.
const MEASURE = `(() => {
  ${FRINGE}
  document.getElementById('btn-start').click();
  document.querySelectorAll('#levels-grid .level-card')[3].click();
  const cards = [...document.querySelectorAll('.puzzle-card canvas')];
  if (!cards.length) throw new Error('no puzzle-card canvas on the level-4 screen');
  const t = cards[0];
  const r = t.getBoundingClientRect();
  return {
    cards: cards.length,
    css: +r.width.toFixed(1),
    cssH: +r.height.toFixed(1),
    backing: t.width,
    backingH: t.height,
    dpr: devicePixelRatio,
    // Every live thumbnail buffer. The grid is rebuilt per level, so this is the peak,
    // not a running total — the number that says whether the fix costs memory worth
    // arguing about on a low-end phone.
    bytes: cards.reduce((n, c) => n + c.width * c.height * 4, 0),
    box: { x: r.left, y: r.top, w: r.width, h: r.height },
    fringe: fringeShare(t, r.width),
    fringeAs1x: as1x(t, r.width),
  };
})()`;

const browser = await launchChrome({ offline: true, windowSize: '1280,900' });
const page = await browser.newPage();

const rows = [];
try {
  for (const vp of VIEWPORTS) {
    await page.emulate(vp);
    await page.goto(`${BASE}/`);
    await page.evaluate('localStorage.clear()');
    const seeded = await page.evaluate(SEED);
    await page.goto(`${BASE}/`);
    const m = await page.evaluate(MEASURE);
    await sleep(120);

    // 4x zoom on the first card: a crop at device scale would hide the very thing under
    // test, since the screenshot is already taken at `dpr`.
    const { data } = await page.call('Page.captureScreenshot', {
      format: 'png',
      clip: { x: m.box.x - 4, y: m.box.y - 4, width: m.box.w + 8, height: m.box.h + 8, scale: 4 },
      captureBeyondViewport: true,
    });
    writeFileSync(join(OUT, `${LABEL}-${vp.label}-thumb.png`), Buffer.from(data, 'base64'));

    const want = Math.min(vp.deviceScaleFactor, SHIPPED_DPR_CAP);
    const ratio = +(m.backing / m.css).toFixed(3);
    const detail = `backing ${m.backing} / css ${m.css} = ${ratio}, want ${want} (dpr ${m.dpr})`;

    check(`${vp.label}: thumbnail buffer is min(dpr, ${SHIPPED_DPR_CAP})x`, Math.abs(ratio - want) <= DPR_TOLERANCE, detail);
    check(`${vp.label}: CSS box unchanged at ${m.css}px square`, m.css === m.cssH && m.css === 100, `${m.css}x${m.cssH}`);
    check(`${vp.label}: buffer is square`, m.backing === m.backingH, `${m.backing}x${m.backingH}`);
    // The fringe assertions wait for the whole sweep: each one is read against the 1x
    // row, which is the last viewport in the matrix.

    rows.push({
      vp: vp.label, dpr: m.dpr, css: m.css, backing: m.backing, ratio, want,
      fringePct: m.fringe.pct, fringeAs1xPct: m.fringeAs1x.pct,
      kb: Math.round(m.bytes / 1024), cards: m.cards, seeded,
    });
  }

  // Fringe, now that the 1x row exists to read the retina rows against. Same drawing,
  // same sampler, same inset — the only difference between the rows is how many device
  // pixels the buffer brought, which is the whole question.
  const baseline = rows.find((r) => r.dpr === 1);
  check(
    `the 1x row is present and is a drawing — neither blank nor uniformly soft (${MIN_BASELINE_FRINGE_PCT}-${MAX_BASELINE_FRINGE_PCT}%)`,
    baseline !== undefined
      && baseline.fringePct >= MIN_BASELINE_FRINGE_PCT
      && baseline.fringePct <= MAX_BASELINE_FRINGE_PCT,
    baseline
      ? `${baseline.fringePct}% at 1x (band ${MIN_BASELINE_FRINGE_PCT}-${MAX_BASELINE_FRINGE_PCT}%)`
      : 'no 1x viewport in the matrix',
  );
  for (const r of rows) {
    // With no 1x row there is nothing to read a ratio against, and the check above has
    // already said so — don't pile a TypeError on top of its message.
    if (r.dpr === 1 || baseline === undefined) continue;
    const vs = +(r.fringePct / baseline.fringePct).toFixed(3);
    check(
      `${r.vp}: fringe no worse than the same card at 1x (<= ${MAX_FRINGE_VS_1X}x)`,
      vs <= MAX_FRINGE_VS_1X,
      `${r.fringePct}% vs ${baseline.fringePct}% at 1x = ${vs}x`,
    );
    // Guards the guard. Reading fringe as a ratio instead of a fixed percentage is only
    // worth doing if the ratio still convicts the defect — so put the defect back on this
    // very card and watch the same check reject it.
    const defect = +(r.fringeAs1xPct / baseline.fringePct).toFixed(3);
    check(
      `${r.vp}: and the check still convicts a 1x buffer on this card`,
      defect > MAX_FRINGE_VS_1X,
      `resampled to 1x: ${r.fringeAs1xPct}% = ${defect}x, over the ${MAX_FRINGE_VS_1X}x line`,
    );
  }

  // The matrix itself has to exercise the cap, or the first check degenerates into
  // "backing == css * dpr" and stops being able to see a cap regression at all.
  const dprs = [...new Set(VIEWPORTS.map((v) => v.deviceScaleFactor))].sort((a, b) => a - b);
  check('the matrix exercises the cap (some viewport has DPR > cap)', dprs.some((d) => d > SHIPPED_DPR_CAP), `DPRs: ${dprs.join(', ')}`);
  check('the matrix covers 1x, where the fix must be a no-op', dprs.includes(1), `DPRs: ${dprs.join(', ')}`);
} finally {
  await browser.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n[${LABEL}] level 4, first card, ${rows[0]?.cards ?? 0} thumbnails live\n`);
console.log(`${pad('viewport', 16)}${pad('dpr', 8)}${pad('css', 7)}${pad('backing', 10)}${pad('backing/css', 13)}${pad('fringe', 10)}${pad('vs 1x', 9)}all buffers`);
const base1x = rows.find((r) => r.dpr === 1)?.fringePct;
for (const r of rows) {
  const vs = r.dpr === 1 || !base1x ? '—' : `${(r.fringePct / base1x).toFixed(2)}x`;
  console.log(
    `${pad(r.vp, 16)}${pad(r.dpr, 8)}${pad(r.css, 7)}${pad(r.backing, 10)}${pad(r.ratio, 13)}${pad(`${r.fringePct}%`, 10)}${pad(vs, 9)}${r.kb} KB`,
  );
}

const failed = report();
writeFileSync(join(OUT, `${LABEL}-thumb.json`), JSON.stringify({ rows, checks }, null, 2));
console.log(`\nwrote ${join(OUT, `${LABEL}-thumb.json`)} and ${rows.length} crops`);
process.exit(failed.length ? 1 : 0);
