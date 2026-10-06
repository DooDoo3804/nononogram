// tests/probe-font.mjs — did the display face actually *render*, with no network?
//
// `tests/probe-deploy.mjs` going 11/11 says the console is quiet and nothing was fetched
// from a foreign host. It does not say the wordmark is set in Playfair Display, and the
// two are easy to confuse: a self-hosted `@font-face` with a wrong `url()` is also a
// quiet console and also a silent Georgia fallback — the exact symptom DOO-40 reported,
// minus the error that gave it away. So the thing that has to be measured is the glyphs.
//
// Three independent signals, because each one alone has a way of lying:
//
//   1. `document.fonts.check()` — the browser's own answer to "can I use this family at
//      this weight". True before the bytes land, so it is necessary, not sufficient.
//   2. the file arrived from our own origin, as a font, with the size we shipped — reads
//      `performance.getEntriesByType('resource')`, so a 404 or a 0-byte body shows up.
//   3. the rendered advance width of the wordmark differs from the same string forced to
//      the fallback. This is the one that cannot be faked: if Playfair is not the face
//      being used, the two measurements are equal to the pixel.
//
// Usage
//   node tests/probe-font.mjs <base-url> [out.json] [--viewport=phone|desktop] [--shot=file.png]
//
// Runs with every host but the static server blackholed, like the deploy probe.
// Exits 1 on any failed check.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const [BASE, OUT = 'qa-out/font.json', ...flags] = process.argv.slice(2);
if (!BASE) {
  console.error('usage: node tests/probe-font.mjs <base-url> [out.json] [--viewport=id] [--shot=file.png]');
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
const shot = flag('shot', null);

// The family and the two weights style.css asks for. Kept as data so the failure message
// can name which weight went missing rather than just "the font".
const FAMILY = 'Playfair Display';
const WEIGHTS = [700, 800];
const EXPECT_BYTES = 23_964;

const { check, checks, report } = checklist();

const browser = await launchChrome({ offline: true, windowSize: `${viewport.width},${viewport.height}` });
const page = await browser.newPage();
await page.emulate({ ...viewport, cpuThrottle: 1 });

process.stdout.write(
  `\n=== display face · ${BASE}\n` +
  `    ${viewportId} ${viewport.width}x${viewport.height} · every host but 127.0.0.1 blocked\n\n`,
);

try {
  await page.goto(BASE, { settleMs: 900 });
  // `document.fonts.check()` answers from the face *list*, which is populated at CSS parse
  // time — so it can say yes while the bytes are still in flight. Wait for the load to
  // actually settle before measuring anything.
  await page.evaluate('document.fonts.ready.then(() => true)');

  const loaded = await page.evaluate(`JSON.stringify((() => {
    const faces = [...document.fonts].map((f) => ({
      family: f.family, weight: f.weight, status: f.status, display: f.display, src: f.src ?? null,
    }));
    return {
      faces,
      checks: ${JSON.stringify(WEIGHTS)}.map((w) => ({
        weight: w, ok: document.fonts.check(w + ' 16px "${FAMILY}"'),
      })),
    };
  })())`).then(JSON.parse);

  const missing = loaded.checks.filter((c) => !c.ok).map((c) => c.weight);
  check(`the ${FAMILY} face is usable at every weight the CSS asks for`,
    missing.length === 0,
    missing.length ? `missing at ${missing.join(', ')}` : `${WEIGHTS.join(' + ')} both available`);

  const ours = loaded.faces.filter((f) => f.family.replace(/["']/g, '') === FAMILY);
  check('it is declared once, not once per weight',
    ours.length === 1 && ours[0].status === 'loaded',
    ours.length ? ours.map((f) => `${f.weight} ${f.status}`).join(' | ') : 'no such face');

  // --- the bytes: our origin, as a font, the size we committed ---------------
  const res = await page.evaluate(`JSON.stringify(
    performance.getEntriesByType('resource')
      .filter((e) => /\\.woff2?($|\\?)/.test(e.name))
      .map((e) => ({
        name: e.name, initiator: e.initiatorType,
        transferSize: e.transferSize, decodedBodySize: e.decodedBodySize,
      })))`).then(JSON.parse);

  const origin = new URL(BASE).origin;
  const foreign = res.filter((r) => !r.name.startsWith(origin));
  check('no font byte comes from outside the deploy origin', foreign.length === 0,
    foreign.length ? foreign.map((r) => new URL(r.name).host).join(' ') : `${res.length} font request(s), all same-origin`);

  const served = res.filter((r) => r.name.startsWith(origin) && r.decodedBodySize > 0);
  check('the subset arrived whole', served.some((r) => r.decodedBodySize === EXPECT_BYTES),
    served.length
      ? served.map((r) => `${r.name.split('/').pop()} ${r.decodedBodySize}B`).join(' | ')
      : 'no font body arrived — the url() in style.css does not resolve');

  // --- the glyphs: measured, not asserted -----------------------------------
  // Same string, same size, same weight; only the family differs. Georgia is the next
  // entry in --font-display, so this compares what the wordmark renders as against what
  // it would have fallen back to. Equal widths mean the fallback is what is on screen.
  const metrics = await page.evaluate(`JSON.stringify((() => {
    const ctx = document.createElement('canvas').getContext('2d');
    const measure = (font) => { ctx.font = font; return ctx.measureText('no-nonogram').width; };
    const h1 = document.querySelector('.brand h1');
    const used = h1 ? getComputedStyle(h1).fontFamily : null;
    return {
      display: measure('800 2.4rem "${FAMILY}", Georgia, serif'),
      fallback: measure('800 2.4rem Georgia, serif'),
      sansCheck: measure('800 2.4rem "No Such Family At All", Georgia, serif'),
      wordmarkText: h1 ? h1.textContent.trim() : null,
      wordmarkFamily: used,
      wordmarkWidth: h1 ? h1.getBoundingClientRect().width : null,
    };
  })())`).then(JSON.parse);

  // The control: an undefined family must measure exactly as Georgia does. If it does
  // not, canvas font parsing is not doing what this check assumes and the comparison
  // below would be meaningless.
  check('the measurement control holds (an unknown family falls back to Georgia exactly)',
    Math.abs(metrics.sansCheck - metrics.fallback) < 0.01,
    `${metrics.sansCheck.toFixed(2)}px vs ${metrics.fallback.toFixed(2)}px`);

  const delta = Math.abs(metrics.display - metrics.fallback);
  check('the wordmark is drawn with Playfair glyphs, not the Georgia fallback',
    delta > 1,
    `"no-nonogram" at 800: ${metrics.display.toFixed(2)}px in ${FAMILY} vs ` +
    `${metrics.fallback.toFixed(2)}px in Georgia — ${delta.toFixed(2)}px apart`);

  check('the wordmark element still asks for the display stack',
    (metrics.wordmarkFamily ?? '').includes(FAMILY),
    `.brand h1 "${metrics.wordmarkText}" → ${metrics.wordmarkFamily}`);

  const errors = page.errors().filter((e) => !e.includes('favicon.ico'));
  check('no console errors while loading the face', errors.length === 0,
    errors.length ? errors.join(' | ') : '0');

  if (shot) {
    mkdirSync(dirname(shot), { recursive: true });
    writeFileSync(shot, Buffer.from(await page.screenshot(), 'base64'));
    process.stdout.write(`\n  wrote ${shot}\n`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    base: BASE, viewport: viewportId, family: FAMILY, expectBytes: EXPECT_BYTES,
    faces: loaded.faces, fontRequests: res, metrics, checks,
  }, null, 2));
  process.stdout.write(`  wrote ${OUT}\n`);
} finally {
  await browser.close();
}

process.exitCode = report().length ? 1 : 0;
