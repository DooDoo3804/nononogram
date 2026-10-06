// scripts/aim-compare.mjs — read two `tests/playtest.mjs reach` runs and diff them.
//
//   node scripts/aim-compare.mjs <beforeDir> <afterDir> [--puzzles=l4-cat,…]
//
// DOO-17 asked for the fix measured before and after **with QA's own harness**, on the
// same basis. `reach` writes one record per box size (`reach-desktop.json`): the cheapest
// interaction cost at which each cell of that box first became clickable, and the cell's
// aperture at the angle where it is widest. This script does no measuring of its own — it
// only reads those two files, re-indexes them by puzzle (a puzzle's required cells are
// the subset of its box the answer asks the player to fill), and prints the diff.
//
// Reading it per puzzle matters because the box-level number flatters the problem: a 6³
// box has 216 cells and 91 of them are clickable as it opens, but `l4-cat` only needs
// 112 — and which 112 decides whether the puzzle is playable, not how many of the 216
// happen to be reachable.
//
// Aperture areas are quantized to `rasterStep²` px² (the harness records the step it
// used), so the script refuses to compare two runs taken at different steps.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS, solutionFor } from '../levels.js';

const MOUSE_PX2 = 24 * 24; //  576
const FINGER_PX2 = 44 * 44; // 1936

const [BEFORE, AFTER, ...flags] = process.argv.slice(2);
if (!BEFORE || !AFTER) throw new Error('usage: aim-compare.mjs <beforeDir> <afterDir> [--puzzles=…] [--platform=desktop]');
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const platform = flag('platform', 'desktop');
const only = flag('puzzles', '') ? new Set(flag('puzzles', '').split(',')) : null;

const load = (dir) => JSON.parse(readFileSync(join(dir, `reach-${platform}.json`), 'utf8'));
const before = load(BEFORE);
const after = load(AFTER);

const dimsKey = (d) => `${d.x}x${d.y}x${d.z}`;
const pct = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '—');
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

/** The required cells of every catalogued puzzle, by id. */
const requiredCells = new Map();
for (const level of LEVELS) {
  for (const spec of level.puzzles) {
    const solution = solutionFor(spec);
    requiredCells.set(spec.id, {
      spec,
      cells: [...solution].map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
    });
  }
}

/** Per-cell aperture in CSS px², and cheapest cost, for one box record. */
function cellView(record) {
  const step = record.rasterStep;
  const area = new Map();
  for (const [cell, b] of Object.entries(record.pixelByCell)) area.set(Number(cell), b.samples * step * step);
  const cost = new Map(Object.entries(record.cheapestCost).map(([c, v]) => [Number(c), v]));
  return { area, cost, step };
}

function statsFor(record, cells) {
  const { area, cost } = cellView(record);
  const reached = cells.filter((c) => cost.has(c));
  const areas = reached.map((c) => area.get(c) ?? 0);
  return {
    required: cells.length,
    reached: reached.length,
    unreachable: cells.filter((c) => !cost.has(c)),
    byCost: [0, 1, 2, 3].map((k) => reached.filter((c) => cost.get(c) === k).length),
    min: areas.length ? Math.min(...areas) : 0,
    median: median(areas),
    underMouse: areas.filter((a) => a < MOUSE_PX2).length,
    underFinger: areas.filter((a) => a < FINGER_PX2).length,
  };
}

const keys = Object.keys(before).filter((k) => k in after);
for (const k of keys) {
  if (before[k].rasterStep !== after[k].rasterStep) {
    throw new Error(`${k}: raster step differs (${before[k].rasterStep} vs ${after[k].rasterStep}) — not the same basis`);
  }
}

// `pixelByCell`/`cheapestCost` are the camera-only half of the sweep (`reach` keeps the
// depth-cursor band in a separate `cursor` block for exactly this reason), so these rows
// compare like with like across runs taken before and after the cursor shipped.
console.log(`\n=== box level — every cell of the box, best angle of the camera sweep (${platform}) ===\n`);
console.log('dims     cells  reached        cost0        aperture min      median        <24px        <44px');
for (const k of keys) {
  const b = before[k];
  const a = after[k];
  const row = (label, x) =>
    `${label.padEnd(8)} ${String(x.total).padStart(5)}  ${String(x.reached).padStart(3)}/${x.total}  ` +
    `cost0=${String(x.byCost[0]).padStart(3)}  min=${String(x.aperture.min).padStart(5)}  ` +
    `med=${String(x.aperture.median).padStart(6)}  <24px=${String(x.aperture.underMouse24).padStart(3)}  ` +
    `<44px=${String(x.aperture.underFinger44).padStart(3)}`;
  console.log(row(k, b), ' BEFORE');
  console.log(row(k, a), ' AFTER');
  const same =
    b.reached === a.reached &&
    b.byCost[0] === a.byCost[0] &&
    b.aperture.underMouse24 === a.aperture.underMouse24;
  console.log(`         ${same ? 'identical on the counts that gate' : 'CHANGED'}`);

  // Run-to-run noise, measured rather than assumed. This used to be the floor under
  // every other number here: a sweep step rastered 420ms after its camera move, damping
  // settles in frames rather than time, and a loaded machine therefore rastered a camera
  // that had not finished moving — 19 of 32 steps disagreed between two runs of the same
  // build, by up to 29 cells (DOO-31). The harness now waits for the camera to converge
  // and counts in frames, so this line is a regression guard rather than a caveat. It
  // stays printed: "the two runs agree" is only worth anything if it is measured.
  const bs = new Map(b.perStep.map((s) => [s.name, s]));
  const diffs = a.perStep
    .map((s) => ({ name: s.name, delta: s.cells - (bs.get(s.name)?.cells ?? s.cells) }))
    .filter((d) => d.delta !== 0);
  const worst = [...diffs].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 3);
  console.log(
    `         per-step raster noise: ${diffs.length}/${a.perStep.length} steps differ` +
      (worst.length ? `  worst ${worst.map((d) => `${d.name} ${d.delta > 0 ? '+' : ''}${d.delta}`).join(', ')}` : ''),
  );
  // Per-cell aperture agreement at the cells that gate: how many cross the mouse floor
  // in one run and not the other.
  const bv = cellView(b).area;
  const av = cellView(a).area;
  const flipped = [...bv.keys()].filter((c) => (bv.get(c) < MOUSE_PX2) !== ((av.get(c) ?? 0) < MOUSE_PX2));
  console.log(`         cells that cross the 576px² floor in one run only: ${flipped.length}\n`);
}

