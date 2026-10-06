// scripts/probe-peel-ui.mjs — does the on-screen depth cursor actually exist, on each
// layout, and does a real tap on it move the cursor? (DOO-28)
//
// DOO-17 proved the *mechanism*: peeling the front layers off the box takes `l4-cat`
// from 26 of its 112 required cells reachable to all 112. It proved that with real
// `[`/`]` key events, which is why the number is trustworthy and also why the feature
// did not exist on a phone — there is no key to press. So the claim this probe has to
// carry is a different one, and it is a UI claim:
//
//   a real tap, at the control's own pixels, through Chrome's own hit-testing,
//   moves `window.__nonogram.peel().depth`
//
// Everything else here guards the ways a control in a 48px band fails without anyone
// noticing: it overflows the band and pushes a sibling off-screen, it lands under
// another control, it shrinks below the thumb floor, or the readout drifts away from the
// cursor it is reporting. Each of those is a check, on each of four layouts.
//
// Deliberately *not* re-measuring cell apertures: `probe-aim.mjs` owns that number and
// re-deriving it here would give the project two answers to one question.
//
// Usage
//   npm run build && npx vite preview --port 4473 --strictPort --host 127.0.0.1
//   node scripts/probe-peel-ui.mjs http://127.0.0.1:4473 verify-out/peel-ui.json
//
// Writes the JSON plus one PNG per layout next to it. `--layouts=` narrows the run,
// `--puzzle=` picks the board (default `l4-cat`, the 6³ the issue quotes).

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join, basename, extname } from 'node:path';
import { launchChrome, checklist } from './cdp.mjs';

/** The thumb floor. The segments are judged on their own box, not on a board cell. */
const FINGER_PX = 44;
/** Chrome rounds a rect's CSS px off the device pixel grid; 1px of slack absorbs it. */
const EPS = 1.01;

const LAYOUTS = [
  // The viewport DOO-17's table was measured on.
  { id: 'desktop', width: 1280, height: 860, deviceScaleFactor: 1, mobile: false, touch: false },
  // Pixel-class Android portrait — the layout the issue says the feature was missing on.
  { id: 'phone', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, touch: true },
  // The narrowest viewport the project claims, and the one the band can overflow on:
  // undo + this pill + fx's hint/mute pair across 344px of usable width.
  { id: 'phone-narrow', width: 360, height: 640, deviceScaleFactor: 3, mobile: true, touch: true },
  // Landscape, where style.css stands the bands up into rails and the pill with them.
  { id: 'landscape', width: 740, height: 360, deviceScaleFactor: 3, mobile: true, touch: true },
];

const [BASE = 'http://127.0.0.1:4473', OUT = 'verify-out/peel-ui.json', ...flags] = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const wanted = flag('layouts', LAYOUTS.map((l) => l.id).join(',')).split(',').filter(Boolean);
const puzzleId = flag('puzzle', 'l4-cat');

const shotPath = (id) =>
  join(dirname(OUT), `${basename(OUT, extname(OUT))}-${id}.png`);

// --- in-page readers -----------------------------------------------------------
// Geometry only, off `getBoundingClientRect`, so what is reported is what Chrome laid
// out rather than what the stylesheet asked for.

const RECTS = `(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             x: +b.left.toFixed(1), y: +b.top.toFixed(1), hidden: !b.width && !b.height };
  };
  const band = document.querySelector('#screen-game .band--bottom');
  return {
    band: r('#screen-game .band--bottom'),
    // A band that scrolls is a band that has pushed something past its edge. Both axes,
    // because the landscape clause turns this row into a column.
    overflowX: band ? band.scrollWidth - band.clientWidth : null,
    overflowY: band ? band.scrollHeight - band.clientHeight : null,
    peel: r('#peel'),
    less: r('#peel-less'),
    more: r('#peel-more'),
    readout: r('#peel-readout'),
    undo: r('#undo'),
    coach: r('#peel-coach'),
    canvas: r('#scene'),
    others: [...document.querySelectorAll('#screen-game .band--bottom button')]
      .filter((el) => !el.closest('#peel') && !el.closest('#peel-coach'))
      .map((el) => {
        const b = el.getBoundingClientRect();
        return { id: el.id || el.textContent.trim().slice(0, 2),
                 x: +b.left.toFixed(1), y: +b.top.toFixed(1),
                 w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
      }),
  };
})()`;

