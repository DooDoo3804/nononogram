#!/usr/bin/env node
// tests/clue-legibility.mjs — **can a person actually read the clues, and can they tell
// which way the box is facing while they rotate it?**
//
//   npm run build && npx vite preview --port 4373 --host 127.0.0.1 &
//   node tests/clue-legibility.mjs http://127.0.0.1:4373 qa-out/clues
//
// Optional trailing args: viewport labels to narrow the matrix.
//
//   node tests/clue-legibility.mjs http://127.0.0.1:4373 qa-out/clues pixel iphone-se
//
// ## The gap this is written for
//
// DOO-8 asks for the distance between "the solver proved it unique" and "a human can
// actually solve it", and names two things the solver structurally cannot see: clue
// legibility, and losing your orientation mid-rotation. Every gate in `tests/` so far
// measures the *board* — `playtest reach` asks which cells a pointer can address,
// `board-viewport` asks how much screen the canvas gets, `thumb-framing` asks about the
// menu thumbnails. None of them read a single clue number.
//
// That matters because the clue numbers are not decoration: they are the entire input
// to the puzzle. A board with perfect 28x28px cells is unplayable if the numbers beside
// it are 6px, clipped, or the same colour as their background. The solver reads `cells`;
// the player reads the three tables.
//
// ## What is measured, and where the pass lines come from
//
// **A. Legibility** — per viewport, per box size, per axis, for every clue number:
//
//   font size      `getComputedStyle(span).fontSize`, in CSS px, and again in device px
//                  (CSS px * DPR). Text is DOM, not canvas, so it is *not* subject to
//                  the renderer's MAX_PIXEL_RATIO cap of 2 — a DPR-3 phone rasterises
//                  these glyphs at 3x. Both numbers are reported because the CSS px one
//                  is what angular size depends on (how big it looks at arm's length)
//                  and the device px one is what glyph fidelity depends on.
//   contrast       WCAG 2.1 relative-luminance ratio of the number against the cell it
//                  sits in, with `opacity` composited in — `.clue-num--done` carries
//                  `opacity: 0.45`, which no naive `color` vs `background-color` read
//                  would account for, and which is exactly the kind of thing that turns
//                  a 7:1 palette into a 2:1 one on screen.
//   clipping       `scrollWidth > clientWidth` on the cell. This is the only one of the
//                  three that is outright information *loss* rather than strain: a
//                  clipped "12" can read as "1", and the player has no way to know.
//   scroll-to-read `scrollWidth/scrollHeight > client*` on the grid and the panel. Not a
//                  defect — the panel is deliberately `overflow: auto` so a 6-wide table
//                  fits a phone — but it is a real cost, so it is counted and reported
//                  rather than hidden.
//
// The pass lines are platform conventions, not invented here:
//
//   >= 4.5:1 contrast   WCAG 2.1 SC 1.4.3 for normal-size text. The large-text 3:1
//                       exemption needs >=18.66px bold, and these numbers are nowhere
//                       near that, so 4.5 is the applicable line. It is also the line
//                       `tests/axis-colors.test.js` already holds the axis palette to,
//                       so the two agree by construction.
//   >= 11 CSS px        Apple HIG's minimum legible type (11pt). Advisory, not gating:
//                       see "Why the font line is advisory" below.
//   >= 12 CSS px        Material's `caption` (12sp). Reported alongside 11 so the
//                       number can be read against either convention.
//   0 clipped           gating. Information loss, not strain.
//
// ### Why the font line is advisory and the contrast line is not
//
// A number below 11px is small; a number at 2:1 contrast or clipped in half is *wrong*.
// Only the second kind can be called a defect from a measurement alone — "11pt" is a
// comfort recommendation with no failure mode attached, while a clipped digit and a
// sub-4.5:1 glyph have one. So font size is measured, reported to one decimal, and
// flagged `advisory`; contrast and clipping gate. Raising an advisory to a blocker is a
// severity call that belongs to the issue thread, not to this file (QA charter: do not
// move a bug's severity alone).
//
// **B. The axis a table claims is the axis it shows.**
//
// Each axis's clue table has one correct shape, fixed by the box dims — see
// `expectedShape()` for where it comes from and for the wrong-oracle false alarm the
// first draft of this check produced. Counting the rendered grid's rows and columns is
// what says whether the table under the "Y" heading really is the Y table; a swapped or
// transposed axis in `ui/clues.js`'s `render()` would show up here and nowhere else.
// Checked against the clue *data contract* rather than against `view.facingAxis()`: a
// gate that compared the DOM to the same function that wrote it would pass on any
// self-consistent mislabelling, which is the bug it would exist to catch.
//
// **C. Rotating never leaves you without an orientation cue.**
//
// `ui/clues.js` puts `.clue-panel--active` on the axis the camera looks most along, and
// that highlight is the game's answer to "which way am I facing?". Orbiting through
// eight azimuths asserts two things about it: it is never absent, and it is not frozen
// (it takes at least two distinct values across a full turn). This deliberately does not
// assert *which* axis is correct at each azimuth — the camera's own start azimuth and
// OrbitControls' damping make that a renderer-internals question — but a cue that is
// missing or stuck is a cue that cannot orient anyone, and both of those are visible
// from the outside.

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from '../scripts/cdp.mjs';

