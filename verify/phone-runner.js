// tests/phone-runner.js — the page the phone actually runs, on either route.
//
// Routes that share this file:
//   * LAN      — `node tests/phone-bench.mjs` serves it and also takes a POST, so the
//                record lands in `verify-out/` on the laptop.
//   * 정적 배포 — `node tests/phone-verify-build.mjs` drops it into `dist/verify/`, where
//                there is no server. The verdict is computed on the phone and the whole
//                record comes out as a paste-ready markdown block.
//
// The difference between the two is one config field (`reportPath`). Everything that
// decides pass or fail lives in ./phone-verdict.mjs, imported by both, because the
// failure mode worth designing against is a phone screen and an issue comment that
// disagree about whether the phone passed.
//
// The bench page itself is never modified: it is driven in a same-origin iframe sized to
// the full viewport, so it renders at the device's real resolution, through query params
// and the `window.__bench` contract that `scripts/bench-render.mjs` already uses.

import { buildRecord, reportMarkdown, verdictHeadline } from './phone-verdict.js';

// Query-param overrides, so the shipped artifact can be smoke-tested in seconds instead
// of 90 — `tests/phone-verify-selfcheck.mjs` drives the deployed bytes rather than a
// special fast build, which is the only way the self-check covers what a tester opens.
//
// Every override that fires is recorded and raises an advisory line on the card: a
// 1-second window is a fine smoke test and a worthless measurement, and the way that
// goes wrong is someone pasting one into the issue as the real reading.
const OVERRIDABLE = {
  suite: ['suite', String],
  seconds: ['sec', Number],
  passes: ['passes', Number],
  sweepDims: ['sweepdims', String],
  sweepSeconds: ['sweepsec', Number],
  sweepSync: ['sweepsync', Number],
};

const CONFIG = { ...window.__PHONE_BENCH__ };
const overrides = [];
{
  const params = new URLSearchParams(location.search);
  for (const [key, [param, cast]] of Object.entries(OVERRIDABLE)) {
    if (!params.has(param)) continue;
    const value = cast(params.get(param));
    if (typeof value === 'number' && !(value > 0)) continue;
    overrides.push(`${param}=${value} (기본 ${CONFIG[key]})`);
    CONFIG[key] = value;
  }
}

const veil = document.getElementById('veil');
const progress = document.getElementById('progress');
const card = document.getElementById('card');
const frame = document.getElementById('frame');

// rAF stops when the screen sleeps or the tab is backgrounded, which silently turns
// into "0 dropped frames, 60fps" — the most convincing false pass available.
let tainted = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) tainted = true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function device() {
  const d = {
    ua: navigator.userAgent,
    platform: navigator.platform,
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: devicePixelRatio,
    pixels: `${Math.round(innerWidth * devicePixelRatio)}x${Math.round(innerHeight * devicePixelRatio)}`,
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
      'model',
      'platform',
      'platformVersion',
      'architecture',
      'bitness',
      'fullVersionList',
    ]);
    if (hints) {
      d.model = hints.model || null;
      d.platform = `${hints.platform ?? d.platform} ${hints.platformVersion ?? ''}`.trim();
      d.browser = (hints.fullVersionList ?? []).map((v) => `${v.brand}/${v.version}`).join(' ');
      d.architecture = hints.architecture;
    }
  } catch {
    /* UA-CH is Chromium-only; the UA-string fallback below covers the rest */
  }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    d.renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  } catch {
    /* renderer string is a nice-to-have, not a gate */
  }
  // Screen refresh rate, measured: a 90/120Hz phone has a 11.1/8.3ms budget, not
  // 16.7ms, and p95 has to be read against the right one.
  d.refreshHz = await refreshRate();
  // UA-string fallback only on Android: on a desktop the same regex happily returns
  // "Intel Mac OS X 10_15_7" and puts it in the record as a phone model.
  if (!d.model && /Android/.test(navigator.userAgent)) {
    d.model = (navigator.userAgent.match(/;\s?([^;)]+)\s?(?:Build|\))/) ?? [])[1]?.trim() ?? null;
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

