// tests/probe-peel-max.mjs — does DOO-36 move the number the playtest harness sizes its
// depth plan from? (report §33)
//
// Why this probe exists
// ---------------------
// `tests/playtest.mjs` builds its reachability sweep with
//
//     sweepPlan({ maxPeel: cursor0.max })        // playtest.mjs ~line 1191
//
// where `cursor0` is `window.__nonogram.peel()` read at the camera the puzzle opens on.
// Every `peel 1..max` step in the plan — the steps that reach the interior cells no
// camera move can see — exists only up to that number. Size it too small and cells the
// shipped game can reach are never aimed at; the run then reports them `stranded` and
// the puzzle as unfinishable, and the number is a harness artifact.
//
// `fde58be` (DOO-36) changed exactly that read. Before it, at depth 0, `state()` reported
// `axis`/`sign` left over from the previous puzzle and `max` off *that* axis; after it,
// both come from the face the camera is actually on. On a cube the two agree. On a
// non-cube box they need not, and the commit message claims 5 of the 14 box shapes in
// catalogue order were wrong.
//
// The 2026-10-07 playtest rail measured a tree *without* DOO-36. `master` has it. So the
// rail's 24/24 does not transfer to `master` by assumption — it transfers only if the
// depth plan is the same size or larger on `master` for all 24 puzzles. Larger is safe:
// the plan is a superset, so a cell reached before is still reached. Smaller is not, and
// those puzzles would have to be re-run.
//
// This probe answers that one question, with no assumption about which axis is which: it
// opens all 24 puzzles on both builds in one browser and reads the same field the harness
// reads, through the same menu walk, at the same settle.
//
// Usage
//   node tests/probe-peel-max.mjs <before-base-url> <after-base-url> [out.json] [--viewport=phone]
//
// `--viewport` matters: the number is read off the face the *camera* is on, and the two
// rails open on different viewports, so `desktop` and `phone` can disagree. Run both.
//
// Exits 1 if any puzzle's `max` shrinks (the unsafe direction) or if a read fails.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome } from '../scripts/cdp.mjs';

const [BEFORE, AFTER, OUT = 'qa-out/peel-max.json', ...flags] = process.argv.slice(2);

if (!BEFORE || !AFTER) {
  console.error('usage: node tests/probe-peel-max.mjs <before-url> <after-url> [out.json] [--viewport=id]');
  process.exit(2);
}

/** The two viewports the playtest rails run on, same numbers as `tests/playtest.mjs`. */
const VIEWPORTS = {
  desktop: { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false },
  phone: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true },
};
const viewportId = flags.find((f) => f.startsWith('--viewport='))?.slice(11) ?? 'desktop';
const viewport = VIEWPORTS[viewportId];
if (!viewport) {
  console.error(`unknown viewport ${viewportId} — one of ${Object.keys(VIEWPORTS).join(', ')}`);
  process.exit(2);
}

/** Seed every puzzle cleared so the level gates open — same expression playtest uses. */
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

/** Wait N animation frames in the page. Frames, not ms — see playtest.mjs `settleTaps`. */
const frames = (page, n) => page.evaluate(`new Promise((res) => {
  let left = ${n};
  const tick = () => (--left <= 0 ? res(${n}) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
})`);

/**
 * Walk the real menu to a puzzle, then read the depth cursor.
 *
 * `localStorage.removeItem` on the target only: every *other* puzzle stays cleared so the
 * level gate is open, and this one opens blank and playable. Same trick as `openPuzzle`.
 */
async function readAtOpen(page, entry) {
  await page.evaluate(`(() => {
    localStorage.removeItem('no-nonogram:' + ${JSON.stringify(entry.id)});
    const show = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    show('#levels-grid .level-card', ${entry.levelIndex});
    show('#puzzles-grid .puzzle-card', ${entry.puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(entry.id)}; })()`,
    { timeoutMs: 15_000 },
  );
  // 48 frames: the same settle `openPuzzle` uses, so the camera this reads is the camera
  // the harness reads.
  await frames(page, 48);
  return page.evaluate(`(() => {
    const p = window.__nonogram.peel();
    const s = typeof p.state === 'function' ? p.state() : p;
    return JSON.stringify({ depth: s.depth, axis: s.axis, sign: s.sign, max: s.max });
  })()`).then(JSON.parse);
}

