// tests/phone-verify-selfcheck.mjs — drive the phone measurement page end to end on an
// emulated phone, so the human's one trip to a real one cannot be wasted on a broken page.
//
//   node tests/phone-verify-selfcheck.mjs --static   # the deployed artifact (dist/verify/)
//   node tests/phone-verify-selfcheck.mjs --lan      # the laptop route (tests/phone-bench.mjs)
//   node tests/phone-verify-selfcheck.mjs --static --url https://host/path/   # a live deploy
//
// This is not a performance measurement — an emulated phone on a desktop GPU cannot
// produce one, which is the whole reason DOO-12 exists. It checks the things that would
// make a real reading unusable: a page that never finishes, a verdict that does not
// render, a sweep that silently returns nothing, a record missing the device identity or
// the commit, a copy button that is not there on the route that has no server.
//
// The run uses `?sec=1&passes=2&sweepsec=1` against the *shipped* bytes rather than a
// special fast build, so what passes here is what a tester opens.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'verify-out');

const argv = process.argv.slice(2);
const mode = argv.includes('--lan') ? 'lan' : 'static';
const urlArg = argv[argv.indexOf('--url') + 1];
const liveUrl = argv.includes('--url') ? urlArg : null;
const PORT = Number(process.env.PORT ?? 4190);
const LAN_PORT = Number(process.env.LAN_PORT ?? 4191);
// Short by default: this checks that the page works, not how fast the machine is.
// Overridable because the fill-rate regression is the one number the DPR cap rests on,
// and its repeatability has to be measurable at the settings the deploy actually ships.
const QUERY = process.env.SELFCHECK_QUERY ?? 'sec=1&passes=2&sweepsec=1&sweepsync=16';

