// tests/playtest.mjs — the QA playtest harness for DOO-8.
//
// OWNER: QA track. Touches no production code: everything it needs it gets from the
// shipped `window.__nonogram` handle, from the DOM, and from dispatched input events.
//
//   node tests/playtest.mjs reach <baseUrl> <outDir> [--dims=6x6x6,…] [--step=6]
//   node tests/playtest.mjs play  <baseUrl> <outDir> [--platform=desktop|mobile]
//   node tests/playtest.mjs edge  <baseUrl> <outDir>
//
// ## Why this exists on top of scripts/verify-browser.mjs
//
// The platform gate proves the render contract: a click raycasts, the dims label is
// right, draw calls stay flat. It proves nothing about whether a *person* can finish a
// puzzle. The gap this harness was written to measure:
//
//   render/voxels.js raycasts against a `hit` InstancedMesh that covers **every** cell,
//   visible or not, and `pick()` takes `intersectObject(...)[0]` — the nearest hit. So
//   the cell a click lands on is always the frontmost cell of the box along that ray,
//   whatever its state. Marking a cell does not remove its hit box.
//
//   21 of the 24 shapes have filled cells that are strictly inside the box (l4-cat has
//   56 of them). If the frontmost-hit rule means those cells cannot be clicked, those
//   puzzles cannot be finished — and no solver check would ever see it, because the
//   solver works on the grid, not on the camera.
//
// So `reach` answers one question per box size: **which cells can a pointer actually
// address, and at what interaction cost?** It answers it by tapping, not by re-deriving
// the projection — every sample goes through the production
// `pointerup -> view.rayFrom -> grid.pick -> session.cycle` path and the answer is read
// off the `cell` event the session emits. There is no second copy of the math here to
// drift out of agreement with the renderer.
//
// ## What is synthetic and what is real
//
// Two different claims need two different kinds of event, so the harness uses both and
// never conflates them:
//
//   synthetic `canvas.dispatchEvent(new PointerEvent(...))` — thousands of samples, used
//     to map pixel -> cell. Exercises the real listener, the real raycast, the real
//     session. Does NOT exercise the browser's own hit-testing, so it cannot see an
//     overlay stealing the tap.
//   real `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent` via CDP — slower, used
//     for the playthroughs and for a routing spot-check at every orientation. These go
//     through Chrome's hit-testing, so an element covering the canvas shows up here.
//
// This file used to declare "a cell is only ever reported reachable if a real event has
// landed on it". That was never what the code did — `reach` confirms a *sample* (one cell
// per cost band, plus the tightest aperture it found, plus the tightest the depth cursor
// found) and the map keeps every cell either way. DOO-31 called that out, so the claim is
// now the narrower true one: **the reach map is synthetic, and a sample of it is
// re-checked with a real event at the camera that produced it.** Every confirmation is
// recorded with its outcome, the summary prints `confirmed N/M`, and a confirmation
// failure is a failed check rather than a line in a JSON file nobody opens.
//
// ## Why every wait in here is counted in frames (DOO-31)
//
// OrbitControls with `enableDamping` does not integrate over time. `update()` applies
// `sphericalDelta * dampingFactor` and then multiplies the delta by `1 - dampingFactor`,
// with no `dt` anywhere in either line, and `render/scene.js` calls `update()` exactly
// once per rAF tick. So the camera after a drag is a pure function of the dispatched
// events and **the number of frames that have run since** — nothing else. At the shipped
// 0.05 damping a drag is 0.95^n of the way from done after n frames:
//
//   n = 25 frames (the old `sleep(420)` at 60fps)   28% of the drag still unapplied
//   n = 60                                           4.6%
//   n = 120                                          0.2%
//
// A 2*pi/8 drag on a 1280x860 desktop moves the board's silhouette a few hundred px, so
// "28% unapplied" is tens of pixels of camera — which is why the same build rastered
// 37 cells under 24x24 one run and 22 the next: a busy machine fitted fewer frames into
// those 420ms and the raster ran at a different camera. The spread was not noise in the
// measurement, it was the measurement running before the thing it measures stopped.
//
// Everything therefore waits on frames, and `settle()` goes one better: it polls a
// camera-derived observable every few frames and only returns when the per-frame movement
// is under `epsPx`. Because the frame sequence is deterministic, two runs of the same
// build stop on the same frame at the same camera. A step that does not converge inside
// `maxFrames` is written to `perStep` with `settled: false` and its raster is dropped
// from the maps — an unsettled step is an unknown, and an unknown must not be averaged
// into a release verdict.
//
// The observable is the sub-pixel position of two footprint edges, bisected through the
// production pick path (see `feature()`). It is not a second copy of the projection: it
// is the same raycast the player's clicks go through, asked where a cell ends.
//
// What this gets to, measured on two runs of the same build taken *concurrently* on one
// machine — the contention the bug report blamed, imposed on purpose:
//
//                                      before (DOO-31's table)   after
//   6³ cells reached                   210 vs 213                206 vs 206
//   cells under 24x24                   37 vs  22                 42 vs  42
//   l4-cat required cells not reached    6 vs   3 (disjoint sets)   9 vs   9 (same set)
//   cells crossing 576px² in one run     18                         0
//   sweep steps whose raster differed    19 of 32 (max 29 cells)    3 of 42 (max 1 cell)
//
// The residual is 10 of 206 cells whose aperture differs by one raster sample — 100 px²
// on cells measuring 3,000 to 90,000 — and it moves no number any verdict reads. Its
// cause is known and is a floor, not a bug: `settle` stops at 0.03 px/frame, which
// leaves about 0.6 px of asymptotic camera motion still to come, and how many frames of
// *that* elapse before the next act depends on CDP round-trip timing. Driving `epsPx`
// lower trades frames for it; 0.03 is where the measurement resolution (0.004 px) still
// has a comfortable margin.
//
// One production-adjacent stub, disclosed because it is a stub: OrbitControls calls
// `setPointerCapture(event.pointerId)` on pointerdown, which throws for a synthetic
// pointer id that the browser has no record of. `install()` replaces the three capture
// methods on the canvas element with no-ops for the duration of a run. It changes no
// repo file and does not affect the real-event paths.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

// --- platforms ---------------------------------------------------------------
// The mobile profile is a mid-range Android: Pixel-class viewport, 2.625 DPR, touch
// on, and the 4x CPU throttle DOO-7 used as its stand-in for a slower phone.

export const PLATFORMS = {
  desktop: { label: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1, touch: false },
  mobile: { label: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4, touch: true },
};

// Known noise owned by other tracks, same list scripts/verify-browser.mjs filters.
const IGNORED_NOISE = /fonts\.(googleapis|gstatic)\.com|favicon\.ico/;

const parseDims = (s) => {
  const [x, y, z] = s.split('x').map(Number);
  return { x, y, z };
};
const dimsKey = (d) => `${d.x}x${d.y}x${d.z}`;

// --- the in-page probe -------------------------------------------------------
// Injected as one expression so it can be re-installed after every navigation.
// Everything it reads is already public: `window.__nonogram` and the DOM.

