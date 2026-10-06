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
import { SHAPES, shapesByLevel } from '../shapes/index.js';
import { validatePuzzle, UNKNOWN, solveLogical } from '../solver.js';
import { shapeToAscii } from '../shapes/format.js';
import { idx } from '../puzzle.js';
import { LEVELS, solutionFor } from '../levels.js';

// The difficulty curve is L1 3³ -> L2 4³ -> L3 5³ -> L4 6³, with non-cubic boxes
// allowed as variants inside a level. A level's budget is therefore its longest edge:
// a 5×4×3 box is a level-3 shape even though it holds fewer cells than a 4³ one.
const LEVEL_BOX = { 1: 3, 2: 4, 3: 5, 4: 6 };

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

// The catalogue the game actually ships. Today `solutionFor` is still the seeded
// random generator, which does NOT guarantee uniqueness — roughly 1% of random grids
// at these sizes have a second solution (exhaustively measured: 2,616 of the 262,144
// grids in a 3x3x2 box). All 12 current seeds happen to be clean, and this gate is
// what keeps it that way: add a puzzle whose seed lands on an ambiguous grid, or swap
// in a hand-authored shape that is not uniquely solvable, and CI stops you here.
describe('shipped puzzle catalogue gate', () => {
  const allPuzzles = LEVELS.flatMap((level) => level.puzzles.map((spec) => [spec.id, spec]));

  it('has puzzles to check', () => {
    expect(allPuzzles.length).toBeGreaterThan(0);
  });

  it.each(allPuzzles)('%s is uniquely solvable without guessing', (_id, spec) => {
    const cells = solutionFor(spec);
    const v = validatePuzzle(spec.dims, cells);
    const message = [
      `puzzle "${spec.id}" (seed ${spec.seed}) failed the gate: ${v.reason}`,
      `  dims=${spec.dims.x}x${spec.dims.y}x${spec.dims.z} filled=${v.filled}`,
      `  unique=${v.unique} noGuess=${v.noGuess} solutions=${v.solutions} unknownCells=${v.unknown}`,
      '  fix: change the seed, or replace this entry with a hand-authored shape from shapes/.',
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

describe('difficulty curve', () => {
  it('reports a score for every shape', () => {
    for (const shape of SHAPES) {
      const d = validatePuzzle(shape.dims, shape.cells).difficulty;
      expect(d.score).toBeGreaterThan(0);
      expect(d.steps).toBeGreaterThan(0);
      expect(d.rounds).toBeGreaterThanOrEqual(1);
    }
  });

  it('increases monotonically from level to level', () => {
    const levels = [1, 2, 3, 4].filter((l) => shapesByLevel(l).length > 0);
    const averages = levels.map((level) => {
      const scores = shapesByLevel(level).map((s) => validatePuzzle(s.dims, s.cells).difficulty.score);
      return { level, avg: scores.reduce((a, b) => a + b, 0) / scores.length, scores };
    });

    for (let i = 1; i < averages.length; i++) {
      const prev = averages[i - 1];
      const cur = averages[i];
      expect(
        cur.avg,
        `L${cur.level} average ${cur.avg.toFixed(1)} (${cur.scores}) must exceed ` +
          `L${prev.level} average ${prev.avg.toFixed(1)} (${prev.scores})`,
      ).toBeGreaterThan(prev.avg);
    }
  });

  it('keeps level 1 shallow — one wave of reasoning, no chaining', () => {
    for (const shape of shapesByLevel(1)) {
      const d = validatePuzzle(shape.dims, shape.cells).difficulty;
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
