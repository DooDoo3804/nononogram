// solver.js — constraint-propagation logic solver, uniqueness/no-guess validator,
// difficulty scoring, and an automatic shape-repair loop. Pure logic, no DOM.
//
// The whole module works on a flat Uint8Array over the dims box (same layout and the
// same `idx` as puzzle.js) where every cell is one of UNKNOWN / FILLED / EMPTY.
// Those numbers deliberately match main.js's BLANK/FILLED/MARKED board encoding, so a
// player's board can be fed straight into `propagate` for a hint without translation.

import { computeClues, idx } from './puzzle.js';

export const UNKNOWN = 0;
export const FILLED = 1;
export const EMPTY = 2;

const AXES = ['x', 'y', 'z'];

// --- line geometry ------------------------------------------------------------

// Every line of the box, in a fixed order (x lines, then y, then z), plus a reverse
// index from cell -> the three lines through it. Built once per dims and cached,
// because the validator re-solves the same box hundreds of times during a repair run.
const lineCache = new Map();

export function buildLines(dims) {
  const key = `${dims.x}x${dims.y}x${dims.z}`;
  const hit = lineCache.get(key);
  if (hit) return hit;

  const lines = [];
  // Line ordering per axis mirrors computeClues' grid layout: outer index = a, inner = b.
  const otherDims = { x: [dims.y, dims.z], y: [dims.x, dims.z], z: [dims.x, dims.y] };

  for (const axis of AXES) {
    const [na, nb] = otherDims[axis];
    const n = dims[axis];
    for (let a = 0; a < na; a++) {
      for (let b = 0; b < nb; b++) {
        const indices = new Int32Array(n);
        for (let i = 0; i < n; i++) {
          const [x, y, z] = axis === 'x' ? [i, a, b] : axis === 'y' ? [a, i, b] : [a, b, i];
          indices[i] = idx(dims, x, y, z);
        }
        lines.push({ id: lines.length, axis, a, b, n, indices });
      }
    }
  }

  // linesByCell[cell] = [xLineId, yLineId, zLineId]
  const total = dims.x * dims.y * dims.z;
  const linesByCell = new Int32Array(total * 3).fill(-1);
  const slot = { x: 0, y: 1, z: 2 };
  for (const line of lines) {
    for (const cell of line.indices) linesByCell[cell * 3 + slot[line.axis]] = line.id;
  }

  const built = { dims, lines, linesByCell, total };
  lineCache.set(key, built);
  return built;
}

// clues[axis][a][b] in puzzle.js' format; [0] means "line is empty".
export function cluesToBlocks(dims, clues) {
  const { lines } = buildLines(dims);
  return lines.map((line) => {
    const runs = clues[line.axis][line.a][line.b];
    return runs.filter((r) => r > 0);
  });
}

// --- single-line solver -------------------------------------------------------
// For one line, intersect *all* arrangements of its blocks that are consistent with
// what is already known. A cell that is FILLED in every arrangement is FILLED; a cell
// that is EMPTY in every arrangement is EMPTY. No arrangement at all = contradiction.
//
// Done with a two-pass DP over states (i, j) = "at cell i, blocks j.. still to place":
//   1. `feasible(i, j)` — memoised, can the rest of the line be completed from here
//   2. a forward walk over states that are both reachable from (0,0) and feasible,
//      marking which values each cell takes on at least one surviving arrangement
// That is O(n·k) states, so a 6-long line is a handful of table lookups.

export const LINE_NO_CHANGE = 0;
export const LINE_CONTRADICTION = -1;

// Scratch buffers, grown on demand and reused. Line solving is the hot loop — a 6³
// validation runs it a few hundred times and a repair run tens of thousands of times,
// so allocating these per call is the difference between a millisecond and a second.
const scratch = {
  n: 0,
  k: 0,
  memo: new Int8Array(0),
  seen: new Uint8Array(0),
  possFilled: new Uint8Array(0),
  possEmpty: new Uint8Array(0),
  filledSuffix: new Uint8Array(0),
  emptyPrefix: new Int32Array(0),
  stack: new Int32Array(0),
};

