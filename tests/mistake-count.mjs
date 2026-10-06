// tests/mistake-count.mjs — is the product's `mistakes` counter a usable aiming signal?
//
// DOO-8 report §18.6 needed a unit-stable misaim metric. `corrections` in playtest.mjs
// counts *taps* and its predicate widened between runs, so it cannot compare across the
// two desktop passes. `record.mistakes` looked like the answer: the product itself counts
// "how many cells did you get wrong", at most once per attempt, committed only when the
// player leaves a wrong fill standing (state/attempt.js header).
//
// But the recorded desktop run reports mistakes on puzzles that were solved *perfectly*:
// l1-flag is 9 needed cells, 9 clicks, 0 corrective taps, 0 wrong cells, solved -- and
// `mistakes: 7`. 378 mistakes across 947 cells over the 24 puzzles. Either the harness
// mis-aimed far more than `corrections` admits, or the counter over-reports.
//
// This runs in node with no browser: state/ is DOM- and THREE-free by design, so it
// cannot disturb the measurement chain holding :4294. It drives the real createSession +
// createAttempt and plays a flawless solve -- every tap lands on a cell the solution
// wants, in order, exactly once. A flawless solve must charge zero mistakes.
//
// Usage: node tests/mistake-count.mjs

import { createSession } from '../state/session.js';
import { createAttempt } from '../state/attempt.js';
import { setStorage } from '../state/progress.js';
import { findPuzzle } from '../levels.js';

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

let failures = 0;
const check = (name, pass, detail) => {
  console.log(`${pass ? ' ok  ' : ' FAIL'} ${name}${detail === undefined ? '' : `  — ${detail}`}`);
  if (!pass) failures++;
};

// A flawless solve: tap each cell the solution wants, once, in index order. No cell the
// solution rejects is ever touched, so `wrongFill` can never be true.
function flawless(id, { reopen = 1 } = {}) {
  setStorage(memoryStorage());
  const spec = findPuzzle(id).spec;
  let clock = 0;
  const tick = () => (clock += 10);

  const session = createSession(spec);
  const wanted = [...session.solution].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  // `reopen` models what the browser harness does between taps: it re-opens the puzzle to
  // re-aim the camera. Each open builds a fresh attempt over the *same* session state.
  let attempt = createAttempt({ session, now: tick });
  attempt.resume();
  let opens = 1;

  wanted.forEach((i, n) => {
    if (reopen > 1 && n > 0 && n % reopen === 0) {
      attempt.flush();
      attempt.dispose();
      attempt = createAttempt({ session, now: tick });
      attempt.resume();
      opens++;
    }
    session.cycle(i); // BLANK -> FILLED, and this cell is one the solution wants
  });
  attempt.flush();
  const out = { mistakes: attempt.mistakes(), solved: session.solved, cells: wanted.length, opens };
  attempt.dispose();
  return out;
}

console.log('# flawless solve must charge 0 mistakes\n');
for (const id of ['l1-flag', 'l1-plus', 'l3-bird', 'l4-castle']) {
  const r = flawless(id);
  check(
    `${id}: flawless solve charges no mistakes`,
    r.mistakes === 0,
    `${r.cells} cells, solved=${r.solved}, mistakes=${r.mistakes}`,
  );
}

// The dedup set `charged` is per-attempt but `mistakes` is loaded from the stored record,
// so re-opening a puzzle mid-solve could re-charge a cell already paid for. A flawless
// solve has nothing to charge either way, which isolates reopening from real misaims.
console.log('\n# re-opening the puzzle mid-solve must not invent mistakes\n');
for (const reopen of [1, 2, 5]) {
  const r = flawless('l3-bird', { reopen });
  check(
    `l3-bird: ${r.opens} attempt(s) over one flawless solve`,
    r.mistakes === 0,
    `mistakes=${r.mistakes}`,
  );
}

// A genuine misaim: fill a cell the solution rejects, then move on. That is the one thing
// that *should* cost exactly one mistake, and it pins the counter as working at all.
console.log('\n# a real wrong fill, left standing, costs exactly 1\n');
{
  setStorage(memoryStorage());
  const session = createSession(findPuzzle('l1-flag').spec);
  let clock = 0;
  const attempt = createAttempt({ session, now: () => (clock += 10) });
  attempt.resume();
  const rejected = [...session.solution].findIndex((v) => !v);
  const wanted = [...session.solution].findIndex((v) => v);
  session.cycle(rejected); // BLANK -> FILLED on a cell the answer rejects
  session.cycle(wanted); // touching a different cell commits the pending wrong fill
  attempt.flush();
  check('one wrong fill left standing charges 1', attempt.mistakes() === 1, `mistakes=${attempt.mistakes()}`);
  attempt.dispose();
}

// Cycling the same wrong cell onward (FILLED -> MARKED) is the player correcting
// themselves before moving on, and the header says it costs nothing.
{
  setStorage(memoryStorage());
  const session = createSession(findPuzzle('l1-flag').spec);
  let clock = 0;
  const attempt = createAttempt({ session, now: () => (clock += 10) });
  attempt.resume();
  const rejected = [...session.solution].findIndex((v) => !v);
  session.cycle(rejected); // -> FILLED (wrong)
  session.cycle(rejected); // -> MARKED (self-corrected before moving on)
  session.cycle([...session.solution].findIndex((v) => v));
  attempt.flush();
  check('self-corrected wrong fill is free', attempt.mistakes() === 0, `mistakes=${attempt.mistakes()}`);
  attempt.dispose();
}

