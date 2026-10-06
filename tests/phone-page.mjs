// tests/phone-page.mjs — the HTML shell for the phone measurement page.
//
// Shared by the LAN harness (`tests/phone-bench.mjs`) and the static deploy builder
// (`tests/phone-verify-build.mjs`) so the page a tester sees is the same markup on both
// routes. Everything route-specific is in the injected config object.

export const DEFAULT_CONFIG = {
  suite: '3x3x3,4x4x4,5x5x5,6x6x6',
  seconds: 4,
  passes: 2,
  sweepDims: '6x6x6',
  sweepCaps: [1, 1.5, 2],
  sweepSeconds: 1,
  sweepSync: 32,
  // Where the bench page lives relative to this page. `/` on the LAN route (the page is
  // served at the root of dist/), `../bench/` from dist/verify/ on the static route.
  benchPath: './bench/',
  // POST target, or null for "no server — show a copy button instead".
  reportPath: './report',
  // Which build is being measured. A perf number with no commit attached cannot be
  // re-read later, and the static artifact outlives the tree it came from.
  commit: null,
  builtAt: null,
};

export function phonePageHtml({ config, runnerSrc = './phone-runner.js' } = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
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
  .note { color: #8ec3e8; font-size: 12px; }
  ul { list-style: none; padding: 0; margin: 10px 0 18px; }
  li { padding: 5px 0; border-bottom: 1px solid #ffffff14; font-size: 13px; }
  li .mark { font-weight: 700; margin-right: 6px; }
  .detail { color: #bdb094; font-size: 12px; display: block; word-break: break-all; }
  pre { overflow-x: auto; font-size: 11px; line-height: 1.45; background: #0f0d08;
    padding: 10px; border-radius: 6px; }
  .meta { color: #bdb094; font-size: 12px; word-break: break-all; }
  .warn { color: #ffcf6b; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
  button { font: inherit; font-size: 13px; padding: 11px 14px; border-radius: 8px;
    border: 1px solid #e8c37a55; background: #2c2417; color: #ecdfc0; cursor: pointer; }
  button:active { background: #3c3220; }
  #copy { flex: 1 1 auto; border-color: #e8c37a; color: #e8c37a; font-weight: 700; }
  #md { display: none; width: 100%; box-sizing: border-box; height: 40vh; margin: 8px 0;
    font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #0f0d08;
    color: #bdb094; border: 1px solid #ffffff22; border-radius: 6px; padding: 8px; }
  #md.shown { display: block; }
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
<script>window.__PHONE_BENCH__ = ${JSON.stringify(merged)};</script>
<script type="module" src="${runnerSrc}"></script>
</body>
</html>`;
}
