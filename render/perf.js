// render/perf.js — frame-time / draw-call / first-screen instrumentation.
//
// The team budget is 60fps (16.7ms/frame) on a mid-range Android and a first screen
// within 2s. Numbers nobody looks at don't hold a budget, so a breach has to be
// loud in three independent places:
//
//   1. `?perf` pins a live overlay to the corner that turns red and prints the
//      blown budget by name.
//   2. `stats().over` is a machine-readable list of blown budgets — what
//      `scripts/bench-render.mjs` fails CI on.
//   3. the first breach of each budget logs one `console.warn`, so a breach shows
//      up in a plain play session with no overlay and no CI.
//
// Two different frame numbers, because they answer different questions:
//   frameMs  the wall-clock gap between frames. rAF is vsync-capped, so 16.7ms is
//            the *floor* — this can only reveal dropped frames, never head room.
//   cpuMs    the time our own code spends per frame (callbacks + controls + the
//            draw call). This is the one with head room in it: cpuMs of 4ms on a
//            desktop says a 4x-slower phone still lands inside the budget.
//
// Public API — createPerfMonitor(renderer, { overlay, label }) returns:
//   .beginFrame()      call at the top of the frame
//   .endFrame()        call after renderer.render() — brackets cpuMs
//   .mark(name)        record a milestone (ms since navigation start)
//   .reset()           drop accumulated samples, keep the marks
//   .stats()           -> see below
//   .dispose()
//
// stats() -> {
//   fps, frameMs, p95Ms, worstMs, droppedFrames, frames,
//   cpuMs, cpuWorstMs,
//   drawCalls, triangles,
//   firstFrameMs, marks,
//   over: string[],      // blown budget names — empty when inside budget
//   budgets,
// }