// --- the viewport matrix -----------------------------------------------------
// Deliberately a copy of `tests/board-viewport.mjs`'s VIEWPORTS rather than an import:
// that module runs its sweep at top level, so importing the constant would launch a
// second Chrome and run the whole 591-check matrix as a side effect. Keep the two lists
// identical — they are meant to describe the same claimed-supported set of devices.
const VIEWPORTS = [
  { label: 'iphone-se',      group: 'se',     orient: 'portrait',  width: 375, height: 667,  deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'galaxy-s',       group: 'galaxy', orient: 'portrait',  width: 360, height: 740,  deviceScaleFactor: 3,     mobile: true,  touch: true },
  { label: 'iphone-pro',     group: 'pro',    orient: 'portrait',  width: 393, height: 852,  deviceScaleFactor: 3,     mobile: true,  touch: true },
  { label: 'pixel',          group: 'pixel',  orient: 'portrait',  width: 412, height: 915,  deviceScaleFactor: 2.625, mobile: true,  touch: true },
  { label: 'pixel-land',     group: 'pixel',  orient: 'landscape', width: 915, height: 412,  deviceScaleFactor: 2.625, mobile: true,  touch: true },
  { label: 'iphone-se-land', group: 'se',     orient: 'landscape', width: 667, height: 375,  deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'ipad',           group: 'ipad',   orient: 'portrait',  width: 768, height: 1024, deviceScaleFactor: 2,     mobile: true,  touch: true },
  { label: 'desktop',        group: 'desk',   orient: 'landscape', width: 1280, height: 860, deviceScaleFactor: 1,    mobile: false, touch: false },
];

const WCAG_NORMAL = 4.5;  // SC 1.4.3, normal-size text
const HIG_MIN_PT = 11;    // Apple HIG minimum legible type
const MATERIAL_CAPTION = 12;

const AXES = ['y', 'x', 'z'];

/**
 * The (cols, rows) a correct clue table has, from the box dims alone.
 *
 * Straight off `solver.js`'s `otherDims` — `{ x: [y, z], y: [x, z], z: [x, y] }`, outer
 * index `a` first — because that is the contract `computeClues` writes and `ui/clues.js`
 * renders with `a` as the row and `b` as the column (`gridTemplateColumns:
 * repeat(grid[0].length)`). So rows = the first entry, cols = the second.
 *
 * The first draft of this guessed the shape geometrically instead ("looking down Y you
 * see the x-z face, so x columns by z rows") and reported 12 failures on non-cubic
 * boxes — every one a clean transpose with the right cell count, and the X axis never
 * among them. That pattern is the signature of a wrong oracle, not a wrong product:
 * a real axis mix-up would land on X too and would not conserve the cell count. Kept
 * here because the shape is only meaningful against the data contract — whether the
 * table's *on-screen* orientation matches the board is camera-dependent (the box
 * rotates freely; no fixed table orientation can match every azimuth), which is what
 * part C's cue-liveness check covers instead.
 */
function expectedShape(axis, d) {
  if (axis === 'x') return { rows: d.y, cols: d.z };
  if (axis === 'y') return { rows: d.x, cols: d.z };
  return { rows: d.x, cols: d.y }; // z
}