const READOUT = `(() => {
  const t = (id) => document.getElementById(id)?.textContent ?? null;
  const next = document.getElementById('peel-next');
  return {
    axis: t('peel-axis'),
    depth: t('peel-depth'),
    live: t('peel-live'),
    nextAxis: t('peel-next-axis'),
    nextShown: next ? getComputedStyle(next).visibility === 'visible' : null,
    moreDisabled: !!document.getElementById('peel-more')?.disabled,
    lessDisabled: !!document.getElementById('peel-less')?.disabled,
    resetDisabled: !!document.getElementById('peel-readout')?.disabled,
    coachOpen: document.getElementById('peel-coach')
      ? !document.getElementById('peel-coach').hidden : null,
    ui: window.__nonogram.peelUi(),
    cursor: window.__nonogram.peel(),
  };
})()`;

/** Spin the camera through OrbitControls, so the facing axis really changes. */
const ORBIT = `((dx, dy) => {
  const canvas = document.getElementById('scene');
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;
  const b = canvas.getBoundingClientRect();
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  const fire = (type, x, y, extra) => canvas.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y, ...extra,
  }));
  fire('pointerdown', cx, cy, { button: 0, buttons: 1 });
  for (let n = 1; n <= 8; n++)
    fire('pointermove', cx + (dx * n) / 8, cy + (dy * n) / 8, { button: -1, buttons: 1 });
  fire('pointerup', cx + dx, cy + dy, { button: 0, buttons: 0 });
  return true;
})`;

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

/** Walk the real menu to a puzzle, dropping its own save so it opens playable. */
async function openPuzzle(page, { levelIndex, puzzleIndex, id }) {
  await page.evaluate(`(() => {
    localStorage.removeItem('no-nonogram:' + ${JSON.stringify(id)});
    const click = (sel, i) => {
      const els = document.querySelectorAll(sel);
      if (!els[i]) throw new Error('no element ' + i + ' for ' + sel);
      els[i].click();
    };
    document.getElementById('btn-start').click();
    click('#levels-grid .level-card', ${levelIndex});
    click('#puzzles-grid .puzzle-card', ${puzzleIndex});
  })()`);
  await page.waitFor(
    `(() => { const s = window.__nonogram.session(); return !!s && s.spec.id === ${JSON.stringify(id)}; })()`,
    { timeoutMs: 15_000 },
  );
  await sleep(350); // let OrbitControls' damping settle where frameCamera put it
}

/** A real tap or click at a client pixel, through Chrome's own hit-testing. */
async function realTap(page, touch, px, py) {
  if (touch) {
    const points = [{ x: px, y: py, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
    await page.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
    await page.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await page.call('Input.dispatchMouseEvent', {
        type, x: px, y: py, button: 'left', clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0, pointerType: 'mouse',
      });
    }
  }
  await sleep(90); // the control repaints synchronously; this is for the WebGL frame
}

const tapCenter = (page, touch, rect) =>
  realTap(page, touch, Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2));

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// --- run -----------------------------------------------------------------------

const { check, report } = checklist();
const browser = await launchChrome({ offline: true });
const page = await browser.newPage();

await page.goto(BASE);
check('the app booted', await page.evaluate('!!window.__nonogram'), BASE);
check(
  'the readout is readable from the page',
  !!(await page.evaluate('typeof window.__nonogram.peelUi === "function"')),
  '__nonogram.peelUi()',
);

const seeded = await page.evaluate(SEED_ALL_CLEARED);
const catalogue = await page.evaluate(CATALOGUE);
const target = catalogue.find((p) => p.id === puzzleId);
if (!target) throw new Error(`no puzzle "${puzzleId}" — have ${catalogue.map((p) => p.id).join(', ')}`);

const dimsLabel = `${target.dims.x}×${target.dims.y}×${target.dims.z}`;
process.stdout.write(
  `\n  depth cursor, on-screen control — ${puzzleId} ${dimsLabel}\n` +
  `  gl=${await page.glRenderer()}  ${seeded} puzzles seeded\n\n`,
);

const results = {};

