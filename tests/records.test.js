// tests/records.test.js — DOO-6's storage schema and the live attempt record.
//
// The first block is the migration proof: the game-design track extended the save
// payload with a timer, mistake count, hint spend and a best record, and every one of
// those additions has to be invisible to a browser that already has the old
// `{state, solved}` blob stored. Both directions are pinned here.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadProgress,
  loadRecord,
  loadSettings,
  saveProgress,
  saveRecord,
  saveSettings,
  setStorage,
} from '../state/progress.js';
import { createAttempt, formatDuration } from '../state/attempt.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

// The exact bytes a pre-DOO-6 build wrote.
const LEGACY = '{"state":[0,1,2,1],"solved":true}';

describe('save schema — backward compatibility with pre-DOO-6 data', () => {
  let store;
  beforeEach(() => {
    store = memoryStorage();
    setStorage(store);
  });

  it('reads a legacy payload as a valid, empty record', () => {
    store.map.set('no-nonogram:l1-1', LEGACY);

    expect(loadRecord('l1-1')).toEqual({
      solved: true,
      elapsedMs: 0,
      mistakes: 0,
      hints: 0,
      hintUses: 0,
      clears: 0,
      best: null,
    });
  });

  it('leaves a legacy payload byte-identical when the board is saved again', () => {
    store.map.set('no-nonogram:l1-1', LEGACY);
    saveProgress('l1-1', new Uint8Array([0, 1, 2, 1]), true);

    // No version prefix, no zero-valued record fields: the wire format is unchanged
    // for a player who has not set any record yet.
    expect(store.map.get('no-nonogram:l1-1')).toBe(LEGACY);
  });

  it('keeps the legacy board readable after records are written over it', () => {
    store.map.set('no-nonogram:l1-1', LEGACY);
    saveRecord('l1-1', { elapsedMs: 42_000, mistakes: 2, best: { ms: 42_000 } });

    // An old reader only looks at .state and .solved — both survive untouched.
    const raw = loadProgress('l1-1');
    expect(raw.state).toEqual([0, 1, 2, 1]);
    expect(raw.solved).toBe(true);
    expect(raw.elapsedMs).toBe(42_000);
  });

  it('does not let a board save stamp over an existing record', () => {
    saveRecord('l1-2', { elapsedMs: 9000, mistakes: 3, hints: 4, hintUses: 2 });
    saveProgress('l1-2', new Uint8Array([1, 1]), false);

    expect(loadRecord('l1-2')).toMatchObject({
      elapsedMs: 9000,
      mistakes: 3,
      hints: 4,
      hintUses: 2,
    });
    expect(loadProgress('l1-2').state).toEqual([1, 1]);
  });

  it('does not let a record save stamp over the board', () => {
    saveProgress('l1-3', new Uint8Array([2, 0, 1]), false);
    saveRecord('l1-3', { mistakes: 1 });

    expect(loadProgress('l1-3').state).toEqual([2, 0, 1]);
  });

  it('normalises garbage record fields instead of trusting them', () => {
    store.map.set(
      'no-nonogram:l1-4',
      JSON.stringify({
        state: [0],
        solved: false,
        elapsedMs: -5,
        mistakes: 'lots',
        hints: 1.9,
        best: { ms: 'fast' },
      }),
    );

    expect(loadRecord('l1-4')).toMatchObject({
      elapsedMs: 0,
      mistakes: 0,
      hints: 1,
      best: null,
    });
  });

  it('treats a never-played puzzle as an empty record, not null', () => {
    expect(loadRecord('never-played').best).toBeNull();
    expect(loadRecord('never-played').solved).toBe(false);
  });
});

describe('settings', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('defaults to muted — 음소거 기본 존중', () => {
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS });
    expect(loadSettings().muted).toBe(true);
  });

  it('persists a mute toggle under its own key, away from puzzle ids', () => {
    const store = memoryStorage();
    setStorage(store);
    saveSettings({ muted: false });

    expect([...store.map.keys()]).toEqual([SETTINGS_KEY]);
    expect(SETTINGS_KEY).toBe('no-nonogram:@settings');
    expect(loadSettings().muted).toBe(false);
  });

  it('falls back to the default for an unreadable settings blob', () => {
    const store = memoryStorage({ [SETTINGS_KEY]: '{oops' });
    setStorage(store);
    expect(loadSettings().muted).toBe(true);
  });
});

// --- the live attempt ----------------------------------------------------------

/** A session stub: just the surface createAttempt subscribes to. */
function fakeSession({ id = 'p1', solution = [1, 0, 1, 0], solved = false } = {}) {
  const listeners = { cell: new Set(), solved: new Set() };
  return {
    spec: { id },
    solution,
    state: new Uint8Array(solution.length),
    solved,
    on(evt, fn) {
      listeners[evt].add(fn);
      return () => listeners[evt].delete(fn);
    },
    emit(evt, payload) {
      for (const fn of listeners[evt]) fn(payload);
    },
    /** Set a cell and emit, the way state/session.js does. */
    put(i, value) {
      this.state[i] = value;
      this.emit('cell', { i, value });
    },
  };
}

function clock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

