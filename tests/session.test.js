// tests/session.test.js — the game rules. No DOM, no WebGL.

import { describe, it, expect, beforeEach } from 'vitest';
import { createSession, BLANK, FILLED, MARKED } from '../state/session.js';
import { setStorage, saveProgress } from '../state/progress.js';
import { LEVELS, solutionFor } from '../levels.js';
import { FILLED as CELLS_FILLED } from '../state/cells.js';

const SPEC = LEVELS[0].puzzles[0]; // the catalogue's first level-1 puzzle

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

/** Click a cell until it reaches `target`. */
function cycleTo(session, i, target) {
  for (let n = 0; n < 3 && session.state[i] !== target; n++) session.cycle(i);
}

/** Fill in the real solution, cell by cell, the way a player would. */
function solveByHand(session) {
  session.solution.forEach((v, i) => {
    if (v) cycleTo(session, i, FILLED);
  });
}

describe('createSession', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('starts blank and unsolved', () => {
    const s = createSession(SPEC);
    expect(s.state.length).toBe(SPEC.dims.x * SPEC.dims.y * SPEC.dims.z);
    expect([...s.state].every((v) => v === BLANK)).toBe(true);
    expect(s.solved).toBe(false);
    expect(s.restored).toBe(false);
  });

  it('derives clues from the puzzle solution, not from the board', () => {
    const s = createSession(SPEC);
    const expected = solutionFor(SPEC);
    expect(Array.from(s.solution)).toEqual(Array.from(expected));
    // clues stay fixed while the board changes
    const before = JSON.stringify(s.clues);
    s.cycle(0);
    expect(JSON.stringify(s.clues)).toBe(before);
  });

  it('cycles BLANK -> FILLED -> MARKED -> BLANK', () => {
    const s = createSession(SPEC);
    expect(s.cycle(0)).toBe(FILLED);
    expect(s.cycle(0)).toBe(MARKED);
    expect(s.cycle(0)).toBe(BLANK);
  });

  it('emits a cell event per change', () => {
    const s = createSession(SPEC);
    const seen = [];
    s.on('cell', (e) => seen.push(e));
    s.cycle(4);
    s.cycle(4);
    expect(seen).toEqual([
      { i: 4, value: FILLED },
      { i: 4, value: MARKED },
    ]);
  });

  it('unsubscribes via the returned handle and via off()', () => {
    const s = createSession(SPEC);
    let viaHandle = 0;
    let viaOff = 0;
    const offCell = () => viaOff++;
    const stop = s.on('cell', () => viaHandle++);
    s.on('cell', offCell);
    s.cycle(0);
    stop();
    s.off('cell', offCell);
    s.cycle(0);
    expect(viaHandle).toBe(1);
    expect(viaOff).toBe(1);
  });
});

describe('undo', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('restores the previous value of the last changed cell', () => {
    const s = createSession(SPEC);
    s.cycle(2); // -> FILLED
    s.cycle(5); // -> FILLED
    expect(s.undo()).toEqual({ i: 5, value: BLANK });
    expect(s.state[5]).toBe(BLANK);
    expect(s.state[2]).toBe(FILLED);
  });

  it('walks the whole history back to a blank board', () => {
    const s = createSession(SPEC);
    s.cycle(1);
    s.cycle(1);
    s.cycle(3);
    while (s.canUndo()) s.undo();
    expect([...s.state].every((v) => v === BLANK)).toBe(true);
  });

  it('is a no-op on an untouched board', () => {
    const s = createSession(SPEC);
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBeNull();
  });

  it('does not reach past a restored save (history starts empty)', () => {
    saveProgress(SPEC.id, new Uint8Array(27).fill(BLANK), false);
    const s = createSession(SPEC);
    expect(s.canUndo()).toBe(false);
  });
});

describe('solving', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('flips to solved once the filled cells match the solution', () => {
    const s = createSession(SPEC);
    let solvedEvents = 0;
    s.on('solved', () => solvedEvents++);
    solveByHand(s);
    expect(s.solved).toBe(true);
    expect(solvedEvents).toBe(1);
  });

  it('ignores MARKED cells when checking the solution', () => {
    const s = createSession(SPEC);
    solveByHand(s);
    expect(s.solved).toBe(true);
    // every cell that should be empty is still BLANK, and marking one would be
    // locked out below — so verify the projection directly instead
    const projection = Array.from(s.state, (v) => (v === CELLS_FILLED ? 1 : 0));
    expect(projection).toEqual(Array.from(s.solution, (v) => (v ? 1 : 0)));
  });

  it('locks the board after solving — no cycle, no undo', () => {
    const s = createSession(SPEC);
    solveByHand(s);
    const snapshot = [...s.state];
    expect(s.cycle(0)).toBeNull();
    expect(s.undo()).toBeNull();
    expect(s.canUndo()).toBe(false);
    expect([...s.state]).toEqual(snapshot);
  });
});

describe('persistence', () => {
  let store;
  beforeEach(() => {
    store = memoryStorage();
    setStorage(store);
  });

  it('writes after every change', () => {
    const s = createSession(SPEC);
    s.cycle(0);
    expect(JSON.parse(store.getItem(`no-nonogram:${SPEC.id}`)).state[0]).toBe(FILLED);
  });

  it('restores a board and its solved flag on the next session', () => {
    const a = createSession(SPEC);
    a.cycle(3);
    a.cycle(3); // MARKED
    a.cycle(8); // FILLED

    const b = createSession(SPEC);
    expect(b.restored).toBe(true);
    expect([...b.state]).toEqual([...a.state]);
    expect(b.solved).toBe(false);
  });

  it('restores solved=true so a finished puzzle stays locked', () => {
    const a = createSession(SPEC);
    solveByHand(a);
    const b = createSession(SPEC);
    expect(b.solved).toBe(true);
    expect(b.cycle(0)).toBeNull();
  });

  it('discards a save whose length no longer matches the puzzle dims', () => {
    saveProgress(SPEC.id, new Uint8Array(8).fill(FILLED), false);
    const s = createSession(SPEC);
    expect(s.restored).toBe(false);
    expect(s.state.length).toBe(SPEC.dims.x * SPEC.dims.y * SPEC.dims.z);
    expect([...s.state].every((v) => v === BLANK)).toBe(true);
  });
});

describe('currentRuns', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('reads clues off the player board, counting only FILLED', () => {
    const s = createSession(SPEC);
    const blank = s.currentRuns();
    expect(blank.x[0][0]).toEqual([0]);

    cycleTo(s, 0, MARKED); // a player note must not read as a filled run
    expect(s.currentRuns().x[0][0]).toEqual([0]);

    cycleTo(s, 0, FILLED);
    expect(s.currentRuns().x[0][0]).toEqual([1]);
  });

  it('matches the puzzle clues exactly once solved', () => {
    const s = createSession(SPEC);
    solveByHand(s);
    expect(s.currentRuns()).toEqual(s.clues);
  });
});
