// tests/hints.test.js — the staged hint, against real puzzles.
//
// The two properties that matter: a hint is never *wrong* (it only ever states what the
// solution actually says), and a hint is always *available* while the puzzle is
// unsolved — including from a board the player has broken, which is exactly when they
// reach for it.

import { describe, it, expect, beforeEach } from 'vitest';
import { createHints } from '../state/hints.js';
import { createSession } from '../state/session.js';
import { setStorage } from '../state/progress.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';
import { LEVELS } from '../levels.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

// Picked by size rather than by index so the catalogue can grow or be reordered
// without this file going stale.
const ALL = LEVELS.flatMap((l) => l.puzzles);
const bySize = [...ALL].sort(
  (a, b) => a.dims.x * a.dims.y * a.dims.z - b.dims.x * b.dims.y * b.dims.z,
);
const SMALL = bySize[0];
const BIG = bySize[bySize.length - 1];

describe('hints — correctness', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('stage 1 names a line and costs 1, without touching the board', () => {
    const s = createSession(SMALL);
    const h = createHints({ session: s });
    const before = Array.from(s.state);

    const hint = h.next();

    expect(hint.stage).toBe(1);
    expect(hint.cost).toBe(1);
    expect(hint.applied).toBeNull();
    expect(hint.line.axis).toMatch(/^[xyz]$/);
    expect(hint.line.indices).toHaveLength(s.dims[hint.line.axis]);
    expect(hint.gains).toBeGreaterThan(0);
    expect(Array.from(s.state)).toEqual(before);
  });

  it('every cell a stage-1 hint claims is settled agrees with the solution', () => {
    const s = createSession(BIG);
    const h = createHints({ session: s });
    const hint = h.next();

    for (const cell of hint.cells) {
      // solver FILLED = 1, EMPTY = 2
      const expected = s.solution[cell.i] ? 1 : 2;
      expect(cell.value).toBe(expected);
    }
  });

  it('pressing again on an unchanged board escalates to stage 2 and places a cell', () => {
    const s = createSession(SMALL);
    const h = createHints({ session: s });

    const first = h.next();
    expect(h.peek()).toBe(2);
    const second = h.next();

    expect(second.stage).toBe(2);
    expect(second.cost).toBe(2);
    expect(second.applied).not.toBeNull();
    expect(second.line.id).toBe(first.line.id);

    const { i } = second.applied;
    expect(s.state[i]).toBe(s.solution[i] ? FILLED : MARKED);
  });

  it('resets to stage 1 once the player changes the board', () => {
    const s = createSession(SMALL);
    const h = createHints({ session: s });

    h.next(); // stage 1
    s.cycle(0); // the player does something
    expect(h.peek()).toBe(1);
    expect(h.next().stage).toBe(1);
  });

  it('charges 1 then 2 points, and counts two uses', () => {
    const s = createSession(SMALL);
    const spent = [];
    const h = createHints({ session: s, onSpend: (e) => spent.push(e.cost) });

    h.next();
    h.next();

    expect(spent).toEqual([1, 2]);
    expect(h.uses()).toBe(2);
    expect(h.points()).toBe(3);
  });

  it('refuses to spend anything on a solved puzzle', () => {
    const s = createSession(SMALL);
    for (let i = 0; i < s.solution.length; i++) if (s.solution[i]) s.set(i, FILLED);
    expect(s.solved).toBe(true);

    const h = createHints({ session: s });
    expect(h.next()).toBeNull();
    expect(h.points()).toBe(0);
  });
});

describe('hints — availability from a broken board', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('still produces a hint when the player has filled cells that are wrong', () => {
    const s = createSession(SMALL);
    // Fill every cell the solution says is empty: maximally wrong, and the state that
    // makes a naive line solver return CONTRADICTION instead of advice.
    for (let i = 0; i < s.solution.length; i++) if (!s.solution[i]) s.set(i, FILLED);

    const h = createHints({ session: s });
    const hint = h.next();

    expect(hint).not.toBeNull();
    expect(hint.gains).toBeGreaterThan(0);
  });

  it('prefers a line the player has broken', () => {
    const s = createSession(BIG);
    const wrong = s.solution.findIndex((v) => !v);
    s.set(wrong, FILLED);

    const h = createHints({ session: s });
    const hint = h.next();

    expect(hint.line.indices).toContain(wrong);
  });

  it('can solve a whole puzzle on stage-2 hints alone, never placing a wrong cell', () => {
    const s = createSession(SMALL);
    const h = createHints({ session: s });
    const limit = s.state.length * 3;

    let presses = 0;
    while (!s.solved && presses < limit) {
      const hint = h.next();
      // While the puzzle is unsolved there is always advice to give.
      expect(hint).not.toBeNull();
      presses++;
      if (hint.applied) {
        // Whatever a hint puts on the board is what the solution says.
        const { i } = hint.applied;
        expect(s.state[i]).toBe(s.solution[i] ? FILLED : MARKED);
      }
    }

    expect(s.solved).toBe(true);
    for (let i = 0; i < s.state.length; i++) {
      if (s.state[i] === FILLED) expect(s.solution[i]).toBe(1);
      if (s.state[i] === MARKED) expect(s.solution[i]).toBe(0);
    }
  });
});

describe('hints — every shipped puzzle can be hinted from blank', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it.each(ALL.map((spec) => [spec.id, spec]))('%s', (_id, spec) => {
    const s = createSession(spec);
    const h = createHints({ session: s });
    const hint = h.next();

    expect(hint).not.toBeNull();
    expect(hint.stage).toBe(1);
    expect(hint.cells.length).toBeGreaterThan(0);
    for (const cell of hint.cells) {
      expect(cell.value).toBe(s.solution[cell.i] ? 1 : 2);
      expect(s.state[cell.i]).toBe(BLANK);
    }
  });
});