// One iframe driver for both phases.
function runBench(query, label, total) {
  return new Promise((done, fail) => {
    frame.src = `${CONFIG.benchPath}?${query}`;
    const started = Date.now();
    const poll = setInterval(() => {
      let bench;
      try {
        bench = frame.contentWindow.__bench;
      } catch {
        return; // same-origin, but the document may not be swapped in yet
      }
      if (bench) progress.textContent = `${label} — ${bench.results.length}/${total} 완료`;
      if (bench?.done) {
        clearInterval(poll);
        done({ rows: bench.results, firstFrameMs: bench.perf().firstFrameMs });
      } else if (Date.now() - started > 1000 * 60 * 5) {
        clearInterval(poll);
        fail(new Error(`${label} timed out`));
      }
    }, 400);
  });
}

function runPass(index) {
  const query = `suite=${encodeURIComponent(CONFIG.suite)}&sec=${CONFIG.seconds}&pass=${index}`;
  const total = CONFIG.suite.split(',').length;
  return runBench(query, `패스 ${index + 1}/${CONFIG.passes}`, total).then((r) => ({ index, ...r }));
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
    const query =
      `suite=${encodeURIComponent(CONFIG.sweepDims)}&sec=${CONFIG.sweepSeconds}` +
      `&maxdpr=${cap}&sync=${CONFIG.sweepSync}`;
    const out = await runBench(query, `DPR 상한 ${cap}배 측정`, 1);
    const r = out.rows[0];
    if (r) rows.push({ cap, ...r });
    await sleep(200);
  }
  return rows;
}

const cell = (v, places, width) => (typeof v === 'number' ? v.toFixed(places) : '—').padStart(width);

function table(pass) {
  const head = 'dims     cells draw   tri    fps    p95    cpu   sync drop  build repaint pick\n';
  return (
    head +
    pass.rows
      .map(
        (r) =>
          r.dims.padEnd(8) +
          String(r.cells).padStart(5) +
          String(r.drawCalls).padStart(5) +
          String(r.triangles).padStart(7) +
          r.fps.toFixed(1).padStart(7) +
          r.p95Ms.toFixed(2).padStart(7) +
          r.cpuMs.toFixed(2).padStart(6) +
          cell(r.syncMs, 2, 7) +
          String(r.droppedFrames).padStart(5) +
          r.buildMs.toFixed(1).padStart(6) +
          r.repaintMs.toFixed(2).padStart(7) +
          (r.picked === null ? '  MISS' : String(r.picked).padStart(6)),
      )
      .join('\n')
  );
}

