// tests/probe-deploy.mjs — is the built `dist/` a *deployable* artifact, or only a
// buildable one? (report §33)
//
// `npm run build` exiting 0 says the bundler finished. It does not say any of the four
// things a release judgment needs, and each of them has failed for real projects on the
// commit after a green build:
//
//   1. served from a **subpath** — the GitHub Pages shape. `vite.config.js` claims this
//      with `base: './'`; the claim is only worth as much as a load from
//      `http://host/a/b/index.html` where every asset must resolve relative to `b/`.
//   2. with **every third-party host unreachable**. `index.html` links a Google Fonts
//      stylesheet on the first-paint path. A deploy behind a firewall, on a plane, or in
//      a region that blocks the host is the same page with that request hanging.
//   3. **playable**, not just painted — one real tap, routed by Chrome's own hit-testing
//      into the shipped bundle, has to fill the cell it was aimed at.
//   4. inside the **2s first-screen budget on a phone**, measured on the artifact that
//      ships rather than on a dev server. This is the one reading the lead named as
//      missing: every earlier 2s number came from `vite preview` at desktop size.
//
// The perf numbers are the product's own `window.__nonogram.perf()` marks — the same
// fields `scripts/verify-browser.mjs:444` asserts — so this adds a viewport and an
// artifact, not a second definition of "first screen".
//
// Usage
//   node tests/probe-deploy.mjs <base-url-including-subpath> [out.json] [--viewport=phone] [--cpu=4]
//
// Exits 1 on any failed check.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const [BASE, OUT = 'qa-out/deploy.json', ...flags] = process.argv.slice(2);
if (!BASE) {
  console.error('usage: node tests/probe-deploy.mjs <base-url> [out.json] [--viewport=id] [--cpu=n]');
  process.exit(2);
}
const flag = (name, fallback) => flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const VIEWPORTS = {
  desktop: { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, touch: false },
  phone: { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, touch: true },
};
const viewportId = flag('viewport', 'phone');
const viewport = VIEWPORTS[viewportId];
if (!viewport) { console.error(`unknown viewport ${viewportId}`); process.exit(2); }
const cpuThrottle = Number(flag('cpu', '4'));

const { check, checks, report } = checklist();

// `offline: true` is `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` — every
// host but the static server resolves to nothing. Same flag the playtest rails run under,
// so the fonts link is dead here exactly as it is there.
const browser = await launchChrome({ offline: true, windowSize: `${viewport.width},${viewport.height}` });
const page = await browser.newPage();
await page.emulate({ ...viewport, cpuThrottle });

process.stdout.write(
  `\n=== deploy artifact · ${BASE}\n` +
  `    ${viewportId} ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}` +
  ` cpu/${cpuThrottle} · every host but 127.0.0.1 blocked\n\n`,
);

