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
//   .set(i, value)   set directly (not pushed onto the undo stack)
//   .undo()          -> { i, value } | null
//   .canUndo()       -> boolean
//   .currentRuns()   -> clue grids as read off the *current* board
//   .on(evt, fn)     -> unsubscribe fn;  .off(evt, fn)
//
// Events: 'cell' ({ i, value }) | 'solved' ()

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

  const history = [];
  const listeners = new Map(EVENTS.map((evt) => [evt, new Set()]));

  function emit(evt, payload) {
    for (const fn of listeners.get(evt)) fn(payload);
  }

  /** Cells the player has filled in, as 0/1 — what the clues are read against. */
  const filledOnly = () => Array.from(state, (v) => (v === FILLED ? 1 : 0));

  function persist() {
    saveProgress(spec.id, state, solved);
  }

  function set(i, value) {
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
    const prev = state[i];
    history.push({ i, prev });
    return set(i, (prev + 1) % CELL_STATE_COUNT);
  }

  function undo() {
    if (solved || history.length === 0) return null;
    const { i, prev } = history.pop();
    set(i, prev);
    return { i, value: prev };
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
    undo,
    canUndo: () => !solved && history.length > 0,
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
