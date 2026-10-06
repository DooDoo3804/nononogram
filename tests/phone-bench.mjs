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
//
// The page, the runner and the pass line all live in sibling modules that the static
// deploy route (`tests/phone-verify-build.mjs`) imports too — see tests/phone-verdict.mjs
// for why the rules cannot live in this file any more.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { phonePageHtml } from './phone-page.mjs';
import { buildRecord, reportMarkdown, P95_CEILING_MS } from './phone-verdict.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'verify-out');
const PORT = Number(process.env.PORT ?? 4180);
const SUITE = process.env.BENCH_SUITE ?? '3x3x3,4x4x4,5x5x5,6x6x6';
const SECONDS = Number(process.env.BENCH_SECONDS ?? 4);
const PASSES = Number(process.env.BENCH_PASSES ?? 2);

// Worst size only. The sweep exists to constrain the cap, and fill cost scales with
// buffer area, not cell count — 6³ is where both are largest.
const SWEEP_DIMS = process.env.BENCH_SWEEP_DIMS ?? '6x6x6';
const SWEEP_CAPS = (process.env.BENCH_SWEEP_CAPS ?? '1,1.5,2')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const SWEEP_SECONDS = Number(process.env.BENCH_SWEEP_SECONDS ?? 1);
const SWEEP_SYNC_SAMPLES = Number(process.env.BENCH_SWEEP_SYNC ?? 32);

// Which build the reading belongs to. A perf number with no commit attached cannot be
// re-read later, and this tree has several branches in flight at once.
const COMMIT = (() => {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT }).toString().trim();
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return null;
  }
})();

// Served to the phone out of this directory so the LAN route and the static route run
// byte-identical code. `.mjs` keeps its own MIME entry above.
const RUNNER_FILES = new Set(['/phone-runner.js', '/phone-verdict.mjs']);

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

  if (RUNNER_FILES.has(url.pathname)) {
    const body = await readFile(join(import.meta.dirname, url.pathname.slice(1)));
    res.writeHead(200, {
      'content-type': MIME[extname(url.pathname)],
      'cache-control': 'no-store',
    });
    res.end(body);
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

  const record = buildRecord(payload, {
    receivedAt: new Date().toISOString(),
    measuredAt: new Date().toISOString(),
    remoteAddress: req.socket.remoteAddress,
    commit: COMMIT,
    route: 'lan',
    suite: SUITE,
    seconds: SECONDS,
  });
  const { verdict, fillRate: rate } = record;
  await writeFile(file, JSON.stringify(record, null, 2));
  // The paste-ready block next to the raw JSON: the issue wants a table, and generating
  // it from the same record the gate judged is one less place to mistype a number.
  await writeFile(file.replace(/\.json$/, '.md'), reportMarkdown(record));
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


// The page is identical on both routes; only the config differs. `reportPath` is what
// makes this the LAN route: the phone POSTs its reading back so the laptop keeps a file.
function wrapperHtml() {
  return phonePageHtml({
    config: {
      suite: SUITE,
      seconds: SECONDS,
      passes: PASSES,
      sweepDims: SWEEP_DIMS,
      sweepCaps: SWEEP_CAPS,
      sweepSeconds: SWEEP_SECONDS,
      sweepSync: SWEEP_SYNC_SAMPLES,
      benchPath: './bench/',
      reportPath: './report',
      commit: COMMIT,
    },
    runnerSrc: './phone-runner.js',
  });
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
