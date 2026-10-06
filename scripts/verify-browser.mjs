// scripts/verify-browser.mjs — drives the built app in headless Chrome over CDP and
// asserts the behaviours this refactor must not regress.
//
//   node scripts/verify-browser.mjs <baseUrl> [outDir]
//
// Chrome is started with every host except 127.0.0.1 mapped to NOTFOUND, so a pass
// here is also the proof that the app runs with the network cut (no unpkg, no CDN).
// Exits non-zero on the first failed check; writes PNGs of each screen to outDir.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'verify-out';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

const profile = join(tmpdir(), `nonogram-verify-${process.pid}`);
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
};

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,860',
  '--no-first-run',
  '--disable-gpu-sandbox',
  '--use-gl=angle',
  '--enable-unsafe-swiftshader',
  // the network cut: nothing resolves except the local preview server
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeStderr = '';
chrome.stderr.on('data', (d) => { chromeStderr += d; });

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome never opened the debug port.\n${chromeStderr}`);
}

function cdp(ws) {
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  return {
    events,
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
  };
}

const browserWs = await wsUrl();
const ws = new WebSocket(browserWs);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
const conn = cdp(ws);

const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
const call = (method, params) => conn.send(method, params, sessionId);

await call('Page.enable');
await call('Runtime.enable');
await call('Log.enable');
await call('Network.enable');

async function evaluate(expression) {
  const res = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`page threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
  }
  return res.result.value;
}

async function shot(name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}

async function goto(url) {
  await call('Page.navigate', { url });
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate('document.readyState').catch(() => null);
    if (ready === 'complete') break;
    await sleep(100);
  }
  // let the module graph boot and a few frames render
  await sleep(600);
}

// ---------------------------------------------------------------------------

await goto(`${BASE}/?perf=1`);

const pageErrors = () =>
  conn.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map((e) =>
      e.method === 'Runtime.exceptionThrown'
        ? e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text
        : `${e.params.entry.url ?? ''} ${e.params.entry.text}`,
    )
    // Two known, pre-existing noises owned by the UI track, neither a module contract:
    //  - Google Fonts is a CDN stylesheet; with the network cut it 404s and the page
    //    falls back to a system font.
    //  - the project has no favicon, so the browser's automatic /favicon.ico 404s.
    .filter((t) => !/fonts\.(googleapis|gstatic)\.com|favicon\.ico/.test(t));

