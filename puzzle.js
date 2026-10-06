// puzzle.js — pure nonogram-3d logic, no DOM.
// dims = { x, y, z } — a box, not necessarily a cube.
//
// The self-check that used to run via `node puzzle.js` now lives in
// tests/puzzle.test.js — run it with `npm test`.

export const idx = (dims, x, y, z) => (x * dims.y + y) * dims.z + z;

// Deterministic PRNG so a puzzle (identified by a seed) always generates the same
// solution — needed so saved progress and thumbnails stay consistent across visits.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSolution(dims, fillProbability = 0.45, rand = Math.random) {
  const total = dims.x * dims.y * dims.z;
  const cells = new Uint8Array(total);
  for (let i = 0; i < total; i++) cells[i] = rand() < fillProbability ? 1 : 0;
  return cells;
}

function runLengths(bits) {
  const runs = [];
  let count = 0;
  for (const b of bits) {
    if (b) count++;
    else if (count) { runs.push(count); count = 0; }
  }
  if (count) runs.push(count);
  return runs.length ? runs : [0];
}

// clues[axis] is a 2D grid of run-length arrays, one per line running along `axis`,
// indexed by the other two coordinates (row-major: outer loop first, inner loop second).
export function computeClues(dims, cells) {
  const lineBits = (axis, a, b) => {
    const bits = [];
    for (let i = 0; i < dims[axis]; i++) {
      const [x, y, z] = axis === 'x' ? [i, a, b] : axis === 'y' ? [a, i, b] : [a, b, i];
      bits.push(cells[idx(dims, x, y, z)]);
    }
    return bits;
  };
  const otherDims = { x: [dims.y, dims.z], y: [dims.x, dims.z], z: [dims.x, dims.y] };

  const clues = {};
  for (const axis of ['x', 'y', 'z']) {
    const [na, nb] = otherDims[axis];
    const grid = [];
    for (let a = 0; a < na; a++) {
      const row = [];
      for (let b = 0; b < nb; b++) row.push(runLengths(lineBits(axis, a, b)));
      grid.push(row);
    }
    clues[axis] = grid;
  }
  return clues;
}

export function isSolved(cells, solution) {
  for (let i = 0; i < cells.length; i++) if (!!cells[i] !== !!solution[i]) return false;
  return true;
}

/** Total filled cells accounted for by one axis' clue grid. */
export function sumClues(grid) {
  let total = 0;
  for (const row of grid) for (const runs of row) total += runs.reduce((a, b) => a + b, 0);
  return total;
}