const PROBE = `(() => {
  const canvas = document.getElementById('scene');
  // See the header note: synthetic pointer ids have no browser-side pointer to capture.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  let hits = [];
  let offCell = null;

  const session = () => window.__nonogram.session();

  function listen() {
    offCell?.();
    offCell = session().on('cell', ({ i }) => hits.push(i));
  }

  function fire(type, px, py, extra = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: px, clientY: py, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window, ...extra,
    }));
  }

  /** One synthetic tap. -> the cell index it landed on, or null. */
  function tap(px, py) {
    hits = [];
    fire('pointerdown', px, py, { button: 0, buttons: 1 });
    fire('pointerup', px, py, { button: 0, buttons: 0 });
    return hits.length ? hits[0] : null;
  }

  /**
   * One synthetic tap that puts the cell it touched straight back.
   *
   * \`before\` is the board as it was, so this is usable mid-playthrough and not only on
   * a blank board. Fractional pixels are deliberate: CSSOM View types
   * \`MouseEventInit.clientX\` as a double, \`view.rayFrom\` divides it by the canvas rect,
   * and the bisection below needs that to resolve a boundary to a fraction of a pixel.
   * \`subPixel()\` asserts the browser really kept the fraction.
   */
  function peek(px, py, before) {
    const i = tap(px, py);
    if (i !== null) session().set(i, before[i]);
    return i;
  }

  /**
   * Make the board un-completable for the duration of a probe sweep.
   *
   * A synthetic tap goes through the production \`cycle()\`, which is
   * \`set(i, next, { undoable: true })\` — and \`set\` latches \`solved\` the instant the
   * FILLED set equals the solution. The restore that every probe does afterwards is a
   * plain \`set\`, which by design does *not* respect the solved lock. So a probe that
   * happens to complete the board leaves the session latched \`solved\` on a board that
   * is one cell short, and from then on \`cycle()\` returns null and no real tap can
   * change anything. The playthrough is handed its clear by the harness instead of by
   * the player's input, and the cell the probe was hunting for is unfillable for good.
   *
   * \`settle(probe: false)\` already exists to dodge this on the camera path. \`findPixel\`
   * cannot dodge it the same way — its whole job is to probe a part-played board, and
   * the board it is called on is by definition missing the cell being hunted, which on
   * the last group of a playthrough is the only one still missing.
   *
   * The guard parks one cell the solution does *not* want as FILLED. \`isSolved\` is a
   * cell-by-cell compare, so a single wrong filled cell keeps it false for the whole
   * sweep no matter what the probes land on. \`park\` is returned so the per-tap restores
   * can leave it alone; the caller's final restore-to-\`before\` loop unparks it, and that
   * \`set\` re-runs the latch check against the real board.
   *
   * \`peek\` is deliberately not guarded: \`settle\` only probes a blank board, and one tap
   * on a blank board can only complete a one-cell solution, which no shipped puzzle is.
   */
  function latchGuard(before) {
    const s = session();
    const park = Array.prototype.findIndex.call(s.solution, (v) => !v);
    // A solution wanting every cell in the box cannot be guarded this way — and could
    // not be a puzzle either (a full box carries no clue information). Reported rather
    // than silently probed without a guard.
    if (park < 0) return { park: -1, guarded: false };
    if (before[park] !== 1) s.set(park, 1);
    return { park, guarded: true };
  }

  /**
   * Put the board back to \`before\`, releasing \`latchGuard\`'s parked cell last.
   *
   * The order is the whole point, and getting it wrong reintroduces the exact bug the
   * guard exists to stop. Restoring in index order releases the park while the probe's
   * last tap is still on the board — so if that tap was the one cell the board was
   * missing, the board passes *through* the solution between unparking cell \`park\` and
   * clearing the tapped cell. \`set\` runs its latch check on every write, including those
   * intermediate ones, so \`solved\` latches on a state that existed for one statement.
   * (Measured: l1-plus parks cell 0 and probes cell 22, and index-order restore latched
   * on every single run.) Clearing every other cell first means the park is released
   * onto a board already short at least one cell.
   */
  function unwind(before, park) {
    const s = session();
    for (let i = 0; i < s.state.length; i++) {
      if (i === park) continue;
      if (s.state[i] !== before[i]) s.set(i, before[i]);
    }
    if (park >= 0 && s.state[park] !== before[park]) s.set(park, before[park]);
  }

  // --- the three camera gestures ---------------------------------------------
  // Closures rather than methods on the returned object, so \`act()\` can dispatch one
  // and start settling it without a round trip in between — see \`act()\`. The object
  // still exposes all three under their old names for the callers that drive them on
  // their own.

  function orbitBy(dx, dy, steps = 6) {
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    fire('pointerdown', cx, cy, { button: 0, buttons: 1 });
    for (let n = 1; n <= steps; n++) {
      fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 1 });
    }
    fire('pointerup', cx + dx, cy + dy, { button: 0, buttons: 0 });
    return true;
  }

  function panBy(dx, dy, steps = 5) {
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    fire('pointerdown', cx, cy, { button: 2, buttons: 2 });
    for (let n = 1; n <= steps; n++)
      fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 2 });
    fire('pointerup', cx + dx, cy + dy, { button: 2, buttons: 0 });
    return true;
  }

  function zoomBy(deltaY, ticks = 1) {
    const r = canvas.getBoundingClientRect();
    for (let n = 0; n < ticks; n++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        bubbles: true, cancelable: true,
      }));
    }
    return true;
  }

  /** Resolve after exactly \`n\` animation frames have run. */
  function waitFrames(n) {
    return new Promise((resolve) => {
      let left = Math.max(1, Math.trunc(n) || 1);
      const tick = () => (--left <= 0 ? resolve(true) : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }

  /**
   * Sub-pixel position of the first cell boundary going (dx, dy) from the canvas centre.
   *
   * Walk out from the centre in \`coarse\` steps until the picked cell stops being the one
   * under the centre, then bisect that bracket \`iters\` times. The result is a continuous
   * function of the camera — it moves when the camera moves and holds still when it does
   * not — measured entirely through the production pick path.
   *
   * Why a cell boundary and not the board's silhouette edge: the silhouette disappears
   * once the camera is dollied inside the box (the board fills the canvas and there is no
   * outside to bracket against), and the cost-3 sweep steps are exactly the ones that put
   * it there. Two adjacent cells, on the other hand, meet somewhere near the middle of
   * the screen at every camera in the plan.
   *
   * -> { t, key } | null   \`key\` is the pair of cells that meet here: if the camera turns
   * far enough that a different pair is at the centre, \`t\` is not comparable with the
   * previous reading, and the caller uses \`key\` to notice instead of averaging across it.
   */
  /**
   * A pixel that is on the board right now.
   *
   * Scattered points rather than a walk out from the canvas centre, because at a
   * lattice-aligned camera there is no cell under the centre *and no cell anywhere along
   * the centre lines*. render/voxels.js draws 0.9-unit cubes on a 1.15 pitch, so a fifth
   * of every pitch is empty space; line the camera up with an axis and those gaps become
   * straight tunnels through the whole box. Worse, a fixed-stride walk down one stays in
   * phase with the on-screen pitch and misses every cell for the length of the canvas —
   * which is why a 24 px walk came back empty at 16 of 42 sweep steps while the raster at
   * the same camera was landing 2,500 taps on cells. The fractions are irregular and
   * clustered where the board is.
   */
  function anchor(before) {
    const r = canvas.getBoundingClientRect();
    const fr = [0.5, 0.43, 0.57, 0.36, 0.64, 0.29, 0.71];
    for (const fy of fr) {
      for (const fx of fr) {
        const px = r.left + r.width * fx;
        const py = r.top + r.height * fy;
        if (peek(px, py, before) !== null) return [px, py];
      }
    }
    return null;
  }

  /**
   * Sub-pixel edge of the footprint of the cell under \`from\`, walking (dx, dy).
   *
   * The walk starts fine and doubles, so a cell drawn 40 px across and one drawn 400 px
   * across both cost about ten samples; the bisection then resolves the bracket to
   * thousandths of a pixel. The board's own silhouette counts as an edge (\`b\` is null),
   * which is what keeps this answerable when one cell fills the view.
   */
  function boundary(from, dx, dy, before, iters = 13) {
    const r = canvas.getBoundingClientRect();
    const at = (t) => peek(from[0] + dx * t, from[1] + dy * t, before);
    const inside = (t) => {
      const px = from[0] + dx * t;
      const py = from[1] + dy * t;
      return px >= r.left && py >= r.top && px <= r.left + r.width && py <= r.top + r.height;
    };
    const a = at(0);
    if (a === null) return null;

    let lo = 0;
    let hi = -1;
    let b = null;
    let stride = 4;
    for (let t = stride; inside(t); t += stride, stride = Math.min(stride * 2, 32)) {
      const v = at(t);
      if (v === a) { lo = t; continue; }
      hi = t; b = v; break;
    }
    if (hi < 0) return null;
    for (let k = 0; k < iters; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid) === a) lo = mid; else hi = mid;
    }
    // Plain concatenation, not a template literal: this whole probe is itself a template
    // literal on the Node side, and a nested one would interpolate there instead of here.
    return { t: (lo + hi) / 2, key: a + '>' + (b === null ? 'out' : b) };
  }

  /**
   * The camera's observable: two footprint edges, to thousandths of a pixel.
   *
   * \`hint\` is the anchor a previous probe used. Re-using it is what makes consecutive
   * readings comparable — and it is re-validated first, so an anchor the camera has
   * moved off is replaced rather than silently measured from.
   *
   * -> { t: [...], key, anchor } | null
   */
  function feature(hint) {
    const before = Array.from(session().state);
    let from = null;
    if (hint && peek(hint[0], hint[1], before) !== null) from = hint;
    else from = anchor(before);
    if (!from) return null;

    const got = [];
    for (const d of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const edge = boundary(from, d[0], d[1], before);
      if (edge) got.push({ d, t: edge.t, key: edge.key });
      if (got.length >= 2) break;
    }
    if (!got.length) return null;
    return {
      t: got.map((g) => g.t),
      key: got.map((g) => g.d[0] + ',' + g.d[1] + ':' + g.key).join('|'),
      anchor: from,
    };
  }

  return {
    install() { listen(); return true; },

    rect() {
      const r = canvas.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },

    frames: waitFrames,
    feature,

    /**
     * Dispatch one camera act and settle it, in a single page call.
     *
     * Two round trips (dispatch, then settle) leave a gap no harness controls: the rAF
     * loop keeps running between them, so one run starts settling two frames into the
     * damping and the next starts one frame in, and the two land on cameras that differ
     * by the residual at that offset. Sub-pixel, but it was still enough to move a
     * raster sample at a cell edge on 8 of 42 steps. Doing both inside one call removes
     * the gap entirely: \`feature()\` here runs in the same synchronous block as the
     * dispatch, so \`before\` is exactly the camera at rest, and frame 1 of the settle is
     * exactly the first frame of the act.
     *
     * -> { before, ...settle() }
     */
    async act(spec, opts) {
      const r = canvas.getBoundingClientRect();
      const before = (opts && opts.probe === false) ? null : feature();
      if (spec.kind === 'orbit') orbitBy(spec.dx * r.height, spec.dy * r.height, 8);
      else if (spec.kind === 'zoom') zoomBy(-120, spec.ticks);
      else if (spec.kind === 'pan') panBy(spec.dx * r.width, spec.dy * r.height, 5);
      return { before, ...(await this.settle(opts)) };
    },

    /** The depth cursor, straight off the shipped read-only handle. */
    peelState() { return window.__nonogram.peel(); },

    /** Is the one-time depth-cursor lesson (ui/peel.js) currently over the board? */
    coachOpen() {
      const el = document.getElementById('peel-coach');
      return !!el && !el.hidden;
    },

    /**
     * Wait until the camera has stopped moving, and report in frames what happened.
     *
     * See the header for why frames are the clock. Two halves:
     *
     *   the frames themselves  which is what makes the final camera reproducible — the
     *     damping sequence is identical across runs, so stopping on frame n always stops
     *     at the same camera however loaded the machine was.
     *   the \`feature()\` poll  which is what makes "it has stopped" a measurement instead
     *     of a hope. Per-frame movement under \`epsPx\` for \`stable\` consecutive probes.
     *
     * Movement is reported per frame rather than per probe so the threshold means the
     * same thing whatever \`probeEvery\` is. Because the decay is geometric at 0.05, the
     * motion still to come when a probe reads \`d\` px/frame is about \`19 * d\` px — so
     * \`epsPx\` of 0.03 leaves well under a pixel of camera on the table.
     *
     * \`probe: false\` takes the frame count and skips the poll. \`play\` needs that: a probe
     * is a synthetic tap, and a tap on a board one cell from complete would latch
     * \`solved\` inside the session — which would hand a playthrough its clear from the
     * harness instead of from a real tap. The reproducible half still applies.
     *
     * -> { settled, probed, frames, perFramePx, at, trace, blind, reason }
     */
    async settle(opts) {
      const o = {
        minFrames: 12, maxFrames: 480, probeEvery: 8, epsPx: 0.03, stable: 2,
        probe: true, fixedFrames: 150, ...(opts || {}),
      };
      const s = session();
      const blank = !s.solved && Array.prototype.every.call(s.state, (v) => v === 0);
      if (!o.probe || !blank) {
        await waitFrames(o.fixedFrames);
        return {
          settled: null, probed: false, frames: o.fixedFrames,
          reason: o.probe ? 'board not blank — probing could latch solved' : 'probe disabled',
        };
      }

      let prev = feature();
      let hint = prev ? prev.anchor : null;
      let run = 0;
      let frames = 0;
      let perFramePx = null;
      let blind = 0;
      const trace = [];
      while (frames < o.maxFrames) {
        const n = Math.min(o.probeEvery, o.maxFrames - frames);
        await waitFrames(n);
        frames += n;
        const now = feature(hint);
        // Not one of the scattered anchor points landed on the board — nothing to
        // measure, so nothing can be claimed. The next probe searches again from
        // scratch. Counted, because a camera that stays unmeasurable is a failed settle
        // and not a settled one.
        if (!now) {
          blind++;
          prev = null;
          hint = null;
          run = 0;
          continue;
        }
        hint = now.anchor;
        if (prev && prev.key === now.key && prev.t.length === now.t.length) {
          perFramePx = Math.max(...now.t.map((v, i) => Math.abs(v - prev.t[i]))) / n;
          trace.push(Number(perFramePx.toFixed(4)));
          if (frames >= o.minFrames && perFramePx <= o.epsPx) {
            if (++run >= o.stable) {
              return { settled: true, probed: true, frames, perFramePx, at: now, trace, blind };
            }
          } else run = 0;
        } else run = 0;
        prev = now;
      }
      return {
        settled: false, probed: true, frames, perFramePx, trace, blind, at: prev,
        reason: blind
          ? 'no cell boundary near the canvas centre on ' + blind + ' of the probes'
          : 'still moving after ' + o.maxFrames + ' frames',
        key: prev ? prev.key : null,
      };
    },

    /**
     * Tap a grid of pixels across the canvas and report which cell each one hit.
     *
     * Every tap is reverted to BLANK immediately, so the board is unchanged at the end
     * and can never drift into the solved state mid-sweep (which would lock input and
     * silently truncate the map).
     *
     * ## Why the pixel per cell is the centroid and not the first hit
     *
     * The scan runs top-left to bottom-right, so the first pixel that reaches a cell is
     * always on the top-left edge of its on-screen footprint — one pixel from its
     * neighbour or from empty space. Replaying that pixel later is a coin flip: a
     * sub-pixel difference in where OrbitControls' damping settled the camera moves the
     * silhouette and the tap lands elsewhere. So each cell keeps the centroid of every
     * pixel that reached it, which is well inside a cell's (convex) footprint, and the
     * centroid is re-tapped here to confirm it still picks the same cell before it is
     * reported. A cell whose centroid does not confirm falls back to the recorded hit
     * closest to it.
     *
     * ## Why the hit count travels with the pixel
     *
     * "Reachable" turned out to be the wrong question on its own. Some interior cells
     * are reachable only through a gap between two nearer cells, and that gap is a
     * couple of pixels wide — a target no person can hit on purpose, and one a 1px
     * camera difference moves off. "samples" is how many raster points landed on the
     * cell, so samples * step * step is roughly the cell's clickable area in CSS px2,
     * which is the number the release verdict actually needs.
     *
     * -> { map: { cellIndex: { px, samples } }, taps, landed, refined }
     */
    raster(step, box) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      const x0 = Math.max(r.left, box?.left ?? r.left);
      const y0 = Math.max(r.top, box?.top ?? r.top);
      const x1 = Math.min(r.left + r.width, (box?.left ?? r.left) + (box?.width ?? r.width));
      const y1 = Math.min(r.top + r.height, (box?.top ?? r.top) + (box?.height ?? r.height));

      const acc = new Map(); // cell -> { n, sx, sy, pts: [[px, py], …] }
      let taps = 0;
      let landed = 0;
      for (let py = Math.round(y0 + step / 2); py < y1; py += step) {
        for (let px = Math.round(x0 + step / 2); px < x1; px += step) {
          taps++;
          const i = tap(px, py);
          if (i === null) continue;
          landed++;
          s.set(i, 0);
          let a = acc.get(i);
          if (!a) acc.set(i, (a = { n: 0, sx: 0, sy: 0, pts: [] }));
          a.n++; a.sx += px; a.sy += py; a.pts.push([px, py]);
        }
      }

      const map = {};
      let refined = 0;
      for (const [i, a] of acc) {
        const c = [Math.round(a.sx / a.n), Math.round(a.sy / a.n)];
        let px = c;
        if (tap(c[0], c[1]) === i) {
          s.set(i, 0);
        } else {
          s.set(i, 0);
          // Centroid missed — the footprint is concave, or it straddles a gap. Take the
          // recorded hit nearest the centroid: a pixel known to reach this cell.
          refined++;
          let bestD = Infinity;
          for (const p of a.pts) {
            const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
            if (d < bestD) { bestD = d; px = p; }
          }
        }
        map[i] = { px, samples: a.n };
      }
      return { map, taps, landed, refined };
    },

    /**
     * Screen bounding box of the whole board, found with a coarse pass.
     *
     * The board covers well under half the canvas, and the fine raster is the cost of
     * this whole mode, so clipping it to the board is a 3-4x saving per sweep step.
     * Padded by one coarse step so the fine pass cannot clip a silhouette edge.
     */
    bbox(coarse = 20) {
      listen();
      const s = session();
      const r = canvas.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let py = Math.round(r.top + coarse / 2); py < r.top + r.height; py += coarse) {
        for (let px = Math.round(r.left + coarse / 2); px < r.left + r.width; px += coarse) {
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
      if (!Number.isFinite(x0)) return { left: r.left, top: r.top, width: r.width, height: r.height };
      return {
        left: x0 - coarse, top: y0 - coarse,
        width: x1 - x0 + 2 * coarse, height: y1 - y0 + 2 * coarse,
      };
    },

    /** Rotate via OrbitControls' own drag path. dx/dy in px. */
    orbit: orbitBy,

    /**
     * Pan via a right-button drag — OrbitControls' default RIGHT binding, and the
     * affordance that lets a player slide the camera's target sideways instead of
     * swinging around it. Deep inside the box, pan is the only way to get next to a
     * particular cell: orbit and dolly both aim at the centre.
     */
    pan: panBy,

    /**
     * Raster a small window centred on the canvas and report which of \`targets\` it hit.
     * Used by the targeted probe, where the camera sits inside the box and the only
     * question is "is this particular cell in front of me now".
     */
    probeCentre(targets, half = 90, step = 3) {
      listen();
      const s = session();
      const want = new Set(targets);
      const found = {};
      const r = canvas.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      for (let py = cy - half; py <= cy + half; py += step) {
        for (let px = cx - half; px <= cx + half; px += step) {
          if (px < r.left || py < r.top || px > r.right || py > r.bottom) continue;
          const i = tap(px, py);
          if (i === null) continue;
          s.set(i, 0);
          if (want.has(i) && !found[i]) found[i] = [px, py];
        }
      }
      return found;
    },

    /** Dolly via the wheel, the same affordance a mouse user has. */
    zoom: zoomBy,

    /**
     * Re-find the pixel that reaches \`cell\` right now, searching outward from a hint.
     *
     * Needed because OrbitControls applies damping per *frame*, so the camera a replayed
     * drag settles on is only equal to the original within an epsilon that depends on how
     * many frames elapsed. For a cell with a wide footprint that is irrelevant; for one
     * reachable through a two-pixel gap it is the difference between hitting it and
     * hitting the cell behind it. So the recorded pixel is treated as a hint and the
     * exact pixel is re-derived against the camera as it actually is.
     *
     * Probing mutates the board through the production cycle, so it runs under
     * \`latchGuard\` — read that for why a probe could otherwise hand the playthrough its
     * clear. \`guarded\` and \`solved\` ride along in the result so the caller can assert
     * the guard held instead of taking it on trust.
     *
     * -> { px, samples, radius, guarded, solved }, \`px: null\` if nothing reached the cell
     */
    findPixel(cell, hint, radius = 14, step = 2) {
      const s = session();
      const solvedAtEntry = s.solved;
      // A playthrough calls this with cells already filled from earlier groups, so the
      // probe has to put the board back exactly, not blank it.
      const before = Array.from(s.state);
      // Park before listening: the park is a \`set\`, so it emits a 'cell' event of its own.
      const guard = latchGuard(before);
      let latchedAt = null;
      listen();
      const hits = [];
      // Only pixels the *browser* would route to the canvas are candidates. A synthetic
      // tap is dispatched on the canvas node, so it skips hit-testing and happily
      // "reaches" a cell from a pixel outside the canvas rect — but \`realTap\` is a real
      // event and lands on whatever covers that pixel, so such a pixel is unclickable
      // and recording it produces a miss that reads exactly like an unaimable cell.
      // Measured: on 1280x860 the canvas is [132, 225, 1017, 547], so it ends at y=772;
      // the raster recorded y=770 for four cells of the 3x3x3 box and this search, with
      // no clamp, moved the centroid to y=773-774. Every 3x3x3 puzzle then failed
      // identically (l1-chair 4 cells, l1-stairs 2, l1-arch 4) on cells whose aperture
      // was 15,700-16,300px² — a 125px target "missed" because the pixel was 2px off the
      // bottom edge. \`rasterAt\` has always clamped this way; this did not.
      const r = canvas.getBoundingClientRect();
      const inCanvas = (px, py) => px >= r.left && py >= r.top && px <= r.right && py <= r.bottom;
      for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const px = hint[0] + dx, py = hint[1] + dy;
          if (!inCanvas(px, py)) continue;
          const i = tap(px, py);
          if (i === null) continue;
          if (!latchedAt && s.solved) {
            latchedAt = { i, px, py, parkValue: s.state[guard.park],
              filled: Array.prototype.filter.call(s.state, (v) => v === 1).length,
              state: Array.from(s.state).join('') };
          }
          // Restore the cell this tap touched — except the parked one, which has to stay
          // parked for the rest of the sweep or the guard lapses mid-probe.
          s.set(i, i === guard.park ? 1 : before[i]);
          if (i === cell) hits.push([px, py]);
        }
      }
      if (!hits.length) {
        unwind(before, guard.park);
        return { px: null, samples: 0, radius, guarded: guard.guarded, solved: s.solved, solvedAtEntry, park: guard.park, latchedAt };
      }
      // Centroid of the local hits, then confirm it still lands on the cell.
      const cx = Math.round(hits.reduce((a, p) => a + p[0], 0) / hits.length);
      const cy = Math.round(hits.reduce((a, p) => a + p[1], 0) / hits.length);
      let px = [cx, cy];
      if (tap(cx, cy) !== cell) {
        let bestD = Infinity;
        for (const p of hits) {
          const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
          if (d < bestD) { bestD = d; px = p; }
        }
      }
      // leave the board exactly as we found it — park released last, see \`unwind\`.
      unwind(before, guard.park);
      // The centroid of in-rect points is in-rect, and the fallback picks one of the
      // hits, so this cannot currently fail — it is here so that it starts failing if
      // the search above ever stops clamping again.
      return { px, samples: hits.length, radius, guarded: guard.guarded, solved: s.solved,
        solvedAtEntry, park: guard.park, latchedAt, inCanvas: inCanvas(px[0], px[1]) };
    },

    /** Whatever element the browser would route a tap at (px, py) to. */
    elementAt(px, py) {
      const el = document.elementFromPoint(px, py);
      return el ? { tag: el.tagName, id: el.id, cls: el.className?.toString?.() ?? '' } : null;
    },

    board() { return Array.from(session().state); },
    solution() { return Array.from(session().solution); },
    solved() { return session().solved; },
    spec() { const s = session().spec; return { id: s.id, dims: s.dims, name: s.name }; },

    /** Put the board back to all-BLANK without going through undo. */
    clearBoard() {
      const s = session();
      for (let i = 0; i < s.state.length; i++) if (s.state[i] !== 0) s.set(i, 0);
      return true;
    },
  };
})()`;

