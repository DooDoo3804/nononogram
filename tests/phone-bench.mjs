// tests/phone-bench.mjs — get the DOO-12 reading off a real phone with no setup on it.
//
//   npm run build && node tests/phone-bench.mjs
//
// Prints a short LAN URL. Open it on an Android phone on the same Wi-Fi, leave the
// screen on for ~90 seconds, and the numbers land in `verify-out/` on this machine
// and on the phone's screen as a pass/fail card worth screenshotting.
//
// Why a wrapper instead of just telling someone to open `/bench/`:
//
//   * The device has to identify itself. "중간 크기 안드로이드" is a claim about
//     hardware, so the record needs the model, the screen, the DPR, the core count
//     and the GL renderer string next to the numbers, not a human's recollection.
//   * Transcribing a 13-column table off a phone screenshot by hand is how wrong
//     numbers get into an issue. The results POST themselves back.
//   * Thermal throttling is the headline risk a laptop cannot reproduce, and it does
//     not show up in one 4-second window. The suite runs twice back-to-back and the
//     second pass is compared against the first.
//   * rAF stops when the screen sleeps or the tab is backgrounded, which silently
//     turns into "0 dropped frames, 60fps". The run is marked tainted if the page was
//     ever hidden while measuring.
//   * The frame columns are blind to the fill axis. `frameMs`/`p95Ms` are vsync-capped
//     and `cpuMs` brackets only our own code, so the GPU rasterizing into a 2x buffer
//     posts the same flat 60.0fps as a 1x one right up until it misses vsync outright
//     — DOO-19 measured p95 flat at 17.8ms across caps 1 through 2.625. Reporting only
//     those columns off a phone would be a false pass for the `MAX_PIXEL_RATIO` cap
//     that `render/scene.js` now ships. So the sync (readPixels fence) column comes
//     back too, and a third phase sweeps `?maxdpr=` on the worst size to measure this
//     phone's fill rate in ms per megapixel.
//
// The bench page itself is unmodified: it is loaded in a same-origin iframe sized to
// the full viewport, so it renders at the device's real resolution, and the wrapper
// reads the `window.__bench` contract that `scripts/bench-render.mjs` already drives.
//
// Nothing is deployed and nothing leaves the LAN.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'verify-out');
const PORT = Number(process.env.PORT ?? 4180);
const SUITE = process.env.BENCH_SUITE ?? '3x3x3,4x4x4,5x5x5,6x6x6';
const SECONDS = Number(process.env.BENCH_SECONDS ?? 4);
const PASSES = Number(process.env.BENCH_PASSES ?? 2);

// The judgement DOO-7 defined, restated here so the phone can render it without a
// round trip. p95 rather than mean: rAF is vsync-capped, so a 60Hz screen floors the
// mean at 16.7ms no matter how much head room there is.
const P95_CEILING_MS = 20;
const FIRST_FRAME_CEILING_MS = 2000;
const THERMAL_REGRESSION = 1.25; // pass 2 p95 vs pass 1, per size
const DRAW_CALL_CEILING = 12; // 2 instanced meshes + outlines + 3 gizmo lines + 3 labels
const FRAME_BUDGET_MS = 1000 / 60; // the team pass line is "60fps", independent of panel Hz

// The shipped cap in render/scene.js. Hard-coded rather than read off the page for the
// same reason scripts/bench-render.mjs hard-codes it: if `setPixelRatio` goes missing
// or the cap is quietly lowered, a gate that asks the page what it did cannot notice.
const SHIPPED_DPR_CAP = 2;
// Worst size only. The sweep exists to constrain the cap, and fill cost scales with
// buffer area, not cell count — 6³ is where both are largest.
const SWEEP_DIMS = process.env.BENCH_SWEEP_DIMS ?? '6x6x6';
const SWEEP_CAPS = (process.env.BENCH_SWEEP_CAPS ?? '1,1.5,2')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const SWEEP_SECONDS = Number(process.env.BENCH_SWEEP_SECONDS ?? 1);
const SWEEP_SYNC_SAMPLES = Number(process.env.BENCH_SWEEP_SYNC ?? 32);

