// tests/gestures-stroke.test.js — one gesture, one undo press (DOO-10).
//
// The bug this pins was invisible to tests/session.test.js: the session was correct
// cell by cell, and the paint drag was correct cell by cell, but the *wiring* between
// them pushed one undo entry per cell, so taking a ten-cell drag back cost ten presses.
// It can only be caught by driving the real pointer events through mountGestures.
//
// The DOM here is hand-rolled rather than jsdom: mountGestures touches four things on
// the canvas and one on the board element, which is cheaper to fake than to install.
//
// Nothing here hard-codes the catalogue. It used to assume the first puzzle had 27
// cells and tapped cell 20; the puzzle track later made puzzle 1 a 3×3×2, and the only
// symptom was `state[20]` reading `undefined` — a gesture-layer test turning red over
// an edit to `levels.js`. The board size is read off the session instead.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountGestures, HOLD_MS } from '../ui/gestures.js';
import { createSession } from '../state/session.js';
import { setStorage } from '../state/progress.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';
import { LEVELS, cellCount } from '../levels.js';

const SPEC = LEVELS[0].puzzles[0];
const TOTAL = cellCount(SPEC.dims);
/** A cell clear of the runs the drags paint, for the "a tap is its own group" case. */
const TAP_CELL = TOTAL - 3;

/** The pointer walks along x; every 10 CSS px is the next cell. */
const CELL_PX = 10;
const cellFor = (event) => {
  const i = Math.floor(event.clientX / CELL_PX);
  return i >= 0 && i < TOTAL ? i : null;
};

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

function harness() {
  const board = {
    attrs: new Map(),
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
    removeAttribute(k) {
      this.attrs.delete(k);
    },
  };
  const handlers = new Map();
  const canvas = {
    closest: () => board,
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener() {},
  };
  const view = { controls: { enableRotate: true }, rayFrom: (event) => event };
  const grid = { pick: cellFor };
  // Mode keys land on window, not the canvas, so the window double records too.
  const winHandlers = new Map();
  const win = {
    addEventListener(type, fn) {
      if (!winHandlers.has(type)) winHandlers.set(type, []);
      winHandlers.get(type).push(fn);
    },
    removeEventListener() {},
  };
  return {
    board,
    canvas,
    view,
    grid,
    win,
    modes: [],
    fire(type, event) {
      for (const fn of handlers.get(type) ?? []) fn({ pointerId: 1, clientY: 0, ...event });
    },
    key(type, key) {
      for (const fn of winHandlers.get(type) ?? []) fn({ key });
    },
  };
}

let h;
let session;
let gestures;

beforeEach(() => {
  setStorage(memoryStorage());
  session = createSession(SPEC);
  h = harness();
  globalThis.window = h.win;
  gestures = mountGestures({
    canvas: h.canvas,
    view: h.view,
    getSession: () => session,
    getGrid: () => h.grid,
    onModeChange: (mode, opts) => h.modes.push([mode, opts]),
  });
});

afterEach(() => {
  gestures.dispose();
  delete globalThis.window;
  vi.useRealTimers();
});

/** Drag from cell 0 across `count` cells and lift. */
function paintDrag(count) {
  gestures.setMode('paint');
  h.fire('pointerdown', { clientX: 0 });
  for (let n = 1; n < count; n++) h.fire('pointermove', { clientX: n * CELL_PX });
  h.fire('pointerup', { clientX: (count - 1) * CELL_PX });
}

// DOO-16: every test in the suite below reached paint mode through `setMode`, which is
// the gesture layer's own API — so they all passed in a build where a *player* could not
// get there at all. These cover the two ways a player actually can: the top-band switch,
// which goes through `toggleMode`, and the `P` key.
describe('reaching paint mode', () => {
  it('opens in rotate mode, with OrbitControls holding one-finger drags', () => {
    expect(gestures.mode()).toBe('rotate');
    expect(h.view.controls.enableRotate).toBe(true);
    expect(h.board.attrs.get('data-mode')).toBe('rotate');
  });

  it('toggleMode — what the top-band button calls — hands one-finger drags to paint', () => {
    expect(gestures.toggleMode()).toBe('paint');
    expect(h.view.controls.enableRotate).toBe(false);
    expect(h.board.attrs.get('data-mode')).toBe('paint');
    // And the HUD is told, so the button can show which mode is live.
    expect(h.modes.at(-1)).toEqual(['paint', { transient: false }]);

    h.fire('pointerdown', { clientX: 0 });
    h.fire('pointermove', { clientX: CELL_PX });
    h.fire('pointerup', { clientX: CELL_PX });
    expect([session.state[0], session.state[1]]).toEqual([FILLED, FILLED]);
    session.undo();
    expect([session.state[0], session.state[1]]).toEqual([BLANK, BLANK]);
  });

  it('P toggles the mode both ways', () => {
    h.key('keydown', 'p');
    expect(gestures.mode()).toBe('paint');
    h.key('keydown', 'P'); // caps lock on
    expect(gestures.mode()).toBe('rotate');
  });

  it('ignores P mid-gesture, so a stroke cannot outlive the mode that started it', () => {
    gestures.setMode('paint');
    h.fire('pointerdown', { clientX: 0 });
    h.key('keydown', 'p');
    expect(gestures.mode()).toBe('paint');
    h.fire('pointermove', { clientX: CELL_PX });
    h.fire('pointerup', { clientX: CELL_PX });
    // The whole drag still painted, and it is still one undo group.
    expect([session.state[0], session.state[1]]).toEqual([FILLED, FILLED]);
    session.undo();
    expect(session.canUndo()).toBe(false);
  });

  it('holding Shift borrows the other mode without sticking', () => {
    h.key('keydown', 'Shift');
    expect(gestures.mode()).toBe('paint');
    expect(h.modes.at(-1)).toEqual(['paint', { transient: true }]);
    h.key('keyup', 'Shift');
    expect(gestures.mode()).toBe('rotate');
  });
});

