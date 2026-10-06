// tests/perf.test.js — the budget alarm.
//
// "예산 초과를 눈에 보이게" is only true if a breach is *detected*, so the detection
// is tested rather than eyeballed through the overlay. `performance.now` is stubbed
// so a dropped frame or a 3-second first screen is a fact the test states, not a
// slow machine it has to wait for.
//
// Only the headless path is exercised here (`overlay: false` never touches the DOM);
// the overlay's own red state is a one-liner off the same `stats().over`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPerfMonitor, FRAME_BUDGET_MS, FIRST_SCREEN_BUDGET_MS } from '../render/perf.js';

// A renderer stand-in: perf only ever reads `renderer.info.render`.
const fakeRenderer = (calls = 4, triangles = 1000) => ({ info: { render: { calls, triangles } } });

let clock = 0;
let nowSpy;
let warnSpy;

beforeEach(() => {
  clock = 0;
  nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  nowSpy.mockRestore();
  warnSpy.mockRestore();
});

/**
 * Render `count` frames, each taking `gapMs` wall-clock and `cpuMs` of our own work.
 *
 * A frame's *gap* is measured on the next `beginFrame`, so switching `gapMs` between
 * two batches leaves the first frame of the new batch carrying the old gap, and the
 * last frame of a run is never counted. The expectations below are off by one on
 * purpose for that reason.
 */
function runFrames(perf, count, { gapMs = FRAME_BUDGET_MS, cpuMs = 1 } = {}) {
  for (let i = 0; i < count; i++) {
    perf.beginFrame();
    clock += cpuMs;
    perf.endFrame();
    clock += gapMs - cpuMs;
  }
}

describe('createPerfMonitor', () => {
  it('starts with nothing measured and nothing over budget', () => {
    const perf = createPerfMonitor(fakeRenderer());
    const s = perf.stats();
    expect(s.firstFrameMs).toBe(null);
    expect(s.frames).toBe(0);
    expect(s.over).toEqual([]);
  });

  it('reads first-screen time off the navigation clock, not module load', () => {
    clock = 850;
    const perf = createPerfMonitor(fakeRenderer());
    perf.beginFrame();
    perf.endFrame();
    expect(perf.stats().firstFrameMs).toBe(850);
    expect(perf.stats().marks['first-frame']).toBe(850);
  });

  it('does not charge the first frame with the whole page lifetime', () => {
    // The first frame has no predecessor, so there is no gap to measure. Counting
    // `now - 0` as a frame gap would report the page load as the worst frame.
    clock = 1500;
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 30);
    expect(perf.stats().worstMs).toBeLessThan(FRAME_BUDGET_MS * 1.5);
    expect(perf.stats().droppedFrames).toBe(0);
  });

  it('holds 60fps clean when every frame lands on vsync', () => {
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 200, { gapMs: FRAME_BUDGET_MS, cpuMs: 2 });
    const s = perf.stats();
    expect(s.fps).toBeCloseTo(60, 0);
    expect(s.droppedFrames).toBe(0);
    expect(s.cpuMs).toBeCloseTo(2, 1);
    expect(s.over).toEqual([]);
  });

  it('flags dropped frames once a gap misses a whole vsync', () => {
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 70, { gapMs: FRAME_BUDGET_MS });
    expect(perf.stats().over).toEqual([]);
    runFrames(perf, 5, { gapMs: 40 }); // 40ms = two missed vsyncs
    const s = perf.stats();
    expect(s.droppedFrames).toBe(4); // the 5th gap lands on the next beginFrame
    expect(s.over).toContain('dropped-frames');
  });

  it('flags cpu work that cannot fit in a 60fps frame', () => {
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 120, { gapMs: 40, cpuMs: 30 });
    const s = perf.stats();
    expect(s.cpuMs).toBeGreaterThan(FRAME_BUDGET_MS);
    expect(s.over).toContain('cpu-frame');
  });

  it('flags a first screen past 2s', () => {
    clock = FIRST_SCREEN_BUDGET_MS + 1;
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 5);
    expect(perf.stats().over).toEqual(['first-screen']);
  });

  it('waits for a steady state before judging the frame budget', () => {
    // Shader compiles and the first layout are not the budget: a slow 20th frame
    // must not fail a run that then holds 60fps for a minute.
    clock = 100;
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 10, { gapMs: 60, cpuMs: 50 });
    expect(perf.stats().over).toEqual([]);
  });

  it('warns on the console once per blown budget', () => {
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 300, { gapMs: 50, cpuMs: 40 });
    const blown = warnSpy.mock.calls.map((c) => c[0]);
    expect(blown).toContain('[perf] budget blown: cpu-frame');
    expect(blown).toContain('[perf] budget blown: dropped-frames');
    // once each, not once per frame
    expect(new Set(blown).size).toBe(blown.length);
  });

  it('reports draw calls and triangles straight off the renderer', () => {
    const perf = createPerfMonitor(fakeRenderer(4, 2598));
    runFrames(perf, 5);
    expect(perf.stats().drawCalls).toBe(4);
    expect(perf.stats().triangles).toBe(2598);
  });

  it('reset() clears the measurement window but keeps the page milestones', () => {
    clock = 200;
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 100, { gapMs: 50, cpuMs: 40 });
    expect(perf.stats().droppedFrames).toBeGreaterThan(0);

    perf.reset();
    expect(perf.stats().frames).toBe(0);
    expect(perf.stats().droppedFrames).toBe(0);
    expect(perf.stats().worstMs).toBe(0);
    expect(perf.stats().firstFrameMs).toBe(200); // a property of the page load

    runFrames(perf, 100);
    expect(perf.stats().droppedFrames).toBe(0);
    expect(perf.stats().worstMs).toBeLessThan(FRAME_BUDGET_MS * 1.5);
  });

  it('records named milestones against the navigation clock', () => {
    const perf = createPerfMonitor(fakeRenderer());
    clock = 640;
    perf.mark('first-puzzle');
    expect(perf.stats().marks['first-puzzle']).toBe(640);
  });

  it('reports a p95 that ignores the single worst frame', () => {
    const perf = createPerfMonitor(fakeRenderer());
    runFrames(perf, 100, { gapMs: 16 });
    runFrames(perf, 2, { gapMs: 200 }); // 2, so one 200ms gap actually gets recorded
    const s = perf.stats();
    expect(s.worstMs).toBe(200);
    expect(s.p95Ms).toBeLessThan(20);
  });
});
