// state/hints.js — the staged hint, built on the solver's public API.
//
// OWNER: game-design track. DOM- and THREE-free; `fx/` turns what this returns into a
// highlight and a banner. Nothing here modifies solver.js — the whole engine is
// `buildLines` + `cluesToBlocks` + `solveLine`, which is exactly the "read one line and
// see what follows" primitive the validator already exports.
//
// ## Two stages, escalating
//
//   1. 라인 공개 — name the line that pure single-line reasoning can advance *right
//      now*, with its clue, and say how many cells it settles. The deduction is still
//      yours to make.
//   2. 셀 확정 — put one of that line's deduced cells on the board for real.
//
// Pressing hint again on an unchanged board escalates 1 -> 2. Any board change resets
// to stage 1, because the right line to look at has probably moved.
//
// ## Cost
//
//   stage 1 (nudge)  1 point
//   stage 2 (answer) 2 points
//
// A nudge narrows 150-odd candidate lines down to one and leaves the reasoning with the
// player; an answer hands over a result that took a full line-solve to produce, and it
// also removes a cell from the puzzle permanently. Two-to-one keeps the cheap hint the
// habit and the expensive one a decision. Both the point total and the raw use count
// are recorded, so "used 3 hints" and "spent 5 points" stay separately legible.
//
// ## Why the player's board is filtered before propagation
//
// A board can contain *wrong* assertions, and feeding those to a line solver returns
// LINE_CONTRADICTION — a hint engine that fails exactly when the player is most stuck
// is useless. So the grid handed to the solver keeps only assertions that agree with
// the solution. Lines where the player went wrong are then *preferred* as hint targets:
// being told to re-read the line you have broken is the most valuable nudge there is.
//
// Public API — createHints({ session }) returns:
//   .next()      -> hint | null      advance the staircase and apply stage 2
//   .peek()      -> stage number the next press would give (1 or 2)
//   .uses() .points()
//   .reset()
//
// A hint is { stage: 1|2, cost, points, uses, line, clue, gains, cells, applied }
//   .line  { id, axis, a, b, indices }      — stage 1 highlight target
//   .clue  number[]                          — that line's run lengths
//   .cells [{ i, value, x, y, z }]           — what the line settles (solver values)
//   .applied { i, value, x, y, z } | null    — the cell stage 2 actually placed

import {
  EMPTY,
  FILLED as SOLVER_FILLED,
  LINE_CONTRADICTION,
  UNKNOWN,
  buildLines,
  cluesToBlocks,
  coordsOf,
  solveLine,
} from '../solver.js';
import { FILLED, MARKED } from './cells.js';

export const HINT_COST = Object.freeze({ 1: 1, 2: 2 });

/** Solver value -> the board state that expresses it. EMPTY becomes the player's mark. */
const boardValueFor = (solverValue) => (solverValue === SOLVER_FILLED ? FILLED : MARKED);

