// shapes.gate.test.js — THE MERGE GATE.
//
// Every shape in shapes/index.js must be a puzzle you can finish by pure logic, with
// exactly one answer. A shape that needs a guess, or that has a second solution, fails
// here and cannot be merged. This is the structural reason the "24 hand-made shapes,
// all proven unique" line in the definition of done cannot quietly rot.
//
// When a shape fails, the message prints its slices and the solver's verdict so whoever
// is authoring it can see which part of the board logic could not reach — then run it
// through `repairShape` to get a minimal fix.

import { describe, it, expect } from 'vitest';
import { LEVEL_BOX as SHAPE_LEVEL_BOX, SHAPES, shapesByLevel } from '../shapes/index.js';
import { validatePuzzle, UNKNOWN, solveLogical } from '../solver.js';
import { shapeToAscii } from '../shapes/format.js';
import { idx } from '../puzzle.js';
import { LEVELS, solutionFor } from '../levels.js';

// The difficulty curve is L1 3³ -> L2 4³ -> L3 5³ -> L4 6³, with non-cubic boxes
// allowed as variants inside a level. A level's budget is therefore its longest edge:
// a 5×4×3 box is a level-3 shape even though it holds fewer cells than a 4³ one.
// Imported rather than redeclared so the gate and the catalogue cannot disagree.
const LEVEL_BOX = SHAPE_LEVEL_BOX;

// The definition of done: 24 shapes over 4 levels.
const EXPECTED_SHAPES = 24;
const EXPECTED_LEVELS = [1, 2, 3, 4];
const PER_LEVEL = EXPECTED_SHAPES / EXPECTED_LEVELS.length;

const scoreOf = (shape) => validatePuzzle(shape.dims, shape.cells).difficulty;
const isCube = (d) => d.x === d.y && d.y === d.z;

function describeFailure(shape, v) {
  const { grid } = solveLogical(shape.dims, v.clues);
  const stuck = [];
  for (let i = 0; i < grid.length && stuck.length < 12; i++) if (grid[i] === UNKNOWN) stuck.push(i);
  return [
    `shape "${shape.id}" (${shape.name}) failed the gate: ${v.reason}`,
    `  dims=${shape.dims.x}x${shape.dims.y}x${shape.dims.z} filled=${v.filled}`,
    `  unique=${v.unique} noGuess=${v.noGuess} solutions=${v.solutions} unknownCells=${v.unknown}`,
    `  first undecided cell indices: ${stuck.join(', ')}`,
    shapeToAscii(shape.dims, shape.cells),
  ].join('\n');
}

describe('shape catalogue gate', () => {
  it('has shapes to check', () => {
    expect(SHAPES.length).toBeGreaterThan(0);
  });

  it('has no duplicate ids', () => {
    const ids = SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate shapes', () => {
    const seen = new Map();
    for (const s of SHAPES) {
      const key = `${s.dims.x}x${s.dims.y}x${s.dims.z}:${s.cells.join('')}`;
      expect(seen.has(key), `${s.id} is the same voxel shape as ${seen.get(key)}`).toBe(false);
      seen.set(key, s.id);
    }
  });

  it.each(SHAPES.map((s) => [s.id, s]))('%s is uniquely solvable without guessing', (_id, shape) => {
    const v = validatePuzzle(shape.dims, shape.cells);
    expect(v.pass, describeFailure(shape, v)).toBe(true);
    expect(v.unique).toBe(true);
    expect(v.noGuess).toBe(true);
    expect(v.solutions).toBe(1);
    expect(v.unknown).toBe(0);
  });

  it.each(SHAPES.map((s) => [s.id, s]))('%s round-trips through the slice format', (_id, shape) => {
    // Guards against a shape whose `cells` and printed slices have drifted apart —
    // the renderer and the clue panel both read `cells`, humans read the slices.
    const { dims, cells, slices } = shape;
    expect(slices.length).toBe(dims.z);
    expect(slices[0].length).toBe(dims.y);
    expect(slices[0][0].length).toBe(dims.x);
    for (let z = 0; z < dims.z; z++)
      for (let y = 0; y < dims.y; y++)
        for (let x = 0; x < dims.x; x++)
          expect(cells[idx(dims, x, y, z)]).toBe(slices[z][dims.y - 1 - y][x] === '#' ? 1 : 0);
  });

  it.each(SHAPES.map((s) => [s.id, s]))('%s fits inside its level box', (_id, shape) => {
    const box = LEVEL_BOX[shape.level];
    expect(box, `shape ${shape.id} has unknown level ${shape.level}`).toBeDefined();
    for (const axis of ['x', 'y', 'z']) {
      expect(
        shape.dims[axis],
        `${shape.id} is level ${shape.level} (box ${box}) but ${axis}=${shape.dims[axis]} — ` +
          `move it to level ${Object.keys(LEVEL_BOX).find((l) => LEVEL_BOX[l] >= shape.dims[axis]) ?? '?'}`,
      ).toBeLessThanOrEqual(box);
    }
  });

  it.each(SHAPES.map((s) => [s.id, s]))('%s is not trivially empty or solid', (_id, shape) => {
    const total = shape.dims.x * shape.dims.y * shape.dims.z;
    const v = validatePuzzle(shape.dims, shape.cells);
    expect(v.filled).toBeGreaterThan(total * 0.05);
    expect(v.filled).toBeLessThan(total * 0.95);
  });
});

