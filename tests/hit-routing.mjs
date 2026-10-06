#!/usr/bin/env node
// tests/hit-routing.mjs — QA: when a real click lands on the board, does the *browser*
// route it to the board?
//
//   npm run build && npx vite preview --port 4291 --strictPort --host 127.0.0.1 &
//   node tests/hit-routing.mjs http://127.0.0.1:4291 qa-out/hit-routing.json
//
// ## Why this exists, separately from `playtest.mjs`
//
// `playtest.mjs` builds its reach map with **synthetic** PointerEvents dispatched
// straight at the canvas (`canvas.dispatchEvent`). Those run the production listener,
// the production raycast and the production session, which is what makes the map
// trustworthy about *geometry* — but they never ask Chrome's hit-testing where the
// pixel belongs, because dispatching on a node skips targeting entirely.
//
// `realTap` does the opposite: `Input.dispatchMouseEvent` is a real OS-level event, so
// it is targeted the way a player's click is. Anything painted over the canvas
// therefore intercepts it.
//
// So the two disagree exactly when something covers the board, and that disagreement is
// a playability bug a geometry sweep cannot see: the cell is *there*, the aperture is
// large, and the click still does not reach it. DOO-8's `play` run surfaced it as
// unexplainable misses — 4 cells on `l1-chair`, 2 on `l1-stairs`, 4 on `l1-arch`, all
// at `cost=2` steps, all with apertures of 15,700-16,300px² (about 125x125 CSS px), all
// at y = 770-774 on an 860-tall viewport. A 125px target is not missed for being small.
//
// This script asks the one question that separates the two explanations, at the exact
// pixels that failed: `document.elementFromPoint(x, y)`. A DOM overlay's position does
// not depend on the 3D camera, so no sweep replay is needed to answer it.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

const [BASE = 'http://127.0.0.1:4291', OUT = 'qa-out/hit-routing.json'] = process.argv.slice(2);

// The pixels `play` reported as misses, read straight out of its own JSON, plus the
// recorded map pixel they were re-localized from. Hard-coded on purpose: these are the
// coordinates of a specific observed failure, and the point is to interrogate *them*.
const MISS_PIXELS = [
  { label: 'l1-chair/l1-arch cell 3', map: [517, 770], play: [514, 773] },
  { label: 'l1-chair/l1-arch cell 5', map: [517, 770], play: [513, 774] },
  { label: 'l1-chair/l1-stairs/l1-arch cell 21', map: [527, 770], play: [523, 774] },
  { label: 'l1-chair/l1-stairs/l1-arch cell 23', map: [507, 770], play: [504, 773] },
];

const PLATFORMS = {
  desktop: { label: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, touch: false },
  mobile: { label: 'mobile', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, touch: true, cpuThrottle: 4 },
};

const describe = `((x, y) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return { none: true };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const canvas = document.getElementById('scene');
  const cr = canvas.getBoundingClientRect();
  return {
    tag: el.tagName, id: el.id, cls: el.className?.toString?.() ?? '',
    isCanvas: el === canvas,
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position,
    canvasRect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)],
    insideCanvas: x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom,
    // The chain up from the hit element, so an overlay is identifiable even when the
    // thing physically hit is an inner span.
    chain: (() => {
      const out = []; let n = el;
      for (let i = 0; i < 5 && n && n !== document.body; i++, n = n.parentElement) {
        out.push((n.tagName || '') + (n.id ? '#' + n.id : '') + (n.className?.toString?.() ? '.' + n.className.toString().trim().split(/\\s+/).join('.') : ''));
      }
      return out;
    })(),
  };
})`;

const openFirstPuzzle = `(() => {
  document.getElementById('btn-start').click();
  document.querySelectorAll('#levels-grid .level-card')[0].click();
  document.querySelectorAll('#puzzles-grid .puzzle-card')[1].click();
  return true;
})()`;

const browser = await launchChrome({ offline: true, windowSize: '1280,860' });
const { check, report, checks } = checklist();
const findings = [];