function ensureScratch(n, k) {
  if (n > scratch.n) {
    scratch.n = n;
    scratch.possFilled = new Uint8Array(n);
    scratch.possEmpty = new Uint8Array(n);
    scratch.filledSuffix = new Uint8Array(n + 1);
    scratch.emptyPrefix = new Int32Array(n + 2);
    scratch.k = -1; // the (n,k)-sized tables below depend on n, so re-grow them too
  }
  if (k > scratch.k) {
    scratch.k = k;
    // States are (i, j) for i in 0..n+1 and j in 0..k. Each state is pushed onto the
    // stack at most once (the `seen` table guarantees it) as a pair, hence 2x.
    const states = (scratch.n + 2) * (k + 1);
    scratch.memo = new Int8Array(states);
    scratch.seen = new Uint8Array(states);
    scratch.stack = new Int32Array(states * 2);
  }
}

/**
 * Reduce one line in place.
 * @param {Uint8Array} line  length-n view of cell states (mutated)
 * @param {number} n         line length
 * @param {number[]} blocks  run lengths, zeros already stripped
 * @returns {number} cells newly determined, 0 if nothing changed, -1 on contradiction
 */
export function solveLine(line, n, blocks) {
  const k = blocks.length;
  ensureScratch(n, k);

  const { memo, seen, possFilled, possEmpty, filledSuffix, emptyPrefix, stack } = scratch;
  const stride = k + 1;

  // Cheap rejection: the blocks plus their mandatory single-cell gaps must fit.
  let need = k > 0 ? k - 1 : 0;
  for (let j = 0; j < k; j++) need += blocks[j];
  if (need > n) return LINE_CONTRADICTION;

  filledSuffix[n] = 0;
  for (let i = n - 1; i >= 0; i--) filledSuffix[i] = line[i] === FILLED || filledSuffix[i + 1] ? 1 : 0;
  emptyPrefix[0] = 0;
  for (let i = 0; i < n; i++) emptyPrefix[i + 1] = emptyPrefix[i] + (line[i] === EMPTY ? 1 : 0);

  const states = (n + 2) * stride;
  memo.fill(-1, 0, states);
  seen.fill(0, 0, states);
  possFilled.fill(0, 0, n);
  possEmpty.fill(0, 0, n);

  // Can blocks j..k-1 be laid out over cells i..n-1?
  const feasible = (i, j) => {
    if (i >= n) return j === k;
    if (j === k) return !filledSuffix[i];
    const at = i * stride + j;
    if (memo[at] !== -1) return memo[at] === 1;
    // Both recursive calls below strictly increase i, so the DP is acyclic and needs
    // no in-progress guard.
    let ok = line[i] !== FILLED && feasible(i + 1, j);
    if (!ok) {
      const b = blocks[j];
      const end = i + b;
      if (
        end <= n &&
        emptyPrefix[end] - emptyPrefix[i] === 0 && // no EMPTY under the block
        (end === n || line[end] !== FILLED) // the gap cell after it can be empty
      ) {
        ok = feasible(end + 1, j + 1);
      }
    }
    memo[at] = ok ? 1 : 0;
    return ok;
  };

  if (!feasible(0, 0)) return LINE_CONTRADICTION;

  // Forward walk: only expand states that are reachable *and* completable, so every
  // mark we make belongs to at least one full valid arrangement.
  let sp = 0;
  stack[sp++] = 0; // i
  stack[sp++] = 0; // j
  seen[0] = 1;

  while (sp > 0) {
    const j = stack[--sp];
    const i = stack[--sp];
    if (i >= n) continue;

    if (j === k) {
      // feasible(i, k) held, so the whole tail is free of FILLED and must be empty.
      for (let t = i; t < n; t++) possEmpty[t] = 1;
      continue;
    }

    if (line[i] !== FILLED && feasible(i + 1, j)) {
      possEmpty[i] = 1;
      const at = (i + 1) * stride + j;
      if (!seen[at]) {
        seen[at] = 1;
        stack[sp++] = i + 1;
        stack[sp++] = j;
      }
    }

    const b = blocks[j];
    const end = i + b;
    if (
      end <= n &&
      emptyPrefix[end] - emptyPrefix[i] === 0 &&
      (end === n || line[end] !== FILLED) &&
      feasible(end + 1, j + 1)
    ) {
      for (let t = i; t < end; t++) possFilled[t] = 1;
      if (end < n) possEmpty[end] = 1;
      const at = (end + 1) * stride + (j + 1);
      if (!seen[at]) {
        seen[at] = 1;
        stack[sp++] = end + 1;
        stack[sp++] = j + 1;
      }
    }
  }

  let changed = 0;
  for (let t = 0; t < n; t++) {
    const f = possFilled[t];
    const e = possEmpty[t];
    if (!f && !e) return LINE_CONTRADICTION;
    if (f && e) continue; // still ambiguous
    const value = f ? FILLED : EMPTY;
    if (line[t] === UNKNOWN) {
      line[t] = value;
      changed++;
    } else if (line[t] !== value) {
      return LINE_CONTRADICTION;
    }
  }
  return changed;
}

