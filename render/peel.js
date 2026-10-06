// render/peel.js — the depth cursor: how many layers to take off the front of the box.
//
// ## What this is for (DOO-17)
//
// `grid.pick()` takes the nearest hit along the ray, which is the only rule a player
// can predict, and which means an interior cell is only clickable through the gaps
// between the cells in front of it. QA measured what that costs on the shipped board,
// at the angle where each cell shows the most of itself (desktop 1280×860):
//
//   6×6×6   216 cells   min 100 px²   median 2,300 px²   49 cells under 24×24
//   l4-cat  112 cells the answer needs — 40 of them (36%) under 24×24, 10 unreachable
//           without dollying the camera *inside* the box and panning
//
// So the aiming problem is not in the picking rule, it is in the fact that the whole
// box is always in the way. This module takes the front of it off. `depth` layers are
// peeled from whichever face the camera is looking at, leaving the next layer exposed
// with a full cell-sized target for every one of its cells, and everything behind it
// still solid, still clickable, still where the player left it.
//
// A cumulative peel rather than a single-layer slice, deliberately: the layers *behind*
// the cursor stay visible, so the shape the player is uncovering stays legible and the
// box keeps the silhouette they orient by. A slice would expose the same cells with the
// same aperture and throw that away — and `grid.setLayerWindow` can still express one
// (`from === to`) if the UI track decides otherwise.
//
// ## Why the axis is re-read on every step and not tracked per frame
//
// Re-aiming while the camera moves would walk the exposed layer around under the
// player mid-rotation, which is precisely the disorientation this issue compounds.
// Re-aiming only when they press a key gives both halves: the cursor never moves on
// its own, and it always peels the face they are actually looking at. Turning to a new
// face and stepping starts that face from zero rather than carrying a depth over from
// the old axis, where it would name a layer nobody asked for.
//
// ## Status of the keyboard binding
//
// `[` / `]` step, `\` resets. That is a desktop stopgap, not the shipped affordance:
// it is undiscoverable and there is no touch equivalent, so mobile still has the
// original problem. The on-screen control (and teaching it) is DOO-28, on the UI/UX
// track, and it should drive this same API rather than reaching into the grid.
//
// Public API
//   peelWindow(dims, facing, depth)  pure -> a layer window for grid.setLayerWindow
//   mountPeel({ view, getGrid, keyTarget }) -> {
//     depth()        current cursor depth, 0 = nothing peeled
//     step(delta)    -> the depth actually applied
//     setDepth(n)    -> the depth actually applied
//     reset()        back to the whole board
//     state()        -> { depth, axis, sign, max, window }  (read-only snapshot)
//     dispose()
//   }

/**
 * The layer window that peeling `depth` layers off the near face produces.
 *
 * `facing` is `view.facing()`: a `sign` of -1 means the camera looks towards decreasing
 * coordinates, so the near face is the *high* end and the window keeps the low layers.
 * Depth 0 returns null — the whole board, and the one state that renders and picks
 * exactly as it did before this module existed.
 */
export function peelWindow(dims, { axis, sign } = {}, depth = 0) {
  const n = dims?.[axis];
  if (!Number.isFinite(n) || n < 1) return null;
  const d = Math.max(0, Math.min(n - 1, Math.trunc(Number(depth)) || 0));
  if (d === 0) return null;
  return sign < 0 ? { axis, from: 0, to: n - 1 - d } : { axis, from: d, to: n - 1 };
}

export function mountPeel({ view, getGrid, keyTarget = globalThis.window ?? null } = {}) {
  let depth = 0;
  let axis = 'x';
  let sign = -1;
  // The grid the cursor is currently applied to. A new puzzle builds a new grid with no
  // window, so the cursor has to come back to 0 with it — detected here rather than
  // asking main.js to call reset() from openPuzzle, which would be a second place for
  // the two to get out of step.
  let bound = null;

  function grid() {
    const next = getGrid?.() ?? null;
    if (next !== bound) {
      bound = next;
      depth = 0;
    }
    return next;
  }

  const maxDepth = (g) => Math.max(0, (g.dims[axis] ?? 1) - 1);

  /** Point the cursor at the face the camera is on now. -> true if it moved. */
  function reaim() {
    const next = view?.facing?.();
    if (!next || (next.axis === axis && next.sign === sign)) return false;
    axis = next.axis;
    sign = next.sign;
    depth = 0;
    return true;
  }

  function apply(g) {
    g.setLayerWindow(peelWindow(g.dims, { axis, sign }, depth));
    return depth;
  }

  function setDepth(next) {
    const g = grid();
    if (!g) return 0;
    reaim();
    depth = Math.max(0, Math.min(maxDepth(g), Math.trunc(Number(next)) || 0));
    return apply(g);
  }

  function step(delta) {
    const g = grid();
    if (!g) return 0;
    reaim();
    depth = Math.max(0, Math.min(maxDepth(g), depth + (Math.trunc(Number(delta)) || 0)));
    return apply(g);
  }

  function reset() {
    const g = grid();
    depth = 0;
    return g ? apply(g) : 0;
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === ']') step(1);
    else if (event.key === '[') step(-1);
    else if (event.key === '\\') reset();
    else return;
    event.preventDefault();
  }

  keyTarget?.addEventListener?.('keydown', onKeyDown);

  return {
    depth: () => depth,
    step,
    setDepth,
    reset,

    state() {
      const g = grid();
      return {
        depth,
        axis,
        sign,
        max: g ? maxDepth(g) : 0,
        window: g?.layerWindow?.() ?? null,
      };
    },

    dispose() {
      keyTarget?.removeEventListener?.('keydown', onKeyDown);
    },
  };
}