// The catalogue the game actually ships. Since DOO-4 this is the same 24 hand-authored
// shapes, reached through levels.js rather than from shapes/index.js directly — so this
// block is what proves the *seam* is sound, not just the shape data. A `solutionFor`
// that drifts back to generating grids, or a spec wired to the wrong shape, fails here:
// the seeded random generator it replaced could not guarantee uniqueness (roughly 1% of
// random grids at these sizes have a second solution — exhaustively measured, 2,616 of
// the 262,144 grids in a 3x3x2 box).
describe('shipped puzzle catalogue gate', () => {
  const allPuzzles = LEVELS.flatMap((level) => level.puzzles.map((spec) => [spec.id, spec]));

  it('ships every catalogue shape, and nothing else', () => {
    expect(allPuzzles.length).toBe(SHAPES.length);
    expect(allPuzzles.map(([id]) => id).sort()).toEqual(SHAPES.map((s) => s.id).sort());
  });

  it('gives every shipped puzzle the name the celebration needs', () => {
    // state/shape-name.js reads `spec.name` first; without it the clear screen falls
    // back to the puzzle id, which is not something to show a player.
    for (const [id, spec] of allPuzzles) {
      expect(spec.name, `${id} has no name`).toBeTruthy();
      expect(spec.name, `${id} is still named after its id`).not.toBe(spec.id);
    }
  });

  it('hands out a copy, so a session cannot corrupt the catalogue', () => {
    const [, spec] = allPuzzles[0];
    const first = solutionFor(spec);
    first[0] ^= 1;
    expect(Array.from(solutionFor(spec))).toEqual(Array.from(spec.cells));
  });

  it.each(allPuzzles)('%s is uniquely solvable without guessing', (_id, spec) => {
    const cells = solutionFor(spec);
    const v = validatePuzzle(spec.dims, cells);
    const message = [
      `puzzle "${spec.id}" (${spec.name}) failed the gate: ${v.reason}`,
      `  dims=${spec.dims.x}x${spec.dims.y}x${spec.dims.z} filled=${v.filled}`,
      `  unique=${v.unique} noGuess=${v.noGuess} solutions=${v.solutions} unknownCells=${v.unknown}`,
      '  fix: repair the shape in shapes/index.js — see `node shapes/report.mjs --repair`.',
    ].join('\n');
    expect(v.pass, message).toBe(true);
  });

  it('validates the whole shipped catalogue in milliseconds', () => {
    const t0 = performance.now();
    for (const [, spec] of allPuzzles) validatePuzzle(spec.dims, solutionFor(spec));
    const ms = performance.now() - t0;
    expect(ms, `catalogue validation took ${ms.toFixed(1)}ms`).toBeLessThan(2000);
  });
});

// The shape of the catalogue itself — "24 hand-made shapes over 4 levels, covering
// 3³/4³/5³/6³ plus non-cubic variants" is the definition of done, so it is a test.
describe('catalogue composition', () => {
  it(`holds exactly ${EXPECTED_SHAPES} shapes, ${PER_LEVEL} per level`, () => {
    expect(SHAPES.length).toBe(EXPECTED_SHAPES);
    for (const level of EXPECTED_LEVELS) {
      const n = shapesByLevel(level).length;
      expect(n, `L${level} has ${n} shapes, expected ${PER_LEVEL}`).toBe(PER_LEVEL);
    }
  });

  it('gives every shape a human name distinct from its id', () => {
    for (const shape of SHAPES) {
      expect(shape.name, `${shape.id} has no name`).toBeTruthy();
      expect(shape.name, `${shape.id} is still named after its id`).not.toBe(shape.id);
    }
    const names = SHAPES.map((s) => s.name);
    expect(new Set(names).size, `duplicate names: ${names.join(', ')}`).toBe(names.length);
  });

  it.each(EXPECTED_LEVELS)('L%i covers its full cube and at least one non-cubic box', (level) => {
    const box = LEVEL_BOX[level];
    const shapes = shapesByLevel(level);
    const cubes = shapes.filter((s) => isCube(s.dims) && s.dims.x === box);
    const others = shapes.filter((s) => !isCube(s.dims));
    expect(cubes.length, `L${level} has no ${box}³ shape`).toBeGreaterThan(0);
    expect(others.length, `L${level} has no non-cubic variant`).toBeGreaterThan(0);
  });

  it('reaches the level box on some axis in every level', () => {
    // Guards the curve from the other side: a level whose shapes all sit well inside
    // their box is really the previous level wearing a bigger label.
    for (const level of EXPECTED_LEVELS) {
      const box = LEVEL_BOX[level];
      const longest = Math.max(...shapesByLevel(level).map((s) => Math.max(s.dims.x, s.dims.y, s.dims.z)));
      expect(longest, `L${level}'s biggest box is ${longest}, expected ${box}`).toBe(box);
    }
  });

  it('leaves no z-plane of a shape completely empty', () => {
    // A shape padded out with blank slices is a flat relief in a bigger box, not a
    // 3D shape — the player would be deducing emptiness, not a silhouette.
    for (const shape of SHAPES) {
      for (let z = 0; z < shape.dims.z; z++) {
        let filled = 0;
        for (let x = 0; x < shape.dims.x; x++)
          for (let y = 0; y < shape.dims.y; y++) filled += shape.cells[idx(shape.dims, x, y, z)];
        expect(filled, `${shape.id} slice z=${z} is empty:\n${shapeToAscii(shape.dims, shape.cells)}`)
          .toBeGreaterThan(0);
      }
    }
  });
});