// --- whole-grid propagation ---------------------------------------------------

export const OK = 'ok';
export const CONTRADICTION = 'contradiction';

/**
 * Run line propagation to a fixpoint, mutating `grid`.
 *
 * Rounds are strictly synchronous: every line in a wave is solved against the grid as
 * it stood at the *start* of the wave, and the deductions are applied together at the
 * end. That makes `rounds` the real depth of the reasoning chain — round 1 is what you
 * get from reading each line once in isolation, round 2 is what those deductions
 * unlock, and so on. If a line could instead see its neighbours' fresh deductions
 * mid-sweep, round 1 would absorb nearly the whole puzzle and the number would mean
 * nothing. The fixpoint reached is the same either way: line reduction is monotone, so
 * ordering changes only how many waves it takes to get there.
 *
 * @returns {{status: string, steps: number, rounds: number, sweeps: number,
 *            lineSolves: number, determined: number, unknown: number,
 *            firstRoundDetermined: number}}
 */
export function propagate(dims, blocks, grid, options = {}) {
  const { lines, linesByCell, total } = buildLines(dims);
  const { dirty = null } = options;

  const lineBuf = new Uint8Array(Math.max(dims.x, dims.y, dims.z));
  const inFrontier = new Uint8Array(lines.length);
  let frontier = [];
  if (dirty) {
    for (const id of dirty) if (id >= 0 && !inFrontier[id]) { inFrontier[id] = 1; frontier.push(id); }
  } else {
    for (let id = 0; id < lines.length; id++) { inFrontier[id] = 1; frontier.push(id); }
  }

  const stats = {
    status: OK,
    steps: 0,
    rounds: 0,
    sweeps: 0,
    lineSolves: 0,
    determined: 0,
    unknown: 0,
    firstRoundDetermined: 0,
  };

  // Deductions staged during the current wave: -1 = nothing pending for this cell.
  const pending = new Int8Array(total).fill(-1);
  let touched = [];
  const fail = () => {
    stats.status = CONTRADICTION;
    stats.unknown = countUnknown(grid, total);
    return stats;
  };

  while (frontier.length > 0) {
    const next = [];
    inFrontier.fill(0);
    stats.sweeps++;

    for (const id of frontier) {
      const line = lines[id];
      const { indices, n } = line;
      for (let i = 0; i < n; i++) lineBuf[i] = grid[indices[i]];

      stats.lineSolves++;
      const res = solveLine(lineBuf, n, blocks[id]);
      if (res === LINE_CONTRADICTION) return fail();
      if (res === LINE_NO_CHANGE) continue;

      stats.steps++;
      for (let i = 0; i < n; i++) {
        const cell = indices[i];
        if (grid[cell] === lineBuf[i]) continue;
        // Two lines in the same wave disagreeing about a cell is a contradiction.
        if (pending[cell] === -1) {
          pending[cell] = lineBuf[i];
          touched.push(cell);
        } else if (pending[cell] !== lineBuf[i]) {
          return fail();
        }
      }
    }

    // Apply the wave, then wake the perpendicular lines of everything that changed.
    for (const cell of touched) {
      grid[cell] = pending[cell];
      pending[cell] = -1;
      for (let s = 0; s < 3; s++) {
        const other = linesByCell[cell * 3 + s];
        if (other < 0) continue;
        if (!inFrontier[other]) { inFrontier[other] = 1; next.push(other); }
      }
    }

    if (touched.length > 0) {
      stats.rounds++;
      stats.determined += touched.length;
      if (stats.rounds === 1) stats.firstRoundDetermined = touched.length;
    }
    touched = [];
    frontier = next;
  }

  stats.unknown = countUnknown(grid, total);
  return stats;
}

function countUnknown(grid, total) {
  let u = 0;
  for (let i = 0; i < total; i++) if (grid[i] === UNKNOWN) u++;
  return u;
}

/** Solve from a blank board using logic only. `grid` holds whatever was deduced. */
export function solveLogical(dims, clues) {
  const { total } = buildLines(dims);
  const blocks = cluesToBlocks(dims, clues);
  const grid = new Uint8Array(total); // all UNKNOWN
  const stats = propagate(dims, blocks, grid);
  return { grid, stats, complete: stats.status === OK && stats.unknown === 0 };
}

