// solver.test.js — correctness of the logic solver, cross-checked against brute force.
//
// The validator is the merge gate for every puzzle in the game, so "the solver looks
// right" is not good enough. If the solver is wrong, the gate either lets a
// multi-solution puzzle through or rejects a good shape, and both are silent failures
// in the shipped game. So both halves are diffed against exhaustive enumeration:
//
//   * the line reducer, against intersecting all 2^n arrangements of a line
//   * the solution counter and the validator, against *every* grid in a small box
//
// The box sweep is the strong one: for a box of N cells it groups all 2^N grids by
// their clue signature in a single pass, after which a grid's true solution count is
// just the size of its group. That turns "brute force one grid" from O(2^N) into O(1)
// and makes a complete sweep of a 65,536-grid box affordable in a unit test. Every
// grid gets checked, so there is nowhere for a bad verdict to hide.

import { describe, it, expect } from 'vitest';
import { computeClues, idx, mulberry32, generateSolution } from '../puzzle.js';
import {
  UNKNOWN, FILLED, EMPTY,
  LINE_CONTRADICTION, LINE_NO_CHANGE,
  OK, CONTRADICTION,
  solveLine, propagate, buildLines, cluesToBlocks,
  solveLogical, countSolutions, validatePuzzle, difficultyScore,
  repairShape, isConnected, coordsOf, sliceToAscii,
} from '../solver.js';

// --- brute-force references ---------------------------------------------------

function runsOf(bits) {
  const runs = [];
  let c = 0;
  for (const b of bits) { if (b) c++; else if (c) { runs.push(c); c = 0; } }
  if (c) runs.push(c);
  return runs;
}

/**
 * Exhaustively intersect every arrangement of `blocks` consistent with `state`.
 * Deliberately written as a dumb 2^n scan — it shares no code with solver.js.
 * @returns {null|{possFilled: boolean[], possEmpty: boolean[]}} null = contradiction
 */
function bruteLine(n, blocks, state) {
  const possFilled = new Array(n).fill(false);
  const possEmpty = new Array(n).fill(false);
  let any = false;

  for (let mask = 0; mask < 1 << n; mask++) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const bit = (mask >> i) & 1;
      if (state[i] === FILLED && !bit) ok = false;
      if (state[i] === EMPTY && bit) ok = false;
    }
    if (!ok) continue;

    // Walk the runs against `blocks` inline; allocating arrays here is what made an
    // earlier version of this file too slow to run.
    let run = 0;
    let b = 0;
    let bad = false;
    for (let i = 0; i < n && !bad; i++) {
      if ((mask >> i) & 1) run++;
      else if (run) {
        if (b >= blocks.length || blocks[b] !== run) bad = true;
        b++;
        run = 0;
      }
    }
    if (!bad && run) {
      if (b >= blocks.length || blocks[b] !== run) bad = true;
      else b++;
    }
    if (bad || b !== blocks.length) continue;

    any = true;
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) possFilled[i] = true;
      else possEmpty[i] = true;
    }
  }
  return any ? { possFilled, possEmpty } : null;
}

// Independent line enumeration — the same geometry buildLines() derives, written out
// longhand so the reference does not inherit a bug from the code under test.
function referenceLines(dims) {
  const out = [];
  for (let y = 0; y < dims.y; y++)
    for (let z = 0; z < dims.z; z++) {
      const line = [];
      for (let x = 0; x < dims.x; x++) line.push(idx(dims, x, y, z));
      out.push(line);
    }
  for (let x = 0; x < dims.x; x++)
    for (let z = 0; z < dims.z; z++) {
      const line = [];
      for (let y = 0; y < dims.y; y++) line.push(idx(dims, x, y, z));
      out.push(line);
    }
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++) {
      const line = [];
      for (let z = 0; z < dims.z; z++) line.push(idx(dims, x, y, z));
      out.push(line);
    }
  return out;
}

