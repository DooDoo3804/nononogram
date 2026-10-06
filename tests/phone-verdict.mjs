// tests/phone-verdict.mjs — the DOO-12 pass line, in one place, runnable on both sides.
//
// This module is deliberately free of Node imports so the identical file can be
// imported by `tests/phone-bench.mjs` (the LAN harness, which writes the record to
// disk) and by `tests/phone-runner.js` (the page the phone actually runs).
//
// Why that matters: the first version of this harness kept the rules in the Node
// server and shipped the verdict back to the phone in the POST response, so the
// screenshot and the saved file could not disagree. That worked for the LAN route.
// It stops working the moment the bench is opened from a static deploy, where there
// is no server to ask — and the old page's fallback was to print "판정 불가". A
// static deploy is now the route the board approved, so the rules move here instead
// of being copied into the page, which is the other way these two drift apart.

export const P95_CEILING_MS = 20;
export const FIRST_FRAME_CEILING_MS = 2000;
export const THERMAL_REGRESSION = 1.25; // pass 2 p95 vs pass 1, per size
export const DRAW_CALL_CEILING = 12; // 2 instanced meshes + outlines + 3 gizmo lines + 3 labels
export const FRAME_BUDGET_MS = 1000 / 60; // the team pass line is "60fps", independent of panel Hz

// The shipped cap in render/scene.js. Hard-coded rather than read off the page for the
// same reason scripts/bench-render.mjs hard-codes it: if `setPixelRatio` goes missing
// or the cap is quietly lowered, a gate that asks the page what it did cannot notice.
export const SHIPPED_DPR_CAP = 2;

// The buffer render/scene.js sized the cap against: a 412x915 phone at cap 2.
// Megapixels, because that is the unit the fill-rate regression comes back in.
export const CAP2_BUFFER_MPX = 1.41;

export const BUDGETS = {
  p95Ms: P95_CEILING_MS,
  firstFrameMs: FIRST_FRAME_CEILING_MS,
  thermalRegression: THERMAL_REGRESSION,
  frameBudgetMs: FRAME_BUDGET_MS,
  shippedDprCap: SHIPPED_DPR_CAP,
  drawCallCeiling: DRAW_CALL_CEILING,
};