// --- solution counting (only needed when logic alone is not enough) -----------

/**
 * Count solutions, stopping as soon as `limit` have been found. Propagation first,
 * then branch on the single most constrained unknown cell.
 *
 * @returns {{count: number, nodes: number, exhausted: boolean}}
 *          `exhausted: true` means the node budget ran out, so `count` is a lower bound.
 */
export function countSolutions(dims, clues, limit = 2, options = {}) {
  const { maxNodes = 500000 } = options;
  const { lines, linesByCell, total } = buildLines(dims);
  const blocks = cluesToBlocks(dims, clues);

  let count = 0;
  let nodes = 0;
  let exhausted = false;

  const search = (grid, dirty) => {
    if (count >= limit || exhausted) return;
    if (++nodes > maxNodes) { exhausted = true; return; }

    const stats = propagate(dims, blocks, grid, { dirty });
    if (stats.status === CONTRADICTION) return;
    if (stats.unknown === 0) { count++; return; }

    const cell = pickBranchCell(grid, lines, total);
    for (const value of [FILLED, EMPTY]) {
      const child = grid.slice();
      child[cell] = value;
      const touched = [
        linesByCell[cell * 3],
        linesByCell[cell * 3 + 1],
        linesByCell[cell * 3 + 2],
      ];
      search(child, touched);
      if (count >= limit || exhausted) return;
    }
  };

  search(new Uint8Array(total), null);
  return { count, nodes, exhausted };
}

// Branch on an unknown cell sitting in the line that has the fewest unknowns left —
// the cheapest place to force a contradiction and so the smallest search tree.
function pickBranchCell(grid, lines, total) {
  let bestLine = -1;
  let bestUnknown = Infinity;
  for (const line of lines) {
    let u = 0;
    for (let i = 0; i < line.n; i++) if (grid[line.indices[i]] === UNKNOWN) u++;
    if (u > 0 && u < bestUnknown) { bestUnknown = u; bestLine = line.id; }
  }
  if (bestLine >= 0) {
    const line = lines[bestLine];
    for (let i = 0; i < line.n; i++) if (grid[line.indices[i]] === UNKNOWN) return line.indices[i];
  }
  for (let i = 0; i < total; i++) if (grid[i] === UNKNOWN) return i;
  return -1;
}

// --- difficulty score ---------------------------------------------------------

/**
 * Turn propagation stats into one number. Three ingredients, in order of weight:
 *
 *   steps            productive line deductions — raw amount of reasoning required
 *   rounds           propagation waves to the fixpoint — how *deep* the chaining goes;
 *                    a puzzle you can read straight off the clues has very few
 *   deferredRatio    share of cells NOT handed to you in the first wave; the part of
 *                    the board that needs cross-axis reasoning rather than a glance
 *
 * Weights are the knob the difficulty curve is tuned with — DOO-4/Rewarde own the
 * banding, this only has to be monotone in "amount and depth of required reasoning".
 */
export const DIFFICULTY_WEIGHTS = { steps: 1, rounds: 4, deferred: 20 };

export function difficultyScore(stats) {
  const determined = stats.determined || 0;
  const deferredRatio = determined > 0 ? 1 - stats.firstRoundDetermined / determined : 0;
  const w = DIFFICULTY_WEIGHTS;
  const score = w.steps * stats.steps + w.rounds * stats.rounds + w.deferred * deferredRatio;
  return {
    score: Math.round(score * 10) / 10,
    steps: stats.steps,
    rounds: stats.rounds,
    lineSolves: stats.lineSolves,
    deferredRatio: Math.round(deferredRatio * 1000) / 1000,
  };
}

// --- validator ----------------------------------------------------------------

/**
 * The gate. Decide whether a voxel shape makes an acceptable puzzle.
 *
 * `noGuess` — pure line propagation from a blank board fills in every cell.
 * `unique`  — exactly one solution exists.
 *
 * noGuess implies unique: propagation only ever writes a value that holds in *every*
 * arrangement consistent with the clues, so it can never discard a solution. If it
 * determines the whole board, no second solution could have existed. So the (much more
 * expensive) search only runs for shapes that already failed noGuess — which keeps the
 * common path, 24 passing shapes in CI, propagation-only.
 *
 * @returns {{pass: boolean, unique: boolean, noGuess: boolean, reason: string,
 *            difficulty: object, stats: object, solutions: number, unknown: number,
 *            filled: number, dims: object}}
 */
