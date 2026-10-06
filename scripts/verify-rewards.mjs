#!/usr/bin/env node
// scripts/verify-rewards.mjs — the DOO-6 gate: drives the built app in headless Chrome
// and proves every acceptance criterion of the reward layer on the real thing.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/verify-rewards.mjs http://127.0.0.1:4173 rewards-out
//
// It checks, and screenshots:
//
//   clear celebration   the shape assembles, the card names it, stats are on it
//   staged hints        stage 1 highlights a line, stage 2 places a correct cell
//   records             timer runs, mistakes count, best time persists over a reload
//   unlocks             levels 2-4 start locked with a progress badge, and open on score
//   sound               starts muted, the toggle flips and survives a reload
//   migration           a pre-DOO-6 localStorage payload still loads, and is not
//                       corrupted by the new writer
//
// Nothing here hard-codes the catalogue: puzzle ids, names and dims are read off the
// running app, so the puzzle track can keep editing shapes without reddening this gate.

import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { launchChrome, checklist } from './cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const OUT = process.argv[3] ?? 'rewards-out';

mkdirSync(OUT, { recursive: true });
const { check, report } = checklist();

// This gate's browser must be its own: the platform gate also uses CDP, and attaching to
// a browser another run started would inherit that run's profile *and its seeded
// progress*, so every unlock check would see a fully-cleared game. It is now structural
// rather than a `port: 9444` request that `launchChrome` quietly ignored — the transport
// is a private pipe to a browser with a throwaway profile, with no port to share (DOO-37).
const browser = await launchChrome({ offline: true });
const page = await browser.newPage();
const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), await page.screenshot());

const IGNORED_NOISE = /fonts\.(googleapis|gstatic)\.com|favicon\.ico/;
const pageErrors = () => page.errors().filter((t) => !IGNORED_NOISE.test(t));

/**
 * Reload onto a known-empty save. Every phase below states its own preconditions
 * rather than inheriting the previous phase's — that is what makes the unlock and
 * migration checks mean anything.
 */
async function fresh(seed = null) {
  await page.goto(`${BASE}/`);
  await page.evaluate('localStorage.clear()');
  if (seed) await page.evaluate(seed);
  await page.goto(`${BASE}/`);
  return page.evaluate('JSON.stringify(Object.keys(localStorage))');
}

// --- helpers -------------------------------------------------------------------

const openLevels = () => page.evaluate("document.getElementById('btn-start').click()");
const clickLevel = (i) =>
  page.evaluate(`document.querySelectorAll('#levels-grid > *')[${i}].click()`);
const clickPuzzle = (i) =>
  page.evaluate(`document.querySelectorAll('#puzzles-grid > *')[${i}].click()`);
const hudText = () =>
  page.evaluate(
    `[...document.querySelectorAll('#screen-game .fx-stat')].map((e) => e.textContent).join(' | ')`,
  );

/** Seed storage directly, the way a returning player's browser would already look. */
const seedSolved = (ids) =>
  page.evaluate(`(() => {
    for (const id of ${JSON.stringify(ids)}) {
      const total = window.__nonogram.levels()
        .flatMap((l) => l.puzzles).find((p) => p.id === id);
      const n = total.dims.x * total.dims.y * total.dims.z;
      localStorage.setItem('no-nonogram:' + id, JSON.stringify({
        state: new Array(n).fill(0), solved: true,
      }));
    }
    return true;
  })()`);

// ============================================================================
// 1. boot
// ============================================================================

const bootStorage = await fresh();
check('starts from an empty save', bootStorage === '[]', bootStorage);
check('boots with no console errors', pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));
check('reward layer mounted', await page.evaluate('!!window.__nonogram.rewards'), '__nonogram.rewards');
check(
  'reward stylesheet injected, not added to style.css',
  await page.evaluate("!!document.getElementById('fx-rewards-styles')"),
  '#fx-rewards-styles',
);

// ============================================================================
// 2. unlocks — the level grid starts gated
// ============================================================================

await openLevels();
await sleep(350);