console.log(`\n=== puzzle level — only the cells the answer requires ===\n`);
for (const [id, { spec, cells }] of requiredCells) {
  if (only && !only.has(id)) continue;
  const k = dimsKey(spec.dims);
  if (!(k in before) || !(k in after)) continue;
  const b = statsFor(before[k], cells);
  const a = statsFor(after[k], cells);
  console.log(`${id}  ${k}  required ${b.required}`);
  for (const [label, s] of [['BEFORE', b], ['AFTER ', a]]) {
    console.log(
      `  ${label}  reached ${String(s.reached).padStart(3)}/${s.required}  ` +
        `cost[0/1/2/3]=${s.byCost.join('/')}  min=${String(s.min).padStart(5)}px²  ` +
        `med=${String(s.median).padStart(6)}px²  <24px=${String(s.underMouse).padStart(3)} (${pct(s.underMouse, s.reached)})  ` +
        `<44px=${String(s.underFinger).padStart(3)}  unreachable=${s.unreachable.length ? s.unreachable.join(' ') : '—'}`,
    );
  }
  console.log('');
}

// --- the union: camera OR cursor ---------------------------------------------
// DOO-17's bar is "every cell the answer requires is a 24x24 target at *some* angle".
// Two measurements cover two disjoint halves of that and neither covers it alone:
//
//   the reach sweep   35 camera angles, no cursor      — best for outer-shell cells,
//                                                        blind to interior ones
//   probe-aim         cursor depths, camera never moves — best for interior cells,
//                                                        cannot widen a front-face cell
//
// A player has both, so the bar is met if the *larger* of the two clears the floor. Any
// cell that clears neither is named, because that is the only honest way to report it.
const aimPath = flag('aim', '');
if (aimPath) {
  const aim = JSON.parse(readFileSync(aimPath, 'utf8'));
  console.log('\n=== union — the better of (35-angle camera, no cursor) and (cursor, camera fixed) ===\n');
  for (const [id, { spec, cells }] of requiredCells) {
    const probe = aim.results?.[id] ?? aim[id];
    if (!probe) continue;
    const k = dimsKey(spec.dims);
    if (!(k in after)) continue;
    if (probe.rasterStep !== after[k].rasterStep) {
      throw new Error(`${id}: raster step ${probe.rasterStep} vs ${after[k].rasterStep} — not comparable`);
    }
    const camera = cellView(after[k]).area;
    const cursor = new Map(Object.entries(probe.bestByCell).map(([c, [area]]) => [Number(c), area]));
    const rows = cells.map((c) => ({
      cell: c,
      camera: camera.get(c) ?? 0,
      cursor: cursor.get(c) ?? 0,
      best: Math.max(camera.get(c) ?? 0, cursor.get(c) ?? 0),
    }));
    const below = rows.filter((r) => r.best < MOUSE_PX2);
    const cameraOnly = rows.filter((r) => r.camera < MOUSE_PX2).length;
    const cursorOnly = rows.filter((r) => r.cursor < MOUSE_PX2).length;
    console.log(
      `${id.padEnd(11)} ${k}  required ${String(cells.length).padStart(3)}  ` +
        `<24px: camera-only ${String(cameraOnly).padStart(3)}  cursor-only ${String(cursorOnly).padStart(3)}  ` +
        `union ${String(below.length).padStart(3)}  union min ${Math.min(...rows.map((r) => r.best))}px²`,
    );
    if (below.length) {
      console.log(
        `            below the floor with both: ` +
          below.map((r) => `cell ${r.cell} (camera ${r.camera}, cursor ${r.cursor})`).join(', '),
      );
    }
  }
  console.log('');
}
