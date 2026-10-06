// tests/puzzle.test.js — the former `node puzzle.js` self-check, plus the cases
// that console.assert couldn't express.

import { describe, it, expect } from 'vitest';
import {
  computeClues,
  generateSolution,
  idx,
  isSolved,
  mulberry32,
  sumClues,
} from '../puzzle.js';

const DIMS = { x: 2, y: 3, z: 2 }; // deliberately non-cubic

describe('idx', () => {
  it('is a bijection onto [0, cellCount)', () => {
    const seen = new Set();
    for (let x = 0; x < DIMS.x; x++)
      for (let y = 0; y < DIMS.y; y++)
        for (let z = 0; z < DIMS.z; z++) seen.add(idx(DIMS, x, y, z));
    expect(seen.size).toBe(DIMS.x * DIMS.y * DIMS.z);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(DIMS.x * DIMS.y * DIMS.z - 1);
  });
});

describe('computeClues', () => {
  const solution = generateSolution(DIMS, 0.5, mulberry32(7));
  const clues = computeClues(DIMS, solution);
  const filledCount = solution.reduce((a, b) => a + b, 0);

  it('accounts for every filled cell on each axis', () => {
    expect(sumClues(clues.x)).toBe(filledCount);
    expect(sumClues(clues.y)).toBe(filledCount);
    expect(sumClues(clues.z)).toBe(filledCount);
  });

  it('shapes each clue grid by the other two dims', () => {
    expect([clues.x.length, clues.x[0].length]).toEqual([DIMS.y, DIMS.z]);
    expect([clues.y.length, clues.y[0].length]).toEqual([DIMS.x, DIMS.z]);
    expect([clues.z.length, clues.z[0].length]).toEqual([DIMS.x, DIMS.y]);
  });

  it('reads run lengths along a line, splitting on gaps', () => {
    const dims = { x: 5, y: 1, z: 1 };
    const cells = new Uint8Array([1, 1, 0, 1, 0]);
    expect(computeClues(dims, cells).x[0][0]).toEqual([2, 1]);
  });

  it('reports an empty line as [0] rather than []', () => {
    const dims = { x: 3, y: 1, z: 1 };
    expect(computeClues(dims, new Uint8Array(3)).x[0][0]).toEqual([0]);
  });

  it('reports a full line as a single run', () => {
    const dims = { x: 4, y: 1, z: 1 };
    expect(computeClues(dims, new Uint8Array([1, 1, 1, 1])).x[0][0]).toEqual([4]);
  });
});

describe('isSolved', () => {
  const solution = generateSolution(DIMS, 0.5, mulberry32(7));

  it('accepts an identical grid', () => {
    expect(isSolved(solution, solution)).toBe(true);
  });

  it('rejects a single differing cell', () => {
    const mutated = solution.slice();
    mutated[0] ^= 1;
    expect(isSolved(mutated, solution)).toBe(false);
  });

  it('compares truthiness, so MARKED (2) counts as filled', () => {
    // The caller is expected to pass a filled-only 0/1 projection — this documents
    // why that projection is required rather than optional.
    expect(isSolved([2], [1])).toBe(true);
  });
});

describe('mulberry32', () => {
  it('reproduces the same solution for the same seed', () => {
    const a = generateSolution(DIMS, 0.5, mulberry32(42));
    const b = generateSolution(DIMS, 0.5, mulberry32(42));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces different solutions for different seeds', () => {
    const a = generateSolution({ x: 5, y: 5, z: 5 }, 0.5, mulberry32(1));
    const b = generateSolution({ x: 5, y: 5, z: 5 }, 0.5, mulberry32(2));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('stays in [0, 1)', () => {
    const rand = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