try {
  await page.goto(BASE, { settleMs: 900 });

  // --- 1. it booted at all, from this subpath -------------------------------
  const booted = await page.evaluate('!!window.__nonogram && !!window.__nonogram.levels');
  check('the bundle boots when served from a subpath', booted, BASE);
  if (!booted) throw new Error('bundle never booted — nothing below this can be measured');

  // Which assets the page actually fetched, and from where. A 404 on a hashed asset is
  // what a wrong `base` looks like, and it is silent in the console for a module preload.
  const external = page.externalRequests(new URL(BASE).origin);
  check(
    'no asset is fetched from outside the deploy origin',
    external.every((u) => !u.endsWith('.js') && !u.endsWith('.css')),
    external.length ? external.join(' ') : 'none',
  );
  // Recorded, not asserted: a deploy may legitimately want the webfont. The number this
  // check owns is "does the page still work without it", which the budget checks below
  // answer under exactly that condition.
  const thirdParty = [...new Set(external.map((u) => new URL(u).host))];
  check('third-party hosts on the first-paint path are recorded',
    true, thirdParty.length ? thirdParty.join(' ') : 'none');

  const failedRequests = await page.evaluate(`JSON.stringify(
    performance.getEntriesByType('resource')
      .filter((e) => e.transferSize === 0 && e.decodedBodySize === 0)
      .map((e) => e.name))`).then(JSON.parse);
  // `favicon.ico` is not in the artifact and not in the markup — the browser asks for it
  // on its own. Nothing in the bundle depends on it, so it is excluded by name rather
  // than left to make this check meaningless.
  const brokenOwn = failedRequests
    .filter((u) => u.startsWith(new URL(BASE).origin))
    .filter((u) => !u.endsWith('/favicon.ico'));
  check('every same-origin asset the page asked for arrived', brokenOwn.length === 0,
    brokenOwn.length ? brokenOwn.join(' ') : `0 broken of ${failedRequests.length} empty responses`);

  // --- 2. the 2s first-screen budget, on this artifact, at this viewport ----
  const perfTitle = await page.evaluate('JSON.stringify(window.__nonogram.perf())').then(JSON.parse);
  check('first screen inside the 2s budget (deploy build)',
    perfTitle.firstFrameMs > 0 && perfTitle.firstFrameMs < 2000,
    `${perfTitle.firstFrameMs?.toFixed(0)}ms`);

  // --- 3. the puzzle-open transition, with the harness's own latency out of it
  // `perf.mark()` stores `performance.now()`, so `marks['first-puzzle']` is
  // *ms since navigation start* — it contains however long the measuring harness took to
  // get to the click. `scripts/verify-browser.mjs` asserts that raw number against 2s
  // after ~1s of its own `sleep()` calls, which is why it is kept here as advisory only.
  //
  // The product's own cost is the delta: stamp `performance.now()` in the page
  // immediately before the click chain, and subtract. Same clock, same frame, no harness
  // in it. The whole walk goes out in one `evaluate` so no round-trip lands inside it.
  const openedAt = await page.evaluate(`(() => {
    const t0 = performance.now();
    document.getElementById('btn-start').click();
    document.querySelectorAll('#levels-grid .level-card')[0].click();
    document.querySelectorAll('#puzzles-grid .puzzle-card')[0].click();
    return t0;
  })()`);
  await page.waitFor('(() => { const s = window.__nonogram.session(); return !!s; })()', { timeoutMs: 20_000 });
  await sleep(800);

  const perfPuzzle = await page.evaluate('JSON.stringify(window.__nonogram.perf())').then(JSON.parse);
  const rawMarkMs = perfPuzzle.marks?.['first-puzzle'];
  const openMs = rawMarkMs > 0 ? rawMarkMs - openedAt : null;
  check('the puzzle-open transition is inside the 2s budget (deploy build, harness latency excluded)',
    openMs !== null && openMs < 2000,
    `${openMs?.toFixed(0)}ms from the click to the first playable frame`);
  check('raw `first-puzzle` mark, for comparison with verify-browser.mjs',
    rawMarkMs > 0 && rawMarkMs < 2000,
    `${rawMarkMs?.toFixed(0)}ms since navigation start — includes ${openedAt.toFixed(0)}ms of harness pacing`,
    { advisory: true });

  // The canvas centre. Not a mapped cell from the reachability rail — this probe asks
  // "does a tap reach the bundle", and the centre of a freshly framed board is a cell on
  // every box in the catalogue. Which cell it is does not matter; that it changes does.
  const rect = await page.evaluate(`JSON.stringify((() => {
    const r = document.getElementById('scene').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  })())`).then(JSON.parse);
  check('the canvas has a usable size at this viewport', rect.w >= 200 && rect.h >= 200,
    `${rect.w.toFixed(0)}x${rect.h.toFixed(0)} CSS px`);

  // `state` is a live Uint8Array; `JSON.stringify` turns one into an object, not an array.
  const readBoard = () => page
    .evaluate('JSON.stringify(Array.from(window.__nonogram.session().state))')
    .then(JSON.parse);
  const before = await readBoard();
  const tapId = 1;
  for (const type of ['touchStart', 'touchEnd']) {
    await page.call('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: rect.x, y: rect.y, id: tapId }],
    });
    await sleep(60);
  }
  await sleep(300);
  const after = await readBoard();
  const moved = before.map((v, i) => (v !== after[i] ? i : -1)).filter((i) => i >= 0);
  check('one real tap on the deploy build changes exactly one cell', moved.length === 1,
    `cells changed: ${JSON.stringify(moved)}`);

  // --- 4. steady state, so the artifact is judged running and not just loading
  await page.evaluate('window.__nonogram.perfReset()');
  await sleep(2500);
  const steady = await page.evaluate('JSON.stringify(window.__nonogram.perf())').then(JSON.parse);
  check('no dropped frames in 2.5s of steady state on the deploy build',
    steady.droppedFrames === 0,
    `${steady.fps?.toFixed(1)}fps, avg ${steady.frameMs?.toFixed(2)}ms, ` +
    `p95 ${steady.p95Ms?.toFixed(2)}ms, worst ${steady.worstMs?.toFixed(2)}ms, ` +
    `dropped ${steady.droppedFrames}`);

  const errors = page.errors().filter((e) => !e.includes('favicon.ico'));
  check('no console errors across the deploy load and the tap', errors.length === 0,
    errors.length ? errors.join(' | ') : '0');

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    base: BASE, viewport: viewportId, cpuThrottle,
    perfTitle, perfPuzzle, openedAt, openMs, rawMarkMs, steady, rect, external, thirdParty, failedRequests,
    checks,
  }, null, 2));
  process.stdout.write(`\n  wrote ${OUT}\n`);
} finally {
  await browser.close();
}

process.exitCode = report().length ? 1 : 0;
