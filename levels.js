// levels.js — the puzzle catalog.
//
// OWNER: puzzle-design track. This file is the single seam between "which puzzles
// exist" and the rest of the app: nothing outside it knows how a solution is
// produced. Replacing the seeded random generator with hand-authored voxel shapes
// means rewriting `solutionFor` (and the puzzle specs) and touching nothing else.
//
// Public API:
//   LEVELS            -> [{ id, name, puzzles: [{ id, dims, seed }] }]
//   solutionFor(spec) -> Uint8Array   (length dims.x*dims.y*dims.z, values 0|1)
//   cellCount(dims)   -> number
//   findLevel(id) / findPuzzle(id)

import { generateSolution, mulberry32 } from './puzzle.js';

// Probability the original (pre-handcrafted) generator fills a cell. Kept here
// rather than inlined so the puzzle track has one number to delete.
const FILL_PROBABILITY = 0.45;

// For now every puzzle lives under Level 1 — add more levels/puzzles here later.
// Each puzzle has a fixed seed so its solution (and therefore its saved progress)
// stays stable.
export const LEVELS = [
  {
    id: 'level-1',
    name: 'Level 1',
    puzzles: [
      { id: 'l1-1', dims: { x: 3, y: 3, z: 3 }, seed: 101 },
      { id: 'l1-2', dims: { x: 3, y: 3, z: 3 }, seed: 202 },
      { id: 'l1-3', dims: { x: 4, y: 3, z: 3 }, seed: 303 },
      { id: 'l1-4', dims: { x: 4, y: 4, z: 3 }, seed: 404 },
      { id: 'l1-5', dims: { x: 4, y: 4, z: 4 }, seed: 505 },
      { id: 'l1-6', dims: { x: 5, y: 4, z: 3 }, seed: 606 },
      { id: 'l1-7', dims: { x: 3, y: 4, z: 3 }, seed: 707 },
      { id: 'l1-8', dims: { x: 5, y: 3, z: 3 }, seed: 808 },
      { id: 'l1-9', dims: { x: 3, y: 5, z: 4 }, seed: 909 },
      { id: 'l1-10', dims: { x: 5, y: 5, z: 3 }, seed: 1010 },
      { id: 'l1-11', dims: { x: 4, y: 5, z: 4 }, seed: 1111 },
      { id: 'l1-12', dims: { x: 5, y: 5, z: 4 }, seed: 1212 },
    ],
  },
];

export const cellCount = (dims) => dims.x * dims.y * dims.z;

/** The hidden shape for a puzzle spec. Deterministic: same spec -> same cells. */
export function solutionFor(spec) {
  return generateSolution(spec.dims, FILL_PROBABILITY, mulberry32(spec.seed));
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