// --- in-page probe -----------------------------------------------------------
// Reads computed style and geometry off the live clue tables. Everything here is
// measurement; nothing mutates game state except `show(axis)`, which clicks the real
// tab button the way a player would.
const PROBE = `(() => {
  const canvas = document.getElementById('scene');
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  function fire(type, px, py, extra = {}) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: px, clientY: py, bubbles: true, cancelable: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, view: window, ...extra,
    }));
  }

  /** Same drag arithmetic as tests/playtest.mjs: dx of clientHeight px == 2*pi azimuth. */
  function orbitBy(dx, dy, steps = 8) {
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    fire('pointerdown', cx, cy, { button: 0, buttons: 1 });
    for (let n = 1; n <= steps; n++)
      fire('pointermove', cx + (dx * n) / steps, cy + (dy * n) / steps, { button: -1, buttons: 1 });
    fire('pointerup', cx + dx, cy + dy, { button: 0, buttons: 0 });
  }

  const parseRGB = (s) => {
    const m = String(s).match(/-?[\\d.]+/g);
    if (!m) return null;
    const [r, g, b, a = 1] = m.map(Number);
    return { r, g, b, a };
  };

  /** WCAG 2.1 relative luminance of an 8-bit sRGB triple. */
  function lum({ r, g, b }) {
    const f = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  /** Composite \`fg\` over \`bg\` at \`alpha\` — what \`opacity\` actually puts on screen. */
  const over = (fg, bg, alpha) => ({
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  });

  /** Walk up for the nearest ancestor with a non-transparent background. */
  function effectiveBg(el) {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const c = parseRGB(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.99) return c;
    }
    return parseRGB(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  }

  /** The accumulated opacity between \`el\` and the panel — opacity multiplies down. */
  function chainOpacity(el) {
    let o = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const v = Number(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) o *= v;
      if (n.classList?.contains('clue-panel')) break;
    }
    return o;
  }

  return {
    wide: window.matchMedia('(min-width: 980px) and (min-height: 750px)').matches,

    /** Open one axis's table the way a player does — by clicking its tab. */
    show(axis) {
      const tab = document.getElementById('clue-tab-' + axis);
      const panel = document.getElementById('clue-panel-' + axis);
      if (tab && getComputedStyle(document.getElementById('clue-tabs')).display !== 'none') tab.click();
      return !!panel && getComputedStyle(panel).display !== 'none'
        && panel.classList.contains('clue-panel--shown');
    },

    /** Which axis currently carries the orientation highlight, if any. */
    activeAxis() {
      for (const a of ['x', 'y', 'z'])
        if (document.getElementById('clue-panel-' + a)?.classList.contains('clue-panel--active')) return a;
      return null;
    },

    orbit(fraction) {
      const r = canvas.getBoundingClientRect();
      orbitBy(fraction * r.height, 0);
    },

    /** Every clue number in one axis's table, measured. */
    read(axis) {
      const grid = document.getElementById('clues-' + axis);
      const panel = document.getElementById('clue-panel-' + axis);
      if (!grid || !panel) return { error: 'no grid for ' + axis };

      const cells = [...grid.querySelectorAll('.clue-cell')];
      const cs = getComputedStyle(grid);
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
      const rows = cols ? Math.round(cells.length / cols) : 0;

      const nums = [];
      for (const cell of cells) {
        const cellBg = effectiveBg(cell);
        const clipped = cell.scrollWidth > cell.clientWidth + 0.5
          || cell.scrollHeight > cell.clientHeight + 0.5;
        for (const span of cell.querySelectorAll('span')) {
          const st = getComputedStyle(span);
          const fg = parseRGB(st.color);
          const alpha = chainOpacity(span) * (fg?.a ?? 1);
          const r = span.getBoundingClientRect();
          nums.push({
            text: span.textContent,
            done: span.classList.contains('clue-num--done'),
            fontPx: parseFloat(st.fontSize),
            weight: st.fontWeight,
            w: +r.width.toFixed(1),
            h: +r.height.toFixed(1),
            contrast: fg ? +ratio(over(fg, cellBg, alpha), cellBg).toFixed(2) : null,
            alpha: +alpha.toFixed(3),
            clipped,
          });
        }
      }
      return {
        cells: cells.length, cols, rows, nums,
        gridScrollX: grid.scrollWidth > grid.clientWidth + 1,
        panelScrollX: panel.scrollWidth > panel.clientWidth + 1,
        panelScrollY: panel.scrollHeight > panel.clientHeight + 1,
      };
    },
  };
})()`;

