// state/session.js — one playthrough of one puzzle.
//
// Deliberately free of DOM and THREE: the whole game rule surface is testable in
// node. Render and UI subscribe to events instead of reading state on a timer, so
// the game-design track can attach audio/effects without touching render/ or ui/.
//
// Public API — createSession(spec) returns:
//   .spec .dims .clues .solution .state    (state is a live Uint8Array, length = cellCount)
//   .solved                                (getter)
//   .restored                              true when the board came back from a save
//   .cycle(i)        BLANK->FILLED->MARKED->BLANK, undoable. -> new value | null when locked
//   .set(i, value, opts?)  set directly. Not undoable unless `{ undoable: true }`,
//                    which also makes it respect the solved lock (-> null).
//   .beginStroke() / .endStroke()   group everything pushed between them, so one
//                    undo() takes the whole stroke back. endStroke -> cells grouped
//   .undo()          -> { i, value } | null   reverts the whole most recent group
//   .canUndo()       -> boolean
//   .currentRuns()   -> clue grids as read off the *current* board
//   .on(evt, fn)     -> unsubscribe fn;  .off(evt, fn)
//
// Events: 'cell' ({ i, value }) | 'solved' ()
//
// ## Why the undo stack holds groups, not cells
//
// DOO-5's paint drag fills every cell the pointer crosses, and DOO-10 was the fallout:
// a ten-cell drag cost ten undo presses to take back. The stack is therefore a stack
// of *groups* — `cycle()` outside a stroke pushes a group of one (so single clicks are
// unchanged), and everything pushed between `beginStroke()` and `endStroke()` lands in
// one group that `undo()` reverts in one go.
//
// `undo()`'s return value stays `{ i, value }` rather than becoming a list: it names
// the cell restored *last*, which for a stroke is the cell the stroke began on. Every
// reverted cell still emits its own `cell` event, so render/fx/audio see the full set
// and nothing downstream had to change for grouping to land.

import { computeClues, isSolved } from '../puzzle.js';
import { cellCount, solutionFor } from '../levels.js';
import { loadProgress, saveProgress } from './progress.js';
import { BLANK, FILLED, MARKED, CELL_STATE_COUNT } from './cells.js';

export { BLANK, FILLED, MARKED };

const EVENTS = ['cell', 'solved'];

export function createSession(spec) {
  const dims = spec.dims;
  const total = cellCount(dims);
  const solution = solutionFor(spec);
  const clues = computeClues(dims, solution);

  const saved = loadProgress(spec.id);
  // Length check guards against a puzzle's dims changing under an old save —
  // without it, `Uint8Array.from` would silently produce a wrong-sized board.
  const restored = Array.isArray(saved?.state) && saved.state.length === total;
  const state = restored ? Uint8Array.from(saved.state) : new Uint8Array(total);
  let solved = restored ? !!saved.solved : false;

  /** Undo stack, oldest first. Each entry is one group: [{ i, prev }, …]. */
  const history = [];
  /** The open stroke's group, or null when no stroke is in flight. */
  let stroke = null;
  const listeners = new Map(EVENTS.map((evt) => [evt, new Set()]));

  function emit(evt, payload) {
    for (const fn of listeners.get(evt)) fn(payload);
  }

  /** Cells the player has filled in, as 0/1 — what the clues are read against. */
  const filledOnly = () => Array.from(state, (v) => (v === FILLED ? 1 : 0));

  // Persistence is coalesced across a batch — one paint stroke, or one grouped undo.
  // `saveProgress` is a read-modify-write of ~700 bytes of JSON on a 6³ board, and a
  // drag crosses a dozen cells, so batching turns a stroke into a single store write.
  let batchDepth = 0;
  let pendingWrite = false;

  function persist() {
    if (batchDepth > 0) {
      pendingWrite = true;
      return;
    }
    saveProgress(spec.id, state, solved);
  }

  function openBatch() {
    batchDepth++;
  }

  function closeBatch() {
    batchDepth = Math.max(0, batchDepth - 1);
    if (batchDepth > 0 || !pendingWrite) return;
    pendingWrite = false;
    persist();
  }

  function set(i, value, { undoable = false } = {}) {
    if (undoable) {
      if (solved) return null;
      // A set that changes nothing contributes nothing to undo — pushing it would make
      // one undo press look like a no-op to the player.
      if (state[i] !== value) {
        if (stroke) stroke.push({ i, prev: state[i] });
        else history.push([{ i, prev: state[i] }]);
      }
    }
    state[i] = value;
    emit('cell', { i, value });
    if (!solved && isSolved(filledOnly(), solution)) {
      solved = true;
      emit('solved');
    }
    persist();
    return value;
  }

  function cycle(i) {
    if (solved) return null;
    return set(i, (state[i] + 1) % CELL_STATE_COUNT, { undoable: true });
  }

  function beginStroke() {
    // Already inside one: keep a single group rather than splitting it. A UI that
    // double-fires pointerdown should still cost exactly one undo.
    if (stroke) return;
    stroke = [];
    openBatch();
  }

  function endStroke() {
    if (!stroke) return 0;
    const count = stroke.length;
    // An empty stroke — a drag that never crossed a cell — must not leave a group
    // behind, or the undo button would answer a press by doing nothing.
    if (count > 0) history.push(stroke);
    stroke = null;
    closeBatch();
    return count;
  }

  function undo() {
    openBatch();
    // Undoing mid-stroke takes that stroke back whole, so the API is total: no caller
    // has to care whether a drag is still in flight.
    endStroke();
    const group = solved ? null : history.pop();
    let last = null;
    if (group) {
      // Reverse order: a stroke that crossed the same cell twice has to land on the
      // value it held before the stroke, not the one it held mid-stroke.
      for (let n = group.length - 1; n >= 0; n--) {
        const { i, prev } = group[n];
        set(i, prev);
        last = { i, value: prev };
      }
    }
    closeBatch();
    return last;
  }

  return {
    spec,
    dims,
    clues,
    solution,
    state,
    restored,
    get solved() {
      return solved;
    },
    cycle,
    set,
    beginStroke,
    endStroke,
    undo,
    canUndo: () => !solved && (history.length > 0 || stroke?.length > 0),
    currentRuns: () => computeClues(dims, filledOnly()),
    on(evt, fn) {
      listeners.get(evt)?.add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },
    off(evt, fn) {
      listeners.get(evt)?.delete(fn);
    },
  };
}