export function validatePuzzle(dims, cells, options = {}) {
  const { countLimit = 2, maxNodes = 500000 } = options;
  const total = dims.x * dims.y * dims.z;
  if (cells.length !== total) {
    throw new Error(`cells length ${cells.length} does not match dims ${dims.x}x${dims.y}x${dims.z} (${total})`);
  }

  let filled = 0;
  for (let i = 0; i < total; i++) if (cells[i]) filled++;

  const clues = computeClues(dims, cells);
  const { grid, stats, complete } = solveLogical(dims, clues);
  const difficulty = difficultyScore(stats);

  const base = {
    dims,
    filled,
    stats,
    difficulty,
    unknown: stats.unknown,
    clues,
  };

  if (stats.status === CONTRADICTION) {
    // Clues come from a real grid, so this can only mean a solver bug.
    return { ...base, pass: false, unique: false, noGuess: false, solutions: 0, reason: 'contradiction' };
  }

  // Soundness self-check: anything propagation decided must agree with the real shape.
  for (let i = 0; i < total; i++) {
    if (grid[i] === UNKNOWN) continue;
    const expected = cells[i] ? FILLED : EMPTY;
    if (grid[i] !== expected) {
      return { ...base, pass: false, unique: false, noGuess: false, solutions: 0, reason: 'unsound-deduction' };
    }
  }

  if (complete) {
    return { ...base, pass: true, unique: true, noGuess: true, solutions: 1, reason: 'ok' };
  }

  const counted = countSolutions(dims, clues, countLimit, { maxNodes });
  const unique = !counted.exhausted && counted.count === 1;
  return {
    ...base,
    pass: false,
    unique,
    noGuess: false,
    solutions: counted.count,
    searchNodes: counted.nodes,
    searchExhausted: counted.exhausted,
    reason: counted.exhausted ? 'search-budget-exhausted' : unique ? 'needs-guessing' : 'multiple-solutions',
  };
}

// --- shape repair loop --------------------------------------------------------

const NEIGHBOURS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

function forEachNeighbour(dims, x, y, z, fn) {
  for (const [dx, dy, dz] of NEIGHBOURS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || ny < 0 || nz < 0 || nx >= dims.x || ny >= dims.y || nz >= dims.z) continue;
    fn(nx, ny, nz, idx(dims, nx, ny, nz));
  }
}

/** Invert puzzle.js' `idx`: cell index -> [x, y, z]. */
export function coordsOf(dims, i) {
  const z = i % dims.z;
  const rest = (i - z) / dims.z; // = x * dims.y + y
  const y = rest % dims.y;
  const x = (rest - y) / dims.y;
  return [x, y, z];
}