describe('attempt — timer', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('accumulates only while running', () => {
    const now = clock(1000);
    const a = createAttempt({ session: fakeSession(), now });

    expect(a.elapsedMs()).toBe(0);
    a.resume();
    now.advance(5000);
    expect(a.elapsedMs()).toBe(5000);

    a.pause();
    now.advance(60_000); // the player is on the level screen
    expect(a.elapsedMs()).toBe(5000);

    a.resume();
    now.advance(2000);
    expect(a.elapsedMs()).toBe(7000);
  });

  it('resumes from the stored total on the next visit', () => {
    saveRecord('p1', { elapsedMs: 30_000 });
    const now = clock(0);
    const a = createAttempt({ session: fakeSession(), now });

    a.resume();
    now.advance(4000);
    expect(a.elapsedMs()).toBe(34_000);
  });

  it('refuses to run for an already-solved puzzle', () => {
    const now = clock(0);
    const a = createAttempt({ session: fakeSession({ solved: true }), now });
    a.resume();
    now.advance(10_000);

    expect(a.running()).toBe(false);
    expect(a.elapsedMs()).toBe(0);
  });

  it('formats as mm:ss, and h:mm:ss past the hour', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(9_000)).toBe('00:09');
    expect(formatDuration(72_000)).toBe('01:12');
    expect(formatDuration(3_671_000)).toBe('1:01:11');
  });
});

describe('attempt — mistakes are charged on commit', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('does not charge for cycling a wrong cell straight on to MARKED', () => {
    // Cell 1 is empty in the solution. Reaching MARKED *requires* passing through
    // FILLED, so this is the normal way to mark a cell and must be free.
    const s = fakeSession();
    const a = createAttempt({ session: s, now: clock() });

    s.put(1, FILLED);
    s.put(1, MARKED);
    a.flush();

    expect(a.mistakes()).toBe(0);
  });

  it('charges once the player leaves a wrong fill standing', () => {
    const s = fakeSession();
    const a = createAttempt({ session: s, now: clock() });

    s.put(1, FILLED); // wrong
    s.put(0, FILLED); // moves on, leaving it -> charged

    expect(a.mistakes()).toBe(1);
  });

  it('charges a wrong fill left standing when the attempt is paused', () => {
    const s = fakeSession();
    const a = createAttempt({ session: s, now: clock() });
    a.resume();

    s.put(3, FILLED); // wrong
    a.pause();

    expect(a.mistakes()).toBe(1);
  });

  it('never charges the same cell twice', () => {
    const s = fakeSession();
    const a = createAttempt({ session: s, now: clock() });

    s.put(1, FILLED);
    s.put(0, FILLED); // commit -> 1
    s.put(1, BLANK);
    s.put(1, FILLED); // same wrong cell again
    s.put(2, FILLED); // commit -> still 1

    expect(a.mistakes()).toBe(1);
  });

  it('does not charge a correct fill', () => {
    const s = fakeSession();
    const a = createAttempt({ session: s, now: clock() });

    s.put(0, FILLED); // correct
    s.put(2, FILLED); // correct
    a.flush();

    expect(a.mistakes()).toBe(0);
  });

  it('carries the count across a reload', () => {
    const s1 = fakeSession();
    const a1 = createAttempt({ session: s1, now: clock() });
    s1.put(1, FILLED);
    s1.put(0, FILLED);
    a1.dispose();

    const a2 = createAttempt({ session: fakeSession(), now: clock() });
    expect(a2.mistakes()).toBe(1);
  });
});

describe('attempt — best record', () => {
  beforeEach(() => setStorage(memoryStorage()));

  it('records the first clear as a best', () => {
    const now = clock(0);
    const s = fakeSession();
    const a = createAttempt({ session: s, now });
    a.resume();
    now.advance(45_000);
    s.emit('solved');

    const r = a.result();
    expect(r.isBest).toBe(true);
    expect(r.previousBest).toBeNull();
    expect(r.ms).toBe(45_000);
    expect(loadRecord('p1').best).toMatchObject({ ms: 45_000 });
  });

  it('stops the clock at the clear', () => {
    const now = clock(0);
    const s = fakeSession();
    const a = createAttempt({ session: s, now });
    a.resume();
    now.advance(20_000);
    s.emit('solved');
    now.advance(90_000);

    expect(a.running()).toBe(false);
    expect(a.elapsedMs()).toBe(20_000);
  });

  it('keeps the faster of two clears and reports the previous best', () => {
    saveRecord('p1', { best: { ms: 50_000, mistakes: 4, hints: 2 }, elapsedMs: 0 });

    const now = clock(0);
    const s = fakeSession();
    const a = createAttempt({ session: s, now });
    a.resume();
    now.advance(31_000);
    s.emit('solved');

    expect(a.result().isBest).toBe(true);
    expect(a.result().previousBest.ms).toBe(50_000);
    expect(loadRecord('p1').best.ms).toBe(31_000);
  });

  it('leaves a faster stored best alone after a slower clear', () => {
    saveRecord('p1', { best: { ms: 10_000 } });

    const now = clock(0);
    const s = fakeSession();
    const a = createAttempt({ session: s, now });
    a.resume();
    now.advance(80_000);
    s.emit('solved');

    expect(a.result().isBest).toBe(false);
    expect(loadRecord('p1').best.ms).toBe(10_000);
  });

  it('counts hint uses and points separately', () => {
    const a = createAttempt({ session: fakeSession(), now: clock() });
    a.noteHint(1);
    a.noteHint(2);

    expect(a.hintUses()).toBe(2);
    expect(a.hints()).toBe(3);
    expect(loadRecord('p1')).toMatchObject({ hints: 3, hintUses: 2 });
  });

  it('counts every clear', () => {
    const s = fakeSession();
    createAttempt({ session: s, now: clock() });
    s.emit('solved');
    expect(loadRecord('p1').clears).toBe(1);
  });
});
