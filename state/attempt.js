// state/attempt.js — the live record for one attempt at one puzzle: timer, mistake
// count, hint spend, and the best-record comparison at the moment of clearing.
//
// OWNER: game-design track. DOM- and THREE-free so it tests in node like the rest of
// `state/`; it only needs a session to subscribe to and an injectable clock.
//
// ## Why mistakes are counted on *commit*, not on click
//
// A click cycles BLANK -> FILLED -> MARKED -> BLANK, so marking a cell "definitely
// empty" has to pass *through* FILLED. Counting every wrong FILLED would charge a
// mistake for every correct mark — the exact opposite of what the number means. So a
// wrong fill is only a mistake once the player **leaves it standing**: they touch a
// different cell, the puzzle is cleared, or the attempt is paused/closed. Cycling the
// same cell onward within that window costs nothing.
//
// Each wrong cell counts at most once per attempt. The number is "how many cells did
// you get wrong", not "how many times did you click a wrong cell" — repeatedly
// re-filling the same cell while thinking it through is one mistake, not five.
//
// Public API — createAttempt({ session, now?, persist? }) returns:
//   .elapsedMs()      accumulated play time, live while running
//   .mistakes() .hints() .hintUses()
//   .best()           -> { ms, mistakes, hints, at } | null   (stored best, pre-clear)
//   .result()         -> null until cleared, then
//                        { ms, mistakes, hints, hintUses, isBest, previousBest }
//   .resume() .pause() .running()
//   .noteHint(cost)   charge one hint use of `cost` points
//   .flush()          force a persist (and commit any pending wrong fill)
//   .on(evt, fn)      -> unsubscribe;   events: 'change' | 'mistake' | 'cleared'
//   .dispose()

import { FILLED } from './cells.js';
import { loadRecord, saveRecord } from './progress.js';

const EVENTS = ['change', 'mistake', 'cleared'];

// The timer is persisted on a coarse interval rather than on every click: a 6³ board
// is ~700 bytes of JSON and a fast player clicks several times a second.
const PERSIST_INTERVAL_MS = 2000;

export function createAttempt({ session, now = () => Date.now(), persist = saveRecord } = {}) {
  const puzzleId = session.spec.id;
  const stored = loadRecord(puzzleId);

  // A solved puzzle reopened for a second look must not keep ticking: the record is
  // already set, and a replay would otherwise inflate elapsedMs forever.
  const finished = session.solved;

  let baseMs = stored.elapsedMs;
  // An explicit flag rather than `startedAt !== 0`: a clock that legitimately reads 0
  // (any injected test clock, and `performance.now()` at process start) would otherwise
  // be indistinguishable from "stopped".
  let isRunning = false;
  let startedAt = 0;
  let mistakes = stored.mistakes;
  let hints = stored.hints;
  let hintUses = stored.hintUses;
  let best = stored.best;
  let result = null;
  let lastPersistAt = 0;

  // The wrong fill that has not been committed yet, and the cells already charged.
  let pendingWrong = null;
  const charged = new Set();

  const listeners = new Map(EVENTS.map((e) => [e, new Set()]));
  const emit = (evt, payload) => {
    for (const fn of listeners.get(evt)) fn(payload);
  };

  const running = () => isRunning;
  const elapsedMs = () => baseMs + (isRunning ? Math.max(0, now() - startedAt) : 0);

  function write() {
    lastPersistAt = now();
    persist(puzzleId, {
      elapsedMs: elapsedMs(),
      mistakes,
      hints,
      hintUses,
      best,
      clears: stored.clears,
    });
  }

  function maybeWrite() {
    if (now() - lastPersistAt >= PERSIST_INTERVAL_MS) write();
  }

  /** Charge the outstanding wrong fill, if the player left it standing. */
  function commitPendingWrong() {
    if (pendingWrong === null) return;
    const i = pendingWrong;
    pendingWrong = null;
    if (charged.has(i) || session.state[i] !== FILLED) return;
    charged.add(i);
    mistakes++;
    emit('mistake', { i, mistakes });
    emit('change');
    write();
  }

  function onCell({ i, value }) {
    if (pendingWrong !== null && pendingWrong !== i) commitPendingWrong();

    const wrongFill = value === FILLED && !session.solution[i];
    if (wrongFill) pendingWrong = i;
    else if (pendingWrong === i) pendingWrong = null; // cycled onward / corrected

    emit('change');
    maybeWrite();
  }

  function onSolved() {
    // Clearing means every filled cell matches the solution, so nothing can be
    // pending — but drop it explicitly rather than relying on that.
    pendingWrong = null;
    pause();

    const ms = elapsedMs();
    const previousBest = best;
    const isBest = !previousBest || ms < previousBest.ms;
    if (isBest) best = { ms, mistakes, hints, hintUses, at: now() };
    stored.clears += 1;
    result = { ms, mistakes, hints, hintUses, isBest, previousBest };

    write();
    emit('change');
    emit('cleared', result);
  }

  function resume() {
    if (finished || isRunning) return;
    isRunning = true;
    startedAt = now();
    lastPersistAt = now();
    emit('change');
  }

  function pause() {
    if (!isRunning) return;
    baseMs = elapsedMs();
    isRunning = false;
    startedAt = 0;
    commitPendingWrong();
    write();
    emit('change');
  }

  const offCell = session.on('cell', onCell);
  const offSolved = session.on('solved', onSolved);

  return {
    puzzleId,
    elapsedMs,
    running,
    mistakes: () => mistakes,
    hints: () => hints,
    hintUses: () => hintUses,
    clears: () => stored.clears,
    best: () => best,
    result: () => result,
    resume,
    pause,

    noteHint(cost = 1) {
      hints += Math.max(0, Math.floor(cost));
      hintUses += 1;
      emit('change');
      write();
      return { hints, hintUses };
    },

    flush() {
      commitPendingWrong();
      write();
    },

    on(evt, fn) {
      listeners.get(evt)?.add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },

    dispose() {
      pause();
      offCell();
      offSolved();
      for (const set of listeners.values()) set.clear();
    },
  };
}

/** mm:ss, or h:mm:ss past an hour. Used by the HUD and the clear card. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