/** True if every filled cell is reachable from every other through face neighbours. */
export function isConnected(dims, cells) {
  const total = dims.x * dims.y * dims.z;
  let start = -1;
  let filled = 0;
  for (let i = 0; i < total; i++) if (cells[i]) { filled++; if (start < 0) start = i; }
  if (filled === 0) return false;

  const seen = new Uint8Array(total);
  const stack = [start];
  seen[start] = 1;
  let reached = 0;
  while (stack.length) {
    const i = stack.pop();
    reached++;
    const [x, y, z] = coordsOf(dims, i);
    forEachNeighbour(dims, x, y, z, (_nx, _ny, _nz, ni) => {
      if (cells[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
    });
  }
  return reached === filled;
}

// Cells worth toggling: the filled cells themselves plus their empty face neighbours.
// Editing only this surface band keeps the silhouette recognisable — a repair never
// pokes a hole in the middle of the shape or sprouts a floating voxel off in a corner.
function surfaceCandidates(dims, cells) {
  const total = dims.x * dims.y * dims.z;
  const flags = new Uint8Array(total);
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++) {
        const i = idx(dims, x, y, z);
        if (!cells[i]) continue;
        flags[i] = 1;
        forEachNeighbour(dims, x, y, z, (_nx, _ny, _nz, ni) => { if (!cells[ni]) flags[ni] = 1; });
      }
  const out = [];
  for (let i = 0; i < total; i++) if (flags[i]) out.push(i);
  return out;
}

/**
 * Nudge a failing shape into a valid puzzle by toggling as few cells as possible.
 *
 * Beam search over edit sets: depth = number of toggled cells, the beam keeps the
 * states whose logical solve gets furthest (highest share of cells determined without
 * guessing). Fully deterministic — same input, same repair, every run — so a shape's
 * repaired form is stable across CI runs and across machines.
 *
 * @param {object} dims
 * @param {ArrayLike<number>} cells          0/1 per cell
 * @param {object} [options]
 * @param {number} [options.maxEdits=4]      give up past this many toggled cells
 * @param {number} [options.beam=16]         states carried to the next depth
 * @param {number} [options.filledDelta=3]   allowed change in filled-cell count
 * @param {boolean} [options.requireConnected=true]
 * @param {Iterable<number>} [options.protect] cell indices that must not be toggled
 * @returns {{ok: boolean, cells: Uint8Array, edits: Array, editCount: number,
 *            validation: object, evaluated: number}}
 */
export function repairShape(dims, cells, options = {}) {
  const {
    maxEdits = 4,
    beam = 16,
    filledDelta = 3,
    requireConnected = true,
    protect = [],
  } = options;

  const total = dims.x * dims.y * dims.z;
  const protectSet = new Set(protect);
  const original = Uint8Array.from(cells, (v) => (v ? 1 : 0));
  let evaluated = 0;

  let baseFilled = 0;
  for (let i = 0; i < total; i++) if (original[i]) baseFilled++;

  const evaluate = (candidate) => {
    evaluated++;
    const v = validatePuzzle(dims, candidate, { countLimit: options.countLimit, maxNodes: options.maxNodes });
    // Hill-climbing measure: how much of the board logic alone nails down. A candidate
    // that gets further without guessing is closer to passing, even if it still fails.
    const determinedRatio = (total - v.unknown) / total;
    return { validation: v, determinedRatio };
  };

  const first = evaluate(original);
  if (first.validation.pass) {
    return { ok: true, cells: original, edits: [], editCount: 0, validation: first.validation, evaluated };
  }

  let beamStates = [{ cells: original, edits: [], ...first }];
  const seen = new Set([keyOf(original)]);

  for (let depth = 1; depth <= maxEdits; depth++) {
    const children = [];

    for (const state of beamStates) {
      const candidates = surfaceCandidates(dims, state.cells);
      for (const cell of candidates) {
        if (protectSet.has(cell)) continue;
        const next = state.cells.slice();
        next[cell] ^= 1;

        let filled = 0;
        for (let i = 0; i < total; i++) if (next[i]) filled++;
        if (filled === 0 || Math.abs(filled - baseFilled) > filledDelta) continue;
        if (requireConnected && !isConnected(dims, next)) continue;

        const key = keyOf(next);
        if (seen.has(key)) continue;
        seen.add(key);

        const scored = evaluate(next);
        const edits = [...state.edits, { index: cell, from: state.cells[cell], to: next[cell] }];
        if (scored.validation.pass) {
          return { ok: true, cells: next, edits, editCount: edits.length, validation: scored.validation, evaluated };
        }
        children.push({ cells: next, edits, key, ...scored });
      }
    }

    if (children.length === 0) break;
    // Prefer more-determined boards; break ties on the already-computed key so the
    // ordering — and therefore the repair this returns — is identical on every run.
    children.sort((a, b) => b.determinedRatio - a.determinedRatio || (a.key < b.key ? -1 : 1));
    beamStates = children.slice(0, beam);
  }

  const best = beamStates[0] ?? { cells: original, edits: [], validation: first.validation };
  return {
    ok: false,
    cells: best.cells,
    edits: best.edits,
    editCount: best.edits.length,
    validation: best.validation,
    evaluated,
  };
}

function keyOf(cells) {
  let s = '';
  for (let i = 0; i < cells.length; i++) s += cells[i] ? '1' : '0';
  return s;
}

// --- convenience --------------------------------------------------------------

/** Validate a batch of shapes and summarise — what the CI gate and DOO-4 both call. */
export function validateShapes(shapes) {
  const results = shapes.map((shape) => ({
    id: shape.id,
    name: shape.name,
    level: shape.level,
    ...validatePuzzle(shape.dims, shape.cells),
  }));
  const passed = results.filter((r) => r.pass);
  return {
    results,
    passed: passed.length,
    failed: results.length - passed.length,
    total: results.length,
    failures: results.filter((r) => !r.pass).map((r) => ({ id: r.id, reason: r.reason, solutions: r.solutions })),
  };
}

/** Render one z-slice as ASCII — for failure messages and shape review in DOO-4. */
export function sliceToAscii(dims, cells, z) {
  const rows = [];
  for (let y = dims.y - 1; y >= 0; y--) {
    let row = '';
    for (let x = 0; x < dims.x; x++) row += cells[idx(dims, x, y, z)] ? '#' : '.';
    rows.push(row);
  }
  return rows.join('\n');
}