async function installProbe(page) {
  await page.evaluate(`window.__qa = ${PROBE}; window.__qa.install()`);
}

// --- navigation helpers ------------------------------------------------------

/**
 * Seed every puzzle as cleared so the reward layer's level gates are open.
 *
 * Seeding alone is not enough to then *play* one: `createSession` reads the same
 * `solved` flag and locks input on a cleared board, so a seeded puzzle opens
 * unplayable. `openPuzzle` therefore drops the target puzzle's own key right before
 * opening it — every other puzzle stays cleared (so the level gate is open), and the
 * one under test opens blank.
 */
const SEED_ALL_CLEARED = `(() => {
  let n = 0;
  for (const level of window.__nonogram.levels())
    for (const p of level.puzzles) {
      const cells = p.dims.x * p.dims.y * p.dims.z;
      localStorage.setItem('no-nonogram:' + p.id,
        JSON.stringify({ state: new Array(cells).fill(0), solved: true }));
      n++;
    }
  return n;
})()`;

/** Flat [{ levelIndex, puzzleIndex, id, dims }] in play order. */
const CATALOGUE = `(() => {
  const out = [];
  window.__nonogram.levels().forEach((level, li) =>
    level.puzzles.forEach((p, pi) =>
      out.push({ levelIndex: li, puzzleIndex: pi, id: p.id, dims: p.dims })));
  return out;
})()`;