const lockState = await page.evaluate(`(() => {
  const cards = [...document.querySelectorAll('#levels-grid > *')];
  return {
    count: cards.length,
    locked: cards.map((c) => c.classList.contains('fx-locked')),
    badges: cards.map((c) => c.querySelector('.fx-lock-badge')?.textContent?.trim() ?? null),
    unlocks: window.__nonogram.rewards.unlocks(),
  };
})()`);

check(
  'level 1 open, every later level locked on a fresh save',
  lockState.locked[0] === false && lockState.locked.slice(1).every(Boolean),
  JSON.stringify(lockState.locked),
);
check(
  'a locked level shows how far off it is, not just a padlock',
  lockState.badges.slice(1).every((b) => /\d+\s*\/\s*\d+/.test(b ?? '')),
  JSON.stringify(lockState.badges),
);
check(
  'unlock requirement comes from the difficulty score',
  lockState.unlocks.every((u) => u.total > 0 && u.required > 0 && u.required < u.total),
  lockState.unlocks.map((u) => `${u.levelId}:${u.earned}/${u.required} of ${u.total}`).join(' '),
);
await shot('1-levels-locked');

// A locked level refuses to open, and says why.
await clickLevel(lockState.count - 1);
await sleep(300);
const refusal = await page.evaluate(`(() => {
  const t = document.querySelector('.fx-toast');
  return {
    onLevels: !document.getElementById('screen-levels').hidden,
    toast: t && !t.hidden ? t.textContent : null,
  };
})()`);
check('clicking a locked level does not open it', refusal.onLevels, 'still on the level screen');
check('and explains the gate', /\d+점/.test(refusal.toast ?? ''), refusal.toast ?? '(no toast)');
await shot('2-locked-refusal');

// ============================================================================
// 3. the game HUD: timer, mistakes, hint and mute controls
// ============================================================================

await clickLevel(0);
await sleep(300);
await clickPuzzle(0);
await sleep(900);

const puzzle = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  return { id: s.spec.id, name: s.spec.name ?? null, dims: s.dims, cells: s.state.length };
})()`);

check(
  'HUD shows a timer and a mistake counter',
  /⏱ \d\d:\d\d/.test(await hudText()) && /✖ 0/.test(await hudText()),
  await hudText(),
);
check(
  'hint and mute buttons are present in the bottom band',
  await page.evaluate("document.querySelectorAll('#screen-game .band--bottom .fx-row button').length === 2"),
  '2 buttons',
);
check(
  'sound starts muted — 음소거 기본 존중',
  await page.evaluate(
    "document.querySelectorAll('#screen-game .fx-row button')[1].textContent === '🔇'",
  ),
  'mute icon 🔇',
);

// The timer has to actually advance.
const t0 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
await sleep(2200);
const t1 = await page.evaluate('window.__nonogram.rewards.attempt().elapsedMs()');
check('the timer runs while the board is open', t1 - t0 >= 1500, `${t0}ms -> ${t1}ms`);
await shot('3-game-hud');

// ============================================================================
// 4. staged hints
// ============================================================================

const h1 = await page.evaluate(`(() => {
  const before = Array.from(window.__nonogram.session().state).join('');
  window.__nonogram.rewards.hint();
  const s = window.__nonogram.session();
  const b = document.querySelector('.fx-banner');
  return {
    boardUnchanged: Array.from(s.state).join('') === before,
    banner: b && !b.hidden ? b.textContent : null,
    hintUses: window.__nonogram.rewards.attempt().hintUses(),
    points: window.__nonogram.rewards.attempt().hints(),
  };
})()`);

check('hint stage 1 names a line without touching the board', h1.boardUnchanged, h1.banner ?? '(no banner)');
check('stage 1 banner carries the axis, the clue and the payoff', /축.*클루.*칸/.test(h1.banner ?? ''), h1.banner);
check('stage 1 costs 1 point and counts as 1 use', h1.hintUses === 1 && h1.points === 1, `uses=${h1.hintUses} points=${h1.points}`);
await sleep(400);
await shot('4-hint-stage1');

const h2 = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  const before = Array.from(s.state).join('');
  window.__nonogram.rewards.hint();
  const after = Array.from(s.state);
  let changed = -1;
  for (let i = 0; i < after.length; i++) if (String(after[i]) !== before[i]) changed = i;
  const b = document.querySelector('.fx-banner');
  return {
    changed,
    correct: changed >= 0 ? after[changed] === (s.solution[changed] ? 1 : 2) : false,
    banner: b && !b.hidden ? b.textContent : null,
    hintUses: window.__nonogram.rewards.attempt().hintUses(),
    points: window.__nonogram.rewards.attempt().hints(),
  };
})()`);