describe('difficulty curve', () => {
  // Measured once; every assertion below reads these.
  const byLevel = EXPECTED_LEVELS.filter((l) => shapesByLevel(l).length > 0).map((level) => {
    const d = shapesByLevel(level).map(scoreOf);
    const scores = d.map((x) => x.score);
    const waves = d.map((x) => x.rounds);
    const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
    return {
      level, scores, waves,
      avg: mean(scores), min: Math.min(...scores), max: Math.max(...scores),
      avgWaves: mean(waves),
    };
  });

  it('reports a score for every shape', () => {
    for (const shape of SHAPES) {
      const d = scoreOf(shape);
      expect(d.score).toBeGreaterThan(0);
      expect(d.steps).toBeGreaterThan(0);
      expect(d.rounds).toBeGreaterThanOrEqual(1);
    }
  });

  // Three separate monotonicity claims. The mean is the one DOO-4 promises; min and max
  // moving together are what stop a level from being "harder on average" only because
  // one monster shape drags the mean up.
  it.each(['avg', 'min', 'max'])('has a monotonically increasing %s score per level', (key) => {
    for (let i = 1; i < byLevel.length; i++) {
      const prev = byLevel[i - 1];
      const cur = byLevel[i];
      expect(
        cur[key],
        `L${cur.level} ${key} ${cur[key].toFixed(1)} (${cur.scores}) must exceed ` +
          `L${prev.level} ${key} ${prev[key].toFixed(1)} (${prev.scores})`,
      ).toBeGreaterThan(prev[key]);
    }
  });

  it('deepens the reasoning, not just the board size', () => {
    // Score grows with board size on its own, so a curve can be monotone while every
    // puzzle stays a one-glance read. Mean waves rising is the claim that later levels
    // actually require chained cross-axis deduction.
    for (let i = 1; i < byLevel.length; i++) {
      const prev = byLevel[i - 1];
      const cur = byLevel[i];
      expect(
        cur.avgWaves,
        `L${cur.level} mean waves ${cur.avgWaves.toFixed(2)} (${cur.waves}) must exceed ` +
          `L${prev.level} mean waves ${prev.avgWaves.toFixed(2)} (${prev.waves})`,
      ).toBeGreaterThan(prev.avgWaves);
    }
  });

  it('orders each level easiest-first — catalogue order is play order', () => {
    for (const level of EXPECTED_LEVELS) {
      const shapes = shapesByLevel(level);
      const scores = shapes.map((s) => scoreOf(s).score);
      for (let i = 1; i < scores.length; i++) {
        expect(
          scores[i],
          `L${level} is out of order at ${shapes[i].id}: ${scores.join(' -> ')} — ` +
            'reorder SHAPES so the level reads easiest-first',
        ).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    }
  });

  it('keeps level 1 shallow — one wave of reasoning, no chaining', () => {
    for (const shape of shapesByLevel(1)) {
      const d = scoreOf(shape);
      expect(d.rounds, `${shape.id} needs ${d.rounds} waves; level 1 should read off the clues`).toBeLessThanOrEqual(2);
    }
  });
});

describe('gate performance', () => {
  it('validates the whole catalogue well inside a CI budget', () => {
    const t0 = performance.now();
    for (const shape of SHAPES) validatePuzzle(shape.dims, shape.cells);
    const ms = performance.now() - t0;
    // Measured at ~4ms for the seed set on an M-series laptop; 2s leaves enormous head
    // room for the full 24 and for slower CI hardware, while still catching a solver
    // change that makes the gate exponential.
    expect(ms, `catalogue validation took ${ms.toFixed(1)}ms`).toBeLessThan(2000);
  });

  it('validates a 6x6x6 shape in milliseconds', () => {
    const l4 = SHAPES.filter((s) => Math.max(s.dims.x, s.dims.y, s.dims.z) === 6);
    expect(l4.length).toBeGreaterThan(0);
    for (const shape of l4) {
      const t0 = performance.now();
      const v = validatePuzzle(shape.dims, shape.cells);
      const ms = performance.now() - t0;
      expect(v.pass).toBe(true);
      expect(ms, `${shape.id} took ${ms.toFixed(1)}ms`).toBeLessThan(500);
    }
  });
});