/**
 * Walk the real menu to a puzzle: title -> levels -> level card -> puzzle card.
 * Clicks the DOM the way a player does rather than calling openPuzzle directly, so a
 * card that is locked or missing fails here instead of being skipped.
 */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }, { fresh = true, frames = 48 } = {}) {
  await page.evaluate(`(() => {
    ${fresh ? `localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});` : ''}
    const show = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    show('#levels-grid .level-card', ${levelIndex});
    show('#puzzles-grid .puzzle-card', ${puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 15_000 },
  );
  await installProbe(page);
  // `frameCamera` writes the camera directly, so the open itself needs no damping — but
  // whatever drag the *previous* sweep step dispatched is still decaying in
  // `sphericalDelta`, and `update()` keeps applying it across the re-open. That is a
  // sweep step inheriting the tail of the one before it, which is the second half of
  // DOO-31's spread. 48 frames leaves 0.95^48 = 8% of an already-converged residue;
  // combined with `settle()` ending the previous step under 0.03 px/frame it is
  // thousandths of a pixel. Counted in frames for the reason in the header.
  await page.evaluate(`window.__qa.frames(${frames})`);
  // The one-time depth-cursor lesson (ui/peel.js) is anchored over the board on level 3+
  // boards, so it is in the way of a real tap aimed at the stepper and of a screenshot.
  // Dismissed through its own close button. Whether it *steals* a tap is DOO-28's gate
  // (scripts/probe-peel-ui.mjs asserts it), not a thing to re-measure here.
  if (await page.evaluate('window.__qa.coachOpen()')) {
    await page.evaluate("document.getElementById('peel-coach-close').click()");
    await page.evaluate('window.__qa.frames(3)');
  }
}

// --- real input --------------------------------------------------------------

/** A real OS-level click or tap at a client pixel, through Chrome's hit-testing. */
async function realTap(page, px, py, { touch }) {
  if (touch) {
    const points = [{ x: px, y: py, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
    await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return;
  }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.call('Input.dispatchMouseEvent', {
      type, x: px, y: py, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse',
    });
  }
}

/** A real key press through Chrome, so the shipped `[`/`]`/`\` binding is what runs. */
async function realKey(page, key) {
  const code = key === ']' ? 'BracketRight' : key === '[' ? 'BracketLeft' : 'Backslash';
  const vk = key === ']' ? 221 : key === '[' ? 219 : 220;
  for (const type of ['keyDown', 'keyUp']) {
    await page.call('Input.dispatchKeyEvent', {
      type, key, code, text: type === 'keyDown' ? key : undefined,
      windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
  }
}

/** A real click or tap on the centre of an element, by id, through Chrome's hit-testing. */
async function tapElement(page, id, platform) {
  const box = await page
    .evaluate(`JSON.stringify((() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: !!el.disabled, w: r.width, h: r.height };
    })())`)
    .then(JSON.parse);
  if (!box || box.disabled || box.w < 1) return { ok: false, box };
  await realTap(page, Math.round(box.x), Math.round(box.y), platform);
  return { ok: true, box };
}

/**
 * Drive the depth cursor to `depth` with the affordance this platform actually has.
 *
 * Desktop presses the shipped `]` binding as real key events; touch taps `#peel-more`,
 * DOO-28's on-screen stepper, as a real tap — because a phone has no `]` key and a sweep
 * that pressed one anyway would be measuring a control the player cannot reach. Both go
 * through Chrome, and the result is read back off `__nonogram.peel()` (read-only by
 * design) so a press that did not land fails here instead of silently measuring depth 0.
 *
 * `render/peel.js` re-aims at the face the camera is on at the moment of the first press
 * and starts that face from zero, so this must run *after* the camera has settled — which
 * is why `applyActs` orders a `peel` act last and settles the orbit before it.
 *
 * -> { depth, requested, axis, sign, max, presses, via }
 */
async function setPeelDepth(page, platform, depth, { via = platform.touch ? 'button' : 'key' } = {}) {
  let presses = 0;
  for (let n = 0; n < depth; n++) {
    if (via === 'button') {
      const hit = await tapElement(page, 'peel-more', platform);
      if (!hit.ok) break;
    } else {
      await realKey(page, ']');
    }
    presses++;
    // The grid's layer window is set synchronously, so this is only here to let the
    // readout and the renderer catch up before anything reads the screen.
    await page.evaluate('window.__qa.frames(2)');
  }
  const st = await page.evaluate('JSON.stringify(window.__qa.peelState())').then(JSON.parse);
  return { ...st, requested: depth, presses, via };
}

/**
 * Real-event spot check: tap a pixel the synthetic raster says reaches `cell` and
 * confirm the production path agrees end to end. This is what makes the synthetic map
 * admissible — if Chrome routes the tap somewhere else (an overlay over the canvas),
 * the cell does not change and the check fails.
 */
async function confirmWithRealTap(page, cell, hint, platform) {
  await page.evaluate('window.__qa.clearBoard()');
  // Re-localize first: the question is "can a real tap reach this cell at this camera",
  // not "is the pixel recorded minutes ago still byte-exact after damping".
  const found = await page
    .evaluate(`JSON.stringify(window.__qa.findPixel(${cell}, ${JSON.stringify(hint)}, 14, 2))`)
    .then(JSON.parse);
  if (!found) return { ok: false, changed: [], routed: null, relocated: false };
  const [px, py] = found.px;
  await realTap(page, px, py, platform);
  await sleep(120);
  // Diff the whole board rather than reading the one cell: when a tap lands on the
  // wrong cell, "which cell did it hit" is the diagnostic that separates a harness
  // artefact (a neighbour, 1px away) from a real routing bug (nothing at all, or an
  // overlay eating the event).
  const changed = await page
    .evaluate('JSON.stringify(window.__qa.board().map((v, i) => [i, v]).filter(([, v]) => v !== 0))')
    .then(JSON.parse);
  const routed = await page.evaluate(`JSON.stringify(window.__qa.elementAt(${px}, ${py}))`);
  await page.evaluate('window.__qa.clearBoard()');
  return {
    ok: changed.length === 1 && changed[0][0] === cell && changed[0][1] === 1,
    changed,
    routed,
    relocated: true,
    localSamples: found.samples,
  };
}

// --- mode: reach -------------------------------------------------------------

/**
 * The orientation sweep. Each entry is an interaction a player can perform from the
 * board as it opens, described in the same terms the bug report uses.
 *
 * `cost` is what the sweep is really measuring: how much camera work a cell costs.
 *   0  the board as it opens
 *   1  orbit only — drag the board around
 *   2  orbit + dolly in, camera still outside the box
 *   3  dolly past the shell, camera inside the box
 *
 * `peel` is the second axis, added at DOO-31: how many layers the depth cursor has taken
 * off the near face. It is deliberately *not* folded into `cost`.
 *
 *   The two are different kinds of effort and the numbers already quoted are in terms of
 *   `cost`. Renumbering the bands to slot the cursor in would make every reach JSON on
 *   the board incomparable with the next one, and `scripts/aim-compare.mjs` keys on
 *   `cheapestCost` to diff two runs. So `cost` keeps meaning exactly what it meant —
 *   camera work, and camera work only — and the camera-only maps are built from the
 *   `peel: 0` steps alone. The cursor band accumulates into its own map, and the record
 *   reports both: `reached` is the box with camera work alone, `cursor.reached` is the box
 *   the shipped game actually gives the player.
 *
 * `maxPeel` is read off `__nonogram.peel().max` at the camera the puzzle opens on, so it
 * is the facing axis's own depth and not an assumption about which axis that is. 0 (the
 * default) leaves the plan exactly as it was before DOO-31 — that is what `--peel=off`
 * gets, and what makes a run comparable with one taken before the cursor shipped.
 */
function sweepPlan({ maxPeel = 0 } = {}) {
  const steps = [{ name: 'default', cost: 0, acts: [] }];

  // Cost 1 — orbit only. 8 azimuths x 3 elevations. A drag of `clientHeight` px is a
  // full 2*pi of azimuth in OrbitControls, so h/8 px per 45 degrees.
  for (const az of [0, 1, 2, 3, 4, 5, 6, 7]) {
    for (const el of [-1, 0, 1]) {
      if (az === 0 && el === 0) continue;
      steps.push({
        name: `orbit az=${az * 45}deg el=${el * 30}deg`,
        cost: 1,
        acts: [{ kind: 'orbit', dx: az / 8, dy: el / 12 }],
      });
    }
  }

  // Cost 2/3 — dolly in, then orbit again at that distance. OrbitControls' wheel zoom
  // is multiplicative (0.95 per tick), so 14 ticks is ~0.49x and 26 is ~0.26x of the
  // opening distance; the opening distance is max(dims)*1.8+1, so 26 ticks puts the
  // camera inside the box for every size in the catalogue.
  //
  // Four azimuths per zoom band rather than eight: the orbit band above already reaches
  // all but a handful of cells, so these steps exist to pick up the stragglers and to
  // widen apertures, not to discover whole new regions.
  for (const [ticks, cost] of [[14, 2], [26, 3]]) {
    for (const az of [0, 2, 4, 6]) {
      steps.push({
        name: `zoom ${ticks}t + orbit az=${az * 45}deg`,
        cost,
        acts: [{ kind: 'zoom', ticks }, { kind: 'orbit', dx: az / 8, dy: 0 }],
      });
    }
  }
  // The depth cursor (DOO-17/DOO-28). Two cameras, not eight: peeling 1..max off one
  // face already makes every layer along that axis the exposed front layer at some
  // depth, so one face is enough for coverage and the opposite face is there for
  // aperture — a cell seen from the other end of the same axis is a different-sized
  // target. Everything else the cursor could be combined with is camera work the 35
  // steps above already price.
  for (const az of [0, 4]) {
    for (let depth = 1; depth <= maxPeel; depth++) {
      steps.push({
        name: `peel ${depth}${az ? ` az=${az * 45}deg` : ''}`,
        cost: az ? 1 : 0,
        peel: depth,
        acts: [
          ...(az ? [{ kind: 'orbit', dx: az / 8, dy: 0 }] : []),
          { kind: 'peel', depth },
        ],
      });
    }
  }
  return steps;
}

/**
 * Perform a step's acts, waiting after each one until the camera has stopped moving.
 *
 * Returns one record per act, which is where `perStep.settled` comes from. An act that
 * came back `settled: false` — or a peel press that did not land — makes the whole step
 * an unknown, and `runReach` drops that step's raster rather than folding it in.
 *
 * `probe: false` is for `play`: see `settle()` for why a playthrough must not run
 * synthetic taps while it is holding real progress on the board.
 */
