// tests/gpu-bench.mjs — QA: on what hardware were the perf numbers actually taken,
// and are they reproducible on this machine at all?
//
//   node tests/gpu-bench.mjs [baseUrl] [outFile]
//   BENCH_SUITE=6x6x6 BENCH_REPS=3 node tests/gpu-bench.mjs
//
// DOO-12 asks for a 60fps reading on a mid-range Android. There is no phone and no
// emulator image in this environment, so a laptop can only produce a *bracket* around
// the phone — and only if its own readings are stable. This script measures both.
//
// Two defects in the existing numbers made it necessary.
//
// 1. The backend label is wrong. `scripts/bench-render.mjs` documents its mobile
//    profile as "the GL backend here is SwiftShader (software rasterization), which is
//    slower than any real phone GPU" and concludes the reading errs pessimistic. Its
//    flags are `--use-gl=angle --enable-unsafe-swiftshader`, which only *permit* a
//    software fallback. Chrome reports what it really used:
//
//      ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)
//
//    An M1 Pro is faster than any mid-range Android GPU, so on the GPU axis those
//    numbers err *optimistic*. Forcing software raster needs `--use-angle=swiftshader`.
//
// 2. Nothing recorded the machine's load. This box runs concurrent agent workloads;
//    readings taken at load 5-10 on 8 cores moved by 10x for the same configuration
//    (first frame 144ms to 3006ms; 6³ software-raster p95 17.6ms to 98.5ms). So every
//    row here carries the 1-minute load average, and `BENCH_REPS` exists to show the
//    spread instead of quoting one sample.
//
// What each profile is worth:
//
//   hw-metal/cpu4     what bench-render.mjs actually measures, labelled correctly.
//   swiftshader/cpu4  真 software raster at a phone's pixel count. No phone GPU is
//                     this bad at fill, but it has a desktop memory subsystem and
//                     never thermally throttles, so it is not a phone either.
//   hw-metal/cpu6     6x CPU slowdown — DevTools' low-end tier rather than mid-tier.
//
// Draw calls, triangles, build and repaint times are hardware-independent and carry
// to a phone as-is. fps/p95/cpu/first-frame do not. Nothing here closes DOO-12.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadavg, cpus } from 'node:os';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'verify-out/bench-gpu.json';
const SUITE = process.env.BENCH_SUITE ?? '3x3x3,4x4x4,5x5x5,6x6x6';
const SECONDS = process.env.BENCH_SECONDS ?? '4';
const REPS = Number(process.env.BENCH_REPS ?? 1);

const P95_CEILING_MS = 20;
const FIRST_FRAME_CEILING_MS = 2000;
const DRAW_CALL_CEILING = 12;
// Above this the machine is too busy for the timing columns to mean anything. 8 cores
// here; the gate should refuse to judge rather than report a contended number.
const QUIET_LOAD = cpus().length * 0.5;

const HW = ['--use-angle=metal', '--ignore-gpu-blocklist'];
const SW = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const PROFILES = [
  { name: 'hw-metal/cpu4', gpuFlags: HW, width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4 },
  { name: 'swiftshader/cpu4', gpuFlags: SW, width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4 },
  { name: 'hw-metal/cpu6', gpuFlags: HW, width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 6 },
];

const { check, report } = checklist();
const records = [];

for (let rep = 0; rep < REPS; rep++) {
  for (const profile of PROFILES) {
    const { gpuFlags, ...emulation } = profile;
    const browser = await launchChrome({ offline: true, gpuFlags });
    const page = await browser.newPage();
    await page.emulate(emulation);

    const loadBefore = loadavg()[0];
    const url = `${BASE}/bench/?suite=${SUITE}&sec=${SECONDS}`;
    console.log(
      `--- rep ${rep + 1}/${REPS}  ${profile.name}  ${profile.width}x${profile.height}@${profile.deviceScaleFactor} ` +
        `(${Math.round(profile.width * profile.deviceScaleFactor)}x${Math.round(profile.height * profile.deviceScaleFactor)}px) ` +
        `cpu/${profile.cpuThrottle}  load ${loadBefore.toFixed(2)}`,
    );
    await page.goto(url);

    // Read the backend off the page rather than trusting the flag: a flag that
    // silently fails to apply is exactly the defect this script was written to catch.
    const renderer = await page.evaluate(`(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })()`);
    if (rep === 0) console.log(`gl: ${renderer}`);

    // Software raster at 2.6Mpx can spend tens of seconds just on warm-up, so the
    // timeout scales with both knobs.
    await page.waitFor('window.__bench?.done === true', {
      timeoutMs: (Number(SECONDS) + 10) * SUITE.split(',').length * 1000 * profile.cpuThrottle,
    });

    const rows = await page.evaluate('window.__bench.results');
    const firstFrameMs = await page.evaluate('window.__bench.perf().firstFrameMs');
    const loadAfter = loadavg()[0];
    records.push({
      rep,
      profile: { ...profile },
      renderer,
      software: /swiftshader/i.test(renderer),
      load: { before: loadBefore, after: loadAfter },
      quiet: Math.max(loadBefore, loadAfter) <= QUIET_LOAD,
      firstFrameMs,
      rows,
    });

    console.log('dims     cells  draw   tri     fps    gap    p95    cpu   dropped  build   repaint  pick');
    for (const r of rows) {
      console.log(
        `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)} ` +
          `${String(r.triangles).padStart(6)} ${r.fps.toFixed(1).padStart(6)} ${r.frameMs.toFixed(2).padStart(6)} ` +
          `${r.p95Ms.toFixed(2).padStart(6)} ${r.cpuMs.toFixed(2).padStart(6)} ${String(r.droppedFrames).padStart(7)} ` +
          `${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
          `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
          (r.p95Ms > P95_CEILING_MS ? '   ⚠ p95' : ''),
      );
    }
    console.log(`first frame: ${firstFrameMs?.toFixed(0) ?? '—'}ms  load after ${loadAfter.toFixed(2)}\n`);
    await browser.close();
  }
}