check('hint stage 2 places exactly one cell', h2.changed >= 0, `cell ${h2.changed}`);
check('and the cell it places matches the solution', h2.correct, h2.banner ?? '');
check('stage 2 costs 2 more points — 2 uses, 3 points', h2.hintUses === 2 && h2.points === 3, `uses=${h2.hintUses} points=${h2.points}`);
await sleep(400);
await shot('5-hint-stage2');

// ============================================================================
// 5. mistakes
// ============================================================================

const mistake = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  // Two cells the solution says are empty: fill the first, then touch the second, which
  // is what "leaving a wrong fill standing" means.
  const wrong = [];
  for (let i = 0; i < s.solution.length && wrong.length < 2; i++) if (!s.solution[i]) wrong.push(i);
  s.set(wrong[0], 1);
  s.set(wrong[1], 1);
  return { mistakes: window.__nonogram.rewards.attempt().mistakes(), wrong };
})()`);
check('a wrong fill left standing counts as a mistake', mistake.mistakes >= 1, `${mistake.mistakes} on cells ${mistake.wrong}`);

const marking = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  const a = window.__nonogram.rewards.attempt();
  // Settle first. The block above deliberately left a wrong fill outstanding, and a
  // mistake is charged when the player moves off it — so the baseline has to be read
  // *after* that lands, or this check would bill the previous one's mistake to itself.
  a.flush();
  const start = a.mistakes();

  // Marking a cell "empty" has to pass through FILLED — that must stay free.
  let target = -1;
  for (let i = 0; i < s.solution.length; i++) if (!s.solution[i] && s.state[i] === 0) { target = i; break; }
  s.set(target, 1);
  s.set(target, 2);
  a.flush();
  return { before: start, after: a.mistakes(), target };
})()`);
check(
  'cycling through FILLED to leave a MARK is not a mistake',
  marking.after === marking.before,
  `${marking.before} -> ${marking.after} on cell ${marking.target}`,
);
await shot('6-mistake-counted');

// ============================================================================
// 6. the clear celebration
// ============================================================================

await page.evaluate('window.__nonogram.rewards.solveNow()');
await sleep(220);
await shot('7-clear-assembling');

await page.waitFor("document.querySelector('.fx-clear') && !document.querySelector('.fx-clear').hidden");
await sleep(700);

