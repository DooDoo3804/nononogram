// scripts/bench-render.mjs — THE PERF GATE.
//
// Drives `bench/` in headless Chrome and fails if the render budget is blown.
//
//   node scripts/bench-render.mjs [baseUrl] [outFile]
//
// Two profiles per run:
//
//   desktop  1280x860, no CPU throttle — the head-room reading.
//   mobile   412x915 @ DPR 2.625 (Pixel-class viewport) with a 4x CPU slowdown.
//            This is the stand-in for "mid-range Android". It is a proxy, not a
//            phone: 4x is Chrome DevTools' own mid-tier mobile factor, and the GL
//            backend here is SwiftShader (software rasterization), which is slower
//            than any real phone GPU. Both knobs err pessimistic, so a pass here is
//            a floor — a physical-device pass still belongs to the QA track.
//
// The draw-call, triangle, build-time and repaint numbers are exact and
// hardware-independent; those are the ones to quote.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome, checklist } from './cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'verify-out/bench.json';
const SUITE = process.env.BENCH_SUITE ?? '3x3x3,4x4x4,5x5x5,6x6x6';
const SECONDS = process.env.BENCH_SECONDS ?? '4';

// One InstancedMesh for filled cells + one for marked + one merged line mesh for the
// cell outlines, plus the gizmo's 3 lines and 3 label sprites. The point of the
// budget is the word "constant": it must not grow with the cell count.
const DRAW_CALL_CEILING = 12;

// How 60fps is judged, and why it is not "zero dropped frames".
//
// Measured over four back-to-back runs of the suite, this harness drops 0 frames at
// every size on desktop and at 3³/4³/6³ on the mobile profile, but produced a one-off
// ~20ms stall (2-4 dropped frames out of 240) at 5³ in two of four runs — GC or a
// SwiftShader hiccup, not a size-correlated cost: 6³ never dropped one. A gate that
// red-lights half its runs gets ignored, so the sharp instrument here is p95, which
// sat in 17.4-18.1ms across every run and every size. A real drop to 30fps puts p95
// at ~33ms, so the separation is wide. Dropped frames stay a loose sanity bound, and
// the count is always printed either way.
const P95_CEILING_MS = 20;
const DROPPED_FRAME_ALLOWANCE = 0.02;

const PROFILES = [
  { name: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: 'mobile-4x', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4 },
];

const { check, report } = checklist();
const browser = await launchChrome({ offline: true });
console.log(`chrome: ${browser.executable}\n`);

const runs = {};

for (const profile of PROFILES) {
  const page = await browser.newPage();
  await page.emulate(profile);

  const url = `${BASE}/bench/?suite=${SUITE}&sec=${SECONDS}`;
  console.log(`--- ${profile.name}  ${profile.width}x${profile.height}@${profile.deviceScaleFactor} cpu/${profile.cpuThrottle}`);
  await page.goto(url);
  // Every dims runs for SECONDS plus warm-up; give the slow profile real head room.
  await page.waitFor('window.__bench?.done === true', {
    timeoutMs: (Number(SECONDS) + 6) * SUITE.split(',').length * 1000 * profile.cpuThrottle,
  });

  const rows = await page.evaluate('window.__bench.results');
  const firstFrameMs = await page.evaluate('window.__bench.perf().firstFrameMs');
  runs[profile.name] = { profile, firstFrameMs, rows };

  console.log(
    'dims     cells  draw   tri    fps    gap    p95    cpu     cpu-worst  dropped  build   repaint  pick',
  );
  for (const r of rows) {
    console.log(
      `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)} ` +
        `${String(r.triangles).padStart(6)} ${r.fps.toFixed(1).padStart(6)} ${r.frameMs.toFixed(2).padStart(6)} ` +
        `${r.p95Ms.toFixed(2).padStart(6)} ${r.cpuMs.toFixed(3).padStart(7)} ${r.cpuWorstMs.toFixed(3).padStart(10)} ` +
        `${String(r.droppedFrames).padStart(8)} ${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
        `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
        (r.over.length ? `   OVER ${r.over.join(',')}` : ''),
    );
  }
  console.log(`first frame: ${firstFrameMs?.toFixed(0)}ms\n`);

  const errors = page.errors().filter((t) => !/favicon\.ico/.test(t));
  check(`${profile.name}: no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
}

// --- the gate ---------------------------------------------------------------

const desktop = runs.desktop;
const mobile = runs['mobile-4x'];
const biggest = (run) => run.rows[run.rows.length - 1];

for (const [name, run] of Object.entries(runs)) {
  const overCeiling = run.rows.filter((r) => r.drawCalls > DRAW_CALL_CEILING);
  check(
    `${name}: draw calls stay under ${DRAW_CALL_CEILING} at every size`,
    overCeiling.length === 0,
    run.rows.map((r) => `${r.dims}=${r.drawCalls}`).join(' '),
  );

  // The headline claim: constant, not merely small. 216 cells must cost the same
  // number of draw calls as 27.
  const calls = new Set(run.rows.map((r) => r.drawCalls));
  check(
    `${name}: draw calls are constant across 3³→6³`,
    calls.size === 1,
    `${[...calls].join(', ')} distinct values`,
  );

  check(
    `${name}: every size still picks a cell by instance raycast`,
    run.rows.every((r) => r.picked !== null),
    run.rows.map((r) => `${r.dims}→${r.picked}`).join(' '),
  );

  check(
    `${name}: first screen inside the 2s budget`,
    run.firstFrameMs !== null && run.firstFrameMs < 2000,
    `${run.firstFrameMs?.toFixed(0)}ms`,
  );
}

// 60fps on the mobile proxy — judged at *every* size, not just the biggest. rAF is
// vsync-capped, so the signal is "frames land on vsync", not an average under 16.7ms.
const worstP95 = mobile.rows.filter((r) => r.p95Ms > P95_CEILING_MS);
check(
  `mobile-4x: holds 60fps at every size (p95 ≤ ${P95_CEILING_MS}ms)`,
  worstP95.length === 0,
  mobile.rows.map((r) => `${r.dims}=${r.p95Ms.toFixed(1)}ms`).join(' '),
);

const tooManyDrops = mobile.rows.filter((r) => r.droppedFrames > r.frames * DROPPED_FRAME_ALLOWANCE);
check(
  `mobile-4x: dropped frames under ${(DROPPED_FRAME_ALLOWANCE * 100).toFixed(0)}% at every size`,
  tooManyDrops.length === 0,
  mobile.rows.map((r) => `${r.dims}=${r.droppedFrames}/${r.frames}`).join(' '),
);

const overCpu = mobile.rows.filter((r) => r.cpuMs >= 1000 / 60);
check(
  'mobile-4x: cpu work per frame inside 16.7ms at every size',
  overCpu.length === 0,
  mobile.rows.map((r) => `${r.dims}=${r.cpuMs.toFixed(2)}ms`).join(' '),
);

const d = biggest(desktop);
check(
  `desktop: cpu work per frame at ${d.dims} leaves 4x head room`,
  d.cpuMs * 4 < 1000 / 60,
  `${d.cpuMs.toFixed(3)}ms x4 = ${(d.cpuMs * 4).toFixed(2)}ms vs 16.67ms`,
);

// --- out --------------------------------------------------------------------

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ base: BASE, suite: SUITE, seconds: Number(SECONDS), runs }, null, 2));
console.log(`\nwrote ${OUT}`);

const failed = report();
process.exit(failed.length ? 1 : 0);