const byProfile = (name) => records.filter((r) => r.profile.name === name);
const spread = (nums) => {
  const s = nums.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  return s.length ? { min: s[0], median: s[Math.floor(s.length / 2)], max: s[s.length - 1] } : null;
};

// --- what this script can actually settle ------------------------------------

check(
  'bench-render.mjs mobile profile runs on hardware GL, not SwiftShader',
  byProfile('hw-metal/cpu4').every((r) => r.software === false),
  byProfile('hw-metal/cpu4')[0]?.renderer,
);
check(
  'software rasterization is reachable, so the pessimistic side can be measured',
  byProfile('swiftshader/cpu4').every((r) => r.software === true),
  byProfile('swiftshader/cpu4')[0]?.renderer,
);

// Hardware-independent. "Does not grow with cell count" rather than "identical at
// every size": the gizmo's axis label sprites are frustum-culled when the framing puts
// one off screen, so the count legitimately reads 8 instead of 9 at some aspect
// ratios. `scripts/bench-render.mjs` asserts strict equality, which is an
// aspect-ratio dependency in the perf gate — reported separately.
const allRows = records.flatMap((r) => r.rows);
check(
  'draw calls do not grow with cell count on any backend',
  !records.some((r) => r.rows[r.rows.length - 1].drawCalls > r.rows[0].drawCalls) &&
    Math.max(...allRows.map((r) => r.drawCalls)) <= DRAW_CALL_CEILING,
  [...new Set(records.map((r) => `${r.profile.name}:${r.rows.map((x) => x.drawCalls).join('/')}`))].join(' '),
);
check(
  'instance raycast picks a cell at every size on every backend',
  allRows.every((r) => r.picked !== null),
);

// Is this machine even quiet enough for the timing columns to mean anything?
const loads = records.map((r) => Math.max(r.load.before, r.load.after));
check(
  `machine quiet enough to time on (1-min load ≤ ${QUIET_LOAD.toFixed(1)} of ${cpus().length} cores)`,
  records.every((r) => r.quiet),
  `load ${Math.min(...loads).toFixed(2)}–${Math.max(...loads).toFixed(2)}`,
);

// Backend-dependent, reported per profile and never merged into one verdict.
for (const name of PROFILES.map((p) => p.name)) {
  const runs = byProfile(name);
  const rows = runs.flatMap((r) => r.rows);
  const over = rows.filter((r) => r.p95Ms > P95_CEILING_MS);
  const p95 = spread(rows.map((r) => r.p95Ms));
  check(
    `${name}: p95 ≤ ${P95_CEILING_MS}ms at every size, every rep`,
    over.length === 0,
    `p95 ${p95.min.toFixed(1)}–${p95.max.toFixed(1)}ms (median ${p95.median.toFixed(1)})` +
      (over.length ? ` · over: ${over.map((r) => `${r.dims}=${r.p95Ms.toFixed(1)}`).join(' ')}` : ''),
  );
  const ff = spread(runs.map((r) => r.firstFrameMs));
  check(
    `${name}: first frame ≤ ${FIRST_FRAME_CEILING_MS}ms, every rep`,
    ff && ff.max < FIRST_FRAME_CEILING_MS,
    ff ? `${ff.min.toFixed(0)}–${ff.max.toFixed(0)}ms (median ${ff.median.toFixed(0)})` : 'not reported',
  );
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      base: BASE,
      suite: SUITE,
      seconds: Number(SECONDS),
      reps: REPS,
      cores: cpus().length,
      quietLoadThreshold: QUIET_LOAD,
      note: 'laptop bracket for DOO-12. No profile here is a mid-range Android; a physical-device reading is still required.',
      records,
    },
    null,
    2,
  ),
);
console.log(`\nwrote ${OUT}`);

// Exit 0 even on a miss: this is an instrument, not a gate. The gate is
// `scripts/bench-render.mjs`, and a software-raster miss is not a product bug.
report();