describe('paint drag', () => {
  it('fills every cell it crosses and comes back on ONE undo', () => {
    paintDrag(10);
    const painted = [...Array(10).keys()];
    expect(painted.every((i) => session.state[i] === FILLED)).toBe(true);

    expect(session.canUndo()).toBe(true);
    session.undo();

    expect(painted.every((i) => session.state[i] === BLANK)).toBe(true);
    expect(session.canUndo()).toBe(false); // nothing left over — it really was one group
  });

  it('erases in one step per cell, and one undo restores the fills', () => {
    // A stroke starting on a filled cell erases. Reaching BLANK from FILLED used to
    // take two cycles through the 3-ring, i.e. two undo entries per cell.
    for (let i = 0; i < 5; i++) session.set(i, FILLED);
    paintDrag(5);
    expect([...Array(5).keys()].every((i) => session.state[i] === BLANK)).toBe(true);

    session.undo();
    expect([...Array(5).keys()].every((i) => session.state[i] === FILLED)).toBe(true);
    expect(session.canUndo()).toBe(false);
  });

  it('does not re-toggle a cell the pointer wobbles back across', () => {
    gestures.setMode('paint');
    h.fire('pointerdown', { clientX: 0 });
    h.fire('pointermove', { clientX: CELL_PX });
    h.fire('pointermove', { clientX: 0 }); // back onto the first cell
    h.fire('pointerup', { clientX: 0 });
    expect([session.state[0], session.state[1]]).toEqual([FILLED, FILLED]);

    session.undo();
    expect([session.state[0], session.state[1]]).toEqual([BLANK, BLANK]);
  });

  it('keeps a tap as its own undo step', () => {
    gestures.setMode('paint');
    paintDrag(4);
    // A tap in rotate mode: down and up on the same spot.
    gestures.setMode('rotate');
    h.fire('pointerdown', { clientX: TAP_CELL * CELL_PX });
    h.fire('pointerup', { clientX: TAP_CELL * CELL_PX });
    expect(session.state[TAP_CELL]).toBe(FILLED);

    session.undo(); // the tap only
    expect(session.state[TAP_CELL]).toBe(BLANK);
    expect([...Array(4).keys()].every((i) => session.state[i] === FILLED)).toBe(true);

    session.undo(); // the drag, whole
    expect([...session.state].every((v) => v === BLANK)).toBe(true);
  });

  it('closes the stroke when a second finger turns the drag into a pinch', () => {
    gestures.setMode('paint');
    h.fire('pointerdown', { clientX: 0 });
    h.fire('pointermove', { clientX: CELL_PX });
    h.fire('pointerdown', { pointerId: 2, clientX: 300 }); // second finger
    expect([session.state[0], session.state[1]]).toEqual([FILLED, FILLED]);

    session.undo();
    expect([session.state[0], session.state[1]]).toEqual([BLANK, BLANK]);
    expect(session.canUndo()).toBe(false);
  });
});

describe('long press', () => {
  it('marks ✕ in one undo step, not two', () => {
    vi.useFakeTimers();
    h.fire('pointerdown', { clientX: 50 });
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(session.state[5]).toBe(MARKED);

    session.undo();
    expect(session.state[5]).toBe(BLANK); // was FILLED — the halfway point of the ring
    expect(session.canUndo()).toBe(false);
  });

  it('clears an existing mark, and that too is one undo step', () => {
    vi.useFakeTimers();
    session.set(5, MARKED);
    h.fire('pointerdown', { clientX: 50 });
    vi.advanceTimersByTime(HOLD_MS + 1);
    expect(session.state[5]).toBe(BLANK);

    session.undo();
    expect(session.state[5]).toBe(MARKED);
  });
});