const SEED_ALL_CLEARED = `(() => {
  let n = 0;
  for (const level of window.__nonogram.levels())
    for (const p of level.puzzles) {
      const cells = p.dims.x * p.dims.y * p.dims.z;
      localStorage.setItem('no-nonogram:' + p.id,
        JSON.stringify({ state: new Array(cells).fill(0), solved: true }));
      n++;
    }
  return n;
})()`;

const CATALOGUE = `(() => {
  const out = [];
  window.__nonogram.levels().forEach((level, li) =>
    level.puzzles.forEach((p, pi) =>
      out.push({ levelIndex: li, puzzleIndex: pi, id: p.id, dims: p.dims })));
  return out;
})()`;

const dimsKey = (d) => `${d.x}x${d.y}x${d.z}`;

/** Walk the real menu to a puzzle, the way a player does. */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }) {
  await page.evaluate(`(() => {
    localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});
    const show = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    show('#levels-grid .level-card', ${levelIndex});
    show('#puzzles-grid .puzzle-card', ${puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 15_000 },
  );
  await sleep(350); // let OrbitControls' damping settle where frameCamera put it
}

// --- run ---------------------------------------------------------------------

const BASE = process.argv[2] ?? 'http://127.0.0.1:4373';
const OUT = process.argv[3] ?? 'qa-out/clues';
const only = process.argv.slice(4).filter((a) => !a.startsWith('-'));

mkdirSync(OUT, { recursive: true });
const { check, report, checks } = checklist();

const browser = await launchChrome({ offline: true, windowSize: '1280,900' });
const page = await browser.newPage();
const results = [];

try {
  let catalogue = null;

  for (const vp of VIEWPORTS) {
    if (only.length && !only.includes(vp.label)) continue;

    await page.emulate(vp);
    await page.goto(`${BASE}/`);
    await page.evaluate('localStorage.clear()');
    await page.evaluate(SEED_ALL_CLEARED);
    await page.goto(`${BASE}/`);

    catalogue ??= await page.evaluate(CATALOGUE);
    // One puzzle per distinct box size: the box is what drives how many numbers have to
    // share a panel, so 3x3x2 through 6x6x6 is the whole interesting range.
    const bySize = new Map();
    for (const e of catalogue) if (!bySize.has(dimsKey(e.dims))) bySize.set(dimsKey(e.dims), e);

    console.log(`\n${vp.label}  ${vp.width}x${vp.height} @${vp.deviceScaleFactor}  (${vp.orient})`);

    for (const [key, entry] of bySize) {
      await openPuzzle(page, entry);
      await page.evaluate(`window.__clue = ${PROBE}`);
      const wide = await page.evaluate('window.__clue.wide');

      for (const axis of AXES) {
        const shown = await page.evaluate(`window.__clue.show(${JSON.stringify(axis)})`);
        check(`[clue] ${vp.label} ${key} ${axis}: the table can be brought on screen`, shown,
          wide ? 'wide layout, all three panels shown' : 'via its tab');
        if (!shown) continue;

        const m = await page.evaluate(`JSON.stringify(window.__clue.read(${JSON.stringify(axis)}))`)
          .then(JSON.parse);
        if (m.error) { check(`[clue] ${vp.label} ${key} ${axis}: table present`, false, m.error); continue; }

        const live = m.nums.filter((n) => !n.done);
        const minFont = Math.min(...m.nums.map((n) => n.fontPx));
        const minContrast = live.length ? Math.min(...live.map((n) => n.contrast)) : null;
        const doneContrast = m.nums.filter((n) => n.done).length
          ? Math.min(...m.nums.filter((n) => n.done).map((n) => n.contrast)) : null;
        const clipped = m.nums.filter((n) => n.clipped);
        const want = expectedShape(axis, entry.dims);

        // B — the table under this heading is the table this axis should have.
        check(`[clue] ${vp.label} ${key} ${axis}: table is ${want.cols}x${want.rows}, as the box dims require`,
          m.cols === want.cols && m.rows === want.rows,
          `got ${m.cols}x${m.rows} (${m.cells} cells)`);

        // A — the three legibility reads.
        check(`[clue] ${vp.label} ${key} ${axis}: no clue number is clipped`,
          clipped.length === 0,
          clipped.length ? `${clipped.length} clipped, first "${clipped[0].text}"` : `${m.nums.length} numbers`);

        if (minContrast !== null) {
          check(`[clue] ${vp.label} ${key} ${axis}: unsolved numbers clear ${WCAG_NORMAL}:1`,
            minContrast >= WCAG_NORMAL, `min ${minContrast}:1 over the cell`);
        }
        if (doneContrast !== null) {
          check(`[clue] ${vp.label} ${key} ${axis}: struck-through numbers stay re-readable (3:1)`,
            doneContrast >= 3, `min ${doneContrast}:1 (opacity composited)`, { advisory: true });
        }
        check(`[clue] ${vp.label} ${key} ${axis}: numbers reach ${HIG_MIN_PT}px (HIG minimum type)`,
          minFont >= HIG_MIN_PT,
          `${minFont.toFixed(2)} CSS px = ${(minFont * vp.deviceScaleFactor).toFixed(1)} device px` +
            `, Material caption line is ${MATERIAL_CAPTION}`,
          { advisory: true });

        results.push({
          viewport: vp.label, dims: key, axis, wide,
          cells: m.cells, cols: m.cols, rows: m.rows, numbers: m.nums.length,
          minFontCssPx: +minFont.toFixed(2),
          minFontDevicePx: +(minFont * vp.deviceScaleFactor).toFixed(1),
          minContrastLive: minContrast, minContrastDone: doneContrast,
          clipped: clipped.length,
          gridScrollX: m.gridScrollX, panelScrollX: m.panelScrollX, panelScrollY: m.panelScrollY,
        });

        console.log(
          `  ${axis}  ${key.padEnd(6)} ${String(m.cols) + 'x' + String(m.rows)}` +
            `  nums=${String(m.numbers ?? m.nums.length).padStart(3)}` +
            `  font=${minFont.toFixed(2)}css/${(minFont * vp.deviceScaleFactor).toFixed(1)}dev` +
            `  contrast=${minContrast ?? '-'}` +
            `  clipped=${clipped.length}` +
            `  scroll=${m.panelScrollX ? 'x' : ''}${m.panelScrollY ? 'y' : ''}${!m.panelScrollX && !m.panelScrollY ? '-' : ''}`,
        );
      }
    }

    // C — rotating keeps an orientation cue alive. Once per viewport, on the largest
    // box: the cue is a property of the layout and the camera, not of the puzzle.
    const biggest = [...bySize.values()].at(-1);
    await openPuzzle(page, biggest);
    await page.evaluate(`window.__clue = ${PROBE}`);
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await page.evaluate(`window.__clue.orbit(${i / 8})`);
      await sleep(260); // damping; this is a cue-liveness read, not a timing measurement
      seen.push(await page.evaluate('window.__clue.activeAxis()'));
    }
    const nulls = seen.filter((a) => a === null).length;
    const distinct = new Set(seen.filter(Boolean));
    check(`[orient] ${vp.label}: an axis cue is on screen at every azimuth`, nulls === 0,
      `${8 - nulls}/8 azimuths highlighted, saw ${[...distinct].join('/') || 'none'}`);
    check(`[orient] ${vp.label}: the cue tracks rotation (not frozen on one axis)`, distinct.size >= 2,
      `${distinct.size} distinct over a full turn: ${seen.join(',')}`);
    results.push({ viewport: vp.label, orient: { seen, nulls, distinct: [...distinct] } });
  }

  writeFileSync(join(OUT, 'clue-legibility.json'), JSON.stringify({ results, checks }, null, 2));
  const failed = report();
  await browser.close();
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  console.error(err);
  writeFileSync(join(OUT, 'clue-legibility.json'), JSON.stringify({ results, checks, error: String(err) }, null, 2));
  await browser.close();
  process.exit(2);
}