function sweepTable(rows) {
  const head = 'cap   buffer      bufferPx    p95   sync syncP95 drop\n';
  return (
    head +
    rows
      .map(
        (r) =>
          String(r.cap).padEnd(5) +
          cell(r.pixelRatio, 3, 7) +
          'x' +
          String(r.bufferPx ?? '?').padStart(12) +
          cell(r.p95Ms, 1, 7) +
          cell(r.syncMs, 2, 7) +
          cell(r.syncP95Ms, 2, 7) +
          String(r.droppedFrames ?? '?').padStart(5),
      )
      .join('\n')
  );
}

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function show(record, markdown, saveNote) {
  const dev = record.device;
  const verdict = record.verdict;
  frame.remove();
  veil.classList.add('hidden');
  card.classList.add('shown');
  card.innerHTML =
    `<div class="big ${verdict.pass ? (verdict.official ? 'pass' : 'warn') : 'fail'}">` +
    `${verdictHeadline(verdict)}</div>` +
    (verdict.disqualifiers?.length
      ? `<div class="warn">이 측정은 합격선 판정으로 쓸 수 없습니다 — ${esc(verdict.disqualifiers.join(', '))}.</div>`
      : '') +
    `<div class="meta">DOO-12 · ${esc(dev.model ?? '기종 미확인')} · ${esc(dev.platform)}` +
    `<br>${esc(dev.screen)} @ dpr ${dev.dpr} → ${esc(dev.pixels)}px · ${dev.refreshHz}Hz 화면` +
    `<br>코어 ${dev.cores ?? '?'} · 메모리 ${dev.memoryGb ?? '?'}GB · ${esc(dev.network ?? '?')}` +
    `<br>${esc(dev.renderer ?? 'GL 미확인')}` +
    (record.commit ? `<br>빌드 ${esc(record.commit)}` : '') +
    '</div>' +
    (record.tainted
      ? '<div class="warn">⚠ 측정 중 화면이 꺼지거나 탭이 가려졌습니다 — 다시 측정하세요.</div>'
      : '') +
    '<ul>' +
    verdict.lines
      .map(
        (l) =>
          `<li><span class="mark ${l.advisory ? 'note' : l.pass ? 'pass' : 'fail'}">` +
          `${l.advisory ? '참고' : l.pass ? 'ok' : 'FAIL'}</span>` +
          `${esc(l.name)}<span class="detail">${esc(l.detail)}</span></li>`,
      )
      .join('') +
    '</ul>' +
    // The copy button is the whole point of the static route: no server means the
    // record has to leave the phone some other way, and "screenshot a 15-column table
    // and retype it" is how wrong numbers get into an issue.
    '<div class="actions">' +
    '<button id="copy" type="button">📋 결과를 복사 (DOO-12에 붙여넣기)</button>' +
    '<button id="toggle" type="button">원문 보기</button>' +
    '</div>' +
    `<div id="copied" class="note"></div>` +
    `<textarea id="md" readonly>${esc(markdown)}</textarea>` +
    (record.passes ?? [])
      .map(
        (p) =>
          `<div class="meta">패스 ${p.index + 1} · first frame ${p.firstFrameMs?.toFixed(0) ?? '—'}ms</div>` +
          `<pre>${esc(table(p))}</pre>`,
      )
      .join('') +
    (record.capSweep?.length
      ? `<div class="meta">DPR 상한 스윕 · ${esc(CONFIG.sweepDims)} · 채움 축을 보는 유일한 열(sync)</div>` +
        `<pre>${esc(sweepTable(record.capSweep))}</pre>`
      : '') +
    `<div class="meta">${esc(saveNote)}</div>`;

  const md = document.getElementById('md');
  const copied = document.getElementById('copied');
  document.getElementById('toggle').addEventListener('click', () => {
    md.classList.toggle('shown');
  });
  document.getElementById('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      copied.textContent = '복사됐습니다 — DOO-12 이슈에 그대로 붙여넣으세요.';
    } catch {
      // Clipboard API needs a secure context, and a plain-http LAN address is not one.
      // Selecting the text is the fallback that works everywhere.
      md.classList.add('shown');
      md.focus();
      md.select();
      copied.textContent = '클립보드 권한이 없습니다 — 아래 상자가 전체 선택됐습니다. 길게 눌러 복사하세요.';
    }
  });
}

(async () => {
  const dev = await device();
  progress.textContent = `${dev.model ?? '기기'} · ${dev.refreshHz}Hz · 측정 시작…`;
  const passes = [];
  for (let i = 0; i < CONFIG.passes; i++) {
    passes.push(await runPass(i));
    // Back-to-back on purpose: pass 2 reads the phone after it has warmed up.
    await sleep(300);
  }
  // Last, so a sweep failure still leaves the suite numbers intact to report.
  let sweep = [];
  try {
    sweep = await runCapSweep();
  } catch {
    sweep = [];
  }

  const payload = { device: dev, passes, capSweep: sweep, tainted, config: CONFIG, overrides };
  const record = buildRecord(payload, {
    measuredAt: new Date().toISOString(),
    commit: CONFIG.commit ?? null,
    builtAt: CONFIG.builtAt ?? null,
    route: CONFIG.reportPath ? 'lan' : 'static',
  });

  let note = CONFIG.reportPath
    ? ''
    : '정적 배포에서 측정했습니다 — 위 복사 버튼으로 전체 기록을 DOO-12에 붙여넣으면 끝입니다.';
  if (CONFIG.reportPath) {
    // The LAN route still posts, so the laptop keeps a file without anyone copying
    // anything. The verdict shown is the locally computed one either way — same module,
    // so there is nothing for the response to correct.
    try {
      const res = await fetch(CONFIG.reportPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      note = `노트북에 기록됨: ${body.saved}`;
    } catch (err) {
      note = `⚠ 노트북으로 전송 실패 (${err.message}) — 아래 복사 버튼으로 결과를 옮기세요.`;
    }
  }

  show(record, reportMarkdown(record), note);
})().catch((err) => {
  progress.textContent = `에러: ${err.message}`;
});
