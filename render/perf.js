// render/perf.js — frame-time / draw-call / first-frame instrumentation.
//
// The team budget is 60fps (16.7ms/frame) on a mid-range Android and a first frame
// within 2s. Numbers nobody looks at don't hold a budget, so `?perf=1` pins a live
// overlay to the corner that turns red the moment either budget is blown.
//
// Public API — createPerfMonitor(renderer, { overlay }) returns:
//   .tick()     call once per frame (before render — it reads the previous frame's info)
//   .stats()    -> { fps, frameMs, worstMs, drawCalls, triangles, firstFrameMs }
//   .dispose()

const FRAME_BUDGET_MS = 1000 / 60;
const FIRST_FRAME_BUDGET_MS = 2000;
// Exponential moving average: smooth enough to read, still reacts within ~0.5s.
const EMA_ALPHA = 0.1;

export function createPerfMonitor(renderer, { overlay = false } = {}) {
  let lastAt = 0;
  let frameMs = 0;
  let worstMs = 0;
  let firstFrameMs = null;
  let frames = 0;
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

  function stats() {
    const info = renderer.info.render;
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      worstMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      firstFrameMs,
    };
  }

  function tick() {
    const now = performance.now();
    frames++;

    if (firstFrameMs === null) {
      // performance.now() is relative to navigation start, so this *is* the
      // time-to-first-frame, not just the time since this module was created.
      firstFrameMs = now;
    } else {
      const dt = now - lastAt;
      frameMs = frameMs ? frameMs + (dt - frameMs) * EMA_ALPHA : dt;
      // Ignore the first second: tab warm-up and shader compiles aren't the budget.
      if (now > 1000 && dt > worstMs) worstMs = dt;
    }
    lastAt = now;

    if (el && frames % 10 === 0) {
      const s = stats();
      const over = s.frameMs > FRAME_BUDGET_MS || s.firstFrameMs > FIRST_FRAME_BUDGET_MS;
      el.style.color = over ? '#ffb4a2' : '#ecdfc0';
      el.textContent =
        `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)}ms (worst ${s.worstMs.toFixed(1)})\n` +
        `draw ${s.drawCalls}  tri ${s.triangles}\n` +
        `first frame ${s.firstFrameMs.toFixed(0)}ms`;
    }
  }

  return {
    tick,
    stats,
    dispose() {
      el?.remove();
      el = null;
    },
  };
}