const card = await page.evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  return {
    open: !q('.fx-clear').hidden,
    name: q('.fx-card-name')?.textContent ?? null,
    sub: q('.fx-card-sub')?.textContent ?? null,
    bestBadge: q('.fx-card-best') && !q('.fx-card-best').hidden,
    stats: [...document.querySelectorAll('.fx-card-stat')].map((e) => e.textContent.trim()),
    spinning: !!window.__nonogram.session() && true,
    sparks: document.querySelectorAll('.fx-sparks i').length,
    // The board must now show the pure shape: no MARKED cells left on it.
    marked: Array.from(window.__nonogram.session().state).filter((v) => v === 2).length,
  };
})()`);

check('the clear card opens', card.open, 'fx-clear visible');
check('it names the shape', !!card.name && card.name === puzzle.name, `"${card.name}" (spec.name "${puzzle.name}")`);
check('it shows the dims and difficulty score', /\d+×\d+×\d+.*난이도 \d/.test(card.sub ?? ''), card.sub);
check('it shows time, mistakes and hints', card.stats.length === 3, card.stats.join(' / '));
check('a first clear is flagged as a record', card.bestBadge, '신기록 badge visible');
check('the reveal leaves the pure shape — the player’s marks are gone', card.marked === 0, `${card.marked} marked cells`);
await shot('8-clear-card');

// ============================================================================
// 7. records persist across a reload
// ============================================================================

const cleared = await page.evaluate(`(() => {
  const r = JSON.parse(localStorage.getItem('no-nonogram:' + '${puzzle.id}'));
  return { solved: r.solved, elapsedMs: r.elapsedMs, hints: r.hints, hintUses: r.hintUses, best: r.best, clears: r.clears };
})()`);
check('the clear is written to storage with its record', cleared.solved === true && cleared.best?.ms > 0, JSON.stringify(cleared));
check('hint spend is recorded — 사용 횟수', cleared.hintUses === 2 && cleared.hints === 3, `uses=${cleared.hintUses} points=${cleared.hints}`);

await page.goto(`${BASE}/`);
await openLevels();
await sleep(300);
await clickLevel(0);
await sleep(300);
await clickPuzzle(0);
await sleep(800);

const afterReload = await page.evaluate(`(() => {
  const best = window.__nonogram.rewards.attempt().best();
  const stat = [...document.querySelectorAll('#screen-game .fx-stat')].map((e) => e.textContent);
  return { best, stat };
})()`);
check('the best time survives a reload and is shown in the HUD', afterReload.best?.ms > 0 && afterReload.stat.some((s) => s.includes('🏆')), afterReload.stat.join(' | '));
await shot('9-best-shown');

// ============================================================================
// 8. sound: the mute toggle persists
// ============================================================================

await page.evaluate("document.querySelectorAll('#screen-game .fx-row button')[1].click()");
await sleep(200);
const unmuted = await page.evaluate(`(() => ({
  icon: document.querySelectorAll('#screen-game .fx-row button')[1].textContent,
  stored: JSON.parse(localStorage.getItem('no-nonogram:@settings') ?? '{}'),
}))()`);
check('the mute toggle flips', unmuted.icon === '🔈', `icon ${unmuted.icon}`);
check('and is persisted under its own settings key', unmuted.stored.muted === false, JSON.stringify(unmuted.stored));

await page.goto(`${BASE}/`);
await openLevels();
await sleep(300);
await clickLevel(0);
await sleep(250);
await clickPuzzle(0);
await sleep(700);
check(
  'the mute setting is still unmuted after a reload',
  await page.evaluate("document.querySelectorAll('#screen-game .fx-row button')[1].textContent === '🔈'"),
  'icon kept',
);

// ============================================================================
// 9. migration: a pre-DOO-6 payload
// ============================================================================

// Seeded through `fresh()`, i.e. from the title screen with no session mounted. A live
// attempt flushes its record on pagehide (that is what keeps the last seconds of the
// timer), so seeding storage underneath an open board gets promptly overwritten.
const legacySeed = `(() => {
  const p = window.__nonogram.levels()[0].puzzles[0];
  const n = p.dims.x * p.dims.y * p.dims.z;
  // Exactly what a pre-DOO-6 build wrote: board and solved flag, nothing else.
  const state = new Array(n).fill(0);
  state[0] = 1;
  state[1] = 2;
  localStorage.setItem('no-nonogram:' + p.id, JSON.stringify({ state, solved: false }));
  return true;
})()`;

await fresh(legacySeed);
const legacy = await page.evaluate(
  `localStorage.getItem('no-nonogram:' + window.__nonogram.levels()[0].puzzles[0].id)`,
);
check('seeded a legacy payload with no record fields', !legacy.includes('elapsedMs') && !legacy.includes('best'), legacy.slice(0, 60) + '…');

await openLevels();
await sleep(300);
await clickLevel(0);
await sleep(250);
await clickPuzzle(0);
await sleep(800);

const migrated = await page.evaluate(`(() => {
  const s = window.__nonogram.session();
  const a = window.__nonogram.rewards.attempt();
  return {
    restored: s.restored,
    cell0: s.state[0],
    cell1: s.state[1],
    elapsedMs: a.elapsedMs(),
    mistakes: a.mistakes(),
    best: a.best(),
    raw: localStorage.getItem('no-nonogram:' + s.spec.id),
  };
})()`);

check('a legacy board still restores', migrated.restored === true && migrated.cell0 === 1 && migrated.cell1 === 2, `restored=${migrated.restored} cells=[${migrated.cell0},${migrated.cell1}]`);
check('and reads as an empty record rather than crashing', migrated.best === null && migrated.mistakes === 0, JSON.stringify({ best: migrated.best, mistakes: migrated.mistakes }));
check(
  'the legacy payload is not rewritten with junk',
  migrated.raw.startsWith('{"state":['),
  migrated.raw.slice(0, 50) + '…',
);

// ============================================================================
// 10. unlocking a level for real
// ============================================================================

const ids = await page.evaluate('window.__nonogram.rewards.unlocks()');
const level1 = await page.evaluate("window.__nonogram.levels()[0].puzzles.map((p) => p.id)");
await page.goto(`${BASE}/`); // leave the board so no attempt can flush over the seed
await page.evaluate('localStorage.clear()');
await seedSolved(level1);
await page.goto(`${BASE}/`);
await openLevels();
await sleep(400);

const unlockedNow = await page.evaluate(`(() => {
  const cards = [...document.querySelectorAll('#levels-grid > *')];
  return {
    locked: cards.map((c) => c.classList.contains('fx-locked')),
    unlocks: window.__nonogram.rewards.unlocks(),
  };
})()`);
check(
  'clearing level 1 opens level 2',
  unlockedNow.locked[0] === false && unlockedNow.locked[1] === false,
  JSON.stringify(unlockedNow.locked),
);
check(
  'but not level 3 — the gate is per level',
  unlockedNow.locked[2] === true,
  JSON.stringify(unlockedNow.locked),
);
check(
  'level 1 earned its full score',
  unlockedNow.unlocks[0].earned === unlockedNow.unlocks[0].total,
  `${unlockedNow.unlocks[0].earned}/${unlockedNow.unlocks[0].total} (needed ${ids[0].required})`,
);
await shot('10-level2-unlocked');

// ============================================================================
// 10b. unlocking mid-level — the card must announce it without lying about the button
// ============================================================================

// Seed level 1 one puzzle short of its gate, then clear the puzzle that crosses it.
// Picking a mid-level puzzle is the point: the next-puzzle button still has somewhere
// to go, so an unlock notice that hijacked that button would send the player elsewhere.
const gateSeed = `(() => {
  const puzzles = window.__nonogram.levels()[0].puzzles;
  const u = window.__nonogram.rewards.unlocks()[0];
  const order = puzzles.map((p) => p.id);
  // Clear from the front until one more clear would pass the gate.
  const scores = window.__nonogram.rewards.unlocks();
  for (const id of order.slice(0, 3)) {
    const p = puzzles.find((q) => q.id === id);
    const n = p.dims.x * p.dims.y * p.dims.z;
    localStorage.setItem('no-nonogram:' + id, JSON.stringify({ state: new Array(n).fill(0), solved: true }));
  }
  return { required: u.required, seeded: order.slice(0, 3), total: scores[0].total };
})()`;

await fresh();
await page.evaluate(gateSeed);
await page.goto(`${BASE}/`);
await openLevels();
await sleep(300);

const beforeClear = await page.evaluate('window.__nonogram.rewards.unlocks()');
await clickLevel(0);
await sleep(300);
// The 4th puzzle: still mid-level, so "다음 퍼즐" has a real destination.
await clickPuzzle(3);
await sleep(800);
await page.evaluate('window.__nonogram.rewards.solveNow()');
await page.waitFor("document.querySelector('.fx-clear') && !document.querySelector('.fx-clear').hidden");
await sleep(800);

const unlockCard = await page.evaluate(`(() => {
  const u = document.querySelector('.fx-card-unlock');
  const next = document.querySelector('.fx-btn--primary');
  return {
    wasLocked2: true,
    nowUnlocked2: window.__nonogram.rewards.unlocks()[1].unlocked,
    notice: u && !u.hidden ? u.textContent : null,
    nextLabel: next.hidden ? null : next.textContent,
  };
})()`);

check('a mid-level clear can open the next level', beforeClear[1].unlocked === false && unlockCard.nowUnlocked2 === true, `level 2: ${beforeClear[1].unlocked} -> ${unlockCard.nowUnlocked2}`);
check('the card announces the unlock on its own line', /해금/.test(unlockCard.notice ?? ''), unlockCard.notice ?? '(no notice)');
check(
  'and the next-puzzle button still says what it does',
  unlockCard.nextLabel === '다음 퍼즐',
  unlockCard.nextLabel ?? '(hidden)',
);
await shot('10b-unlock-announced');

// ============================================================================
// 11. mobile — the celebration has to work on a phone too
// ============================================================================

await page.emulate({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await fresh();
await openLevels();
await sleep(300);
await clickLevel(0);
await sleep(300);
await clickPuzzle(0);
await sleep(800);

const mobileHud = await page.evaluate(`(() => {
  const band = document.querySelector('#screen-game .band--bottom .fx-row');
  const r = band.getBoundingClientRect();
  const btn = band.querySelector('button').getBoundingClientRect();
  return {
    inViewport: r.right <= window.innerWidth + 1 && r.left >= 0,
    tapTarget: Math.min(btn.width, btn.height),
    stats: [...document.querySelectorAll('#screen-game .fx-stat')].length,
  };
})()`);
check('the hint/mute controls stay inside a 390px viewport', mobileHud.inViewport, JSON.stringify(mobileHud));
check('their tap target clears 44px', mobileHud.tapTarget >= 44, `${mobileHud.tapTarget}px`);
await shot('11-mobile-hud');

await page.evaluate('window.__nonogram.rewards.solveNow()');
await page.waitFor("document.querySelector('.fx-clear') && !document.querySelector('.fx-clear').hidden");
await sleep(900);

const mobileCard = await page.evaluate(`(() => {
  const card = document.querySelector('.fx-card').getBoundingClientRect();
  const canvas = document.getElementById('scene').getBoundingClientRect();
  return {
    fits: card.left >= 0 && card.right <= window.innerWidth + 1 && card.bottom <= window.innerHeight + 1,
    // Room left above the card for the shape the sequence just revealed.
    shapeRoom: Math.round(card.top - canvas.top),
    name: document.querySelector('.fx-card-name').textContent,
  };
})()`);
check('the clear card fits a phone screen', mobileCard.fits, JSON.stringify(mobileCard));
check('and leaves the revealed shape visible above it', mobileCard.shapeRoom > 120, `${mobileCard.shapeRoom}px of board above the card`);
await shot('12-mobile-clear');

// ============================================================================
// 12. reduced motion — the reveal survives, the spin and sparkles do not
// ============================================================================

await page.call('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
});
await page.emulate({ width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await fresh();
await openLevels();
await sleep(300);
await clickLevel(0);
await sleep(300);
await clickPuzzle(0);
await sleep(700);

await page.evaluate('window.__nonogram.rewards.solveNow()');
await page.waitFor("document.querySelector('.fx-clear') && !document.querySelector('.fx-clear').hidden");
await sleep(500);

const reduced = await page.evaluate(`(() => ({
  motionClass: document.documentElement.classList.contains('fx-motion'),
  sparks: document.querySelectorAll('.fx-sparks i').length,
  autoRotate: !!window.__nonogram.session() && false,
  cardOpen: !document.querySelector('.fx-clear').hidden,
  name: document.querySelector('.fx-card-name').textContent,
  // The shape still gets revealed — that is the content, not the animation.
  filled: Array.from(window.__nonogram.session().state).filter((v) => v === 1).length,
}))()`);
check('prefers-reduced-motion drops the fx-motion class', reduced.motionClass === false, `fx-motion=${reduced.motionClass}`);
check('no sparkles under reduced motion', reduced.sparks === 0, `${reduced.sparks} sparks`);
check('but the card and the revealed shape still happen', reduced.cardOpen && reduced.filled > 0 && !!reduced.name, `"${reduced.name}", ${reduced.filled} cells`);
await shot('13-reduced-motion');

check('no console errors across the whole run', pageErrors().length === 0, pageErrors().slice(0, 3).join(' | '));

// --- report --------------------------------------------------------------------

console.log(`\nscreenshots in ${OUT}/`);
const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
