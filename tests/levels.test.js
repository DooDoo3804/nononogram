// tests/levels.test.js — catalog integrity. These guards are what keep a bad
// hand-authored puzzle from shipping silently once `solutionFor` is replaced.

import { describe, it, expect } from 'vitest';
import { LEVELS, cellCount, findLevel, findPuzzle, solutionFor } from '../levels.js';

const allPuzzles = LEVELS.flatMap((level) => level.puzzles);

describe('catalog', () => {
  it('has at least one level, each with puzzles', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const level of LEVELS) expect(level.puzzles.length).toBeGreaterThan(0);
  });

  it('gives every level and every puzzle a unique id', () => {
    const levelIds = LEVELS.map((l) => l.id);
    const puzzleIds = allPuzzles.map((p) => p.id);
    expect(new Set(levelIds).size).toBe(levelIds.length);
    expect(new Set(puzzleIds).size).toBe(puzzleIds.length);
  });

  it('declares positive integer dims on every axis', () => {
    for (const p of allPuzzles) {
      for (const axis of ['x', 'y', 'z']) {
        expect(Number.isInteger(p.dims[axis]), `${p.id}.${axis}`).toBe(true);
        expect(p.dims[axis], `${p.id}.${axis}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('solutionFor', () => {
  it('returns one 0/1 cell per grid position', () => {
    for (const p of allPuzzles) {
      const cells = solutionFor(p);
      expect(cells.length, p.id).toBe(cellCount(p.dims));
      expect([...cells].every((v) => v === 0 || v === 1), p.id).toBe(true);
    }
  });

  it('is deterministic — saved progress depends on it', () => {
    for (const p of allPuzzles) {
      expect(Array.from(solutionFor(p)), p.id).toEqual(Array.from(solutionFor(p)));
    }
  });

  it('never returns a fully empty puzzle', () => {
    for (const p of allPuzzles) {
      expect([...solutionFor(p)].some(Boolean), p.id).toBe(true);
    }
  });
});

describe('lookup', () => {
  it('finds a level by id', () => {
    expect(findLevel(LEVELS[0].id)).toBe(LEVELS[0]);
    expect(findLevel('nope')).toBeNull();
  });

  it('finds a puzzle together with its level', () => {
    const target = LEVELS[0].puzzles[2];
    expect(findPuzzle(target.id)).toEqual({ level: LEVELS[0], spec: target });
    expect(findPuzzle('nope')).toBeNull();
  });
});
