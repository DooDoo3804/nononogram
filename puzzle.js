// puzzle.js — pure nonogram-3d logic, no DOM. Run with `node puzzle.js` to self-check.
// dims = { x, y, z } — a box, not necessarily a cube.

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

function sumClues(grid) {
  let total = 0;
  for (const row of grid) for (const runs of row) total += runs.reduce((a, b) => a + b, 0);
  return total;
}

function demo() {
  const dims = { x: 2, y: 3, z: 2 }; // deliberately non-cubic
  const solution = generateSolution(dims, 0.5);
  const filledCount = solution.reduce((a, b) => a + b, 0);
  const clues = computeClues(dims, solution);

  console.assert(sumClues(clues.x) === filledCount, 'x-clues must account for every filled cell');
  console.assert(sumClues(clues.y) === filledCount, 'y-clues must account for every filled cell');
  console.assert(sumClues(clues.z) === filledCount, 'z-clues must account for every filled cell');
  console.assert(clues.x.length === dims.y && clues.x[0].length === dims.z, 'x-clue grid shape matches (y,z)');
  console.assert(clues.y.length === dims.x && clues.y[0].length === dims.z, 'y-clue grid shape matches (x,z)');
  console.assert(clues.z.length === dims.x && clues.z[0].length === dims.y, 'z-clue grid shape matches (x,y)');
  console.assert(isSolved(solution, solution), 'identical grids must be solved');

  const mutated = solution.slice();
  mutated[0] ^= 1;
  console.assert(!isSolved(mutated, solution), 'a single differing cell must fail isSolved');

  const seeded1 = generateSolution(dims, 0.5, mulberry32(42));
  const seeded2 = generateSolution(dims, 0.5, mulberry32(42));
  console.assert(isSolved(seeded1, seeded2), 'same seed must reproduce the same solution');

  console.log('puzzle.js self-check passed');
}

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('puzzle.js')) demo();
