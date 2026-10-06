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
//            4x is Chrome DevTools' own mid-tier mobile factor.
//
// WHAT THE MOBILE PROFILE IS AND IS NOT (DOO-20).
//
// It emulates a phone's *viewport* and *CPU*. It does not emulate a phone's GPU: the
// GL backend is whatever this machine has, which here is `ANGLE (Apple, ANGLE Metal
// Renderer: Apple M1 Pro)`. This file used to claim the backend was SwiftShader and
// conclude "both knobs err pessimistic, so a pass here is a floor". The first half
// was false and so was the conclusion — an M1 Pro outruns every mid-range Android
// GPU, so on the fill axis these numbers err *optimistic*, not pessimistic. Reading
// the two axes apart:
//
//   CPU axis    pessimistic (4x slowdown) — a pass is meaningful.
//   fill axis   OPTIMISTIC (desktop GPU)  — a pass is not a phone floor.
//
// That matters because this renderer's frame cost is overwhelmingly per-pixel. Run
// the same profile against forced software raster (`BENCH_GL=software`) and 6³ p95
// goes from 17.8ms to 33ms at a 1x buffer and 73-80ms at the shipped 2x cap, while
// cpu/frame stays under 0.9ms throughout: every millisecond that moves lives
// downstream of our code, on the one axis this profile flatters. Neither reading is a
// phone — see the bracket in render/scene.js — and DOO-12 still needs a device.
//
// So: the draw-call, triangle, build-time, repaint and pixel-ratio numbers are exact
// and hardware-independent — those are the ones to quote. The timing columns describe
// this machine on this run, which is what makes them useful as a regression tripwire
// and useless as a device claim. Every run records the backend it actually got
// (`page.glRenderer()`) and the machine's load average, so no later reader has to
// take a comment's word for it.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadavg, cpus } from 'node:os';
import { launchChrome, checklist } from './cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'verify-out/bench.json';
const SUITE = process.env.BENCH_SUITE ?? '3x3x3,4x4x4,5x5x5,6x6x6';
const SECONDS = process.env.BENCH_SECONDS ?? '4';
// Unset ships the cap from render/scene.js. BENCH_MAX_DPR overrides it, which is how
// the cap was swept to pick a value — see DOO-19.
const MAX_DPR = process.env.BENCH_MAX_DPR;
// 'auto' = this machine's GPU (see the header). 'software' forces SwiftShader, which
// is the pessimistic fill-axis reading; its timing checks go advisory because the
// budgets here were set against hardware GL and software raster misses them by design.
const GL = process.env.BENCH_GL ?? 'auto';

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

// The retina floor (DOO-19). The drawing buffer must be the CSS box times the
// device ratio, clamped to this. Stated here as an independent contract rather than
// read back from the page, so the gate still fails if `setPixelRatio` is dropped or
// the cap in render/scene.js is quietly lowered. Raising or lowering it is a
// deliberate edit backed by the sweep below it in this file's history.
const MIN_PIXEL_RATIO_CAP = 2;

// Above this, the box is too busy for the timing columns to describe the code rather
// than the neighbours (DOO-20 BUG-D: the same configuration moved ~10x — first frame
// 144ms vs 3006ms — at load 6.6-15.3 on 8 cores). Contended timings are still printed
// and still stored; they just go advisory instead of setting the exit code, because a
// commit cannot cause them.
const QUIET_LOAD = cpus().length * 0.5;

const ALL_PROFILES = [
  { name: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: 'mobile-4x', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4 },
];

// A full run is both profiles; BENCH_PROFILES narrows it. That exists so a sweep is a
// command in the repo rather than a throwaway script — software raster at 2.6Mpx costs
// minutes per size, and a cap sweep only needs the mobile profile at the biggest board:
//
//   BENCH_GL=software BENCH_PROFILES=mobile-4x BENCH_SUITE=6x6x6 BENCH_MAX_DPR=2 \
//     node scripts/bench-render.mjs http://127.0.0.1:4173 verify-out/sweep-2.json
//
// Checks belonging to an absent profile are skipped, so a narrowed run gates less. It
// is an instrument in that mode, not the gate.
const ONLY = process.env.BENCH_PROFILES?.split(',').map((s) => s.trim());
const PROFILES = ONLY ? ALL_PROFILES.filter((p) => ONLY.includes(p.name)) : ALL_PROFILES;
if (!PROFILES.length) {
  throw new Error(`BENCH_PROFILES=${ONLY} matched none of ${ALL_PROFILES.map((p) => p.name).join(', ')}`);
}

const { check, report } = checklist();
const browser = await launchChrome({ offline: true, gl: GL });
console.log(`chrome: ${browser.executable}`);

const runs = {};