async function applyActs(page, acts, { platform, probe = true, settle = {} } = {}) {
  const done = [];
  for (const act of acts) {
    if (act.kind === 'peel') {
      const got = await setPeelDepth(page, platform, act.depth);
      done.push({
        act: `peel ${act.depth}`,
        settled: got.depth === act.depth,
        depth: got.depth,
        requested: act.depth,
        detail: `${got.via} x${got.presses} -> depth ${got.depth}/${got.max} on ` +
          `${got.axis}${got.sign < 0 ? '-' : '+'}`,
      });
      continue;
    }
    // One call dispatches the gesture and settles it — see `act()` for why the round
    // trip between the two used to matter. `dx`/`dy` are fractions of a full turn;
    // OrbitControls maps a drag of clientHeight px to 2*pi, and the probe does that
    // conversion against the live canvas rect.
    const got = await page
      .evaluate(`window.__qa.act(${JSON.stringify(act)}, ${JSON.stringify({ probe, ...settle })})`
        + '.then((r) => JSON.stringify(r))')
      .then(JSON.parse);
    const before = got.before;
    // A zero-magnitude orbit is in the plan on purpose — `zoom 14t + orbit az=0deg` is
    // the dolly band's straight-on shot — so "the camera did not move" is only a
    // complaint when the act asked it to. A different `key` before and after is the act
    // having moved the camera far enough to put a different cell under the anchor, which
    // is movement by any reading.
    const asked = act.kind === 'zoom' ? act.ticks > 0 : !!(act.dx || act.dy);
    const movedPx = before && got.at && before.key === got.at.key && before.t.length === got.at.t.length
      ? Math.max(...got.at.t.map((v, i) => Math.abs(v - before.t[i])))
      : null;
    done.push({
      act: act.kind === 'zoom' ? `zoom ${act.ticks}t` : `orbit ${act.dx},${act.dy}`,
      settled: got.settled !== false,
      probed: got.probed,
      frames: got.frames,
      perFramePx: got.perFramePx ?? null,
      movedPx,
      took: !asked || !before || !got.at || movedPx === null || movedPx > 0.5,
      detail: got.reason ?? `${got.frames} frames to ${(got.perFramePx ?? 0).toFixed(4)} px/frame`,
      // Only on failure, and only then: this is the per-probe movement history, and it is
      // the whole diagnosis of a step that would otherwise just say "did not converge".
      ...(got.settled === false ? { trace: got.trace, key: got.key } : {}),
    });
  }
  return done;
}

/** min / median / how many fall under each floor, over a cell -> best-hit map. */
function apertureOf(best, step) {
  const rows = [...best.entries()].map(([cell, b]) => ({
    cell, samples: b.samples, px2: b.samples * step * step, cost: b.cost, peel: b.peel ?? 0,
  }));
  const sorted = [...rows].sort((a, b) => a.px2 - b.px2);
  return {
    min: sorted[0]?.px2 ?? 0,
    median: sorted[Math.floor(sorted.length / 2)]?.px2 ?? 0,
    underMouse24: rows.filter((a) => a.px2 < 576).length,
    underFinger44: rows.filter((a) => a.px2 < 1936).length,
    tightest: sorted.slice(0, 12),
  };
}

async function runReach(page, platform, { dimsList, step, out, check, peel = true }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const byDims = new Map();
  for (const entry of catalogue) {
    const key = dimsKey(entry.dims);
    if (!byDims.has(key)) byDims.set(key, entry);
  }

  const wanted = dimsList?.length ? dimsList.map(dimsKey) : [...byDims.keys()];
  const results = {};

  for (const key of wanted) {
    const entry = byDims.get(key);
    if (!entry) {
      console.log(`  (no puzzle has dims ${key} — skipped)`);
      continue;
    }
    const total = entry.dims.x * entry.dims.y * entry.dims.z;
    // How deep the cursor goes on this box is the facing axis's own depth, so it is read
    // off the shipped handle at the camera the puzzle opens on rather than assumed.
    await openPuzzle(page, entry);
    const cursor0 = await page.evaluate('JSON.stringify(window.__qa.peelState())').then(JSON.parse);
    const plan = sweepPlan({ maxPeel: peel ? cursor0.max : 0 });

    // cheapest interaction cost at which each cell first became reachable
    const costOf = new Map();
    // cell -> the orientation where its clickable aperture is *largest*. The whole sweep
    // runs (no early exit on full coverage) because the first orientation that reaches a
    // cell is often the one where it is a 2px sliver; `play` wants the easiest shot, and
    // the verdict wants the aperture of the easiest shot.
    const bestOf = new Map();
    // The same two, over every step including the depth-cursor band — the box as the
    // shipped game hands it to the player. Kept apart from the pair above so `cost`,
    // `cheapestCost` and `pixelByCell` keep meaning what they meant before DOO-31 and
    // every reach JSON already on the board stays comparable (see `sweepPlan`).
    const cursorFirst = new Map();
    const cursorBest = new Map();
    const perStep = [];
    const startedAt = Date.now();
    let unsettledSteps = 0;
    let box = null;

    for (const s of plan) {
      // A fresh open resets the camera, so each sweep step starts from the same place
      // and its `cost` means what it says.
      await openPuzzle(page, entry);
      const settles = await applyActs(page, s.acts, { platform });
      const bad = settles.filter((a) => a.settled === false || a.took === false);
      // The board's screen box changes with the camera, so it is re-found per step.
      box = await page.evaluate('JSON.stringify(window.__qa.bbox(20))').then(JSON.parse);
      const { map, taps, landed, refined } = await page
        .evaluate(`JSON.stringify(window.__qa.raster(${step}, ${JSON.stringify(box)}))`)
        .then(JSON.parse);

      const row = {
        name: s.name, cost: s.cost, peel: s.peel ?? 0, taps, landed, refined,
        cells: Object.keys(map).length, fresh: 0, settled: bad.length === 0, settles,
      };

      // An unsettled step is an unknown, and an unknown must not be folded into a
      // release verdict (DOO-31). Its raster is still recorded in `perStep` — the
      // numbers are the diagnosis for *why* it did not converge — but it contributes
      // no cell to either map.
      if (!row.settled) {
        unsettledSteps++;
        perStep.push(row);
        console.log(
          `  ${key}  ${s.name.padEnd(38)} DROPPED — ${bad.map((a) => `${a.act}: ${a.detail}`).join('; ')}`,
        );
        continue;
      }

      let fresh = 0;
      let improved = 0;
      for (const [cellStr, hit] of Object.entries(map)) {
        const cell = Number(cellStr);
        const rec = { px: hit.px, samples: hit.samples, step: s.name, acts: s.acts, cost: s.cost, peel: row.peel };
        if (!cursorFirst.has(cell)) cursorFirst.set(cell, { cost: s.cost, peel: row.peel });
        const prevAny = cursorBest.get(cell);
        if (!prevAny || hit.samples > prevAny.samples) cursorBest.set(cell, rec);
        if (row.peel) continue;
        if (!costOf.has(cell)) { costOf.set(cell, s.cost); fresh++; }
        const prev = bestOf.get(cell);
        if (!prev || hit.samples > prev.samples) {
          bestOf.set(cell, rec);
          if (prev) improved++;
        }
      }
      row.fresh = fresh;
      perStep.push(row);
      if (fresh || improved || row.peel) {
        console.log(
          `  ${key}  ${s.name.padEnd(38)} reached ${String(Object.keys(map).length).padStart(3)}` +
            `  (+${fresh} new, ${improved} wider, ${costOf.size}/${total} camera, ` +
            `${cursorBest.size}/${total} with cursor)`,
        );
      }
    }

    // Real-event confirmation: a sample of the synthetic map, re-localized and clicked
    // for real at the camera that produced it. Sampled across the cost bands plus —
    // deliberately — the tightest aperture in each map, which is where a real event is
    // most likely to miss. The map keeps every cell either way; what this buys is that
    // the sample's outcome is a check instead of a footnote, and `confirmed N/M` is
    // printed next to every number the verdict quotes (DOO-31 §2).
    const sample = [];
    const add = (cell) => { if (cell !== undefined && !sample.includes(cell)) sample.push(cell); };
    for (const cost of [0, 1, 2, 3]) {
      const cells = [...costOf.entries()].filter(([, c]) => c === cost).map(([cell]) => cell);
      if (cells.length) add(cells[Math.floor(cells.length / 2)]);
    }
    add([...bestOf.entries()].sort((a, b) => a[1].samples - b[1].samples)[0]?.[0]);
    // The cursor band's own tightest cell: its `acts` end in a `peel`, so confirming it
    // presses the shipped `]` / `#peel-more` and proves the whole replay path, cursor
    // included, lands a real event.
    add([...cursorBest.entries()].filter(([, b]) => b.peel)
      .sort((a, b) => a[1].samples - b[1].samples)[0]?.[0]);

    const confirmations = [];
    for (const cell of sample) {
      const rec = bestOf.get(cell) ?? cursorBest.get(cell);
      await openPuzzle(page, entry);
      const settles = await applyActs(page, rec.acts, { platform });
      const got = await confirmWithRealTap(page, cell, rec.px, platform);
      confirmations.push({
        cell, cost: rec.cost, peel: rec.peel ?? 0, samples: rec.samples,
        apertureCssPx2: rec.samples * step * step, replaySettled: settles.every((a) => a.settled !== false), ...got,
      });
      // The map records the outcome too, so a reader of the JSON can tell a confirmed
      // cell from an unexamined one without cross-referencing the confirmations array.
      if (bestOf.has(cell)) bestOf.get(cell).confirmed = got.ok;
      if (cursorBest.has(cell)) cursorBest.get(cell).confirmed = got.ok;
      check(
        `${platform.label} ${key}: a real ${platform.touch ? 'tap' : 'click'} reaches cell ${cell} ` +
          `(cost ${rec.cost}${rec.peel ? `, peel ${rec.peel}` : ''})`,
        got.ok,
        `changed=${JSON.stringify(got.changed)} routed to ${got.routed}`,
      );
    }
    const confirmed = confirmations.filter((c) => c.ok).length;

    // Aperture distribution, in CSS px² of clickable area at each cell's best angle.
    // 44x44 = 1936 px² is the usual floor for a finger-sized target; 24x24 = 576 for a
    // mouse. Both bands are reported so the verdict can say which platform is hurt.
    const aperture = apertureOf(bestOf, step);
    const cursorAperture = apertureOf(cursorBest, step);

    results[key] = {
      dims: entry.dims,
      viaPuzzle: entry.id,
      total,
      rasterStep: step,
      reached: costOf.size,
      byCost: [0, 1, 2, 3].map((c) => [...costOf.values()].filter((v) => v === c).length),
      unreachable: Array.from({ length: total }, (_, i) => i).filter((i) => !costOf.has(i)),
      cheapestCost: Object.fromEntries(costOf),
      // cell -> { px, step, acts, samples }: the pixel, the camera moves that reach it,
      // and its aperture there. `play` replays exactly this, which is what makes the two
      // modes agree, and the report reads its numbers off the same record.
      pixelByCell: Object.fromEntries(bestOf),
      aperture,
      // The same box with the depth cursor in the player's hands. Separate on purpose:
      // `reached`/`aperture` above are camera-work-only and comparable with every run
      // taken before the cursor shipped; these are the shipped game.
      cursor: {
        maxDepth: peel ? cursor0.max : 0,
        axis: cursor0.axis,
        sign: cursor0.sign,
        reached: cursorBest.size,
        unreachable: Array.from({ length: total }, (_, i) => i).filter((i) => !cursorBest.has(i)),
        // how many cells got their widest shot at each cursor depth, 0 = camera alone
        byDepth: Array.from({ length: (peel ? cursor0.max : 0) + 1 }, (_, d) =>
          [...cursorBest.values()].filter((b) => (b.peel ?? 0) === d).length),
        aperture: cursorAperture,
        pixelByCell: Object.fromEntries(cursorBest),
        firstSeenAt: Object.fromEntries(cursorFirst),
      },
      // Per step, including the ones dropped unsettled — `scripts/aim-compare.mjs` diffs
      // two runs step by step off this, and a dropped step has to be visible there or
      // the diff reads as "this step reached nothing".
      perStep,
      settle: {
        steps: plan.length,
        unsettled: unsettledSteps,
        // Frames each act needed to converge — the distribution that replaced sleep(420).
        framesPerAct: perStep.flatMap((p) => p.settles.filter((a) => a.probed).map((a) => a.frames)),
      },
      confirmations: { confirmed, sampled: confirmations.length, cells: confirmations },
      elapsedMs: Date.now() - startedAt,
    };

    const r = results[key];
    console.log(
      `  ${key}: ${r.reached}/${total} reachable by camera  ` +
        `[cost0=${r.byCost[0]} orbit=${r.byCost[1]} zoom=${r.byCost[2]} inside=${r.byCost[3]}]  ` +
        `aperture min=${r.aperture.min}px² med=${r.aperture.median}px²  ` +
        `<24px:${r.aperture.underMouse24} <44px:${r.aperture.underFinger44}  ` +
        `${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
    );
    console.log(
      `  ${key}: ${r.cursor.reached}/${total} with the depth cursor (max depth ${r.cursor.maxDepth})  ` +
        `aperture min=${r.cursor.aperture.min}px² med=${r.cursor.aperture.median}px²  ` +
        `<24px:${r.cursor.aperture.underMouse24} <44px:${r.cursor.aperture.underFinger44}  ` +
        `| confirmed ${confirmed}/${confirmations.length} by real ${platform.touch ? 'tap' : 'click'}` +
        `${unsettledSteps ? `  | ${unsettledSteps}/${plan.length} steps DROPPED unsettled` : ''}`,
    );
    check(`${platform.label} ${key}: every cell of the box is reachable by pointer`, r.reached === total,
      `${r.reached}/${total} with camera work alone, ${r.unreachable.length} unreachable`);
    check(`${platform.label} ${key}: every cell of the box is reachable with the depth cursor`,
      r.cursor.reached === total,
      `${r.cursor.reached}/${total} with the cursor, ${r.cursor.unreachable.length} unreachable: ` +
        `${r.cursor.unreachable.slice(0, 12).join(' ')}`);
    // Without this the sweep could quietly measure a camera that was still swinging and
    // report the result as fact — which is the bug DOO-31 was filed for.
    check(`${platform.label} ${key}: every sweep step's camera converged before the raster ran`,
      unsettledSteps === 0, `${unsettledSteps} of ${plan.length} steps dropped`);

    // Written per size, not once at the end: a full sweep is tens of minutes, and a
    // crash or a kill on the last size used to throw away every size before it.
    writeFileSync(join(out, `reach-${platform.label}.json`), JSON.stringify(results, null, 2));
  }

  return results;
}

