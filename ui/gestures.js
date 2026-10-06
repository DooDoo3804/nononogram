// ui/gestures.js — one pointer on the board can mean four different things, and
// this module is the only place that decides which.
//
//   tap           (moved < SLOP, no second finger)   cycle the cell
//   long press    (held >= HOLD_MS without moving)   mark the cell ✕
//   drag          rotate mode -> OrbitControls spins the camera
//                 paint mode  -> paint every cell the pointer crosses
//   two fingers   OrbitControls: pinch zoom and pan
//
// Why a mode switch rather than inferring from where the drag began: on a 6³ board
// the cube covers most of the viewport, so "drag starting on a cell paints, drag
// starting on background rotates" would make rotation nearly unreachable and would
// turn every slightly-sloppy rotation into an accidental fill. The mode is explicit
// and visible in the top band; `P` toggles it and Shift holds the other one
// temporarily, both on desktop.
//
// The misfire guard that matters most is SLOP being measured against the furthest
// the pointer ever got from where it went down, not against where it came back up.
// A rotation that loops back to its starting point is a drag, not a tap — the old
// down/up distance check read it as a tap and flipped a cell under the player's
// finger.
//
// Public API — mountGestures({ canvas, view, getSession, getGrid, onModeChange })
//   .mode()                 'rotate' | 'paint'
//   .setMode(mode)          -> the mode actually applied
//   .toggleMode()           -> the new mode
//   .dispose()
//
// ## Why this file was missing (DOO-16)
//
// It was written for DOO-5 and rewired onto the session stroke API for DOO-10, but on a
// UI-track branch that never reached the integration branch — only DOO-10's `state/`
// half landed. So `beginStroke()`/`endStroke()` existed, were tested, and had no caller:
// `main.js` had a pointerup-only handler and no `pointermove`, which is to say the app
// shipped without drag painting at all. Restored here unchanged apart from the `P`
// shortcut, so the feature DOO-10 grouped undo *for* is reachable again.

import { BLANK, FILLED, MARKED } from '../state/cells.js';

/** Furthest a pointer may stray and still count as a tap, in CSS px. */
export const SLOP = 8;
/** Hold this long without straying and it's a ✕ mark, not a tap. */
export const HOLD_MS = 450;

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