export const FRAME_BUDGET_MS = 1000 / 60;
export const FIRST_SCREEN_BUDGET_MS = 2000;
// A frame is "dropped" when the gap is long enough to have missed a whole vsync.
const DROP_THRESHOLD_MS = FRAME_BUDGET_MS * 1.5;
// Exponential moving average: smooth enough to read, still reacts within ~0.5s.
const EMA_ALPHA = 0.1;
// Tab warm-up, shader compiles and the first layout are not the steady-state
// budget — the worst-case trackers ignore everything before this point.
const WARMUP_MS = 1000;
// Ring buffer for the p95. 240 frames is ~4s at 60fps: long enough to be stable,
// small enough to sort every time stats() is called.
const SAMPLE_CAP = 240;
// Every budget `over` can name. Used to stop re-checking once all have warned.
const BUDGET_NAMES = ['first-screen', 'cpu-frame', 'dropped-frames'];

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function createPerfMonitor(renderer, { overlay = false, label = '' } = {}) {
  let lastBeginAt = 0;
  let frameStartedAt = 0;

  let frameMs = 0;
  let worstMs = 0;
  let cpuMs = 0;
  let cpuWorstMs = 0;
  let droppedFrames = 0;
  let frames = 0;

  let firstFrameMs = null;
  const marks = {};
  const samples = [];
  const warned = new Set();

  let el = null;
  if (overlay) {
    el = document.createElement('div');
    el.id = 'perf-overlay';
    el.style.cssText =
      'position:fixed;top:6px;left:6px;z-index:9999;padding:4px 7px;border-radius:4px;' +
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;' +
      'background:rgba(44,36,23,.82);color:#ecdfc0;pointer-events:none';
    document.body.appendChild(el);
  }

  function mark(name) {
    marks[name] = performance.now();
  }

  /** Blown budgets, by name. Empty array = inside budget. */
  function overBudget(s) {
    const over = [];
    if (s.firstFrameMs !== null && s.firstFrameMs > FIRST_SCREEN_BUDGET_MS) over.push('first-screen');
    // Only judge the frame budget once there is a steady state to judge.
    if (s.frames > 60) {
      if (s.cpuMs > FRAME_BUDGET_MS) over.push('cpu-frame');
      if (s.droppedFrames > 0) over.push('dropped-frames');
    }
    return over;
  }

  function stats() {
    const info = renderer?.info?.render ?? { calls: 0, triangles: 0 };
    const sorted = [...samples].sort((a, b) => a - b);
    const s = {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      p95Ms: percentile(sorted, 95),
      worstMs,
      droppedFrames,
      frames,
      cpuMs,
      cpuWorstMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      firstFrameMs,
      marks: { ...marks },
      budgets: { frameMs: FRAME_BUDGET_MS, firstScreenMs: FIRST_SCREEN_BUDGET_MS },
    };
    s.over = overBudget(s);
    return s;
  }

  function paintOverlay() {
    const s = stats();
    const over = s.over.length > 0;
    el.style.color = over ? '#ffb4a2' : '#ecdfc0';
    el.style.background = over ? 'rgba(120,32,24,.88)' : 'rgba(44,36,23,.82)';
    el.textContent =
      (label ? `${label}\n` : '') +
      `${s.fps.toFixed(0)} fps   gap ${s.frameMs.toFixed(1)}ms  p95 ${s.p95Ms.toFixed(1)}  worst ${s.worstMs.toFixed(1)}\n` +
      `cpu ${s.cpuMs.toFixed(2)}ms/frame (worst ${s.cpuWorstMs.toFixed(2)})  budget ${FRAME_BUDGET_MS.toFixed(1)}\n` +
      `draw ${s.drawCalls}  tri ${s.triangles}  dropped ${s.droppedFrames}/${s.frames}\n` +
      `first screen ${s.firstFrameMs === null ? '—' : `${s.firstFrameMs.toFixed(0)}ms`} / ${FIRST_SCREEN_BUDGET_MS}ms` +
      (over ? `\n⚠ OVER BUDGET: ${s.over.join(', ')}` : '');
  }

  function beginFrame() {
    const now = performance.now();
    frames++;

    if (firstFrameMs === null) {
      // performance.now() is relative to navigation start, so this *is* the
      // time-to-first-screen, not just the time since this module was created.
      firstFrameMs = now;
      marks['first-frame'] = now;
    }

    // lastBeginAt is 0 on the very first frame and again after reset() — there is
    // no previous frame to measure a gap against, and treating `now - 0` as a gap
    // would poison worstMs with the whole page lifetime.
    if (lastBeginAt > 0) {
      const gap = now - lastBeginAt;
      frameMs = frameMs ? frameMs + (gap - frameMs) * EMA_ALPHA : gap;
      if (now > WARMUP_MS) {
        if (gap > worstMs) worstMs = gap;
        if (gap > DROP_THRESHOLD_MS) droppedFrames++;
        samples.push(gap);
        if (samples.length > SAMPLE_CAP) samples.shift();
      }
    }

    lastBeginAt = now;
    frameStartedAt = now;
  }

  function endFrame() {
    const spent = performance.now() - frameStartedAt;
    cpuMs = cpuMs ? cpuMs + (spent - cpuMs) * EMA_ALPHA : spent;
    if (lastBeginAt > WARMUP_MS && spent > cpuWorstMs) cpuWorstMs = spent;

    // One warning per budget, the first time it is blown — a breach is visible
    // even with no overlay and nobody watching. stats() sorts the sample ring, so
    // this runs on a tenth of the frames and stops once every budget has spoken.
    if (frames % 10 === 0 && warned.size < BUDGET_NAMES.length) {
      const s = stats();
      for (const name of s.over) {
        if (warned.has(name)) continue;
        warned.add(name);
        console.warn(`[perf] budget blown: ${name}`, s);
      }
    }

    if (el && frames % 10 === 0) paintOverlay();
  }

  return {
    beginFrame,
    endFrame,
    mark,
    stats,
    reset() {
      frameMs = 0;
      worstMs = 0;
      cpuMs = 0;
      cpuWorstMs = 0;
      droppedFrames = 0;
      frames = 0;
      samples.length = 0;
      lastBeginAt = 0;
      // firstFrameMs is a property of the page load, not of a measurement window.
    },
    dispose() {
      el?.remove();
      el = null;
    },
  };
}