for (const layout of LAYOUTS.filter((l) => wanted.includes(l.id))) {
  const tag = `[${layout.id}]`;
  await page.emulate(layout);
  // Clearing the flag is not enough to re-arm the lesson: `ui/peel.js` reads it once at
  // mount and then keeps its own in-memory copy, so a card already shown this session
  // stays shown-once even if the key comes back. That is the behaviour we want in play
  // and it means every layout needs a fresh page to prove the card renders in its band.
  await page.evaluate(`localStorage.removeItem('no-nonogram:@coach')`);
  await page.goto(BASE);
  await page.evaluate(SEED_ALL_CLEARED);
  await openPuzzle(page, target);
  await sleep(250);

  const rects = await page.evaluate(RECTS);
  const r = { ...rects };
  const row = { layout: layout.id, viewport: `${layout.width}×${layout.height}`, rects: r };

  // 1. It is there at all, and it is inside the band rather than spilling out of it.
  check(`${tag} the stepper is laid out`, !!r.peel && r.peel.w > 0 && r.peel.h > 0,
    r.peel ? `${r.peel.w}×${r.peel.h}` : 'missing');
  check(`${tag} the band does not overflow`, r.overflowX <= 0 && r.overflowY <= 0,
    `scroll − client = ${r.overflowX}px × ${r.overflowY}px`);

  // 2. Every segment clears the thumb floor on at least the axis the pill is laid out
  //    along, and 44px on the other. A pill is one object with no dead gaps between its
  //    segments, so the floor applies to the short side.
  const segs = { less: r.less, readout: r.readout, more: r.more };
  const short = Object.entries(segs).map(([k, s]) => [k, Math.min(s.w, s.h)]);
  check(
    `${tag} every segment clears ${FINGER_PX}px on its short side`,
    short.every(([, px]) => px + EPS >= FINGER_PX),
    short.map(([k, px]) => `${k} ${px}px`).join(', '),
  );
  const areas = Object.entries(segs).map(([k, s]) => [k, Math.round(s.w * s.h)]);
  row.segments = Object.fromEntries(areas);

  // 3. Nothing in the band sits on top of anything else — the failure that makes a
  //    control look present and tap like its neighbour.
  const collisions = r.others.filter((o) => o.w > 0 && overlaps(r.peel, o)).map((o) => o.id);
  check(`${tag} no overlap with the band's other controls`, collisions.length === 0,
    collisions.length ? `overlaps ${collisions.join(', ')}` : `clear of ${r.others.length} others`);
  check(`${tag} clear of the board`, !overlaps(r.peel, r.canvas),
    `pill ${r.peel.x},${r.peel.y} ${r.peel.w}×${r.peel.h} vs canvas ${r.canvas.x},${r.canvas.y} ${r.canvas.w}×${r.canvas.h}`);

  // 4. The lesson. First level-3-or-deeper board of the session, so it should be up.
  const opened = await page.evaluate(READOUT);
  row.coachOnOpen = opened.coachOpen;
  check(`${tag} the lesson is showing on this board`, opened.coachOpen === true,
    `level ${target.levelIndex + 1}, coach ${opened.coachOpen}`);
  const coach = (await page.evaluate(RECTS)).coach;
  check(`${tag} the card is on screen`,
    !!coach && coach.x >= -EPS && coach.y >= -EPS &&
      coach.x + coach.w <= layout.width + EPS && coach.y + coach.h <= layout.height + EPS,
    coach ? `${coach.x},${coach.y} ${coach.w}×${coach.h} in ${layout.width}×${layout.height}` : 'missing');
  row.coachRect = coach;

  await page.screenshot().then((png) => writeFileSync(shotPath(`${layout.id}-coach`), png));

  // 5. The claim. A real tap on `+`, and the cursor moves.
  const before = opened.cursor.depth;
  await tapCenter(page, layout.touch, r.more);
  let after = await page.evaluate(READOUT);
  check(`${tag} a real ${layout.touch ? 'tap' : 'click'} on + peels a layer`,
    after.cursor.depth === before + 1, `depth ${before} → ${after.cursor.depth}`);
  check(`${tag} the tap also dismissed the lesson`, after.coachOpen === false,
    `coach ${after.coachOpen}`);

  // 6. And the readout reports the cursor it just moved, rather than its own idea of it.
  await tapCenter(page, layout.touch, r.more);
  after = await page.evaluate(READOUT);
  const want = `${after.cursor.depth}/${after.cursor.max}`;
  check(`${tag} the readout matches the cursor`,
    after.depth === want && after.axis === after.cursor.axis.toUpperCase(),
    `shows "${after.axis} ${after.depth}", cursor is ${after.cursor.axis} ${want}`);
  row.afterTwoTaps = { depth: after.depth, axis: after.axis, live: after.live };

  await page.screenshot().then((png) => writeFileSync(shotPath(layout.id), png));

  // 7. `−` and the readout-as-reset, which is the only way back to the whole board
  //    without a keyboard.
  await tapCenter(page, layout.touch, r.less);
  const stepped = await page.evaluate(READOUT);
  check(`${tag} − covers a layer back up`, stepped.cursor.depth === after.cursor.depth - 1,
    `depth ${after.cursor.depth} → ${stepped.cursor.depth}`);
  await tapCenter(page, layout.touch, r.readout);
  const resetted = await page.evaluate(READOUT);
  check(`${tag} the readout resets to the whole board`,
    resetted.cursor.depth === 0 && resetted.cursor.window === null &&
      resetted.lessDisabled && resetted.resetDisabled,
    `depth ${resetted.cursor.depth}, window ${JSON.stringify(resetted.cursor.window)}`);

  // 8. The re-aim warning. Peel, turn the camera to a different face, and the arrow has
  //    to appear — it is the only notice the player gets that the next press jumps.
  await tapCenter(page, layout.touch, r.more);
  const peeledAxis = (await page.evaluate(READOUT)).cursor.axis;
  let turned = null;
  for (const [dx, dy] of [[260, 0], [-260, 0], [0, 180]]) {
    await page.evaluate(`(${ORBIT})(${dx}, ${dy})`);
    await sleep(400);
    turned = await page.evaluate(READOUT);
    if (turned.cursor.axis !== peeledAxis || turned.nextShown) break;
  }
  const faceMoved = turned.ui.pending !== null;
  check(`${tag} turning the camera raises the "next press switches face" arrow`,
    faceMoved && turned.nextShown === true &&
      turned.axis === peeledAxis.toUpperCase() &&
      turned.nextAxis === turned.ui.pending.toUpperCase(),
    faceMoved
      ? `peeled ${turned.axis}, next ${turned.nextAxis}, arrow ${turned.nextShown}`
      : `camera never left the ${peeledAxis} face — orbit did not take`);
  row.afterTurn = {
    axis: turned.axis, depth: turned.depth, nextAxis: turned.nextAxis,
    nextShown: turned.nextShown, live: turned.live,
  };
  await page.screenshot().then((png) => writeFileSync(shotPath(`${layout.id}-reaim`), png));

  // 9. Second level-3 board of the session: the lesson is spent.
  await openPuzzle(page, target);
  await sleep(200);
  const second = await page.evaluate(READOUT);
  check(`${tag} the lesson does not come back`, second.coachOpen === false,
    `coach ${second.coachOpen}`);
  row.coachOnSecondOpen = second.coachOpen;
  // A new board zeroes the cursor, so the readout has to have come back with it.
  check(`${tag} a new board resets the readout`,
    second.cursor.depth === 0 && second.depth.startsWith('0/'),
    `cursor ${second.cursor.depth}, readout "${second.depth}"`);

  // 10. The band at its fullest. "Solved! 🎉" is the longest the status line ever gets,
  //     and on a 360px band it does not fit beside undo, this pill and fx's hint/mute
  //     pair — so the pill stands down. Solved through the session's own `set`, which
  //     is what fires the real `solved` event and the real `hud.setStatus`.
  await page.evaluate(`(() => {
    const s = window.__nonogram.session();
    for (let i = 0; i < s.solution.length; i++) if (s.solution[i]) s.set(i, 1);
    return s.solved;
  })()`);
  await sleep(200);
  const solved = await page.evaluate(`(() => {
    const band = document.querySelector('#screen-game .band--bottom');
    const peel = document.getElementById('peel');
    return {
      status: document.getElementById('status').textContent,
      flagged: band.classList.contains('band--solved'),
      peelShown: peel.getBoundingClientRect().width > 0,
      overflowX: band.scrollWidth - band.clientWidth,
      overflowY: band.scrollHeight - band.clientHeight,
    };
  })()`);
  check(`${tag} the solved band still fits`,
    solved.flagged && !solved.peelShown && solved.overflowX <= 0 && solved.overflowY <= 0,
    `"${solved.status}", stepper ${solved.peelShown ? 'shown' : 'stood down'}, ` +
    `overflow ${solved.overflowX}×${solved.overflowY}px`);
  row.solvedBand = solved;
  await page.screenshot().then((png) => writeFileSync(shotPath(`${layout.id}-solved`), png));

  results[layout.id] = row;
  process.stdout.write('\n');
}

// The webfont 404 is this probe's own doing: `offline: true` is what makes the run
// reproducible, and it is the same request `verify-browser.mjs` asserts the page
// *survives*. Filtered here so the check means "the control threw nothing", which is
// what it is for. Favicon likewise.
const errors = page.errors().filter((e) => !/favicon|fonts\.(googleapis|gstatic)\.com/.test(e));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

const glRenderer = await page.glRenderer();
const failed = report();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify({ base: BASE, puzzle: puzzleId, dims: dimsLabel, glRenderer, fingerFloorPx: FINGER_PX, layouts: results, errors }, null, 2)}\n`,
);
process.stdout.write(`  wrote ${OUT} and ${Object.keys(results).length * 3} screenshots\n`);

await browser.close();
process.exit(failed ? 1 : 0);
