// tests/phone-bench.mjs — get the DOO-12 reading off a real phone with no setup on it.
//
//   npm run build && node tests/phone-bench.mjs
//
// Prints a short LAN URL. Open it on an Android phone on the same Wi-Fi, leave the
// screen on for ~70 seconds, and the numbers land in `verify-out/` on this machine
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

  const verdict = judge(payload);
  const record = {
    issue: 'DOO-12',
    receivedAt: new Date().toISOString(),
    remoteAddress: req.socket.remoteAddress,
    budgets: { p95Ms: P95_CEILING_MS, firstFrameMs: FIRST_FRAME_CEILING_MS, thermalRegression: THERMAL_REGRESSION },
    device,
    passes: payload.passes,
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
    console.log('dims     cells  draw   tri     fps    p95    cpu   dropped  build   repaint  pick');
    for (const r of pass.rows) {
      console.log(
        `${r.dims.padEnd(8)} ${String(r.cells).padStart(4)}  ${String(r.drawCalls).padStart(4)} ` +
          `${String(r.triangles).padStart(6)} ${r.fps.toFixed(1).padStart(6)} ${r.p95Ms.toFixed(2).padStart(6)} ` +
          `${r.cpuMs.toFixed(2).padStart(6)} ${String(r.droppedFrames).padStart(7)} ` +
          `${r.buildMs.toFixed(2).padStart(7)} ${r.repaintMs.toFixed(3).padStart(8)} ` +
          `${r.picked === null ? ' MISS' : String(r.picked).padStart(5)}` +
          (r.p95Ms > P95_CEILING_MS ? '   ⚠ p95' : ''),
      );
    }
  }
  console.log('');
  for (const line of verdict.lines) console.log(`${line.pass ? '  ok  ' : ' FAIL '} ${line.name}  — ${line.detail}`);
  console.log(`\n${verdict.pass ? 'PASS' : 'FAIL'} — wrote ${file}`);
  console.log('paste that file into DOO-12. Ctrl+C when every phone is done.\n');
  return { file, verdict };
}

// One judgement function, run on the server so the saved record and the phone's card
// cannot disagree. The phone gets the result back in the POST response.
function judge(payload) {
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

  return { pass: lines.every((l) => l.pass), lines };
}

function wrapperHtml() {
  const config = JSON.stringify({ suite: SUITE, seconds: SECONDS, passes: PASSES });
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
  <div id="tip">측정하는 동안 <b>화면을 끄지 말고</b> 이 탭을 그대로 두세요. 약 70초 걸립니다.</div>
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

function runPass(index) {
  return new Promise((done, fail) => {
    const url = './bench/?suite=' + encodeURIComponent(CONFIG.suite) + '&sec=' + CONFIG.seconds + '&pass=' + index;
    frame.src = url;
    const started = Date.now();
    const poll = setInterval(() => {
      let bench;
      try { bench = frame.contentWindow.__bench; } catch { return; }
      if (bench) {
        const n = bench.results.length;
        const total = CONFIG.suite.split(',').length;
        progress.textContent = '패스 ' + (index + 1) + '/' + CONFIG.passes + ' — ' + n + '/' + total + ' 크기 완료';
      }
      if (bench?.done) {
        clearInterval(poll);
        done({ index, rows: bench.results, firstFrameMs: bench.perf().firstFrameMs });
      } else if (Date.now() - started > 1000 * 60 * 5) {
        clearInterval(poll);
        fail(new Error('pass ' + index + ' timed out'));
      }
    }, 400);
  });
}

function table(pass) {
  const head = 'dims     cells draw   tri    fps    p95    cpu  drop  build repaint pick\\n';
  return head + pass.rows.map((r) =>
    r.dims.padEnd(8) + String(r.cells).padStart(5) + String(r.drawCalls).padStart(5) +
    String(r.triangles).padStart(7) + r.fps.toFixed(1).padStart(7) + r.p95Ms.toFixed(2).padStart(7) +
    r.cpuMs.toFixed(2).padStart(6) + String(r.droppedFrames).padStart(6) +
    r.buildMs.toFixed(1).padStart(6) + r.repaintMs.toFixed(2).padStart(7) +
    (r.picked === null ? '  MISS' : String(r.picked).padStart(6))
  ).join('\\n');
}

function show(dev, passes, verdict, saveNote) {
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
      '<li><span class="mark ' + (l.pass ? 'pass' : 'fail') + '">' + (l.pass ? 'ok' : 'FAIL') + '</span>' +
      l.name + '<span class="detail">' + l.detail + '</span></li>').join('') + '</ul>' +
    passes.map((p) => '<div class="meta">패스 ' + (p.index + 1) + ' · first frame ' +
      (p.firstFrameMs?.toFixed(0) ?? '—') + 'ms</div><pre>' + table(p) + '</pre>').join('') +
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
  const payload = { device: dev, passes, tainted, config: CONFIG };
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
  show(dev, passes, verdict, note);
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