/**
 * Group every grid in the box by its clue signature. Two grids share a signature
 * exactly when they produce identical clues, so `groups.get(sigOf[mask])` is the true
 * number of solutions for the puzzle posed by grid `mask`.
 */
const sweepCache = new Map();
function exhaustiveSweep(dims) {
  const key = `${dims.x}x${dims.y}x${dims.z}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;

  const total = dims.x * dims.y * dims.z;
  if (total > 17) throw new Error(`exhaustiveSweep is 2^N; ${total} cells is too many for a unit test`);

  const lines = referenceLines(dims);
  const count = 2 ** total;
  const sigOf = new Array(count);
  const groups = new Map();

  for (let mask = 0; mask < count; mask++) {
    let sig = '';
    for (const line of lines) {
      let run = 0;
      for (const cell of line) {
        if ((mask >>> cell) & 1) run++;
        else if (run) { sig += `${run}.`; run = 0; }
      }
      if (run) sig += `${run}.`;
      sig += '|';
    }
    sigOf[mask] = sig;
    groups.set(sig, (groups.get(sig) ?? 0) + 1);
  }

  const built = { dims, total, count, sigOf, groups, solutionsFor: (mask) => groups.get(sigOf[mask]) };
  sweepCache.set(key, built);
  return built;
}

function cellsOf(total, mask) {
  const cells = new Uint8Array(total);
  for (let i = 0; i < total; i++) cells[i] = (mask >>> i) & 1;
  return cells;
}

function randomBlocks(rand, n) {
  // Derive blocks from a random bit pattern, so a valid arrangement always exists.
  const bits = [];
  for (let i = 0; i < n; i++) bits.push(rand() < 0.45 ? 1 : 0);
  return { blocks: runsOf(bits), bits };
}

// --- single-line solver -------------------------------------------------------

describe('solveLine', () => {
  it('fills the forced cells of a line that is fully determined by its clue', () => {
    const line = new Uint8Array([UNKNOWN, UNKNOWN, UNKNOWN]);
    expect(solveLine(line, 3, [3])).toBe(3);
    expect(Array.from(line)).toEqual([FILLED, FILLED, FILLED]);
  });

  it('empties a line whose clue is empty', () => {
    const line = new Uint8Array(4);
    expect(solveLine(line, 4, [])).toBe(4);
    expect(Array.from(line)).toEqual([EMPTY, EMPTY, EMPTY, EMPTY]);
  });

  it('finds the overlap of a block that cannot avoid the middle', () => {
    // A 3-block in a length-4 line always covers cells 1 and 2.
    const line = new Uint8Array(4);
    expect(solveLine(line, 4, [3])).toBe(2);
    expect(Array.from(line)).toEqual([UNKNOWN, FILLED, FILLED, UNKNOWN]);
  });

  it('leaves a genuinely ambiguous line alone', () => {
    const line = new Uint8Array(3);
    expect(solveLine(line, 3, [1])).toBe(LINE_NO_CHANGE);
    expect(Array.from(line)).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
  });

  it('reports a contradiction when the blocks cannot fit', () => {
    expect(solveLine(new Uint8Array(3), 3, [2, 2])).toBe(LINE_CONTRADICTION);
  });

  it('reports a contradiction when known cells rule out every arrangement', () => {
    const line = new Uint8Array([EMPTY, UNKNOWN, EMPTY]);
    expect(solveLine(line, 3, [2])).toBe(LINE_CONTRADICTION);
  });

  // The important ones: no hand-picked cases, just agreement with exhaustive search.
  // Mismatches are collected in plain JS and asserted once at the end — one expect()
  // per random case instead of one per cell keeps these fuzz runs fast enough to live
  // in the default `npm test`.
  it('agrees with exhaustive enumeration on 4000 random lines (reachable states)', () => {
    const rand = mulberry32(20260306);
    const problems = [];
    let determinations = 0;

    for (let t = 0; t < 4000; t++) {
      const n = 2 + Math.floor(rand() * 11); // 2..12
      const { blocks, bits } = randomBlocks(rand, n);

      // A partial state revealing a random subset of a genuinely valid arrangement:
      // always satisfiable, so any contradiction here would be a solver bug.
      const state = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (rand() < 0.35) state[i] = bits[i] ? FILLED : EMPTY;
      }

      const expected = bruteLine(n, blocks, state);
      const where = `n=${n} blocks=[${blocks}] state=[${state}]`;
      if (expected === null) { problems.push(`${where}: reference says unsatisfiable`); continue; }

      const got = state.slice();
      const res = solveLine(got, n, blocks);
      if (res === LINE_CONTRADICTION) { problems.push(`${where}: solveLine cried contradiction`); continue; }

      const want = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const canFill = expected.possFilled[i];
        const canEmpty = expected.possEmpty[i];
        want[i] = canFill && canEmpty ? state[i] : canFill ? FILLED : EMPTY;
        if (want[i] !== state[i]) determinations++;
      }
      if (String(got) !== String(want)) problems.push(`${where}: got [${got}] want [${want}]`);
    }

    expect(problems.slice(0, 5)).toEqual([]);
    // Sanity: the fuzz has to actually be deducing things, not comparing no-ops.
    expect(determinations).toBeGreaterThan(1000);
  });

  it('agrees with exhaustive enumeration on 4000 random lines (including unsatisfiable ones)', () => {
    const rand = mulberry32(777);
    const problems = [];
    let contradictions = 0;

    for (let t = 0; t < 4000; t++) {
      const n = 2 + Math.floor(rand() * 9); // 2..10
      const { blocks } = randomBlocks(rand, n);

      // Fully random state — frequently impossible, which is the point.
      const state = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const r = rand();
        state[i] = r < 0.25 ? FILLED : r < 0.5 ? EMPTY : UNKNOWN;
      }

      const expected = bruteLine(n, blocks, state);
      const got = state.slice();
      const res = solveLine(got, n, blocks);
      const where = `n=${n} blocks=[${blocks}] state=[${state}]`;

      if (expected === null) {
        if (res !== LINE_CONTRADICTION) problems.push(`${where}: missed a contradiction, got [${got}]`);
        contradictions++;
        continue;
      }
      if (res === LINE_CONTRADICTION) { problems.push(`${where}: false contradiction`); continue; }

      const want = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const canFill = expected.possFilled[i];
        const canEmpty = expected.possEmpty[i];
        want[i] = canFill && canEmpty ? state[i] : canFill ? FILLED : EMPTY;
      }
      if (String(got) !== String(want)) problems.push(`${where}: got [${got}] want [${want}]`);
    }

    expect(problems.slice(0, 5)).toEqual([]);
    // Both branches must be exercised or this test proves only half of what it claims.
    expect(contradictions).toBeGreaterThan(500);
    expect(contradictions).toBeLessThan(3500);
  });
});

// --- line geometry ------------------------------------------------------------

describe('buildLines', () => {
  it('produces one line per clue entry, in clue order', () => {
    const dims = { x: 2, y: 3, z: 4 };
    const { lines } = buildLines(dims);
    // x lines: y*z, y lines: x*z, z lines: x*y
    expect(lines.length).toBe(3 * 4 + 2 * 4 + 2 * 3);

    const cells = generateSolution(dims, 0.5, mulberry32(5));
    const clues = computeClues(dims, cells);
    const blocks = cluesToBlocks(dims, clues);

    // Every line's own cells must reproduce its own clue.
    lines.forEach((line, i) => {
      const bits = Array.from(line.indices, (c) => cells[c]);
      expect(runsOf(bits)).toEqual(blocks[i]);
    });
  });

  it('maps every cell to exactly one line per axis', () => {
    const dims = { x: 3, y: 2, z: 4 };
    const { lines, linesByCell, total } = buildLines(dims);
    expect(total).toBe(24);
    for (let cell = 0; cell < total; cell++) {
      const ids = [linesByCell[cell * 3], linesByCell[cell * 3 + 1], linesByCell[cell * 3 + 2]];
      expect(ids.every((id) => id >= 0)).toBe(true);
      expect(ids.map((id) => lines[id].axis)).toEqual(['x', 'y', 'z']);
      for (const id of ids) expect(Array.from(lines[id].indices)).toContain(cell);
    }
  });

  it('covers every cell of the box exactly once per axis', () => {
    const dims = { x: 4, y: 3, z: 2 };
    const { lines, total } = buildLines(dims);
    for (const axis of ['x', 'y', 'z']) {
      const seen = new Uint8Array(total);
      for (const line of lines.filter((l) => l.axis === axis)) {
        for (const cell of line.indices) {
          expect(seen[cell]).toBe(0);
          seen[cell] = 1;
        }
      }
      expect(Array.from(seen).every((v) => v === 1)).toBe(true);
    }
  });
});

// --- whole-grid propagation ---------------------------------------------------

describe('propagate / solveLogical', () => {
  it('solves a shape that is fully determined by its clues', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const cells = new Uint8Array(27);
    cells[idx(dims, 1, 1, 1)] = 1;
    const { grid, stats, complete } = solveLogical(dims, computeClues(dims, cells));

    expect(stats.status).toBe(OK);
    expect(complete).toBe(true);
    expect(stats.unknown).toBe(0);
    for (let i = 0; i < 27; i++) expect(grid[i]).toBe(cells[i] ? FILLED : EMPTY);
  });

  it('never contradicts itself on clues taken from a real grid', () => {
    const rand = mulberry32(31337);
    for (let t = 0; t < 300; t++) {
      const dims = {
        x: 2 + Math.floor(rand() * 5),
        y: 2 + Math.floor(rand() * 5),
        z: 2 + Math.floor(rand() * 5),
      };
      const cells = generateSolution(dims, 0.15 + rand() * 0.7, rand);
      const { grid, stats } = solveLogical(dims, computeClues(dims, cells));
      expect(stats.status).toBe(OK);
      // Soundness: every deduction must match the grid the clues came from.
      for (let i = 0; i < cells.length; i++) {
        if (grid[i] === UNKNOWN) continue;
        expect(grid[i]).toBe(cells[i] ? FILLED : EMPTY);
      }
    }
  });

  it('detects contradictory clues', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const clues = computeClues(dims, new Uint8Array(27)); // everything empty
    // Claim one x-line holds a block of 3 while all its cells are pinned empty by
    // the (still empty) y and z clues.
    clues.x[0][0] = [3];
    const { stats } = solveLogical(dims, clues);
    expect(stats.status).toBe(CONTRADICTION);
  });

  it('reaches the same fixpoint whichever lines are seeded dirty', () => {
    const dims = { x: 4, y: 3, z: 3 };
    const cells = generateSolution(dims, 0.4, mulberry32(99));
    const clues = computeClues(dims, cells);
    const blocks = cluesToBlocks(dims, clues);
    const { lines } = buildLines(dims);

    const full = new Uint8Array(cells.length);
    propagate(dims, blocks, full);

    // Seed with a single line and let it spread; the result can only be the same or less.
    const partial = new Uint8Array(cells.length);
    for (let i = 0; i < lines.length; i++) {
      propagate(dims, blocks, partial, { dirty: [i] });
    }
    propagate(dims, blocks, partial);
    expect(Array.from(partial)).toEqual(Array.from(full));
  });

  it('counts rounds as true synchronous waves', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const cells = new Uint8Array(27).fill(1);
    const { stats } = solveLogical(dims, computeClues(dims, cells));
    // A completely full cube is readable from any single line, so it is one wave.
    expect(stats.rounds).toBe(1);
    expect(stats.firstRoundDetermined).toBe(27);
    expect(stats.determined).toBe(27);
  });
});

// --- solution counting --------------------------------------------------------

describe('countSolutions', () => {
  it('stops at the requested limit', () => {
    const dims = { x: 2, y: 2, z: 2 };
    const cells = checkerboard(dims);
    const clues = computeClues(dims, cells);
    expect(countSolutions(dims, clues, 1).count).toBe(1);
    expect(countSolutions(dims, clues, 2).count).toBe(2);
    expect(countSolutions(dims, clues, 5).count).toBe(2); // only two exist
  });

  it('reports exhaustion rather than lying when the node budget runs out', () => {
    // An even-sided checkerboard stalls propagation completely, so counting it has to
    // branch. One node is not enough to get through that branch.
    const dims = { x: 4, y: 4, z: 4 };
    const clues = computeClues(dims, checkerboard(dims));

    const starved = countSolutions(dims, clues, 1000, { maxNodes: 1 });
    expect(starved.exhausted).toBe(true);
    expect(starved.count).toBeLessThan(2); // a lower bound, explicitly not trustworthy

    // With room to finish, the same call is exact.
    const complete = countSolutions(dims, clues, 1000);
    expect(complete.exhausted).toBe(false);
    expect(complete.count).toBe(2);
  });

  it('makes the validator fail safe when the search budget is exhausted', () => {
    const dims = { x: 4, y: 4, z: 4 };
    const v = validatePuzzle(dims, checkerboard(dims), { maxNodes: 1 });
    expect(v.pass).toBe(false);
    expect(v.unique).toBe(false); // never claim uniqueness off an incomplete search
    expect(v.reason).toBe('search-budget-exhausted');
  });
});

function checkerboard(dims) {
  const cells = new Uint8Array(dims.x * dims.y * dims.z);
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++)
        if ((x + y + z) % 2 === 0) cells[idx(dims, x, y, z)] = 1;
  return cells;
}

// --- the validator ------------------------------------------------------------

describe('validatePuzzle', () => {
  it('rejects the 2x2x2 checkerboard — the canonical 3D ambiguity', () => {
    // Every clue is [1], and the complementary checkerboard yields identical clues,
    // so no amount of logic can pick between them.
    const dims = { x: 2, y: 2, z: 2 };
    const v = validatePuzzle(dims, checkerboard(dims));
    expect(v.pass).toBe(false);
    expect(v.unique).toBe(false);
    expect(v.noGuess).toBe(false);
    expect(v.solutions).toBe(2);
    expect(v.reason).toBe('multiple-solutions');
    expect(v.unknown).toBe(8); // propagation learns nothing at all
  });

  it('accepts a shape that logic alone pins down', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const cells = new Uint8Array(27);
    for (const [x, y, z] of [[1, 1, 1], [0, 1, 1], [2, 1, 1], [1, 0, 1], [1, 2, 1], [1, 1, 0], [1, 1, 2]]) {
      cells[idx(dims, x, y, z)] = 1;
    }
    const v = validatePuzzle(dims, cells);
    expect(v.pass).toBe(true);
    expect(v.unique).toBe(true);
    expect(v.noGuess).toBe(true);
    expect(v.solutions).toBe(1);
    expect(v.filled).toBe(7);
  });

  it('throws when cells do not match dims', () => {
    expect(() => validatePuzzle({ x: 2, y: 2, z: 2 }, new Uint8Array(7))).toThrow(/does not match dims/);
  });

  it('fails a unique-but-unsolvable-by-logic shape as needs-guessing', () => {
    // Two stacked, mirrored 2x2 ambiguities in a 4x2x2 box. Exactly one global
    // solution exists, but every line is already individually reduced as far as it
    // goes, so propagation stalls with the whole board unknown. Found by exhaustively
    // classifying all 2^16 grids in this box — 10 of the 1,048,576 grids in 5x2x2 and
    // 2 of these 65,536 behave this way, and they must never pass the gate.
    //   z=0:  #..#     z=1:  .##.
    //         .##.           #..#
    const dims = { x: 4, y: 2, z: 2 };
    const cells = new Uint8Array(16);
    for (const [x, y, z] of [
      [0, 1, 0], [3, 1, 0], [1, 0, 0], [2, 0, 0],
      [1, 1, 1], [2, 1, 1], [0, 0, 1], [3, 0, 1],
    ]) cells[idx(dims, x, y, z)] = 1;

    const v = validatePuzzle(dims, cells);
    expect(v.noGuess).toBe(false);
    expect(v.unknown).toBe(16); // logic gets literally nowhere
    expect(v.unique).toBe(true);
    expect(v.solutions).toBe(1);
    expect(v.reason).toBe('needs-guessing');
    expect(v.pass).toBe(false); // unique is not enough — guessing is a fail

    // And uniqueness is not just our own search agreeing with itself.
    const sweep = exhaustiveSweep(dims);
    let mask = 0;
    for (let i = 0; i < 16; i++) if (cells[i]) mask |= 1 << i;
    expect(sweep.solutionsFor(mask)).toBe(1);
  });
});

// --- the strong one: every grid in a box, checked against brute force -----------

describe('exhaustive agreement with brute force', () => {
  // Each box is swept completely: for every single grid, the validator's verdict is
  // compared with the true solution count. These four boxes together cover 75,264
  // grids, including 206 genuinely ambiguous ones and the two unique-but-needs-a-guess
  // cases that only exist at 4x2x2 — the branch random sampling never reaches.
  const boxes = [
    { dims: { x: 2, y: 2, z: 2 }, expectMulti: 2, expectGuess: 0 },
    { dims: { x: 3, y: 2, z: 2 }, expectMulti: 36, expectGuess: 0 },
    { dims: { x: 2, y: 2, z: 3 }, expectMulti: 36, expectGuess: 0 },
    { dims: { x: 4, y: 2, z: 2 }, expectMulti: 166, expectGuess: 2 },
  ];

  it.each(boxes.map((b) => [`${b.dims.x}x${b.dims.y}x${b.dims.z}`, b]))(
    'every grid in %s gets the right verdict',
    (label, { dims, expectMulti, expectGuess }) => {
      const sweep = exhaustiveSweep(dims);
      const problems = [];
      let pass = 0;
      let multi = 0;
      let needsGuess = 0;

      // One expect() per 65,536-grid box rather than per grid; `problems` carries the
      // detail so a regression still names the exact grid that broke.
      for (let mask = 0; mask < sweep.count; mask++) {
        const cells = cellsOf(sweep.total, mask);
        const truth = sweep.solutionsFor(mask);
        const v = validatePuzzle(dims, cells);
        const ctx = `grid ${mask} [${Array.from(cells).join('')}] truth=${truth} verdict=${v.reason}`;

        if (v.reason === 'contradiction' || v.reason === 'unsound-deduction') {
          problems.push(`${ctx}: solver is unsound here`);
        } else if (v.reason === 'search-budget-exhausted') {
          problems.push(`${ctx}: ran out of search budget on a tiny box`);
        } else if (v.pass) {
          // Passing means "unique and reachable by logic" — uniqueness must hold.
          if (truth !== 1) problems.push(`${ctx}: passed the gate but has ${truth} solutions`);
          else if (!v.noGuess || v.unknown !== 0) problems.push(`${ctx}: passed without finishing the board`);
          pass++;
        } else if (truth > 1) {
          // counting stops at the limit of 2, so `solutions` is exactly 2 here
          if (v.reason !== 'multiple-solutions' || v.unique || v.solutions !== 2) {
            problems.push(`${ctx}: ambiguous grid misreported (unique=${v.unique} solutions=${v.solutions})`);
          }
          multi++;
        } else {
          // Unique, but propagation could not finish it: must be reported, not passed.
          if (v.reason !== 'needs-guessing' || !v.unique || v.solutions !== 1 || v.unknown === 0) {
            problems.push(`${ctx}: needs-guessing grid misreported (unique=${v.unique} unknown=${v.unknown})`);
          }
          needsGuess++;
        }
      }

      expect(problems.slice(0, 10)).toEqual([]);
      expect(pass + multi + needsGuess).toBe(sweep.count);
      // Pinned counts: a solver change that silently shifts the gate's behaviour on a
      // whole box shows up here as a number, not as a vague pass.
      expect(multi, `${label} ambiguous grids`).toBe(expectMulti);
      expect(needsGuess, `${label} unique-but-needs-guessing grids`).toBe(expectGuess);
    },
  );

  it('matches brute force on the raw solution count too, not just the verdict', () => {
    const dims = { x: 3, y: 2, z: 2 };
    const sweep = exhaustiveSweep(dims);
    const problems = [];
    let checked = 0;
    for (let mask = 0; mask < sweep.count; mask++) {
      const cells = cellsOf(sweep.total, mask);
      const truth = Math.min(sweep.solutionsFor(mask), 3);
      const got = countSolutions(dims, computeClues(dims, cells), 3);
      if (got.exhausted || got.count !== truth) {
        problems.push(`grid ${mask} [${Array.from(cells).join('')}]: counted ${got.count}, truth ${truth}`);
      }
      checked++;
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(checked).toBe(4096);
  });
});

// --- difficulty ---------------------------------------------------------------

describe('difficultyScore', () => {
  it('is zero for a puzzle that required no reasoning', () => {
    const d = difficultyScore({ steps: 0, rounds: 0, lineSolves: 0, determined: 0, firstRoundDetermined: 0 });
    expect(d.score).toBe(0);
  });

  it('grows with deduction count, chain depth, and deferred cells', () => {
    const base = { steps: 10, rounds: 1, lineSolves: 10, determined: 20, firstRoundDetermined: 20 };
    const moreSteps = difficultyScore({ ...base, steps: 20 });
    const deeper = difficultyScore({ ...base, rounds: 3 });
    const deferred = difficultyScore({ ...base, firstRoundDetermined: 5 });
    const b = difficultyScore(base);

    expect(b.deferredRatio).toBe(0);
    expect(moreSteps.score).toBeGreaterThan(b.score);
    expect(deeper.score).toBeGreaterThan(b.score);
    expect(deferred.score).toBeGreaterThan(b.score);
    expect(deferred.deferredRatio).toBeCloseTo(0.75, 3);
  });

  it('grows with box size for the same kind of shape', () => {
    // A solid cube of each level's size: identical reasoning, more of it.
    const scores = [3, 4, 5, 6].map((n) => {
      const dims = { x: n, y: n, z: n };
      const cells = new Uint8Array(n ** 3).fill(1);
      return validatePuzzle(dims, cells).difficulty.score;
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `score ${scores[i]} at n=${i + 3} must exceed ${scores[i - 1]}`).toBeGreaterThan(scores[i - 1]);
    }
  });
});

// --- shape repair -------------------------------------------------------------

describe('repairShape', () => {
  it('returns an already-valid shape untouched', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const cells = new Uint8Array(27);
    cells[idx(dims, 1, 1, 1)] = 1;
    const r = repairShape(dims, cells);
    expect(r.ok).toBe(true);
    expect(r.editCount).toBe(0);
    expect(Array.from(r.cells)).toEqual(Array.from(cells));
  });

  it('repairs the 2x2x2 checkerboard', () => {
    const dims = { x: 2, y: 2, z: 2 };
    const r = repairShape(dims, checkerboard(dims), { requireConnected: false, filledDelta: 2 });
    expect(r.ok).toBe(true);
    expect(r.editCount).toBeGreaterThan(0);
    expect(r.validation.pass).toBe(true);
    expect(r.validation.noGuess).toBe(true);
  });

  it('repairs multi-solution grids at every level size with few edits', () => {
    // Random fills are exactly what puzzle.js' generateSolution produces today, and a
    // few per cent of them are ambiguous — these are the ones the gate would reject.
    const sizes = [3, 4, 5, 6];
    let repaired = 0;

    for (const n of sizes) {
      const dims = { x: n, y: n, z: n };
      let found = false;
      for (let s = 1; s <= 400 && !found; s++) {
        const cells = generateSolution(dims, 0.3, mulberry32(s * 104729 + n));
        if (validatePuzzle(dims, cells).pass) continue;
        found = true;

        const r = repairShape(dims, cells, { maxEdits: 4, beam: 12, filledDelta: 4, requireConnected: false });
        expect(r.ok, `could not repair ${n}^3 seed ${s * 104729 + n}`).toBe(true);
        expect(r.editCount).toBeLessThanOrEqual(4);
        expect(r.validation.pass).toBe(true);
        expect(r.validation.noGuess).toBe(true);

        // Every reported edit must actually be present in the returned cells.
        for (const e of r.edits) expect(r.cells[e.index]).toBe(e.to);
        repaired++;
      }
      expect(found, `no ambiguous ${n}^3 grid found to repair`).toBe(true);
    }

    expect(repaired).toBe(sizes.length);
  });

  it('is deterministic', () => {
    const dims = { x: 4, y: 4, z: 4 };
    const cells = checkerboard(dims);
    const opts = { maxEdits: 2, beam: 8, requireConnected: false, filledDelta: 4 };
    const a = repairShape(dims, cells, opts);
    const b = repairShape(dims, cells, opts);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.edits).toEqual(b.edits);
    expect(a.evaluated).toBe(b.evaluated);
  });

  it('respects protected cells and the connectivity constraint', () => {
    const dims = { x: 3, y: 3, z: 3 };
    const cells = generateSolution(dims, 0.3, mulberry32(314190));
    expect(validatePuzzle(dims, cells).pass).toBe(false);

    const free = repairShape(dims, cells, { maxEdits: 2, requireConnected: false });
    expect(free.ok).toBe(true);

    const protect = free.edits.map((e) => e.index);
    const blocked = repairShape(dims, cells, { maxEdits: 2, requireConnected: false, protect });
    for (const e of blocked.edits) expect(protect).not.toContain(e.index);

    const connected = repairShape(dims, cells, { maxEdits: 3, requireConnected: true, filledDelta: 3 });
    if (connected.ok) expect(isConnected(dims, connected.cells)).toBe(true);
  });

  it('gives up honestly instead of returning a broken shape as ok', () => {
    const dims = { x: 2, y: 2, z: 2 };
    // maxEdits 0 leaves no room to change anything, and the input does not pass.
    const r = repairShape(dims, checkerboard(dims), { maxEdits: 0 });
    expect(r.ok).toBe(false);
    expect(r.validation.pass).toBe(false);
  });
});

// --- helpers ------------------------------------------------------------------

describe('coordsOf', () => {
  it('inverts idx for every cell of a non-cubic box', () => {
    const dims = { x: 4, y: 3, z: 5 };
    for (let x = 0; x < dims.x; x++)
      for (let y = 0; y < dims.y; y++)
        for (let z = 0; z < dims.z; z++) {
          expect(coordsOf(dims, idx(dims, x, y, z))).toEqual([x, y, z]);
        }
  });
});

describe('isConnected', () => {
  it('accepts face-connected shapes and rejects diagonal-only ones', () => {
    const dims = { x: 2, y: 2, z: 2 };
    const joined = new Uint8Array(8);
    joined[idx(dims, 0, 0, 0)] = 1;
    joined[idx(dims, 1, 0, 0)] = 1;
    expect(isConnected(dims, joined)).toBe(true);

    const diagonal = new Uint8Array(8);
    diagonal[idx(dims, 0, 0, 0)] = 1;
    diagonal[idx(dims, 1, 1, 0)] = 1;
    expect(isConnected(dims, diagonal)).toBe(false);

    expect(isConnected(dims, new Uint8Array(8))).toBe(false);
  });
});

describe('sliceToAscii', () => {
  it('prints a slice with y increasing upward', () => {
    const dims = { x: 2, y: 2, z: 1 };
    const cells = new Uint8Array(4);
    cells[idx(dims, 0, 1, 0)] = 1; // top-left
    expect(sliceToAscii(dims, cells, 0)).toBe('#.\n..');
  });
});