export function createHints({ session, onSpend } = {}) {
  const { dims, solution, state } = session;
  const { lines } = buildLines(dims);
  const blocks = cluesToBlocks(dims, session.clues);

  // coordsOf returns [x, y, z]; hints travel out as named fields for the banner.
  const at = (i) => {
    const [x, y, z] = coordsOf(dims, i);
    return { x, y, z };
  };

  let stage = 0;
  let signature = null;
  let uses = 0;
  let points = 0;

  /** Cheap board fingerprint — only has to change when the board does. */
  function boardSignature() {
    let h = 2166136261;
    for (let i = 0; i < state.length; i++) {
      h ^= state[i] + i;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * The player's board as solver values, with every wrong assertion dropped so
   * propagation cannot hit a contradiction. Also reports which cells were dropped.
   */
  function trustedGrid() {
    const grid = new Uint8Array(state.length);
    const wrong = new Set();
    for (let i = 0; i < state.length; i++) {
      const filled = !!solution[i];
      if (state[i] === FILLED) {
        if (filled) grid[i] = SOLVER_FILLED;
        else wrong.add(i);
      } else if (state[i] === MARKED) {
        if (!filled) grid[i] = EMPTY;
        else wrong.add(i);
      }
    }
    return { grid, wrong };
  }

  /**
   * Every line single-line reasoning can still advance, best first.
   * Ranked by: contains a wrong assertion, then cells settled, then line id.
   */
  function candidates() {
    const { grid, wrong } = trustedGrid();
    const buf = new Uint8Array(Math.max(dims.x, dims.y, dims.z));
    const found = [];

    for (const line of lines) {
      const { indices, n, id } = line;
      for (let t = 0; t < n; t++) buf[t] = grid[indices[t]];

      const changed = solveLine(buf, n, blocks[id]);
      if (changed === LINE_CONTRADICTION || changed <= 0) continue;

      const cells = [];
      let hasWrong = false;
      for (let t = 0; t < n; t++) {
        const i = indices[t];
        if (wrong.has(i)) hasWrong = true;
        if (grid[i] === UNKNOWN && buf[t] !== UNKNOWN) {
          cells.push({ i, value: buf[t], ...at(i) });
        }
      }
      if (cells.length === 0) continue;
      found.push({ line, clue: blocks[id], gains: cells.length, cells, hasWrong });
    }

    found.sort(
      (p, q) =>
        Number(q.hasWrong) - Number(p.hasWrong) || q.gains - p.gains || p.line.id - q.line.id,
    );
    return found;
  }

  /**
   * Last resort: a puzzle that needs guessing can saturate every line with the board
   * still unfinished. Reveal straight from the solution rather than refusing to help.
   */
  function fallbackCell() {
    // A wrong fill first: it is the thing actively keeping the puzzle unsolved.
    for (let i = 0; i < state.length; i++) {
      if (!solution[i] && state[i] === FILLED) return { i, value: EMPTY, ...at(i) };
    }
    for (let i = 0; i < state.length; i++) {
      if (solution[i] && state[i] !== FILLED) return { i, value: SOLVER_FILLED, ...at(i) };
    }
    return null;
  }

  function spend(cost) {
    uses += 1;
    points += cost;
    onSpend?.({ cost, uses, points });
  }

  function next() {
    if (session.solved) return null;

    const sig = boardSignature();
    if (sig !== signature) stage = 0;
    stage = Math.min(stage + 1, 2);
    signature = sig;

    const ranked = candidates();
    const best = ranked[0];

    if (!best) {
      const cell = fallbackCell();
      if (!cell) return null;
      stage = 2;
      const cost = HINT_COST[2];
      spend(cost);
      session.set(cell.i, boardValueFor(cell.value));
      signature = boardSignature();
      return {
        stage: 2,
        cost,
        points,
        uses,
        line: null,
        clue: null,
        gains: 1,
        cells: [cell],
        applied: cell,
      };
    }

    const base = {
      cost: HINT_COST[stage],
      line: {
        id: best.line.id,
        axis: best.line.axis,
        a: best.line.a,
        b: best.line.b,
        indices: Array.from(best.line.indices),
      },
      clue: [...best.clue],
      gains: best.gains,
      cells: best.cells,
    };

    if (stage === 1) {
      spend(base.cost);
      return { stage: 1, ...base, points, uses, applied: null };
    }

    // Lowest index first, so repeated stage-2 presses walk the line in a stable order.
    const cell = best.cells.reduce((lo, c) => (c.i < lo.i ? c : lo), best.cells[0]);
    spend(base.cost);
    session.set(cell.i, boardValueFor(cell.value));
    signature = boardSignature();
    return { stage: 2, ...base, points, uses, applied: cell };
  }

  return {
    next,
    peek: () => (boardSignature() === signature ? Math.min(stage + 1, 2) : 1),
    uses: () => uses,
    points: () => points,
    reset() {
      stage = 0;
      signature = null;
    },
  };
}