/** Open every puzzle on one build and read the plan-sizing number off each. */
async function sweep(page, base, label) {
  await page.goto(base);
  await page.waitFor('!!window.__nonogram && !!window.__nonogram.levels', { timeoutMs: 30_000 });
  const seeded = await page.evaluate(SEED_ALL_CLEARED);
  await page.goto(base); // re-read storage with the seed in place
  await page.waitFor('!!window.__nonogram && !!window.__nonogram.levels', { timeoutMs: 30_000 });
  const catalogue = await page.evaluate(CATALOGUE);
  process.stdout.write(`\n=== ${label}  ${base}  (${seeded} seeded, ${catalogue.length} puzzles)\n`);
  const rows = [];
  for (const entry of catalogue) {
    const state = await readAtOpen(page, entry);
    rows.push({ ...entry, ...state });
    process.stdout.write(
      `  ${entry.id.padEnd(12)} ${entry.dims.x}x${entry.dims.y}x${entry.dims.z}` +
      `  axis=${state.axis} sign=${state.sign >= 0 ? '+' : '-'}  max=${state.max}` +
      `  -> ${2 * state.max} peel steps\n`,
    );
  }
  return rows;
}

const browser = await launchChrome({ windowSize: `${viewport.width},${viewport.height}` });
const page = await browser.newPage();
await page.emulate(viewport);
process.stdout.write(
  `viewport ${viewportId}  ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}` +
  `${viewport.mobile ? ' mobile' : ''}\n`,
);

try {
  const before = await sweep(page, BEFORE, 'before (no DOO-36)');
  const after = await sweep(page, AFTER, 'after (master, DOO-36)');

  const byId = new Map(after.map((r) => [r.id, r]));
  const rows = before.map((b) => {
    const a = byId.get(b.id);
    return {
      id: b.id,
      dims: b.dims,
      cube: b.dims.x === b.dims.y && b.dims.y === b.dims.z,
      before: { axis: b.axis, sign: b.sign, max: b.max },
      after: a ? { axis: a.axis, sign: a.sign, max: a.max } : null,
      axisChanged: a ? a.axis !== b.axis || a.sign !== b.sign : null,
      maxDelta: a ? a.max - b.max : null,
    };
  });

  const shrank = rows.filter((r) => r.maxDelta !== null && r.maxDelta < 0);
  const grew = rows.filter((r) => r.maxDelta !== null && r.maxDelta > 0);
  const axisMoved = rows.filter((r) => r.axisChanged);
  const missing = rows.filter((r) => !r.after);

  process.stdout.write('\n=== delta\n');
  for (const r of rows) {
    const tag = r.maxDelta === 0 ? (r.axisChanged ? 'axis only' : 'same') : (r.maxDelta > 0 ? 'GREW' : 'SHRANK');
    process.stdout.write(
      `  ${r.id.padEnd(12)} ${r.dims.x}x${r.dims.y}x${r.dims.z}${r.cube ? ' cube ' : '      '}` +
      `  ${r.before.axis}${r.before.sign >= 0 ? '+' : '-'}/${r.before.max}` +
      ` -> ${r.after?.axis}${r.after?.sign >= 0 ? '+' : '-'}/${r.after?.max}   ${tag}\n`,
    );
  }

  const errors = page.errors();
  const verdict = shrank.length === 0 && missing.length === 0;
  process.stdout.write(
    `\n${verdict ? 'ok  ' : 'FAIL'} depth plan on master is never smaller  — ` +
    `${rows.length} puzzles: ${grew.length} grew, ${shrank.length} shrank, ` +
    `${axisMoved.length} changed facing axis\n`,
  );
  if (errors.length) process.stdout.write(`  console errors: ${errors.length}\n${errors.join('\n')}\n`);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ before: BEFORE, after: AFTER, rows, consoleErrors: errors }, null, 2));
  process.stdout.write(`  wrote ${OUT}\n`);
  process.exitCode = verdict ? 0 : 1;
} finally {
  await browser.close();
}
