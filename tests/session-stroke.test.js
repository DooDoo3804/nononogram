// tests/session-stroke.test.js — grouped undo (DOO-10).
//
// DOO-5's paint drag paints every cell the pointer crosses; before this, each of those
// cells was its own undo entry, so taking a ten-cell drag back cost ten presses. These
// tests pin the group boundary: one stroke, one undo, and the single-click path and the
// non-undoable `set()` that hints/fx rely on both unchanged.

import { describe, it, expect, beforeEach } from 'vitest';
import { createSession, BLANK, FILLED, MARKED } from '../state/session.js';
import { setStorage } from '../state/progress.js';
import { LEVELS } from '../levels.js';

const SPEC = LEVELS[0].puzzles[0]; // 3³

/** A store that also counts writes, so stroke batching is measurable. */
function countingStorage() {
  const map = new Map();
  let writes = 0;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      writes++;
      map.set(k, String(v));
    },
    writes: () => writes,
    read: (k) => (map.has(k) ? JSON.parse(map.get(k)) : null),
  };
}

let store;
beforeEach(() => {
  store = countingStorage();
  setStorage(store);
});

/** Paint `indices` to FILLED as one drag. */
function paintStroke(session, indices, value = FILLED) {
  session.beginStroke();
  for (const i of indices) session.set(i, value, { undoable: true });
  return session.endStroke();
}

describe('stroke grouping', () => {
  it('takes a whole stroke back with one undo', () => {
    const s = createSession(SPEC);
    const painted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(paintStroke(s, painted)).toBe(painted.length);
    expect(painted.every((i) => s.state[i] === FILLED)).toBe(true);

    s.undo();

    expect(painted.every((i) => s.state[i] === BLANK)).toBe(true);
    expect(s.canUndo()).toBe(false);
  });

  it('leaves a single click as its own undo step', () => {
    const s = createSession(SPEC);
    s.cycle(2);
    s.cycle(5);
    expect(s.undo()).toEqual({ i: 5, value: BLANK });
    expect(s.state[2]).toBe(FILLED);
  });

  it('names the cell the stroke began on in its return value', () => {
    const s = createSession(SPEC);
    paintStroke(s, [7, 8, 9]);
    expect(s.undo()).toEqual({ i: 7, value: BLANK });
  });

  it('emits a cell event for every cell it reverts', () => {
    const s = createSession(SPEC);
    paintStroke(s, [1, 2, 3]);
    const seen = [];
    s.on('cell', (e) => seen.push(e));
    s.undo();
    // Reverse order, so a repaint that walks the list ends on the stroke's origin.
    expect(seen).toEqual([
      { i: 3, value: BLANK },
      { i: 2, value: BLANK },
      { i: 1, value: BLANK },
    ]);
  });

  it('restores the pre-stroke value when a stroke crossed one cell twice', () => {
    const s = createSession(SPEC);
    s.cycle(4); // -> FILLED, before the stroke
    s.beginStroke();
    s.set(4, MARKED, { undoable: true });
    s.set(4, BLANK, { undoable: true });
    s.endStroke();

    s.undo();
    expect(s.state[4]).toBe(FILLED);
  });

  it('groups cycle() calls made inside a stroke', () => {
    const s = createSession(SPEC);
    s.beginStroke();
    s.cycle(0);
    s.cycle(1);
    s.cycle(2);
    s.endStroke();

    s.undo();
    expect([s.state[0], s.state[1], s.state[2]]).toEqual([BLANK, BLANK, BLANK]);
    expect(s.canUndo()).toBe(false);
  });

  it('separates consecutive strokes', () => {
    const s = createSession(SPEC);
    paintStroke(s, [0, 1]);
    paintStroke(s, [2, 3]);

    s.undo();
    expect([...s.state].filter((v) => v === FILLED).length).toBe(2);
    s.undo();
    expect([...s.state].every((v) => v === BLANK)).toBe(true);
  });

  it('leaves no group behind for a stroke that painted nothing', () => {
    const s = createSession(SPEC);
    s.cycle(0);
    s.beginStroke();
    expect(s.endStroke()).toBe(0);
    expect(s.canUndo()).toBe(true);

    s.undo(); // must reach the click, not an empty stroke
    expect(s.state[0]).toBe(BLANK);
    expect(s.canUndo()).toBe(false);
  });

  it('keeps one group when beginStroke is called twice', () => {
    const s = createSession(SPEC);
    s.beginStroke();
    s.set(0, FILLED, { undoable: true });
    s.beginStroke(); // a UI that double-fires pointerdown
    s.set(1, FILLED, { undoable: true });
    s.endStroke();

    s.undo();
    expect([s.state[0], s.state[1]]).toEqual([BLANK, BLANK]);
  });

  it('reverts an unfinished stroke, and counts as undoable mid-stroke', () => {
    const s = createSession(SPEC);
    s.beginStroke();
    s.set(3, FILLED, { undoable: true });
    s.set(4, FILLED, { undoable: true });
    expect(s.canUndo()).toBe(true);

    s.undo();
    expect([s.state[3], s.state[4]]).toEqual([BLANK, BLANK]);
    expect(s.canUndo()).toBe(false);
  });

  it('is a no-op outside any stroke', () => {
    const s = createSession(SPEC);
    expect(s.endStroke()).toBe(0);
    expect(s.canUndo()).toBe(false);
  });
});