// --- mode: play --------------------------------------------------------------

/**
 * Wait for dispatched real taps to have landed, counted in frames.
 *
 * This replaced `sleep(150)` / `sleep(120)` / `sleep(90)`, and for the same reason
 * DOO-31 took the wall-clock waits out of `reach`: a sleep measures the clock, not the
 * thing being waited for. A CDP input event has to cross to the renderer, run the
 * listener, and have the session's `cell` event applied before `__qa.board()` can see
 * it. On a quiet machine 150ms is many frames of slack; at the load this box actually
 * runs at (measured: 1-minute average **470 on 8 cores**) it is not reliably even one,
 * so the board got read before the taps landed and the cells came back as `missed` —
 * a *harness* miss indistinguishable in the output from a cell the player cannot hit.
 *
 * Frames are the right unit because they are the unit the thing being waited on runs
 * in: `render/scene.js` drives everything from rAF, so N frames means N real chances
 * for the tap to have been applied however slowly the clock is running. Under load the
 * wait takes longer in seconds and exactly as long in frames, which is what makes the
 * result reproducible instead of load-dependent.
 *
 * 10 frames, not 2: the margin is cheap (a `play` run is thousands of taps, not
 * millions) and the failure it prevents is one that reads as a product defect.
 */
function settleTaps(page, frames = 10) {
  return page.evaluate(`window.__qa.frames(${frames})`);
}

/**
 * Finish one puzzle with real input only.
 *
 * Cells are clicked in groups by the sweep step that reaches them, so the camera is
 * moved once per group rather than once per cell. A cell the sweep never reached is
 * recorded as `stranded` and left alone — the run reports the puzzle as unfinishable
 * rather than quietly reaching into `session` to fake a clear.
 */
async function playPuzzle(page, entry, reach, platform, { out, check }) {
  const key = dimsKey(entry.dims);
  const plan = reach[key];
  if (!plan) throw new Error(`no reachability map for ${key} — run \`reach\` first`);

  await openPuzzle(page, entry);
  await page.evaluate('window.__qa.clearBoard()');
  const solution = await page.evaluate('JSON.stringify(window.__qa.solution())').then(JSON.parse);
  const needed = solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  // Group the needed cells by the sweep step that reaches them, so the camera moves
  // once per group instead of once per cell.
  //
  // The *cursor* map, not the camera-only one (report §17.9). `plan.pixelByCell` holds
  // only the cells reachable by camera work alone, which is the pre-DOO-17 gate; the
  // depth cursor is what ships, and `plan.cursor.pixelByCell` is a strict superset of it
  // with the same record shape (cursor-only cells carry `acts: [{kind:'peel', depth:N}]`,
  // which `applyActs` already drives through `setPeelDepth`). Reading the narrow map made
  // `play` strand exactly the cells the cursor exists to reach: every stranded cell in
  // the 2026-10-07 desktop run was a member of `plan.unreachable`, set-for-set.
  const pixelByCell = plan.cursor?.pixelByCell ?? plan.pixelByCell ?? {};
  const groups = new Map();
  const stranded = [];
  for (const cell of needed) {
    const rec = pixelByCell[cell];
    if (!rec) { stranded.push(cell); continue; }
    if (!groups.has(rec.step)) groups.set(rec.step, { acts: rec.acts, cells: [] });
    groups.get(rec.step).cells.push({ cell, px: rec.px });
  }

  const startedAt = Date.now();
  let clicks = 0;
  const misses = [];
  const probeLatches = [];
  const offCanvas = [];
  const unsettled = [];

  for (const [stepName, group] of groups) {
    // `fresh: false` is load-bearing: a fresh open drops the puzzle's saved board, which
    // would wipe every group played before this one. The board has to come back from
    // storage so the groups accumulate into one playthrough.
    await openPuzzle(page, entry, { fresh: false });
    // `probe: false`: the settle poll is synthetic taps, and this board is holding the
    // progress of every group played before this one — see `settle()`.
    //
    // The result is read rather than discarded: a `peel` act that lands on a different
    // depth than the map recorded leaves the camera somewhere the recorded pixels do not
    // describe, and every tap in the group then aims at the wrong cell. Discarding this
    // is the shape of both §15.2 defects — a failure that stays quiet in the direction
    // that flatters the verdict.
    const applied = await applyActs(page, group.acts, { platform, probe: false });
    for (const a of applied ?? []) {
      if (a.settled === false) unsettled.push({ step: stepName, act: a.act, detail: a.detail ?? null });
    }

    // Tap the whole group, then diff once. Reading the board after every tap doubles the
    // CDP round trips for a run that is already thousands of them; cells that did not
    // land are retried individually below, which is where the per-cell detail is needed.
    const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    const wanted = group.cells.filter(({ cell }) => board[cell] !== 1);

    // Re-localize every pixel against the camera as it actually settled, in one page
    // call, before any real tap goes out. See `findPixel` for why the recorded pixel is
    // only a hint.
    const located = await page
      .evaluate(`JSON.stringify(${JSON.stringify(wanted)}.map((w) => {
        const f = window.__qa.findPixel(w.cell, w.px, 14, 2);
        return { cell: w.cell, px: f.px, samples: f.samples, guarded: f.guarded, solved: f.solved, solvedAtEntry: f.solvedAtEntry, park: f.park, latchedAt: f.latchedAt, inCanvas: f.inCanvas };
      }))`)
      .then(JSON.parse);

    // The probe must not have latched `solved` on this part-played board — see
    // `latchGuard`. Asserted per group rather than trusted, because the failure is
    // silent in exactly the direction that flatters the verdict: a latched board awards
    // `solved`, `celebrated` and a solved record while the cell under the probe becomes
    // permanently unfillable by any real tap.
    probeLatches.push(...located.filter((l) => l.solved || l.guarded === false)
      .map((l) => ({ cell: l.cell, stepName, guarded: l.guarded, solved: l.solved, solvedAtEntry: l.solvedAtEntry, park: l.park, latchedAt: l.latchedAt })));
    // A pixel a real click cannot be routed to is not a usable target, and the symptom
    // if it slips through is a miss that looks like an unaimable cell. See `findPixel`.
    offCanvas.push(...located.filter((l) => l.px && l.inCanvas === false)
      .map((l) => ({ cell: l.cell, stepName, px: l.px })));

    const todo = [];
    for (const l of located) {
      if (!l.px) { misses.push({ cell: l.cell, stepName, reason: 'no pixel reaches it at this angle' }); continue; }
      todo.push({ cell: l.cell, px: l.px });
    }
    for (const { px } of todo) {
      await realTap(page, px[0], px[1], platform);
      clicks++;
    }
    await settleTaps(page);

    const after = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    for (const { cell, px } of todo) {
      if (after[cell] === 1) continue;
      // Retry once on its own: a tap can miss because the cell cycled past FILLED (it
      // was already MARKED from a stray earlier tap) rather than because it is unaimable.
      await page.evaluate(`window.__nonogram.session().set(${cell}, 0)`);
      await realTap(page, px[0], px[1], platform);
      clicks++;
      await settleTaps(page);
      const value = await page.evaluate(`window.__nonogram.session().state[${cell}]`);
      if (value !== 1) misses.push({ cell, px, stepName, value });
    }
  }

  // --- correction pass -------------------------------------------------------
  // A tap aimed at one cell can land on another along the same ray, which leaves a cell
  // filled that the solution does not want. A player would spot that and click it back,
  // so the harness does too — and counts it, because "how many corrective taps did this
  // board cost" is a usability number, not noise to be hidden.
  let corrections = 0;
  for (let round = 0; round < 3; round++) {
    const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
    const strays = board
      .map((v, i) => ({ i, v }))
      .filter(({ i, v }) => v !== 0 && solution[i] !== 1)
      .filter(({ i }) => pixelByCell[i]);
    if (!strays.length) break;
    for (const { i, v } of strays) {
      const rec = pixelByCell[i];
      await openPuzzle(page, entry, { fresh: false });
      await applyActs(page, rec.acts, { platform, probe: false });
      // FILLED -> MARKED -> BLANK is two taps; MARKED -> BLANK is one.
      for (let n = 0; n < (v === 1 ? 2 : 1); n++) {
        await realTap(page, rec.px[0], rec.px[1], platform);
        corrections++;
        await settleTaps(page);
      }
    }
  }

  const solved = await page.evaluate('window.__qa.solved()');
  const board = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
  const wrong = board.filter((v, i) => (v === 1) !== (solution[i] === 1)).length;

  // the clear celebration is the reward layer's completion signal
  const celebrated = await page.evaluate(
    "!!document.querySelector('.fx-clear.fx-clear--on') || !!document.querySelector('.fx-clear')",
  );
  const record = await page.evaluate(`localStorage.getItem('no-nonogram:${entry.id}')`);

  const result = {
    id: entry.id,
    dims: entry.dims,
    needed: needed.length,
    clicks,
    corrections,
    stranded,
    misses,
    probeLatches,
    offCanvas,
    unsettled,
    solved,
    wrongCells: wrong,
    celebrated,
    record: record ? JSON.parse(record) : null,
    elapsedMs: Date.now() - startedAt,
  };

  // Before any verdict reads `solved`: this clear came from real input and not from the
  // harness's own probe. Without it, the three checks below are satisfiable by a bug in
  // this file — they were, until DOO-35 was traced to `latchGuard`/`unwind`.
  check(
    `${platform.label} ${entry.id}: no probe latched solved mid-playthrough`,
    probeLatches.length === 0,
    JSON.stringify(probeLatches.slice(0, 3)),
  );
  check(
    `${platform.label} ${entry.id}: every pixel aimed at is one a real click can reach`,
    offCanvas.length === 0,
    JSON.stringify(offCanvas.slice(0, 3)),
  );
  check(
    `${platform.label} ${entry.id}: every camera move the map recorded was reproduced`,
    unsettled.length === 0,
    `${unsettled.length} unsettled: ${JSON.stringify(unsettled.slice(0, 3))}`,
  );
  check(
    `${platform.label} ${entry.id}: finished with real ${platform.touch ? 'taps' : 'clicks'} only`,
    solved && stranded.length === 0 && misses.length === 0,
    `${clicks} ${platform.touch ? 'taps' : 'clicks'} for ${needed.length} cells, ` +
      `${corrections} corrective, ${stranded.length} stranded, ${misses.length} missed, ` +
      `${wrong} wrong, solved=${solved}`,
  );
  if (solved) {
    check(`${platform.label} ${entry.id}: clear celebration fired`, celebrated);
    check(`${platform.label} ${entry.id}: record persisted as solved`, result.record?.solved === true,
      JSON.stringify(result.record)?.slice(0, 80));
  }
  void out;
  return result;
}