// The magnitude of the recorded 378 only means something if one misaimed cell cannot be
// billed twice. `mistakes` survives a re-open (it is loaded from the stored record) while
// the `charged` dedup set does not, so a cell already paid for in attempt 1 is unknown to
// attempt 2. Pin that it still cannot be re-charged while it stands wrong.
console.log('\n# a cell already charged must not be billed again after a re-open\n');
{
  setStorage(memoryStorage());
  const session = createSession(findPuzzle('l1-flag').spec);
  let clock = 0;
  const tick = () => (clock += 10);
  const rejected = [...session.solution].findIndex((v) => !v);
  const wantedCells = [...session.solution].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

  let attempt = createAttempt({ session, now: tick });
  attempt.resume();
  session.cycle(rejected); // wrong fill
  session.cycle(wantedCells[0]); // commits it -> 1
  const afterFirst = attempt.mistakes();
  attempt.flush();
  attempt.dispose();

  // Re-open over the same board, with the wrong cell still standing FILLED.
  attempt = createAttempt({ session, now: tick });
  attempt.resume();
  session.cycle(wantedCells[1]); // touch elsewhere; the wrong cell is untouched
  session.cycle(wantedCells[2]);
  attempt.flush();
  check(
    'standing wrong cell is not re-charged by a new attempt',
    attempt.mistakes() === afterFirst,
    `after first=${afterFirst}, after re-open=${attempt.mistakes()}`,
  );
  attempt.dispose();
}

// The one that decides whether the recorded 378 means anything. `locate()` in
// playtest.mjs finds which pixel maps to which cell by *tapping* candidate cells and then
// restoring the board with `session().set(...)`. Both the tap and the restore go through
// session `set`, which emits the same 'cell' event `attempt.onCell` listens to. So a probe
// that brushes a cell the solution rejects looks exactly like a player filling it and
// moving on -- and gets billed. If this charges, the browser run's `mistakes` is measuring
// the harness's instrumentation, not the player's aim.
console.log('\n# why `mistakes` cannot be the aiming metric: probes are billed too\n');
{
  setStorage(memoryStorage());
  const session = createSession(findPuzzle('l1-flag').spec);
  let clock = 0;
  const attempt = createAttempt({ session, now: () => (clock += 10) });
  attempt.resume();
  const rejected = [...session.solution].map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const probed = rejected[0];
  const parked = rejected[1];

  // What `locate` does: fill a candidate to see where it lands, touch another cell, then
  // put the board back exactly as it was.
  session.set(probed, 1); // probe fills a rejected cell
  session.set(parked, 1); // the park/next probe -- a different cell, so the first commits
  session.set(probed, 0); // probe restores
  session.set(parked, 0); // park released
  attempt.flush();

  const charged = attempt.mistakes();
  // This is NOT a product bug, and the assertion says so by expecting the charge. The
  // counter is specified against session `set`, and a probe's `set` is indistinguishable
  // from a player's by design -- `state/attempt.js` has no notion of "who did this". What
  // it proves is that `record.mistakes` from a *probed* playthrough measures the harness,
  // so it cannot serve as the aiming metric §18.6 went looking for. Report defect G.
  check(
    'probe tap + full restore IS billed — mistakes is instrumentation-contaminated',
    charged === 2,
    `mistakes=${charged} with the board fully restored ` +
      `(probed=${session.state[probed]}, parked=${session.state[parked]})`,
  );
  attempt.dispose();
}

// The one production path shaped like a probe: reopening a saved board that has a wrong
// fill standing on it. If restore replayed through `set`, every reload would re-bill the
// player. It does not -- `createSession` builds the board with `Uint8Array.from(saved.state)`
// and fires no 'cell' events -- and this pins that, because it is a save/restore edge case
// the issue asks about, not just an implementation detail.
console.log('\n# restoring a saved board with a standing wrong cell bills nothing\n');
{
  const store = memoryStorage();
  setStorage(store);
  const spec = findPuzzle('l1-flag').spec;
  let clock = 0;
  const tick = () => (clock += 10);

  const first = createSession(spec);
  const rejected = [...first.solution].findIndex((v) => !v);
  const wanted = [...first.solution].findIndex((v) => v);
  const a1 = createAttempt({ session: first, now: tick });
  a1.resume();
  first.cycle(rejected); // wrong fill
  first.cycle(wanted); // commits it
  a1.flush();
  const before = a1.mistakes();
  a1.dispose();

  // Reload: a brand new session + attempt over the same storage, wrong cell still filled.
  const second = createSession(spec);
  const a2 = createAttempt({ session: second, now: tick });
  a2.resume();
  a2.flush();
  check(
    'reload does not re-bill a wrong cell already on the saved board',
    a2.mistakes() === before && second.state[rejected] === 1,
    `before=${before}, after reload=${a2.mistakes()}, restored cell=${second.state[rejected]}`,
  );
  a2.dispose();
}

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
