// state/difficulty.js — a puzzle's difficulty score, memoised.
//
// OWNER: game-design track. This is the only place the game asks the solver "how hard
// is this one"; the unlock curve in state/unlock.js is expressed entirely in these
// numbers. Solver-side (`difficultyScore`) owns *what* the number measures — amount
// and depth of required reasoning — and this track owns the banding built on it.
//
// Cost: `solveLogical` is ~0.1–0.8ms per puzzle (measured, 3³ through 6³), so scoring
// a whole 24-puzzle catalogue is a couple of milliseconds. The memo exists because the
// level screen asks for every score on every repaint, not because one call is slow.

import { computeClues } from '../puzzle.js';
import { solutionFor } from '../levels.js';
import { difficultyScore, solveLogical } from '../solver.js';

const cache = new Map();

/** Difficulty score for a puzzle spec. Deterministic, so the memo never goes stale. */
export function difficultyFor(spec) {
  const hit = cache.get(spec.id);
  if (hit !== undefined) return hit;

  let score = 0;
  try {
    const cells = solutionFor(spec);
    const { stats } = solveLogical(spec.dims, computeClues(spec.dims, cells));
    score = difficultyScore(stats).score;
  } catch {
    // A puzzle the solver cannot read should never block progression — treat it as
    // weightless rather than letting it make a level impossible to finish.
    score = 0;
  }

  cache.set(spec.id, score);
  return score;
}

/** Test seam: forget memoised scores. */
export function resetDifficultyCache() {
  cache.clear();
}