// --- mode: probe -------------------------------------------------------------

/**
 * Targeted hunt for specific cells the broad sweep never reached.
 *
 * The broad sweep is a finite *sample* of orientations, so "not found" there means "not
 * found by those orientations", not "impossible". Before a puzzle can be called
 * unfinishable, the cells it needs have to survive a search that uses every camera
 * affordance the player has — including the two the sweep barely touches: dollying the
 * camera *inside* the box, and panning the target sideways once inside (orbit and dolly
 * both aim at the centre, so pan is the only way to get next to a particular cell).
 *
 * Every hit is re-confirmed with a real CDP event before it counts.
 */
async function runProbe(page, platform, { puzzleId, cells, out, check }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const entry = catalogue.find((c) => c.id === puzzleId);
  if (!entry) throw new Error(`no puzzle ${puzzleId}`);

  const remaining = new Set(cells);
  const found = {};
  let configs = 0;
  const startedAt = Date.now();

  // Inside-the-box bands: 0.95^n of the opening distance max(dims)*1.8+1. At 6³ the
  // opening distance is 11.8 and the box half-diagonal is ~6, so 20 ticks (~0.36x) is
  // already inside and 36 (~0.16x) is deep inside.
  for (const ticks of [18, 22, 26, 30, 34]) {
    for (const az of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const [dx, dy] of [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25], [-0.25, -0.25], [0.25, 0.25]]) {
        if (!remaining.size) break;
        await openPuzzle(page, entry);
        const rect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
        // Frames, not milliseconds, for the reason in the header — and pan is damped the
        // same way orbit is (`target.addScaledVector(panOffset, dampingFactor)`), so the
        // `sleep(260)` these three used to take left a third of every move unapplied.
        const settle = () => page.evaluate('window.__qa.settle({}).then((r) => JSON.stringify(r))');
        await page.evaluate(`window.__qa.zoom(-120, ${ticks})`);
        await settle();
        if (az) {
          await page.evaluate(`window.__qa.orbit(${(az / 8) * rect.height}, 0, 8)`);
          await settle();
        }
        if (dx || dy) {
          await page.evaluate(`window.__qa.pan(${dx * rect.width}, ${dy * rect.height}, 5)`);
          await settle();
        }
        configs++;
        const hit = await page
          .evaluate(`JSON.stringify(window.__qa.probeCentre(${JSON.stringify([...remaining])}, 90, 3))`)
          .then(JSON.parse);
        for (const [cellStr, px] of Object.entries(hit)) {
          const cell = Number(cellStr);
          if (!remaining.has(cell)) continue;
          // only counts if a real event lands on it too
          const got = await confirmWithRealTap(page, cell, px, platform);
          if (!got.ok) continue;
          remaining.delete(cell);
          found[cell] = { ticks, az: az * 45, pan: [dx, dy], px, confirmed: true };
          console.log(`  ${puzzleId} cell ${cell}: reached at zoom ${ticks}t az ${az * 45}deg pan [${dx},${dy}] — real click CONFIRMED`);
        }
      }
    }
  }

  const stillUnreachable = [...remaining];
  console.log(
    `\n  ${puzzleId}: ${cells.length - stillUnreachable.length}/${cells.length} of the sweep's unreachable cells ` +
      `were reached by the targeted probe (${configs} camera configs, ${((Date.now() - startedAt) / 1000).toFixed(0)}s)`,
  );
  if (stillUnreachable.length) console.log(`  still unreachable: ${stillUnreachable.join(' ')}`);

  check(
    `${platform.label} ${puzzleId}: every required cell is reachable by some camera the player can reach`,
    stillUnreachable.length === 0,
    `${stillUnreachable.length} cells survived ${configs} camera configs: ${stillUnreachable.join(' ')}`,
  );

  writeFileSync(join(out, `probe-${puzzleId}.json`), JSON.stringify({ puzzleId, cells, found, stillUnreachable, configs }, null, 2));
  return { found, stillUnreachable, configs };
}

// --- mode: edge --------------------------------------------------------------

/**
 * The paths a player takes that are not "click cells until solved": leaving a puzzle
 * half-done, reloading, switching tabs, undoing, re-opening a cleared board.
 *
 * Every assertion here is on observable state — localStorage, the DOM, the session —
 * reached by clicking the real controls, never by calling into the reward layer.
 */