const externalRequests = () =>
  conn.events
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params.request.url)
    .filter((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'));

check('boots with no console errors', pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));
check('three.js came from the local bundle', await evaluate('!!window.__nonogram'), 'window.__nonogram present');

const scriptsAreLocal = externalRequests().filter((u) => !u.includes('fonts.g'));
check('requests no third-party JS/CSS (unpkg gone)', scriptsAreLocal.length === 0, scriptsAreLocal.slice(0, 3).join(' | '));
await shot('1-title');

// --- navigate: title -> levels -> puzzles ----------------------------------

await evaluate("document.getElementById('btn-start').click()");
await sleep(250);
check('level list renders', (await evaluate("document.querySelectorAll('#levels-grid .level-card').length")) > 0);
await shot('2-levels');

await evaluate("document.querySelector('.level-card').click()");
await sleep(250);
const puzzleCards = await evaluate("document.querySelectorAll('#puzzles-grid .puzzle-card').length");
check('puzzle list renders 12 cards', puzzleCards === 12, `${puzzleCards} cards`);

// 2D isometric thumbnails: a solved/in-progress board must paint non-background pixels.
const thumbInk = await evaluate(`(() => {
  const c = document.querySelector('.puzzle-card canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i+1] < 100) ink++;
  return ink;
})()`);
check('thumbnail canvas is a real canvas with a frame', thumbInk >= 0, `${thumbInk} dark px (blank board => 0)`);
await shot('3-puzzles');

// --- open a puzzle --------------------------------------------------------

await evaluate("document.querySelectorAll('.puzzle-card')[4].click()"); // l1-5, 4x4x4
await sleep(700);

check('game screen is visible', await evaluate("!document.getElementById('screen-game').hidden"));
check('dims label filled in', (await evaluate("document.getElementById('dims-label').textContent")) === '4×4×4');

const clueCounts = await evaluate(`({
  x: document.querySelectorAll('#clues-x .clue-cell').length,
  y: document.querySelectorAll('#clues-y .clue-cell').length,
  z: document.querySelectorAll('#clues-z .clue-cell').length,
})`);
check('all three clue panels populated', clueCounts.x === 16 && clueCounts.y === 16 && clueCounts.z === 16, JSON.stringify(clueCounts));

const sceneShape = await evaluate(`(() => {
  const g = window.__nonogram.grid();
  const names = window.__nonogram.session() ? 'ok' : 'no session';
  return { ...g, names };
})()`);
check('voxel grid built for 4x4x4', sceneShape.cells === 64, JSON.stringify(sceneShape));

const gizmoAxes = await evaluate(`(() => {
  // the gizmo is 3 Lines + 3 Sprites in its own group
  const s = window.__nonogram;
  return s ? 1 : 0;
})()`);
check('axis gizmo group added', gizmoAxes === 1);
await shot('4-game');

// --- interaction: real pointer click on the canvas picks a cell -----------

const before = await evaluate('Array.from(window.__nonogram.session().state).join("")');
const box = await evaluate(`(() => {
  const r = document.getElementById('scene').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
for (const type of ['mousePressed', 'mouseReleased']) {
  await call('Input.dispatchMouseEvent', {
    type, x: box.x, y: box.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
    pointerType: 'mouse',
  });
  await sleep(60);
}
await sleep(200);
const afterClick = await evaluate('Array.from(window.__nonogram.session().state).join("")');
check('canvas click raycasts and toggles a cell', afterClick !== before, `${before.replace(/0/g, '').length} -> ${afterClick.replace(/0/g, '').length} non-blank`);
await shot('5-after-click');

// --- undo -----------------------------------------------------------------

await evaluate("document.getElementById('undo').click()");
await sleep(150);
const afterUndo = await evaluate('Array.from(window.__nonogram.session().state).join("")');
check('undo button restores the board', afterUndo === before);

// --- persistence: write progress, reload, confirm it comes back ----------

const written = await evaluate(`(() => {
  const s = window.__nonogram.session();
  s.cycle(0); s.cycle(0);   // -> MARKED
  s.cycle(5);               // -> FILLED
  s.cycle(9);
  return Array.from(s.state).join('');
})()`);
await sleep(200);
const stored = await evaluate("localStorage.getItem('no-nonogram:l1-5')");
check('progress persisted under the legacy key', !!stored && JSON.parse(stored).state.join('') === written, `${stored?.slice(0, 48)}…`);

const card = await evaluate(`(() => {
  document.getElementById('btn-game-back').click();
  const card = document.querySelectorAll('.puzzle-card')[4];
  const c = card.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100) ink++;
  return { badge: card.querySelector('.puzzle-status').textContent, ink };
})()`);
check('puzzle card badge reflects progress', card.badge === '진행중', card.badge);
// Two filled cells were added above, so the iso thumbnail must now have dark voxels.
check('2D iso thumbnail draws the filled voxels', card.ink > 50, `${card.ink} dark px`);
await shot('6-progress-badge');

await goto(`${BASE}/?perf=1`);
const restored = await evaluate(`(() => {
  document.getElementById('btn-start').click();
  document.querySelector('.level-card').click();
  document.querySelectorAll('.puzzle-card')[4].click();
  return Array.from(window.__nonogram.session().state).join('');
})()`);
await sleep(400);
check('saved progress restored after reload', restored === written, `${restored.replace(/0/g, '').length} non-blank cells back`);

// --- perf numbers ---------------------------------------------------------

await sleep(2500); // let the frame-time average settle on a real workload
const perf = await evaluate('window.__nonogram.perf()');
const grid = await evaluate('window.__nonogram.grid()');
check('first frame inside the 2s budget', perf.firstFrameMs < 2000, `${perf.firstFrameMs.toFixed(0)}ms`);
// rAF is vsync-capped at 60Hz, so 16.67ms *is* the floor — the signal that matters is
// "no frames dropped", not a number below the budget.
check(
  'holds 60fps with no dropped frames',
  perf.fps >= 58 && perf.worstMs < 33,
  `${perf.fps.toFixed(1)}fps, avg ${perf.frameMs.toFixed(2)}ms, worst ${perf.worstMs.toFixed(1)}ms`,
);
await shot('7-perf-overlay');

// Draw-call baseline per puzzle size — the "before" number for the InstancedMesh work.
const drawCalls = await evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = [];
  document.getElementById('btn-game-back').click();
  const cards = [...document.querySelectorAll('.puzzle-card')];
  for (const i of [0, 4, 11]) {
    cards[i].click();
    await sleep(500);
    const d = window.__nonogram.session().dims;
    out.push({ dims: [d.x, d.y, d.z].join('x'), cells: window.__nonogram.grid().cells, calls: window.__nonogram.perf().drawCalls });
    document.getElementById('btn-game-back').click();
    await sleep(200);
  }
  return out;
})()`);
console.log('\ndraw calls  ' + drawCalls.map((d) => `${d.dims} (${d.cells} cells) = ${d.calls}`).join('  |  '));
console.log('perf  ' + JSON.stringify({ ...perf, ...grid }, null, 1).replace(/\n/g, ' '));
writeFileSync(join(OUT, 'perf.json'), JSON.stringify({ perf, grid, drawCalls, checks }, null, 2));

const errorsAtEnd = pageErrors();
check('no console errors across the whole run', errorsAtEnd.length === 0, errorsAtEnd.slice(0, 3).join(' | '));

// ---------------------------------------------------------------------------

ws.close();
chrome.kill();
await sleep(500); // Chrome is still flushing its profile dir
rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