if (!existsSync(join(DIST, 'bench', 'index.html'))) {
  console.error('dist/bench/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const slug = (text) =>
  (text || 'device')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase() || 'device';

const received = [];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'POST' && url.pathname === '/report') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end(`bad json: ${err.message}`);
      return;
    }
    const { file, verdict } = await save(payload, req);
    // The verdict goes back in the response so the phone renders the same judgement
    // that got written to disk, instead of a second copy of the rules in the page.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, saved: file, verdict }));
    return;
  }

  // dist/ has no favicon, and the resulting 404 lands in the phone's console as an
  // error — noise in the one place a tester is told to look for real failures.
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.htm') {
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    res.end(wrapperHtml());
    return;
  }

  // Everything else is the built artifact, served straight out of dist/.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('no');
    return;
  }
  if (file.endsWith('/') || (existsSync(file) && !extname(file))) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
});

async function save(payload, req) {
  const device = payload.device ?? {};
  const name = device.model || device.platform || 'device';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(OUT_DIR, `phone-bench-${slug(name)}-${stamp}.json`);
  await mkdir(OUT_DIR, { recursive: true });

  const rate = fillRate(payload.capSweep);
  const verdict = judge(payload, rate);
  const record = {
    issue: 'DOO-12',
    receivedAt: new Date().toISOString(),
    remoteAddress: req.socket.remoteAddress,
    budgets: {
      p95Ms: P95_CEILING_MS,
      firstFrameMs: FIRST_FRAME_CEILING_MS,
      thermalRegression: THERMAL_REGRESSION,
      frameBudgetMs: FRAME_BUDGET_MS,
      shippedDprCap: SHIPPED_DPR_CAP,
    },
    device,
    passes: payload.passes,
    capSweep: payload.capSweep ?? null,
    fillRate: rate,
    tainted: payload.tainted,
    verdict,
    suite: SUITE,
    seconds: SECONDS,
  };
  await writeFile(file, JSON.stringify(record, null, 2));
  received.push(record);

  console.log(`\n=== reading from ${device.model || 'unknown device'} (${req.socket.remoteAddress})`);
  console.log(`ua: ${device.ua ?? '—'}`);
  console.log(
    `screen ${device.screen ?? '?'} @ dpr ${device.dpr ?? '?'}  cores ${device.cores ?? '?'}  ` +
      `mem ${device.memoryGb ?? '?'}GB  net ${device.network ?? '?'}`,
  );
  console.log(`gl: ${device.renderer ?? '—'}`);
  if (payload.tainted) console.log('⚠ TAINTED — the page was hidden during measurement; rerun with the screen awake.');
  for (const pass of payload.passes ?? []) {
    console.log(`\npass ${pass.index + 1}  first frame ${pass.firstFrameMs?.toFixed(0) ?? '—'}ms`);
    console.log('dims     cells  draw   tri     fps    p95    cpu    sync  dropped  build   repaint  pick');
    for (const r of pass.rows) {
      console.log(
        `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)} ` +
          `${String(r.triangles).padStart(6)} ${r.fps.toFixed(1).padStart(6)} ${r.p95Ms.toFixed(2).padStart(6)} ` +
          `${r.cpuMs.toFixed(2).padStart(6)} ${num(r.syncMs, 2, 7)} ${String(r.droppedFrames).padStart(7)} ` +
          `${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
          `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
          (r.p95Ms > P95_CEILING_MS ? '   ⚠ p95' : ''),
      );
    }
  }

  if (payload.capSweep?.length) {
    console.log(`\ncap sweep — ${SWEEP_DIMS}, the only columns that see the fill axis`);
    console.log('cap    buffer     bufferPx      p95   sync  syncP95  dropped');
    for (const r of payload.capSweep) {
      console.log(
        `${String(r.cap).padEnd(5)} ${(r.pixelRatio?.toFixed(3) ?? '?').padStart(6)}x ${String(r.bufferPx ?? '?').padStart(12)} ` +
          `${num(r.p95Ms, 2, 8)} ${num(r.syncMs, 2, 6)} ${num(r.syncP95Ms, 2, 8)} ${String(r.droppedFrames ?? '?').padStart(8)}`,
      );
    }
    if (rate) {
      console.log(
        `\nfill rate: ${rate.msPerMegapixel.toFixed(3)} ms per megapixel ` +
          `(r² ${rate.r2.toFixed(4)}, ${rate.points} points, intercept ${rate.interceptMs.toFixed(2)}ms)`,
      );
      console.log(
        '  this is the number render/scene.js projected from an M1 Pro at a 5-10x divisor.',
      );
    }
  }
  console.log('');
  for (const line of verdict.lines) {
    const mark = line.advisory ? ' note ' : line.pass ? '  ok  ' : ' FAIL ';
    console.log(`${mark} ${line.name}  — ${line.detail}`);
  }
  console.log(`\n${verdict.pass ? 'PASS' : 'FAIL'} — wrote ${file}`);
  console.log('paste that file into DOO-12. Ctrl+C when every phone is done.\n');
  return { file, verdict };
}