for (const platform of Object.values(PLATFORMS)) {
  const page = await browser.newPage();
  await page.emulate(platform);
  await page.goto(`${BASE}/?perf=1`);
  await page.evaluate('localStorage.clear()');
  await page.goto(`${BASE}/?perf=1`);
  await page.evaluate(openFirstPuzzle);
  await page.waitFor('(() => { const s = window.__nonogram.session(); return !!s; })()');

  console.log(`\n=== ${platform.label} ${platform.width}x${platform.height} ===\n`);

  // What covers the canvas at all, independent of the specific failing pixels: walk a
  // grid over the canvas and record every pixel the browser does *not* route to it.
  const sweep = await page.evaluate(`(() => {
    const canvas = document.getElementById('scene');
    const r = canvas.getBoundingClientRect();
    const blocked = [];
    let total = 0;
    for (let y = Math.ceil(r.top); y < r.bottom; y += 8) {
      for (let x = Math.ceil(r.left); x < r.right; x += 8) {
        total++;
        const el = document.elementFromPoint(x, y);
        if (el !== canvas) {
          blocked.push({ x, y, tag: el ? el.tagName : null, id: el ? el.id : null,
            cls: el ? (el.className?.toString?.() ?? '') : null });
        }
      }
    }
    return { total, blocked };
  })()`);

  const byOwner = new Map();
  for (const b of sweep.blocked) {
    const key = `${b.tag}${b.id ? '#' + b.id : ''}${b.cls ? '.' + b.cls.trim().split(/\s+/).join('.') : ''}`;
    const e = byOwner.get(key) ?? { count: 0, minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity };
    e.count++;
    e.minY = Math.min(e.minY, b.y); e.maxY = Math.max(e.maxY, b.y);
    e.minX = Math.min(e.minX, b.x); e.maxX = Math.max(e.maxX, b.x);
    byOwner.set(key, e);
  }

  console.log(`  canvas grid: ${sweep.total} sample pixels, ${sweep.blocked.length} not routed to #scene` +
    ` (${((sweep.blocked.length / sweep.total) * 100).toFixed(1)}%)`);
  for (const [owner, e] of [...byOwner.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`    ${String(e.count).padStart(5)} px  x ${e.minX}-${e.maxX}  y ${e.minY}-${e.maxY}  <- ${owner}`);
  }

  check(`${platform.label}: every pixel of the canvas routes a real click to the board`,
    sweep.blocked.length === 0,
    `${sweep.blocked.length}/${sweep.total} sampled pixels land on something else: ` +
      [...byOwner.keys()].slice(0, 4).join(' | '));

  findings.push({ platform: platform.label, blockedSamples: sweep.blocked.length,
    totalSamples: sweep.total, owners: Object.fromEntries(byOwner) });

  // Now the specific pixels `play` failed on. Desktop only — the misses were recorded
  // at a desktop viewport and the coordinates mean nothing on a 412px-wide screen.
  if (platform.label === 'desktop') {
    for (const m of MISS_PIXELS) {
      const atPlay = await page.evaluate(`${describe}(${m.play[0]}, ${m.play[1]})`);
      const atMap = await page.evaluate(`${describe}(${m.map[0]}, ${m.map[1]})`);
      console.log(`\n  ${m.label}`);
      console.log(`    map px  [${m.map}]  -> ${atMap.tag}${atMap.id ? '#' + atMap.id : ''}` +
        `${atMap.cls ? '.' + atMap.cls : ''}  isCanvas=${atMap.isCanvas} insideCanvas=${atMap.insideCanvas}`);
      console.log(`    play px [${m.play}] -> ${atPlay.tag}${atPlay.id ? '#' + atPlay.id : ''}` +
        `${atPlay.cls ? '.' + atPlay.cls : ''}  isCanvas=${atPlay.isCanvas} insideCanvas=${atPlay.insideCanvas}`);
      console.log(`    canvas rect [${atPlay.canvasRect}]  hit rect [${atPlay.rect}]` +
        `  pointer-events=${atPlay.pointerEvents} z=${atPlay.zIndex} pos=${atPlay.position}`);
      console.log(`    chain: ${atPlay.chain.join(' < ')}`);
      check(`desktop: a real click at the recorded pixel for ${m.label} reaches the board`,
        atPlay.isCanvas, `routed to ${atPlay.tag}${atPlay.id ? '#' + atPlay.id : ''}${atPlay.cls ? '.' + atPlay.cls : ''}`);
      findings.push({ platform: 'desktop', pixel: m, atPlay, atMap });
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ findings, checks }, null, 2));
console.log(`\nwrote ${OUT}`);
report();