async function runEdge(page, platform, { out, check, base }) {
  const catalogue = await page.evaluate(CATALOGUE);
  const target = catalogue[1]; // level 1, puzzle 2 — small board, always unlocked
  // Observations that are not pass/fail. Empty right now: the one note this used to
  // carry (stroke-undo unreachable) became a real assertion at E6 once DOO-16 wired the
  // caller up. Kept because the edge JSON's shape is part of the report's inputs.
  const notes = [];

  // --- E1 partial progress survives a reload, MARKED cells included -----------
  await openPuzzle(page, target);
  const written = await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    s.cycle(0);               // FILLED
    s.cycle(1); s.cycle(1);   // MARKED
    s.cycle(2);
    return Array.from(s.state).join('');
  })()`);
  await sleep(200);
  await page.goto(`${base}/?perf=1`);
  await openPuzzle(page, target, { fresh: false });
  const restored = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: a half-finished board (incl. MARKED cells) survives a reload', restored === written,
    `${written} -> ${restored}`);

  // --- E2 the elapsed timer survives a reload ---------------------------------
  const t1 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1600);
  await page.evaluate('window.__nonogram.rewards.attempt().flush()');
  const t2 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await page.goto(`${base}/?perf=1`);
  await openPuzzle(page, target, { fresh: false });
  const t3 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  check('edge: the attempt timer accumulates and survives a reload', t2 > t1 && t3 >= t2 - 200,
    `${t1.toFixed(0)}ms -> ${t2.toFixed(0)}ms -> after reload ${t3.toFixed(0)}ms`);

  // --- E3 walking back to the list pauses the timer ---------------------------
  await page.evaluate("document.getElementById('btn-game-back').click()");
  await sleep(300);
  const pausedRunning = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  const pausedAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1200);
  const stillAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  check('edge: leaving the puzzle for the list stops the timer', pausedRunning === false && Math.abs(stillAt - pausedAt) < 100,
    `running=${pausedRunning}, ${pausedAt.toFixed(0)}ms -> ${stillAt.toFixed(0)}ms after 1.2s on the list`);

  // --- E4 a hidden tab pauses the timer ---------------------------------------
  await openPuzzle(page, target, { fresh: false });
  await sleep(300);
  const runningOnScreen = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  // Emulation.setPageVisibility does not exist in CDP; the production listener is on
  // `visibilitychange`, so drive the real property the way the browser would.
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await sleep(250);
  const hiddenRunning = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  const hiddenAt = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await sleep(1200);
  const hiddenStill = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await sleep(250);
  const resumed = await page.evaluate('window.__nonogram.rewards.attempt().running()');
  check('edge: a backgrounded tab pauses the timer and coming back resumes it',
    runningOnScreen && hiddenRunning === false && Math.abs(hiddenStill - hiddenAt) < 100 && resumed === true,
    `onscreen=${runningOnScreen} hidden=${hiddenRunning} drift=${(hiddenStill - hiddenAt).toFixed(0)}ms resumed=${resumed}`);

  // --- E5 undo, by real clicks on the real button -----------------------------
  await openPuzzle(page, target);
  const rect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
  const centre = [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
  await realTap(page, centre[0], centre[1], platform);
  await sleep(150);
  const afterOne = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  const undoBtn = await page.evaluate("!!document.getElementById('undo') && !document.getElementById('undo').disabled");
  await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: undo reverts a real click', undoBtn && /^0+$/.test(afterUndo) && afterOne !== afterUndo,
    `${afterOne} -> ${afterUndo}`);

  // Undo with nothing on the stack must be a safe no-op, not an exception.
  for (let n = 0; n < 4; n++) await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterOverUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');
  check('edge: undo past the start of the stack is a no-op', /^0+$/.test(afterOverUndo), afterOverUndo);

  // --- E6 drag painting, and one undo for the whole stroke (DOO-10 + DOO-16) ---
  // This slot used to just assert beginStroke/endStroke *existed* and then print a note
  // saying nothing called them. That was true when it was written and stopped being true
  // at DOO-16, which restored ui/gestures.js — but the note was a hardcoded string, so
  // it kept printing a defect that no longer existed. A release report that cries wolf
  // is worse than one that stays quiet, so it now drives the feature instead.
  //
  // Two things have to hold for DOO-10's grouped undo to mean anything to a player:
  // a drag must paint more than one cell, and ONE undo press must take the whole drag
  // back. Both are driven the way a player does it — `#btn-mode` for paint mode (the
  // `__nonogram.mode()` handle is read-only on purpose) and real CDP input for the drag.
  await openPuzzle(page, target);
  const paintRect = await page.evaluate('JSON.stringify(window.__qa.rect())').then(JSON.parse);
  const modeBefore = await page.evaluate('window.__nonogram.mode()');
  await page.evaluate("document.getElementById('btn-mode').click()");
  await sleep(150);
  const modeAfter = await page.evaluate('window.__nonogram.mode()');

  // A horizontal sweep through the middle of the board, which crosses several columns of
  // the front face at any camera angle. Stepping in 6px increments keeps every move
  // inside one cell's width so no crossing is skipped.
  const dragY = Math.round(paintRect.top + paintRect.height / 2);
  const dragX0 = Math.round(paintRect.left + paintRect.width * 0.35);
  const dragX1 = Math.round(paintRect.left + paintRect.width * 0.65);
  const touch = platform.touch;
  const pt = (x) => [{ x, y: dragY, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
  if (touch) {
    await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(dragX0) });
  } else {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: dragX0, y: dragY, button: 'left', clickCount: 1, buttons: 1, pointerType: 'mouse',
    });
  }
  for (let x = dragX0 + 6; x <= dragX1; x += 6) {
    if (touch) await page.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x) });
    else {
      await page.call('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y: dragY, button: 'left', buttons: 1, pointerType: 'mouse',
      });
    }
  }
  if (touch) await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else {
    await page.call('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: dragX1, y: dragY, button: 'left', clickCount: 1, buttons: 0, pointerType: 'mouse',
    });
  }
  await sleep(200);

  const painted = await page
    .evaluate('JSON.stringify(window.__qa.board().map((v, i) => [i, v]).filter(([, v]) => v !== 0))')
    .then(JSON.parse);
  // One press, not a loop: the whole point of the stroke group is that a drag costs the
  // player a single undo. Looping here would pass even with no grouping at all.
  await page.evaluate("document.getElementById('undo').click()");
  await sleep(200);
  const afterStrokeUndo = await page.evaluate('Array.from(window.__nonogram.session().state).join("")');

  check('edge: a drag paints a stroke of several cells (DOO-16 restored the caller)',
    modeAfter === 'paint' && painted.length >= 2,
    `#btn-mode: ${modeBefore} -> ${modeAfter}; drag ${dragX0}->${dragX1}px painted ${painted.length} cells ` +
    `[${painted.map(([i]) => i).join(',')}]`);
  check('edge: one undo press takes the entire painted stroke back (DOO-10 grouping)',
    painted.length >= 2 && /^0+$/.test(afterStrokeUndo),
    `${painted.length} cells painted -> after ONE undo: ${afterStrokeUndo}`);

  // Leave the board in rotate mode so nothing after this inherits paint mode.
  if (modeAfter === 'paint') await page.evaluate("document.getElementById('btn-mode').click()");

  // --- E7 a hint costs points and the board stays consistent ------------------
  await openPuzzle(page, target);
  const hintBefore = await page.evaluate('window.__nonogram.rewards.attempt().hints()');
  await page.evaluate('window.__nonogram.rewards.hint()');
  await sleep(250);
  const banner = await page.evaluate("document.querySelector('.fx-banner')?.textContent?.slice(0, 60) ?? ''");
  await page.evaluate('window.__nonogram.rewards.hint()');
  await sleep(250);
  const hintAfter = await page.evaluate('window.__nonogram.rewards.attempt().hints()');
  const boardAfterHint = await page.evaluate('JSON.stringify(window.__qa.board())').then(JSON.parse);
  const solutionNow = await page.evaluate('JSON.stringify(window.__qa.solution())').then(JSON.parse);
  const hintWrong = boardAfterHint.filter((v, i) => v === 1 && solutionNow[i] !== 1).length;
  check('edge: two hint presses escalate 1 -> 2, charge points, and place only correct cells',
    hintAfter > hintBefore && hintWrong === 0 && banner.length > 0,
    `points ${hintBefore} -> ${hintAfter}, ${hintWrong} wrong cells placed, banner="${banner}"`);

  // --- E8 a cleared board reopens locked, with the timer stopped --------------
  await openPuzzle(page, target);
  await page.evaluate('window.__nonogram.rewards.solveNow()');
  await sleep(600);
  const solvedNow = await page.evaluate('window.__qa.solved()');
  await page.evaluate("document.getElementById('btn-game-back').click()");
  await sleep(300);
  await openPuzzle(page, target, { fresh: false });
  const reopened = await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    const before = Array.from(s.state).join('');
    s.cycle(0);
    return { solved: s.solved, locked: Array.from(s.state).join('') === before,
             canUndo: s.canUndo(), running: window.__nonogram.rewards.attempt().running() };
  })()`);
  check('edge: a cleared board reopens solved, input-locked, undo-locked, timer stopped',
    solvedNow && reopened.solved && reopened.locked && !reopened.canUndo && !reopened.running,
    JSON.stringify(reopened));

  // --- E9 level gating: locked before the clears, open after ------------------
  await page.evaluate('localStorage.clear()');
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  const lockedAtStart = await page.evaluate(
    "Array.from(document.querySelectorAll('#levels-grid .level-card')).map((c) => c.classList.contains('fx-locked'))",
  );
  await page.evaluate(SEED_ALL_CLEARED);
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  const lockedAfter = await page.evaluate(
    "Array.from(document.querySelectorAll('#levels-grid .level-card')).map((c) => c.classList.contains('fx-locked'))",
  );
  check('edge: levels 2-4 start locked and open once the earlier levels are cleared',
    lockedAtStart[0] === false && lockedAtStart.slice(1).every(Boolean) && lockedAfter.every((l) => l === false),
    `fresh=[${lockedAtStart}] seeded=[${lockedAfter}]`);

  // --- E10 a locked level card tells the player why ---------------------------
  await page.evaluate('localStorage.clear()');
  await page.goto(`${base}/?perf=1`);
  await page.evaluate("document.getElementById('btn-start').click()");
  await sleep(300);
  await page.evaluate("document.querySelectorAll('#levels-grid .level-card')[1].click()");
  await sleep(400);
  const blocked = await page.evaluate(`(() => ({
    stillOnLevels: !document.getElementById('screen-levels').hidden,
    toast: document.querySelector('.fx-toast')?.textContent?.slice(0, 80) ?? '',
    badge: document.querySelectorAll('#levels-grid .level-card')[1]?.textContent?.slice(0, 80) ?? '',
  }))()`);
  check('edge: tapping a locked level is refused with a reason, not silently',
    blocked.stillOnLevels && (blocked.toast.length > 0 || /잠김|\d+점/.test(blocked.badge)),
    JSON.stringify(blocked));

  writeFileSync(join(out, `edge-${platform.label}.json`), JSON.stringify({ notes }, null, 2));
  for (const n of notes) console.log(`  note   ${n.name}\n         ${n.detail}`);
  return { notes };
}

// --- entry point -------------------------------------------------------------

const [mode = 'reach', BASE = 'http://127.0.0.1:4273', OUT = 'qa-out'] = process.argv.slice(2);
const flags = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

mkdirSync(OUT, { recursive: true });
const { check, report, checks } = checklist();
const platform = PLATFORMS[flags.platform ?? 'desktop'];
if (!platform) throw new Error(`unknown platform ${flags.platform}`);

const browser = await launchChrome({ offline: true, windowSize: `${platform.width},${platform.height}` });
const page = await browser.newPage();
await page.emulate(platform);

const pageErrors = () => page.errors().filter((t) => !IGNORED_NOISE.test(t));

console.log(`\n=== ${mode} · ${platform.label} ${platform.width}x${platform.height}@${platform.deviceScaleFactor} cpu/${platform.cpuThrottle} ===\n`);

await page.goto(`${BASE}/?perf=1`);
await page.evaluate('localStorage.clear()');
await page.goto(`${BASE}/?perf=1`);
await page.evaluate(SEED_ALL_CLEARED);
await page.goto(`${BASE}/?perf=1`);
check(`${platform.label}: boots with no console errors`, pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));

// `settle()` resolves a cell boundary by bisecting fractional client coordinates, and a
// browser that rounded them would make every bisection return the same integer and every
// step claim it had converged on the first probe — green, and measuring nothing. The
// depth cursor is read through a handle that may not exist on an older build, and a sweep
// that silently skipped the cursor band would report the pre-DOO-17 box as the shipped
// one. Both are asserted here rather than assumed.
// Inline rather than through the probe: `install()` latches onto a session's `cell`
// event, and there is no session until a puzzle is open.
check(`${platform.label}: the browser keeps a fractional clientX (sub-pixel settle)`,
  await page.evaluate("new PointerEvent('pointerdown', { clientX: 12.25 }).clientX === 12.25"),
  "new PointerEvent({ clientX: 12.25 }).clientX");
check(`${platform.label}: the depth cursor is wired into the page`,
  await page.evaluate('typeof window.__nonogram.peel === "function"'), '__nonogram.peel()');

let payload = null;
if (mode === 'reach') {
  const dimsList = flags.dims ? flags.dims.split(',').map(parseDims) : null;
  payload = await runReach(page, platform, {
    dimsList,
    step: Number(flags.step ?? 6),
    // `--peel=off` drops the depth-cursor band and leaves the plan at the 35 camera
    // steps it had before DOO-31 — which is how a run is made comparable with one
    // taken before the cursor shipped.
    peel: flags.peel !== 'off',
    out: OUT,
    check,
  });
} else if (mode === 'play') {
  // `play` replays the map `reach` wrote for this platform: same pixels, same camera
  // moves, but every cell clicked with a real event and the puzzle taken to `solved`.
  const reach = JSON.parse(readFileSync(join(OUT, `reach-${platform.label}.json`), 'utf8'));
  const catalogue = await page.evaluate(CATALOGUE);
  const only = flags.only ? new Set(flags.only.split(',')) : null;
  const plays = [];
  for (const entry of catalogue) {
    if (only && !only.has(entry.id)) continue;
    const result = await playPuzzle(page, entry, reach, platform, { out: OUT, check });
    plays.push(result);
    console.log(
      `  ${entry.id.padEnd(12)} ${dimsKey(entry.dims).padEnd(6)} ` +
        `need=${String(result.needed).padStart(3)} ${String(result.clicks).padStart(3)} ${platform.touch ? 'taps' : 'clicks'} ` +
        `+${String(result.corrections).padStart(2)} fix  solved=${String(result.solved).padEnd(5)} ` +
        `stranded=${result.stranded.length} missed=${result.misses.length} wrong=${result.wrongCells}  ` +
        `${(result.elapsedMs / 1000).toFixed(0)}s`,
    );
  }
  const finished = plays.filter((p) => p.solved).length;
  check(`${platform.label}: all ${plays.length} puzzles finished with real input`, finished === plays.length,
    `${finished}/${plays.length}`);
  payload = plays;
} else if (mode === 'probe') {
  payload = await runProbe(page, platform, {
    puzzleId: flags.puzzle,
    cells: flags.cells.split(',').map(Number),
    out: OUT,
    check,
  });
} else if (mode === 'edge') {
  payload = await runEdge(page, platform, { out: OUT, check, base: BASE });
} else {
  throw new Error(`mode \`${mode}\` is not wired up in this revision`);
}

const errorsAtEnd = pageErrors();
check(`${platform.label}: no console errors across the whole run`, errorsAtEnd.length === 0, errorsAtEnd.slice(0, 4).join(' | '));

writeFileSync(join(OUT, `playtest-${mode}-${platform.label}.json`), JSON.stringify({ mode, platform, payload, checks }, null, 2));
await browser.close();
process.exit(report().length ? 1 : 0);

export { playPuzzle, runReach, sweepPlan, openPuzzle, realTap };