const num = (v, places, width) => (typeof v === 'number' ? v.toFixed(places) : '—').padStart(width);

// Least squares of sync time against buffer area over the cap sweep. The slope is this
// phone's fill rate; the intercept absorbs the per-frame cost that does not scale with
// area (draw-call submission, the readPixels round trip itself), which is exactly why
// the cap decision needs a regression and not a single absolute reading.
//
// render/scene.js picked the shipped cap by taking an M1 Pro's 0.95 ms/Mpx and dividing
// by a literature 5-10x. This replaces that divisor with a measurement.
function fillRate(sweep) {
  const pts = (sweep ?? [])
    .filter((r) => typeof r.syncMs === 'number' && typeof r.bufferPx === 'number' && r.bufferPx > 0)
    .map((r) => ({ x: r.bufferPx / 1e6, y: r.syncMs }));
  // Distinct buffer sizes, not distinct caps: a DPR-1.5 phone clamps caps 1.5 and 2 to
  // the same buffer, and fitting a line through a repeated x is how a made-up slope
  // gets into the record.
  if (new Set(pts.map((p) => p.x.toFixed(4))).size < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const ssTot = pts.reduce((a, p) => a + (p.y - my) ** 2, 0);
  const ssRes = pts.reduce((a, p) => a + (p.y - (slope * p.x + intercept)) ** 2, 0);
  return {
    msPerMegapixel: slope,
    interceptMs: intercept,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    points: n,
  };
}

// One judgement function, run on the server so the saved record and the phone's card
// cannot disagree. The phone gets the result back in the POST response.
function judge(payload, rate) {
  const passes = payload.passes ?? [];
  const rows = passes.flatMap((p) => p.rows ?? []);
  const lines = [];
  if (!rows.length) return { pass: false, lines: [{ name: 'any results at all', pass: false, detail: 'none' }] };

  const worst = rows.reduce((a, r) => (r.p95Ms > a.p95Ms ? r : a));
  lines.push({
    name: `p95 ≤ ${P95_CEILING_MS}ms at every size`,
    pass: rows.every((r) => r.p95Ms <= P95_CEILING_MS),
    detail: rows.map((r) => `${r.dims}=${r.p95Ms.toFixed(1)}`).join(' ') + `  worst ${worst.dims}`,
  });

  // "Does not grow with cell count", not "identical at every size". The gizmo's three
  // axis label sprites are frustum-culled when the camera framing puts one off screen,
  // so the count legitimately reads 8 instead of 9 at some aspect ratios — measured on
  // this harness: 9 at 3³/4³ and 8 at 5³/6³ in a 412x915 iframe. A phone with any
  // other aspect ratio would fail a strict-equality check for a reason that has
  // nothing to do with the cell count, which is what the budget is about.
  const callsBySize = rows.map((r) => r.drawCalls);
  const maxCalls = Math.max(...callsBySize);
  const grows = rows[rows.length - 1].drawCalls > rows[0].drawCalls;
  lines.push({
    name: `draw calls do not grow with cell count (≤ ${DRAW_CALL_CEILING})`,
    pass: !grows && maxCalls <= DRAW_CALL_CEILING,
    detail: rows.map((r) => `${r.dims}=${r.drawCalls}`).join(' '),
  });

  const firsts = passes.map((p) => p.firstFrameMs).filter((n) => typeof n === 'number');
  lines.push({
    name: `first frame ≤ ${FIRST_FRAME_CEILING_MS}ms`,
    pass: firsts.length > 0 && firsts.every((n) => n < FIRST_FRAME_CEILING_MS),
    detail: firsts.map((n) => `${n.toFixed(0)}ms`).join(', ') || 'not reported',
  });

  lines.push({
    name: 'cpu per frame inside 16.7ms',
    pass: rows.every((r) => r.cpuMs < 1000 / 60),
    detail: rows.map((r) => `${r.dims}=${r.cpuMs.toFixed(2)}`).join(' '),
  });

  lines.push({
    name: 'instance raycast picks a cell at every size',
    pass: rows.every((r) => r.picked !== null),
    detail: rows.every((r) => r.picked !== null) ? 'all sizes' : 'MISS',
  });

  // The fill axis. Everything above is vsync-capped or CPU-only and would pass a phone
  // that is one buffer-doubling away from missing frames; this is the only gate that
  // notices. The suite rows run at the shipped cap, so their sync is the shipped cost.
  const synced = rows.filter((r) => typeof r.syncP95Ms === 'number' && r.syncP95Ms > 0);
  if (synced.length) {
    const worstSync = synced.reduce((a, r) => (r.syncP95Ms > a.syncP95Ms ? r : a));
    lines.push({
      name: `GPU raster inside the 60fps budget at the shipped cap (sync p95 ≤ ${FRAME_BUDGET_MS.toFixed(1)}ms)`,
      pass: synced.every((r) => r.syncP95Ms <= FRAME_BUDGET_MS),
      detail:
        synced.map((r) => `${r.dims}=${r.syncP95Ms.toFixed(1)}`).join(' ') +
        `  worst ${worstSync.dims} @ ${worstSync.pixelRatio ?? '?'}x (${worstSync.bufferPx ?? '?'}px)`,
    });
  }

  // Did the phone actually render at the cap we are judging? A DPR-1.75 phone never
  // reaches cap 2, so its pass says nothing about the cap — the record has to say so
  // out loud rather than letting a weaker test masquerade as the stronger one.
  const ratios = rows.map((r) => r.pixelRatio).filter((n) => typeof n === 'number');
  const dpr = payload.device?.dpr;
  if (ratios.length) {
    const atCap = Math.max(...ratios) >= SHIPPED_DPR_CAP - 0.05;
    lines.push({
      name: `drawing buffer sits at min(DPR, ${SHIPPED_DPR_CAP}) — setPixelRatio is live`,
      pass: ratios.every((r) => Math.abs(r - Math.min(dpr ?? r, SHIPPED_DPR_CAP)) < 0.05),
      detail:
        `device dpr ${dpr ?? '?'} → buffer ${[...new Set(ratios.map((r) => r.toFixed(3)))].join('/')}x` +
        (atCap ? '  (exercises the cap)' : `  ⚠ dpr < ${SHIPPED_DPR_CAP}: this phone cannot test the cap`),
    });
  }

  if (rate) {
    // The projection in render/scene.js that this measurement is here to replace:
    // 1.41M buffer pixels at cap 2 on a 412x915 phone, which has to fit the budget
    // alongside the CPU frame cost.
    const atCap2 = rate.msPerMegapixel * 1.41 + rate.interceptMs;
    lines.push({
      name: `measured fill rate leaves head room at cap ${SHIPPED_DPR_CAP}`,
      pass: atCap2 <= FRAME_BUDGET_MS,
      detail:
        `${rate.msPerMegapixel.toFixed(2)}ms/Mpx (r² ${rate.r2.toFixed(3)}) → ` +
        `${atCap2.toFixed(1)}ms for 1.41Mpx vs ${FRAME_BUDGET_MS.toFixed(1)}ms budget`,
    });
  }

  // Thermal: same size, pass 2 against pass 1. A phone that holds 60fps cold and
  // drops when warm fails the budget in the way a player actually meets it.
  if (passes.length > 1) {
    const first = new Map((passes[0].rows ?? []).map((r) => [r.dims, r.p95Ms]));
    const drift = (passes[passes.length - 1].rows ?? [])
      .filter((r) => first.has(r.dims))
      .map((r) => ({ dims: r.dims, ratio: r.p95Ms / first.get(r.dims), p95: r.p95Ms }));
    lines.push({
      name: `no thermal regression (pass ${passes.length} vs pass 1 < ${THERMAL_REGRESSION}x)`,
      pass: drift.every((d) => d.ratio < THERMAL_REGRESSION),
      detail: drift.map((d) => `${d.dims}=${d.ratio.toFixed(2)}x`).join(' '),
    });
  }

  if (payload.tainted) {
    lines.push({
      name: 'screen stayed awake for the whole run',
      pass: false,
      detail: 'page was hidden while measuring — numbers not trustworthy, rerun',
    });
  }

  // Advisory, not a gate. The team pass line is "60fps", and render/perf.js counts a
  // drop against 16.7ms, so a 120Hz phone holding 16.7ms satisfies the line as written
  // even though it is missing every other native vsync. Reported because "60fps on a
  // 120Hz panel" is a visibly worse experience than the number suggests, and whether
  // to tighten the line is Angerl's call, not QA's.
  const hz = payload.device?.refreshHz;
  if (typeof hz === 'number' && hz > 65) {
    const nativeCeiling = (1000 / hz) * (P95_CEILING_MS / FRAME_BUDGET_MS);
    lines.push({
      advisory: true,
      name: `[참고] ${hz}Hz 네이티브 주사율 기준 p95 ≤ ${nativeCeiling.toFixed(1)}ms`,
      pass: rows.every((r) => r.p95Ms <= nativeCeiling),
      detail:
        rows.map((r) => `${r.dims}=${r.p95Ms.toFixed(1)}`).join(' ') +
        '  — 합격선은 60fps이므로 판정에는 반영하지 않음',
    });
  }

  return { pass: lines.every((l) => l.advisory || l.pass), lines };
}

function wrapperHtml() {
  const config = JSON.stringify({
    suite: SUITE,
    seconds: SECONDS,
    passes: PASSES,
    sweepDims: SWEEP_DIMS,
    sweepCaps: SWEEP_CAPS,
    sweepSeconds: SWEEP_SECONDS,
    sweepSync: SWEEP_SYNC_SAMPLES,
  });
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>no-nonogram — 폰 성능 측정 (DOO-12)</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #16130d; color: #ecdfc0;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  #frame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
  #veil { position: fixed; inset: 0; display: grid; place-content: center; gap: 14px;
    padding: 24px; background: #16130db8; backdrop-filter: blur(2px); text-align: center; }
  #veil.hidden { display: none; }
  h1 { font-size: 17px; margin: 0; }
  #tip { color: #e8c37a; font-size: 13px; max-width: 30em; }
  #progress { font-size: 13px; color: #c9bb98; }
  #card { position: fixed; inset: 0; overflow: auto; padding: 18px 14px 40px;
    background: #16130d; display: none; }
  #card.shown { display: block; }
  .big { font-size: 26px; font-weight: 700; letter-spacing: .04em; padding: 10px 0; }
  .pass { color: #7fd48a; }
  .fail { color: #ff8d7a; }
  .note { color: #8ec3e8; }
  ul { list-style: none; padding: 0; margin: 10px 0 18px; }
  li { padding: 5px 0; border-bottom: 1px solid #ffffff14; font-size: 13px; }
  li .mark { font-weight: 700; margin-right: 6px; }
  .detail { color: #bdb094; font-size: 12px; display: block; word-break: break-all; }
  pre { overflow-x: auto; font-size: 11px; line-height: 1.45; background: #0f0d08;
    padding: 10px; border-radius: 6px; }
  .meta { color: #bdb094; font-size: 12px; word-break: break-all; }
  .warn { color: #ffcf6b; }
</style>
</head>
<body>
<iframe id="frame" title="bench"></iframe>
<div id="veil">
  <h1>no-nonogram 성능 측정</h1>
  <div id="tip">측정하는 동안 <b>화면을 끄지 말고</b> 이 탭을 그대로 두세요. 약 90초 걸립니다.</div>
  <div id="progress">기기 정보 확인 중…</div>
</div>
<div id="card"></div>
<script>
const CONFIG = ${config};
const veil = document.getElementById('veil');
const progress = document.getElementById('progress');
const card = document.getElementById('card');
const frame = document.getElementById('frame');

let tainted = false;
document.addEventListener('visibilitychange', () => { if (document.hidden) tainted = true; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function device() {
  const d = {
    ua: navigator.userAgent,
    platform: navigator.platform,
    screen: screen.width + 'x' + screen.height,
    viewport: innerWidth + 'x' + innerHeight,
    dpr: devicePixelRatio,
    pixels: Math.round(innerWidth * devicePixelRatio) + 'x' + Math.round(innerHeight * devicePixelRatio),
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: navigator.deviceMemory ?? null,
    network: navigator.connection?.effectiveType ?? null,
    refreshHz: null,
    model: null,
  };
  // User-Agent Client Hints is the only way to get the model off modern Chrome;
  // the UA string itself has been frozen for years.
  try {
    const hints = await navigator.userAgentData?.getHighEntropyValues([
      'model', 'platform', 'platformVersion', 'architecture', 'bitness', 'fullVersionList',
    ]);
    if (hints) {
      d.model = hints.model || null;
      d.platform = (hints.platform ?? d.platform) + ' ' + (hints.platformVersion ?? '');
      d.browser = (hints.fullVersionList ?? []).map((v) => v.brand + '/' + v.version).join(' ');
      d.architecture = hints.architecture;
    }
  } catch {}
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    d.renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  } catch {}
  // Screen refresh rate, measured: a 90/120Hz phone has a 11.1/8.3ms budget, not
  // 16.7ms, and p95 has to be read against the right one.
  d.refreshHz = await refreshRate();
  // UA-string fallback only on Android: on a desktop the same regex happily returns
  // "Intel Mac OS X 10_15_7" and puts it in the record as a phone model.
  if (!d.model && /Android/.test(navigator.userAgent)) {
    d.model = (navigator.userAgent.match(/;\\s?([^;)]+)\\s?(?:Build|\\))/) ?? [])[1]?.trim() ?? null;
  }
  return d;
}

function refreshRate() {
  return new Promise((done) => {
    const stamps = [];
    const tick = (t) => {
      stamps.push(t);
      if (stamps.length < 61) requestAnimationFrame(tick);
      else {
        const gaps = stamps.slice(1).map((s, i) => s - stamps[i]).sort((a, b) => a - b);
        done(Math.round(1000 / gaps[Math.floor(gaps.length / 2)]));
      }
    };
    requestAnimationFrame(tick);
  });
}

// One iframe driver for both phases. The bench page is never modified; everything is
// expressed as query params on it and read back off the window.__bench contract.
function runBench(query, label, total) {
  return new Promise((done, fail) => {
    frame.src = './bench/?' + query;
    const started = Date.now();
    const poll = setInterval(() => {
      let bench;
      try { bench = frame.contentWindow.__bench; } catch { return; }
      if (bench) progress.textContent = label + ' — ' + bench.results.length + '/' + total + ' 완료';
      if (bench?.done) {
        clearInterval(poll);
        done({ rows: bench.results, firstFrameMs: bench.perf().firstFrameMs });
      } else if (Date.now() - started > 1000 * 60 * 5) {
        clearInterval(poll);
        fail(new Error(label + ' timed out'));
      }
    }, 400);
  });
}

function runPass(index) {
  const query = 'suite=' + encodeURIComponent(CONFIG.suite) + '&sec=' + CONFIG.seconds + '&pass=' + index;
  const total = CONFIG.suite.split(',').length;
  return runBench(query, '패스 ' + (index + 1) + '/' + CONFIG.passes, total)
    .then((r) => ({ index, ...r }));
}

// Phase 3 — sweep the retina cap on the worst size. The frame columns cannot see this
// axis (DOO-19 measured p95 flat across caps 1 to 2.625), so without this the phone
// reading cannot tell a cap that fits from one that is about to stop fitting.
async function runCapSweep() {
  const rows = [];
  // The device's own DPR goes in above the shipped cap so the record also shows what
  // capping cost in sharpness terms: if uncapped fits the budget too, cap 2 is leaving
  // resolution on the table, and that is Vitra's call to make with a number in hand.
  const caps = CONFIG.sweepCaps.slice();
  if (devicePixelRatio > Math.max.apply(null, caps) + 0.05) caps.push(Number(devicePixelRatio.toFixed(3)));
  for (const cap of caps) {
    const query = 'suite=' + encodeURIComponent(CONFIG.sweepDims) + '&sec=' + CONFIG.sweepSeconds +
      '&maxdpr=' + cap + '&sync=' + CONFIG.sweepSync;
    const label = 'DPR 상한 ' + cap + '배 측정';
    const out = await runBench(query, label, 1);
    const r = out.rows[0];
    if (r) rows.push({ cap, ...r });
    await sleep(200);
  }
  return rows;
}

const cell = (v, places, width) => (typeof v === 'number' ? v.toFixed(places) : '—').padStart(width);

function table(pass) {
  const head = 'dims     cells draw   tri    fps    p95    cpu   sync drop  build repaint pick\\n';
  return head + pass.rows.map((r) =>
    r.dims.padEnd(8) + String(r.cells).padStart(5) + String(r.drawCalls).padStart(5) +
    String(r.triangles).padStart(7) + r.fps.toFixed(1).padStart(7) + r.p95Ms.toFixed(2).padStart(7) +
    r.cpuMs.toFixed(2).padStart(6) + cell(r.syncMs, 2, 7) + String(r.droppedFrames).padStart(5) +
    r.buildMs.toFixed(1).padStart(6) + r.repaintMs.toFixed(2).padStart(7) +
    (r.picked === null ? '  MISS' : String(r.picked).padStart(6))
  ).join('\\n');
}

function sweepTable(rows) {
  const head = 'cap   buffer      bufferPx    p95   sync syncP95 drop\\n';
  return head + rows.map((r) =>
    String(r.cap).padEnd(5) + cell(r.pixelRatio, 3, 7) + 'x' +
    String(r.bufferPx ?? '?').padStart(12) + cell(r.p95Ms, 1, 7) +
    cell(r.syncMs, 2, 7) + cell(r.syncP95Ms, 2, 7) + String(r.droppedFrames ?? '?').padStart(5)
  ).join('\\n');
}

function show(dev, passes, sweep, verdict, saveNote) {
  frame.remove();
  veil.classList.add('hidden');
  card.classList.add('shown');
  card.innerHTML =
    '<div class="big ' + (verdict.pass ? 'pass' : 'fail') + '">' +
      (verdict.pass ? '✅ 통과' : '❌ 예산 초과') + '</div>' +
    '<div class="meta">DOO-12 · ' + (dev.model ?? '기종 미확인') + ' · ' + dev.platform +
      '<br>' + dev.screen + ' @ dpr ' + dev.dpr + ' → ' + dev.pixels + 'px · ' + dev.refreshHz + 'Hz 화면' +
      '<br>코어 ' + (dev.cores ?? '?') + ' · 메모리 ' + (dev.memoryGb ?? '?') + 'GB · ' + (dev.network ?? '?') +
      '<br>' + (dev.renderer ?? 'GL 미확인') + '</div>' +
    (tainted ? '<div class="warn">⚠ 측정 중 화면이 꺼지거나 탭이 가려졌습니다 — 다시 측정하세요.</div>' : '') +
    '<ul>' + verdict.lines.map((l) =>
      '<li><span class="mark ' + (l.advisory ? 'note' : l.pass ? 'pass' : 'fail') + '">' +
      (l.advisory ? '참고' : l.pass ? 'ok' : 'FAIL') + '</span>' +
      l.name + '<span class="detail">' + l.detail + '</span></li>').join('') + '</ul>' +
    passes.map((p) => '<div class="meta">패스 ' + (p.index + 1) + ' · first frame ' +
      (p.firstFrameMs?.toFixed(0) ?? '—') + 'ms</div><pre>' + table(p) + '</pre>').join('') +
    (sweep?.length ? '<div class="meta">DPR 상한 스윕 · ' + CONFIG.sweepDims +
      ' · 채움 축을 보는 유일한 열(sync)</div><pre>' + sweepTable(sweep) + '</pre>' : '') +
    '<div class="meta">' + saveNote + '</div>';
}

(async () => {
  const dev = await device();
  progress.textContent = (dev.model ?? '기기') + ' · ' + dev.refreshHz + 'Hz · 측정 시작…';
  const passes = [];
  for (let i = 0; i < CONFIG.passes; i++) {
    passes.push(await runPass(i));
    // Back-to-back on purpose: pass 2 reads the phone after it has warmed up.
    await sleep(300);
  }
  // Last, so a sweep failure still leaves the suite numbers intact to report.
  let sweep = [];
  try { sweep = await runCapSweep(); } catch (err) { sweep = []; }
  const payload = { device: dev, passes, capSweep: sweep, tainted, config: CONFIG };
  let verdict, note;
  try {
    const res = await fetch('./report', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json();
    note = '노트북에 기록됨: ' + body.saved;
    verdict = body.verdict ?? null;
  } catch (err) {
    note = '⚠ 노트북으로 전송 실패 (' + err.message + ') — 이 화면을 캡처해서 붙여 주세요.';
  }
  if (!verdict) {
    // The server owns the judgement; if the POST failed, fall back to showing the
    // raw numbers with no verdict rather than inventing a second rule set here.
    verdict = { pass: false, lines: [{ name: '판정 불가 — 전송 실패', pass: false, detail: '아래 표를 캡처' }] };
  }
  show(dev, passes, sweep, verdict, note);
})().catch((err) => {
  progress.textContent = '에러: ' + err.message;
});
</script>
</body>
</html>`;
}

server.on('listening', () => {
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log('\n  no-nonogram — 폰 성능 측정 (DOO-12)\n');
  console.log(`  suite ${SUITE}   window ${SECONDS}s   passes ${PASSES}`);
  console.log(`  dpr cap sweep ${SWEEP_DIMS} @ ${SWEEP_CAPS.join('/')}x (+ the device's own dpr)`);
  console.log('\n  같은 Wi-Fi에 연결된 안드로이드 폰 브라우저에서 아래 주소를 여세요:\n');
  for (const a of addrs) console.log(`      http://${a}:${PORT}`);
  if (!addrs.length) console.log('      (LAN 주소를 찾지 못했습니다 — Wi-Fi 연결을 확인하세요)');
  console.log(`\n  게임 화면 오버레이:  http://${addrs[0] ?? '127.0.0.1'}:${PORT}/index.html?perf=1`);
  console.log('  측정 중 화면이 꺼지지 않게 두세요. 결과는 verify-out/ 에 저장됩니다.');
  console.log('  Ctrl+C 로 종료.\n');
});

server.listen(PORT, '0.0.0.0');

process.on('SIGINT', () => {
  console.log(`\n${received.length} reading(s) recorded.`);
  for (const r of received) {
    console.log(`  ${r.verdict.pass ? 'PASS' : 'FAIL'}  ${r.device.model ?? 'unknown'}  ${r.device.screen}@${r.device.dpr}`);
  }
  server.close(() => process.exit(0));
});