export function mountGestures({ canvas, view, getSession, getGrid, onModeChange } = {}) {
  const board = canvas.closest('#board') ?? canvas.parentElement;

  let mode = 'rotate';
  let shiftHeld = false;

  // The gesture in flight. `id` null means nothing is down.
  let id = null;
  let startX = 0;
  let startY = 0;
  let drift = 0; // furthest distance from the start point, ever
  let holdTimer = 0;
  let consumed = false; // a long press or a paint stroke already handled this gesture
  let multi = false; // a second finger landed; this is a pinch, not a tap
  let strokeValue = null; // what a paint drag is painting
  const strokePainted = new Set();

  function effectiveMode() {
    return shiftHeld ? (mode === 'paint' ? 'rotate' : 'paint') : mode;
  }

  // Rotation and painting both want one-finger drags, so only one of them can be
  // listening at a time. OrbitControls keeps pinch-zoom and two-finger pan either way.
  function syncControls() {
    view.controls.enableRotate = effectiveMode() === 'rotate';
    board?.setAttribute('data-mode', effectiveMode());
  }

  function pickAt(event) {
    const grid = getGrid();
    return grid ? grid.pick(view.rayFrom(event)) : null;
  }

  function playable() {
    const session = getSession();
    return session && !session.solved ? session : null;
  }

  // Closes the session's undo group too, so the whole drag comes back on one undo
  // press. Every exit from a stroke — pointerup, cancel, a second finger — goes
  // through here, and session.endStroke() is a no-op when no stroke is open.
  function endStroke() {
    if (strokeValue !== null) getSession()?.endStroke();
    strokeValue = null;
    strokePainted.clear();
    board?.removeAttribute('data-painting');
  }

  function reset() {
    clearTimeout(holdTimer);
    holdTimer = 0;
    id = null;
    consumed = false;
    endStroke();
  }

  function onPointerDown(event) {
    if (id !== null) {
      // A second finger: this is a pinch. Abandon whatever the first one was doing
      // so letting go doesn't also toggle a cell.
      multi = true;
      clearTimeout(holdTimer);
      consumed = true;
      endStroke();
      return;
    }
    id = event.pointerId;
    multi = false;
    consumed = false;
    drift = 0;
    startX = event.clientX;
    startY = event.clientY;

    const session = playable();
    if (!session) return;

    if (effectiveMode() === 'paint') {
      const i = pickAt(event);
      if (i !== null) {
        // A stroke paints one value, decided by the cell it started on: starting on
        // an empty cell fills, starting on a filled one erases. Same rule as 2D
        // nonograms, and it makes a stroke undoable in the obvious direction.
        strokeValue = session.state[i] === FILLED ? BLANK : FILLED;
        // One undo group for the whole stroke — see state/session.js. Painting goes
        // through the undoable set() rather than cycle(), so a cell lands on the
        // stroke's value in one step instead of walking the 3-ring to reach it.
        session.beginStroke();
        session.set(i, strokeValue, { undoable: true });
        strokePainted.add(i);
        consumed = true;
        board?.setAttribute('data-painting', '1');
      }
    }

    holdTimer = setTimeout(() => {
      holdTimer = 0;
      if (consumed || multi || drift >= SLOP) return;
      const held = playable();
      if (!held) return;
      const i = pickAt(event);
      if (i === null) return;
      // Long press always means ✕ — pressing an already-marked cell clears it, so the
      // gesture is its own undo.
      held.set(i, held.state[i] === MARKED ? BLANK : MARKED, { undoable: true });
      consumed = true;
      buzz(15);
    }, HOLD_MS);
  }

  function onPointerMove(event) {
    if (event.pointerId !== id) return;
    drift = Math.max(drift, Math.hypot(event.clientX - startX, event.clientY - startY));
    if (drift >= SLOP && holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
    if (strokeValue === null || multi) return;

    const session = playable();
    if (!session) return;
    const i = pickAt(event);
    // `strokePainted` keeps a stroke from re-toggling a cell when the pointer wobbles
    // back across it — without it, dragging along a line flickers cells on and off.
    if (i !== null && !strokePainted.has(i)) {
      session.set(i, strokeValue, { undoable: true });
      strokePainted.add(i);
    }
  }

  function onPointerUp(event) {
    if (event.pointerId !== id) return;
    clearTimeout(holdTimer);
    holdTimer = 0;

    const tapped = !consumed && !multi && drift < SLOP;
    if (tapped) {
      const session = playable();
      const i = session ? pickAt(event) : null;
      if (i !== null) session.cycle(i);
    }
    reset();
  }

  function onPointerCancel(event) {
    if (event.pointerId !== id) return;
    reset();
  }

  // Named rather than only a method on the returned object, so the `P` handler below
  // and the mode button go through exactly one path.
  function applyMode(next) {
    mode = next === 'paint' ? 'paint' : 'rotate';
    syncControls();
    onModeChange?.(effectiveMode(), { transient: false });
    return effectiveMode();
  }

  // Shift is a hold-to-switch, not a toggle: let go mid-drag and the drag keeps the
  // mode it started in, because syncControls only runs between gestures.
  function onKeyDown(event) {
    if (event.key === 'Shift' && !shiftHeld) {
      shiftHeld = true;
      if (id === null) syncControls();
      onModeChange?.(effectiveMode(), { transient: true });
      return;
    }
    // `P` is the sticky counterpart to holding Shift — a desktop player painting a long
    // run should not have to keep a modifier down for it. Ignored while a gesture is in
    // flight: flipping the mode mid-stroke would leave `strokeValue` painting in a mode
    // the player has already left.
    if ((event.key === 'p' || event.key === 'P') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (id !== null) return;
      applyMode(mode === 'paint' ? 'rotate' : 'paint');
    }
  }
  function onKeyUp(event) {
    if (event.key === 'Shift' && shiftHeld) {
      shiftHeld = false;
      if (id === null) syncControls();
      onModeChange?.(effectiveMode(), { transient: true });
    }
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  function onBlur() {
    if (!shiftHeld) return;
    shiftHeld = false;
    syncControls();
    onModeChange?.(effectiveMode(), { transient: true });
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  // A context menu on long press would cancel the hold before it ever fires.
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  syncControls();

  return {
    mode: () => effectiveMode(),

    setMode: applyMode,

    toggleMode() {
      return applyMode(mode === 'paint' ? 'rotate' : 'paint');
    },

    dispose() {
      reset();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