for (const profile of PROFILES) {
  const page = await browser.newPage();
  await page.emulate(profile);

  const url = `${BASE}/bench/?suite=${SUITE}&sec=${SECONDS}${MAX_DPR ? `&maxdpr=${MAX_DPR}` : ''}`;
  console.log(`--- ${profile.name}  ${profile.width}x${profile.height}@${profile.deviceScaleFactor} cpu/${profile.cpuThrottle}`);
  await page.goto(url);

  // Read the backend off the page, never off the flags — that conflation is the whole
  // of DOO-20. Software raster at 2.6Mpx also needs a far longer leash than hardware
  // GL, so the timeout keys off what we actually got.
  const glRenderer = await page.glRenderer();
  const software = /swiftshader/i.test(glRenderer);
  console.log(`gl: ${glRenderer}${software ? '  (software raster)' : ''}`);

  const loadBefore = loadavg()[0];
  // Each dims costs the SECONDS window plus warm-up plus the 40-frame fill probe, and
  // the probe's frames are pipeline-synced, so they cost real GPU time rather than
  // vsync time. Head room is per-size and scales with both slow knobs: a contended box
  // (see QUIET_LOAD) can take several times the quiet figure, and software raster at
  // 2.6Mpx takes an order of magnitude more than hardware GL. A timeout here is an
  // instrument failure, not a budget failure, so it says how far the suite got.
  const sizes = SUITE.split(',').length;
  try {
    await page.waitFor('window.__bench?.done === true', {
      timeoutMs: (Number(SECONDS) + (software ? 45 : 14)) * sizes * 1000 * profile.cpuThrottle,
    });
  } catch (err) {
    const done = await page.evaluate('window.__bench?.results?.length ?? -1');
    throw new Error(
      `${profile.name}: bench did not finish — ${done}/${sizes} sizes done, gl ${glRenderer}, ` +
        `load ${loadBefore.toFixed(2)} → ${loadavg()[0].toFixed(2)}. ${err.message}`,
    );
  }

  const rows = await page.evaluate('window.__bench.results');
  const firstFrameMs = await page.evaluate('window.__bench.perf().firstFrameMs');
  const load = { before: loadBefore, after: loadavg()[0] };
  runs[profile.name] = { profile, glRenderer, software, load, firstFrameMs, rows };

  const ratio = rows[0]?.pixelRatio;
  console.log(
    `dpr: device ${profile.deviceScaleFactor} cap ${MAX_DPR ?? 'default'} → buffer ${ratio}x ` +
      `(${rows[0]?.bufferPx.toLocaleString()} px)`,
  );
  // `sync` is the fill-axis instrument this profile otherwise lacks (DOO-19): a
  // readPixels after the draw, which cannot be served until the raster finishes. The
  // other timing columns are vsync-capped or bracket only our own code, so they read
  // identically whether the buffer is 1x or 9x. This one moves with buffer area.
  console.log(
    'dims     cells  draw   tri    fps    gap    p95    cpu     sync   sync-p95  dropped  build   repaint  pick',
  );
  for (const r of rows) {
    console.log(
      `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)} ` +
        `${String(r.triangles).padStart(6)} ${r.fps.toFixed(1).padStart(6)} ${r.frameMs.toFixed(2).padStart(6)} ` +
        `${r.p95Ms.toFixed(2).padStart(6)} ${r.cpuMs.toFixed(3).padStart(7)} ${r.syncMs.toFixed(2).padStart(6)} ` +
        `${r.syncP95Ms.toFixed(2).padStart(9)} ` +
        `${String(r.droppedFrames).padStart(8)} ${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
        `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
        (r.over.length ? `   OVER ${r.over.join(',')}` : ''),
    );
  }
  console.log(
    `first frame: ${firstFrameMs?.toFixed(0)}ms   load ${load.before.toFixed(2)} → ${load.after.toFixed(2)} ` +
      `(${cpus().length} cores)\n`,
  );

  const errors = page.errors().filter((t) => !/favicon\.ico/.test(t));
  check(`${profile.name}: no console errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
}

// --- the gate ---------------------------------------------------------------

const desktop = runs.desktop;
const mobile = runs['mobile-4x'];
const biggest = (run) => run.rows[run.rows.length - 1];

// Did we get the backend we asked for? The failure mode is silent — DOO-20's flags
// requested a software fallback and got a Metal GPU for months without a word.
const wantSoftware = GL === 'software';
check(
  `gl backend is the one requested (BENCH_GL=${GL})`,
  Object.values(runs).every((r) => r.software === wantSoftware),
  Object.values(runs)
    .map((r) => `${r.profile.name}: ${r.glRenderer}`)
    .join(' | '),
);

// Timing columns are only evidence about the code when the box is quiet and the
// backend is the one the budgets were set against. Otherwise they still print, with
// their real values, but they stop gating. See QUIET_LOAD.
const peakLoad = Math.max(...Object.values(runs).flatMap((r) => [r.load.before, r.load.after]));
const contended = peakLoad > QUIET_LOAD;
const timing = { advisory: contended || wantSoftware };
const why = [
  contended ? `load ${peakLoad.toFixed(2)} > ${QUIET_LOAD.toFixed(1)}` : null,
  wantSoftware ? 'software raster' : null,
]
  .filter(Boolean)
  .join(', ');
if (timing.advisory) {
  console.log(`!! timing checks are ADVISORY this run (${why}) — they print but do not gate.\n`);
}

for (const [name, run] of Object.entries(runs)) {
  const overCeiling = run.rows.filter((r) => r.drawCalls > DRAW_CALL_CEILING);
  check(
    `${name}: draw calls stay under ${DRAW_CALL_CEILING} at every size`,
    overCeiling.length === 0,
    run.rows.map((r) => `${r.dims}=${r.drawCalls}`).join(' '),
  );

  // The headline claim: 216 cells must not cost more draw calls than 27.
  //
  // Asserted as non-growth rather than strict equality (DOO-20 BUG-C). The gizmo's
  // three axis-label sprites are individually frustum-culled, so the count legitimately
  // reads 8 instead of 9 at framings where one falls off screen — QA saw 9/9/8/8 across
  // 3³→6³ inside a 412x915 iframe. That is an aspect-ratio artefact with no connection
  // to the cell count, and `calls.size === 1` turned it into a spurious FAIL on any
  // viewport but the two we happened to test. Phone aspect ratios vary per device, so
  // this would have fired on the physical-device run for no reason. The budget's whole
  // meaning is "does not grow with cells", and that is now what it says.
  const first = run.rows[0];
  const last = run.rows[run.rows.length - 1];
  check(
    `${name}: draw calls do not grow from 3³ to 6³`,
    last.drawCalls <= first.drawCalls,
    run.rows.map((r) => `${r.dims}(${r.cells})=${r.drawCalls}`).join(' '),
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
    timing,
  );

  // DOO-19. Blurriness shows up in no other number in this table — the board can be
  // drawn at 1/9 the screen's pixels and still post a perfect fps. Skipped when the
  // run is a deliberate cap sweep.
  const wantRatio = Math.min(run.profile.deviceScaleFactor, MIN_PIXEL_RATIO_CAP);
  check(
    `${name}: drawing buffer is ${wantRatio}x the CSS box (device ${run.profile.deviceScaleFactor}, cap ≥ ${MIN_PIXEL_RATIO_CAP})`,
    MAX_DPR ? true : run.rows.every((r) => r.pixelRatio >= wantRatio - 1e-6),
    MAX_DPR
      ? `skipped — BENCH_MAX_DPR=${MAX_DPR} sweep, measured ${run.rows[0]?.pixelRatio}x`
      : run.rows.map((r) => `${r.dims}=${r.pixelRatio}x`).join(' '),
  );
}

if (mobile) {
  // 60fps on the mobile proxy — judged at *every* size, not just the biggest. rAF is
  // vsync-capped, so the signal is "frames land on vsync", not an average under 16.7ms.
  const worstP95 = mobile.rows.filter((r) => r.p95Ms > P95_CEILING_MS);
  check(
    `mobile-4x: holds 60fps at every size (p95 ≤ ${P95_CEILING_MS}ms)`,
    worstP95.length === 0,
    mobile.rows.map((r) => `${r.dims}=${r.p95Ms.toFixed(1)}ms`).join(' '),
    timing,
  );

  const tooManyDrops = mobile.rows.filter((r) => r.droppedFrames > r.frames * DROPPED_FRAME_ALLOWANCE);
  check(
    `mobile-4x: dropped frames under ${(DROPPED_FRAME_ALLOWANCE * 100).toFixed(0)}% at every size`,
    tooManyDrops.length === 0,
    mobile.rows.map((r) => `${r.dims}=${r.droppedFrames}/${r.frames}`).join(' '),
    timing,
  );

  const overCpu = mobile.rows.filter((r) => r.cpuMs >= 1000 / 60);
  check(
    'mobile-4x: cpu work per frame inside 16.7ms at every size',
    overCpu.length === 0,
    mobile.rows.map((r) => `${r.dims}=${r.cpuMs.toFixed(2)}ms`).join(' '),
    timing,
  );
}

if (desktop) {
  const d = biggest(desktop);
  check(
    `desktop: cpu work per frame at ${d.dims} leaves 4x head room`,
    d.cpuMs * 4 < 1000 / 60,
    `${d.cpuMs.toFixed(3)}ms x4 = ${(d.cpuMs * 4).toFixed(2)}ms vs 16.67ms`,
    timing,
  );
}

if (ONLY) console.log(`\n(narrowed to BENCH_PROFILES=${ONLY.join(',')} — not a full gate run)`);

// --- out --------------------------------------------------------------------

await browser.close();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      base: BASE,
      suite: SUITE,
      seconds: Number(SECONDS),
      // The provenance a later reader needs to know what the timing columns are worth.
      // Each run also carries its own `glRenderer` / `software` / `load`.
      gl: GL,
      maxDpr: MAX_DPR ?? null,
      cores: cpus().length,
      quietLoadThreshold: QUIET_LOAD,
      peakLoad,
      timingAdvisory: timing.advisory,
      runs,
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${OUT}`);

const failed = report();
process.exit(failed.length ? 1 : 0);