// A mid-range Android, as emulated elsewhere in this harness: 412x915 at DPR 2.625 with
// a 4x CPU slowdown. The DPR matters most — it is above the shipped cap of 2, so the cap
// is actually exercised and the sweep gets three distinct buffer sizes.
const PHONE = { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, cpuThrottle: 4 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function staticServer(root, port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') return void res.writeHead(204).end();
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (!file.startsWith(root)) return void res.writeHead(403).end('no');
    if (file.endsWith('/') || (existsSync(file) && !extname(file))) file = join(file, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('404');
    }
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let lan = null;
let base;

if (liveUrl) {
  base = liveUrl.endsWith('/') ? liveUrl : `${liveUrl}/`;
} else if (mode === 'static') {
  if (!existsSync(join(DIST, 'verify', 'index.html'))) {
    console.error('dist/verify/index.html is missing — run `npm run build && node tests/phone-verify-build.mjs`.');
    process.exit(1);
  }
  server = await staticServer(DIST, PORT);
  base = `http://127.0.0.1:${PORT}/verify/`;
} else {
  // The LAN route under test is the real server, started the way a tester starts it.
  lan = spawn(process.execPath, [join(ROOT, 'tests', 'phone-bench.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(LAN_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  lan.stdout.on('data', () => {});
  lan.stderr.on('data', (d) => process.stderr.write(`[lan] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${LAN_PORT}/`);
      break;
    } catch {
      await sleep(200);
    }
  }
  base = `http://127.0.0.1:${LAN_PORT}/`;
}

const list = checklist();
const browser = await launchChrome({ gl: 'auto', windowSize: '480,960' });
const page = await browser.newPage();

try {
  await page.emulate(PHONE);
  const target = `${base}?${QUERY}`;
  console.log(`\n  ${mode} route — ${target}`);
  console.log(`  emulated ${PHONE.width}x${PHONE.height} @ dpr ${PHONE.deviceScaleFactor}, cpu ${PHONE.cpuThrottle}x`);
  console.log(`  gl backend: ${await page.glRenderer()}\n`);

  await page.goto(target, { settleMs: 400 });

  // The page is the thing under test, so wait on its own completion signal — the card
  // becoming visible — not on a fixed sleep.
  await page.waitFor("!!document.querySelector('#card.shown')", { timeoutMs: 300_000, everyMs: 1000 });

  const seen = await page.evaluate(`(() => {
    const card = document.getElementById('card');
    const md = document.getElementById('md');
    return {
      verdictText: card.querySelector('.big')?.textContent ?? '',
      lines: [...card.querySelectorAll('li')].map((li) => ({
        mark: li.querySelector('.mark')?.textContent ?? '',
        name: li.querySelector('.mark')?.nextSibling?.textContent ?? '',
        detail: li.querySelector('.detail')?.textContent ?? '',
      })),
      hasCopyButton: !!document.getElementById('copy'),
      hasToggle: !!document.getElementById('toggle'),
      markdown: md?.value ?? null,
      metaText: [...card.querySelectorAll('.meta')].map((d) => d.textContent).join(' | '),
      preBlocks: card.querySelectorAll('pre').length,
      iframeGone: !document.getElementById('frame'),
    };
  })()`);

  const md = seen.markdown ?? '';
  const nameOf = (needle) => seen.lines.find((l) => l.name.includes(needle));

  list.check(
    'card rendered with a verdict',
    /통과|예산 초과|예산 내/.test(seen.verdictText),
    seen.verdictText.trim(),
  );
  // The headline is what gets screenshotted into an issue. This run is a desktop on a
  // shortened window, so a plain "✅ 통과" here would be the exact false pass the
  // disqualifier logic exists to prevent — assert it is withheld. An outright
  // "❌ 예산 초과" satisfies that too: whether the numbers happened to fit is not what
  // this is checking, and on a loaded desktop in a 1s window they often will not.
  list.check(
    'unqualified run is not headlined as a plain pass',
    !/^\s*✅ 통과\s*$/.test(seen.verdictText),
    seen.verdictText.trim(),
  );
  list.check('iframe torn down after the run', seen.iframeGone, seen.iframeGone ? 'removed' : 'still present');
  list.check('verdict has the gate lines', seen.lines.length >= 8, `${seen.lines.length} lines`);

  // The thermal line compares pass 2 against pass 1, so it only exists on a multi-pass
  // run. Demanding it unconditionally made this self-check fail on its own single-pass
  // invocations — a check that is wrong about the thing it guards is worse than absent.
  const passCount = Number(new URLSearchParams(QUERY).get('passes') ?? 2);

  for (const needle of [
    'p95 ≤ 20ms',
    'draw calls do not grow',
    'first frame ≤ 2000ms',
    'cpu per frame',
    'instance raycast picks',
    'GPU raster inside the 60fps budget',
    'drawing buffer sits at min(DPR, 2)',
    ...(passCount > 1 ? ['no thermal regression'] : []),
  ]) {
    const line = nameOf(needle);
    list.check(`gate line present: ${needle}`, !!line, line ? `${line.mark} ${line.detail.slice(0, 70)}` : 'MISSING');
  }

  // The fill axis is the reason this harness exists — an emulated phone at DPR 2.625
  // gets three distinct buffers out of caps 1/1.5/2, so the regression must land.
  const rate = nameOf('measured fill rate');
  list.check('fill-rate regression computed from the sweep', !!rate, rate?.detail ?? 'MISSING — sweep produced <3 distinct buffers');
  list.check('cap sweep table rendered', /DPR 상한 스윕/.test(seen.metaText), `${seen.preBlocks} pre blocks`);

  // Both routes must flag a shortened window; a green card from a 1s run is exactly the
  // artefact that should never be mistaken for the official reading.
  const override = nameOf('측정 파라미터가 기본값이 아님');
  list.check('non-default parameters flagged on the card', !!override, override?.detail ?? 'MISSING');

  list.check('commit stamped on the card', /빌드\s+\w/.test(seen.metaText), (seen.metaText.match(/빌드\s+\S+/) ?? ['—'])[0]);
  list.check('device identified', /dpr 2.625/.test(seen.metaText), (seen.metaText.split('|')[0] ?? '').slice(0, 90));

  // The static route has no server, so the copy button *is* the record-keeping path.
  list.check('copy button present', seen.hasCopyButton && seen.hasToggle, seen.hasCopyButton ? 'copy + raw toggle' : 'MISSING');
  list.check('paste-ready markdown generated', md.length > 1500, `${md.length} chars`);
  list.check('markdown carries the verdict table', md.includes('| 항목 |') && md.includes('**판정:'), 'verdict table');
  list.check('markdown carries the suite table', /\| dims \| cells \| draw \|/.test(md), 'suite table');
  list.check('markdown carries the sweep table', /\| cap \| buffer \| bufferPx \|/.test(md), 'sweep table');
  list.check('markdown embeds the raw record', md.includes('```json') && md.includes('"issue": "DOO-12"'), 'json block');
  list.check(
    'markdown names the measured build',
    /측정한 빌드 `\w/.test(md),
    (md.match(/측정한 빌드 `[^`]+`/) ?? ['MISSING'])[0],
  );

  if (mode === 'lan') {
    list.check('posted to the laptop', /노트북에 기록됨/.test(seen.metaText), 'POST round trip');
  } else {
    list.check(
      'static route explains how to report',
      /복사 버튼/.test(seen.metaText),
      'copy instruction shown',
    );
  }

  // A page that tells a tester to look at errors must not generate its own.
  const errors = page.errors().filter((e) => !/favicon/i.test(e));
  list.check('no console errors', errors.length === 0, errors.slice(0, 3).join(' / ') || 'clean');

  // The deploy is a static artifact; a phone on a hotel wifi should not need anything but
  // the origin it was opened from. Compared against the *origin*, not the page's own
  // directory — the artifact legitimately reaches up to ../bench/ and /assets/, and a
  // deploy under a subpath would otherwise flag its own files as third-party.
  const external = page.externalRequests(new URL(base).origin);
  list.check('no off-origin requests', external.length === 0, external.slice(0, 3).join(' ') || 'self-contained');

  // A page whose instructions are "look at the errors" must not manufacture one. With no
  // icon declared the browser hits the origin root for /favicon.ico, which a static host
  // answers with a 404 that nothing in the artifact can intercept.
  // `externalRequests` filters by prefix, so an unmatchable prefix yields every request —
  // the favicon hit can be same-origin or not depending on where the page is deployed.
  const favicons = page.externalRequests('about:').filter((u) => /favicon/i.test(u));
  list.check('no favicon 404 on the phone', favicons.length === 0, favicons.join(' ') || 'icon declared inline');

  const shot = await page.screenshot();
  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await writeFile(join(OUT_DIR, `phone-verify-selfcheck-${mode}-${stamp}.png`), shot);
  await writeFile(
    join(OUT_DIR, `phone-verify-selfcheck-${mode}-${stamp}.json`),
    JSON.stringify({ mode, base, query: QUERY, phone: PHONE, checks: list.checks, seen }, null, 2),
  );
  await writeFile(join(OUT_DIR, `phone-verify-selfcheck-${mode}-${stamp}.md`), md);

  const failed = list.checks.filter((c) => !c.pass && !c.advisory);
  console.log('');
  for (const c of list.checks) {
    console.log(`  ${c.pass ? ' ok ' : 'FAIL'}  ${c.name}  — ${c.detail}`);
  }
  console.log(`\n  ${list.checks.length - failed.length}/${list.checks.length} passed`);
  console.log(`  screenshot + record + markdown in verify-out/phone-verify-selfcheck-${mode}-${stamp}.*\n`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close().catch(() => {});
  server?.close();
  lan?.kill('SIGINT');
}
