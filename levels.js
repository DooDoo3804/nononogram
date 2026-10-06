// levels.js — the puzzle catalog.
//
// OWNER: puzzle-design track. This file is the single seam between "which puzzles
// exist" and the rest of the app: nothing outside it knows how a solution is
// produced.
//
// As of DOO-4 it produces nothing. Every puzzle is one of the 24 hand-authored voxel
// shapes in shapes/index.js, so `solutionFor` is a lookup, not a generator. The seeded
// random generator that used to live here (`generateSolution` + `mulberry32`, still in
// puzzle.js for the tests that cover them) could not guarantee a unique solution —
// roughly 1% of random grids at these sizes have a second one. The catalogue can,
// because tests/gate.test.js proves it for all 24 on every run.
//
// Levels come straight from the shapes' own `level` field, and the puzzle order inside
// a level is the catalogue order, which is ascending difficulty. Puzzle id == shape id.
//
// Public API (unchanged):
//   LEVELS            -> [{ id, name, level, box, puzzles: [spec] }]
//   solutionFor(spec) -> Uint8Array   (length dims.x*dims.y*dims.z, values 0|1)
//   cellCount(dims)   -> number
//   findLevel(id) / findPuzzle(id)
//
// A spec is { id, name, level, dims, cells, tags }. `name` is the shape's Korean name,
// which state/shape-name.js uses for the clear celebration; `cells` is what
// `solutionFor` hands out.

import { LEVEL_BOX, LEVELS_PRESENT, SHAPES } from './shapes/index.js';

export const LEVELS = LEVELS_PRESENT.map((level) => ({
  id: `level-${level}`,
  name: `Level ${level}`,
  level,
  // The level's box budget: its longest allowed edge. Non-cubic boxes are the variants
  // inside a level, so a 5x4x3 puzzle is level 3 even though a 4x4x4 one holds more.
  box: LEVEL_BOX[level],
  puzzles: SHAPES.filter((shape) => shape.level === level).map((shape) => ({
    id: shape.id,
    name: shape.name,
    level: shape.level,
    dims: shape.dims,
    cells: shape.cells,
    tags: shape.tags,
  })),
}));

export const cellCount = (dims) => dims.x * dims.y * dims.z;

/**
 * The hidden shape for a puzzle spec. Deterministic: same spec -> same cells.
 *
 * Returns a copy, so a session that writes into its `solution` — or anything else
 * downstream — cannot corrupt the shared catalogue. The arrays are at most 216 bytes.
 */
export function solutionFor(spec) {
  return Uint8Array.from(spec.cells);
}

export function findLevel(levelId) {
  return LEVELS.find((level) => level.id === levelId) ?? null;
}

export function findPuzzle(puzzleId) {
  for (const level of LEVELS) {
    const spec = level.puzzles.find((p) => p.id === puzzleId);
    if (spec) return { level, spec };
  }
  return null;
}