describe('set(i, value, { undoable })', () => {
  it('is its own undo step outside a stroke', () => {
    const s = createSession(SPEC);
    s.set(6, MARKED, { undoable: true });
    expect(s.state[6]).toBe(MARKED);
    expect(s.undo()).toEqual({ i: 6, value: BLANK });
  });

  it('stays out of the undo stack by default — the hint/reveal path', () => {
    const s = createSession(SPEC);
    s.set(6, FILLED);
    expect(s.state[6]).toBe(FILLED);
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBeNull();
  });

  it('pushes nothing when the value does not change', () => {
    const s = createSession(SPEC);
    s.set(6, BLANK, { undoable: true });
    expect(s.canUndo()).toBe(false);
  });

  it('respects the solved lock, while a plain set still gets through', () => {
    const s = createSession(SPEC);
    // Fill the solution without touching the undo stack, to reach `solved` cleanly.
    s.solution.forEach((v, i) => {
      if (v) s.set(i, FILLED);
    });
    expect(s.solved).toBe(true);

    const empty = [...s.solution].findIndex((v) => !v);
    expect(s.set(empty, MARKED, { undoable: true })).toBeNull();
    expect(s.state[empty]).toBe(BLANK);
    expect(s.canUndo()).toBe(false);

    // fx/index.js reveals the answer through the plain path after the clear.
    expect(s.set(empty, FILLED)).toBe(FILLED);
    expect(s.state[empty]).toBe(FILLED);
  });

  it('does not undo a stroke that finished the puzzle', () => {
    const s = createSession(SPEC);
    const fill = [...s.solution.keys()].filter((i) => s.solution[i]);
    paintStroke(s, fill);
    expect(s.solved).toBe(true);
    expect(s.undo()).toBeNull();
    expect(fill.every((i) => s.state[i] === FILLED)).toBe(true);
  });
});

describe('stroke persistence', () => {
  it('writes once per stroke instead of once per cell', () => {
    const s = createSession(SPEC);
    const before = store.writes();
    paintStroke(s, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(store.writes() - before).toBe(1);

    const saved = store.read(`no-nonogram:${SPEC.id}`);
    expect(saved.state.slice(0, 10)).toEqual(Array(10).fill(FILLED));
  });

  it('writes once for a grouped undo, with the reverted board', () => {
    const s = createSession(SPEC);
    paintStroke(s, [0, 1, 2, 3]);
    const before = store.writes();
    s.undo();
    expect(store.writes() - before).toBe(1);
    expect(store.read(`no-nonogram:${SPEC.id}`).state.slice(0, 4)).toEqual(Array(4).fill(BLANK));
  });

  it('still writes on every single click', () => {
    const s = createSession(SPEC);
    const before = store.writes();
    s.cycle(0);
    s.cycle(1);
    expect(store.writes() - before).toBe(2);
  });
});
