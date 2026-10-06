#!/usr/bin/env node
// shapes/report.mjs — print the solver's verdict and difficulty numbers for every
// shape in the catalogue, plus every puzzle the game currently ships.
//
//   node shapes/report.mjs              # the table
//   node shapes/report.mjs --repair     # also try to repair anything that fails
//   node shapes/report.mjs --ascii      # print each shape's slices too
//
// This is the authoring loop for DOO-4: write a shape, run this, read the score. The
// same verdicts are enforced in CI by tests/gate.test.js — this script only reports.

import { SHAPES } from './index.js';
import { shapeToAscii, shapeToSource } from './format.js';
import { validatePuzzle, repairShape } from '../solver.js';
import { LEVELS, solutionFor } from '../levels.js';

const args = new Set(process.argv.slice(2));
const wantRepair = args.has('--repair');
const wantAscii = args.has('--ascii');

const COLUMNS = [
  ['id', 16], ['dims', 9], ['lvl', 4], ['fill', 5], ['pass', 6],
  ['uniq', 6], ['noGuess', 8], ['steps', 6], ['waves', 6], ['defer', 7], ['score', 8], ['reason', 0],
];

function header() {
  return COLUMNS.map(([name, w]) => (w ? name.padEnd(w) : name)).join('');
}

function row(id, level, dims, v) {
  const d = v.difficulty;
  const cells = [
    id, `${dims.x}x${dims.y}x${dims.z}`, String(level), String(v.filled),
    String(v.pass), String(v.unique), String(v.noGuess),
    String(d.steps), String(d.rounds), String(d.deferredRatio), String(d.score), v.reason,
  ];
  return cells.map((c, i) => (COLUMNS[i][1] ? c.padEnd(COLUMNS[i][1]) : c)).join('');
}

function section(title) {
  console.log(`\n${title}\n${'='.repeat(title.length)}`);
  console.log(header());
}

let failures = 0;
const byLevel = new Map();

section('shapes/index.js');
const t0 = performance.now();
for (const shape of SHAPES) {
  const v = validatePuzzle(shape.dims, shape.cells);
  console.log(row(shape.id, shape.level, shape.dims, v));
  if (!byLevel.has(shape.level)) byLevel.set(shape.level, []);
  byLevel.get(shape.level).push(v.difficulty.score);

  if (wantAscii) console.log(shapeToAscii(shape.dims, shape.cells), '\n');

  if (!v.pass) {
    failures++;
    if (wantRepair) {
      const r = repairShape(shape.dims, shape.cells, { maxEdits: 4, beam: 16 });
      console.log(`  repair: ok=${r.ok} edits=${r.editCount} evaluated=${r.evaluated}`);
      if (r.ok) {
        console.log(`  repaired score=${r.validation.difficulty.score}`);
        console.log(shapeToSource(shape, r.cells).replace(/^/gm, '  '));
      }
    }
  }
}
const shapesMs = performance.now() - t0;

section('levels.js (shipped puzzles)');
const t1 = performance.now();
for (const level of LEVELS) {
  for (const spec of level.puzzles) {
    const v = validatePuzzle(spec.dims, solutionFor(spec));
    console.log(row(spec.id, level.id.replace('level-', ''), spec.dims, v));
    if (!v.pass) failures++;
  }
}
const levelsMs = performance.now() - t1;

console.log('\ndifficulty curve (mean score per level)');
for (const level of [...byLevel.keys()].sort()) {
  const scores = byLevel.get(level);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`  L${level}: ${avg.toFixed(1)}  (n=${scores.length}, ${scores.join(', ')})`);
}

console.log(`\nvalidated ${SHAPES.length} shapes in ${shapesMs.toFixed(1)}ms, ` +
  `${LEVELS.flatMap((l) => l.puzzles).length} shipped puzzles in ${levelsMs.toFixed(1)}ms`);
console.log(failures === 0 ? 'all clear' : `${failures} FAILING — these cannot be merged`);
process.exit(failures === 0 ? 0 : 1);