// Least squares of sync time against buffer area over the cap sweep. The slope is this
// phone's fill rate; the intercept absorbs the per-frame cost that does not scale with
// area (draw-call submission, the readPixels round trip itself), which is exactly why
// the cap decision needs a regression and not a single absolute reading.
//
// render/scene.js picked the shipped cap by taking an M1 Pro's 0.95 ms/Mpx and dividing
// by a literature 5-10x. This replaces that divisor with a measurement.
export function fillRate(sweep) {
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

// One judgement function. `payload` is what the phone collected; `rate` is fillRate()
// over its cap sweep.
export function judge(payload, rate) {
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
    pass: rows.every((r) => r.cpuMs < FRAME_BUDGET_MS),
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
    const atCap2 = rate.msPerMegapixel * CAP2_BUFFER_MPX + rate.interceptMs;
    lines.push({
      name: `measured fill rate leaves head room at cap ${SHIPPED_DPR_CAP}`,
      pass: atCap2 <= FRAME_BUDGET_MS,
      detail:
        `${rate.msPerMegapixel.toFixed(2)}ms/Mpx (r² ${rate.r2.toFixed(3)}) → ` +
        `${atCap2.toFixed(1)}ms for ${CAP2_BUFFER_MPX}Mpx vs ${FRAME_BUDGET_MS.toFixed(1)}ms budget`,
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

  // Two things can make a run technically green and still not be the reading DOO-12
  // asks for. They are collected rather than just printed, because the headline has to
  // carry them: a screenshot of "✅ 통과" is what actually gets pasted into an issue, and
  // nobody scrolls to an advisory line before believing it.
  const disqualifiers = [];

  // A shortened window is a fine smoke test and a worthless measurement.
  if (payload.overrides?.length) {
    disqualifiers.push('측정 파라미터가 기본값이 아님');
    lines.push({
      advisory: true,
      name: '[참고] 측정 파라미터가 기본값이 아님 — 공식 수치로 쓸 수 없음',
      pass: false,
      detail: payload.overrides.join(', '),
    });
  }

  // An Android reading is the one the team pass line asks for. Anything else is worth
  // recording — a real mobile GPU and compositor is still far closer than a desktop
  // floor — but it must not be filed as the Android number, so it is called out here
  // rather than left for whoever reads the issue to notice from the UA string.
  const ua = payload.device?.ua ?? '';
  if (ua && !/Android/i.test(ua)) {
    disqualifiers.push('안드로이드 기기가 아님');
    lines.push({
      advisory: true,
      name: '[참고] 안드로이드가 아닌 기기 — 합격선("중간 크기 안드로이드")의 판정으로는 쓸 수 없음',
      pass: false,
      detail: ua.slice(0, 120),
    });
  }

  return {
    pass: lines.every((l) => l.advisory || l.pass),
    // `pass` says the numbers fit the budget. `official` says the run is the one the
    // team pass line asks for. Both have to be true before this closes DOO-12.
    official: disqualifiers.length === 0,
    disqualifiers,
    lines,
  };
}

// The headline, in one place: the card, the markdown and any future reader of the saved
// record should not each decide separately what a qualified pass looks like.
export function verdictHeadline(verdict) {
  if (!verdict.pass) return '❌ 예산 초과';
  return verdict.official ? '✅ 통과' : '⚠️ 예산 내 — 공식 판정 아님';
}

// The full record, assembled identically on both routes. `nowIso` and the environment
// fields are injected rather than read here so this module stays pure (and so the LAN
// route can add the socket address, which a static page cannot know).
export function buildRecord(payload, extra = {}) {
  const rate = fillRate(payload.capSweep);
  return {
    issue: 'DOO-12',
    budgets: BUDGETS,
    device: payload.device ?? {},
    passes: payload.passes ?? [],
    capSweep: payload.capSweep ?? null,
    fillRate: rate,
    tainted: payload.tainted ?? false,
    verdict: judge(payload, rate),
    config: payload.config ?? null,
    ...extra,
  };
}

const fx = (v, places) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(places) : '—');

const SUITE_COLUMNS = [
  ['dims', (r) => r.dims],
  ['cells', (r) => r.cells],
  ['draw', (r) => r.drawCalls],
  ['tri', (r) => r.triangles],
  ['fps', (r) => fx(r.fps, 1)],
  ['p95', (r) => fx(r.p95Ms, 2)],
  ['cpu', (r) => fx(r.cpuMs, 2)],
  ['sync', (r) => fx(r.syncMs, 2)],
  ['syncP95', (r) => fx(r.syncP95Ms, 2)],
  ['drop', (r) => r.droppedFrames],
  ['dpr', (r) => fx(r.pixelRatio, 3)],
  ['bufferPx', (r) => r.bufferPx ?? '—'],
  ['build', (r) => fx(r.buildMs, 1)],
  ['repaint', (r) => fx(r.repaintMs, 2)],
  ['pick', (r) => (r.picked === null || r.picked === undefined ? 'MISS' : r.picked)],
];

const SWEEP_COLUMNS = [
  ['cap', (r) => r.cap],
  ['buffer', (r) => `${fx(r.pixelRatio, 3)}x`],
  ['bufferPx', (r) => r.bufferPx ?? '—'],
  ['p95', (r) => fx(r.p95Ms, 2)],
  ['sync', (r) => fx(r.syncMs, 2)],
  ['syncP95', (r) => fx(r.syncP95Ms, 2)],
  ['drop', (r) => r.droppedFrames ?? '—'],
];

function mdTable(columns, rows) {
  const head = `| ${columns.map(([h]) => h).join(' | ')} |`;
  const rule = `|${columns.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${columns.map(([, get]) => get(r)).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

// The record as a block someone can paste straight into the issue. The static route has
// no server to POST to, so this is what replaces the saved JSON file: one copy button,
// no hand-transcription of a 15-column table off a phone screenshot.
export function reportMarkdown(record) {
  const d = record.device ?? {};
  const v = record.verdict ?? { pass: false, lines: [] };
  const out = [];

  out.push(`## DOO-12 실기 측정 — ${d.model ?? '기종 미확인'}`);
  out.push('');
  out.push(`**판정: ${verdictHeadline(v)}**`);
  if (v.disqualifiers?.length) {
    out.push('');
    out.push(
      `> 이 측정은 합격선 판정으로 쓸 수 없습니다 — ${v.disqualifiers.join(', ')}. ` +
        '수치는 참고용입니다.',
    );
  }
  out.push('');
  out.push('| 항목 | | 상세 |');
  out.push('|---|---|---|');
  for (const l of v.lines) {
    const mark = l.advisory ? '참고' : l.pass ? '✅' : '❌';
    out.push(`| ${l.name} | ${mark} | \`${String(l.detail).replace(/\|/g, '\\|')}\` |`);
  }
  out.push('');
  out.push('### 기기');
  out.push('');
  out.push(`- 기종 \`${d.model ?? '?'}\` · ${d.platform ?? '?'}`);
  out.push(`- 화면 ${d.screen ?? '?'} @ dpr ${d.dpr ?? '?'} → 뷰포트 ${d.viewport ?? '?'} (${d.pixels ?? '?'}px)`);
  out.push(`- 주사율 ${d.refreshHz ?? '?'}Hz · 코어 ${d.cores ?? '?'} · 메모리 ${d.memoryGb ?? '?'}GB · 네트워크 ${d.network ?? '?'}`);
  out.push(`- GL \`${d.renderer ?? '?'}\``);
  out.push(`- 브라우저 \`${d.browser ?? d.ua ?? '?'}\``);
  if (record.commit) out.push(`- 측정한 빌드 \`${record.commit}\`${record.builtAt ? ` (빌드 ${record.builtAt})` : ''}`);
  if (record.measuredAt) out.push(`- 측정 시각 ${record.measuredAt}`);
  if (record.tainted) {
    out.push('');
    out.push('> ⚠ 측정 중 화면이 꺼지거나 탭이 가려졌습니다 — 이 수치는 신뢰할 수 없습니다. 다시 측정하세요.');
  }

  for (const p of record.passes ?? []) {
    out.push('');
    out.push(`### 패스 ${p.index + 1} — first frame ${fx(p.firstFrameMs, 0)}ms`);
    out.push('');
    out.push(mdTable(SUITE_COLUMNS, p.rows ?? []));
  }

  if (record.capSweep?.length) {
    out.push('');
    out.push(`### DPR 상한 스윕 — ${record.config?.sweepDims ?? '최악 크기'}`);
    out.push('');
    out.push('프레임 열(p95)은 vsync에 묶여 캡에 눈이 멀다. 채움 축을 보는 열은 `sync`뿐이다.');
    out.push('');
    out.push(mdTable(SWEEP_COLUMNS, record.capSweep));
    const rate = record.fillRate;
    out.push('');
    if (rate) {
      const atCap2 = rate.msPerMegapixel * CAP2_BUFFER_MPX + rate.interceptMs;
      out.push(
        `**채움 속도 ${rate.msPerMegapixel.toFixed(3)} ms/메가픽셀** ` +
          `(r² ${rate.r2.toFixed(4)}, ${rate.points}점, 절편 ${rate.interceptMs.toFixed(2)}ms) → ` +
          `캡 ${SHIPPED_DPR_CAP}의 ${CAP2_BUFFER_MPX}Mpx에 ${atCap2.toFixed(1)}ms ` +
          `(예산 ${FRAME_BUDGET_MS.toFixed(1)}ms)`,
      );
      out.push('');
      out.push('이 값이 `render/scene.js`가 M1 Pro 실측을 문헌값 5~10배로 나눠 투사했던 자리를 대체한다.');
    } else {
      out.push('**채움 속도 회귀 포기** — 서로 다른 버퍼 크기가 3개 미만. (DPR이 낮아 캡들이 같은 버퍼로 눌렸다.)');
    }
  }

  out.push('');
  out.push('<details><summary>원자료 JSON</summary>');
  out.push('');
  out.push('```json');
  out.push(JSON.stringify(record, null, 2));
  out.push('```');
  out.push('');
  out.push('</details>');
  return out.join('\n');
}
