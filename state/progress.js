// state/progress.js — per-puzzle persistence: board progress, records, settings.
//
// OWNER: game-design track (진행·기록). Platform created the skeleton; the storage
// key and payload shape below are a compatibility contract with already-saved
// browsers, so changing them needs a migration, not an edit.
//
// ## The migration story: additive, unversioned, both directions
//
// DOO-6 grew this file from "board + solved flag" to "board + solved + timer +
// mistakes + hints + best record". There is deliberately **no version field**:
//
//   - **Old save → new code.** Every field added here has a default that means
//     "never recorded" (0 / null). An old `{state, solved}` payload normalises to a
//     fresh record with no best time, which is exactly the truth about it.
//   - **New save → old code.** `loadProgress` is still a raw pass-through and old
//     readers only touch `.state` / `.solved`, so extra keys are ignored, not fatal.
//   - **A version field would have broken the wire format.** `saveProgress` only
//     writes a record field when it is non-default, so a puzzle played without ever
//     clearing it still serialises to the byte-identical `{"state":[…],"solved":…}`
//     that tests/progress.test.js pins. A `{"v":2,…}` prefix would have changed that
//     string for every player, for no gain over "absent field = default".
//
// Public API:
//   loadProgress(puzzleId)                  -> raw { state, solved, … } | null
//   saveProgress(puzzleId, cells, solved)   -> void   (preserves record fields)
//   loadRecord(puzzleId)                    -> normalised record (never null)
//   saveRecord(puzzleId, patch)             -> merged record  (preserves board)
//   loadSettings() / saveSettings(patch)    -> normalised settings
//   setStorage(storageLike)                 -> void   (tests inject a fake)

const KEY_PREFIX = 'no-nonogram:';
const storageKey = (puzzleId) => `${KEY_PREFIX}${puzzleId}`;

// '@' can never appear in a puzzle id, so the settings blob can share the prefix
// without any chance of colliding with `no-nonogram:<puzzleId>`.
export const SETTINGS_KEY = `${KEY_PREFIX}@settings`;

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // SecurityError in some embedded/private contexts — treat as "no storage"
    return null;
  }
}

let storage = defaultStorage();

/** Swap the backing store. Pass `null` to disable persistence entirely. */
export function setStorage(storageLike) {
  storage = storageLike;
}

function readJson(key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(key, text) {
  try {
    storage?.setItem(key, text);
  } catch {
    // storage unavailable (private mode, quota) — progress just won't persist
  }
}

export function loadProgress(puzzleId) {
  return readJson(storageKey(puzzleId));
}

// --- records -------------------------------------------------------------------

/** A puzzle nobody has touched. `best` stays null until the first clear. */
export const EMPTY_RECORD = Object.freeze({
  solved: false,
  elapsedMs: 0,
  mistakes: 0,
  hints: 0,
  hintUses: 0,
  clears: 0,
  best: null,
});

const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function normalizeBest(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.ms) || raw.ms < 0) return null;
  return {
    ms: Math.floor(raw.ms),
    mistakes: num(raw.mistakes),
    hints: num(raw.hints),
    hintUses: num(raw.hintUses),
    at: num(raw.at),
  };
}

/**
 * The record fields of one puzzle, with every missing field defaulted — this is the
 * read path that makes a pre-DOO-6 `{state, solved}` payload a valid record.
 */
export function loadRecord(puzzleId) {
  const raw = loadProgress(puzzleId);
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RECORD };
  return {
    solved: !!raw.solved,
    elapsedMs: num(raw.elapsedMs),
    mistakes: num(raw.mistakes),
    hints: num(raw.hints),
    hintUses: num(raw.hintUses),
    clears: num(raw.clears),
    best: normalizeBest(raw.best),
  };
}

// Field order is load-bearing: `state` then `solved` then extras, and extras only
// when non-default, so an untouched-record save is byte-identical to the pre-DOO-6
// format that tests/progress.test.js pins.
function serialize(state, solved, record) {
  const out = { state, solved: !!solved };
  if (record.elapsedMs) out.elapsedMs = record.elapsedMs;
  if (record.mistakes) out.mistakes = record.mistakes;
  if (record.hints) out.hints = record.hints;
  if (record.hintUses) out.hintUses = record.hintUses;
  if (record.clears) out.clears = record.clears;
  if (record.best) out.best = record.best;
  return JSON.stringify(out);
}

export function saveProgress(puzzleId, cells, solved) {
  // Read-modify-write: session.js calls this on every click, and it must not stamp
  // over the timer/mistake/best fields that saveRecord put there.
  const record = loadRecord(puzzleId);
  writeRaw(storageKey(puzzleId), serialize(Array.from(cells), solved, record));
}

/**
 * Merge record fields in without touching the board. A patch of `{ best: null }`
 * is honoured (clears the record); omitted keys keep their stored value.
 */
export function saveRecord(puzzleId, patch = {}) {
  const prev = loadProgress(puzzleId);
  const record = loadRecord(puzzleId);
  const merged = {
    elapsedMs: 'elapsedMs' in patch ? num(patch.elapsedMs) : record.elapsedMs,
    mistakes: 'mistakes' in patch ? num(patch.mistakes) : record.mistakes,
    hints: 'hints' in patch ? num(patch.hints) : record.hints,
    hintUses: 'hintUses' in patch ? num(patch.hintUses) : record.hintUses,
    clears: 'clears' in patch ? num(patch.clears) : record.clears,
    best: 'best' in patch ? normalizeBest(patch.best) : record.best,
  };
  const state = Array.isArray(prev?.state) ? prev.state : [];
  const solved = 'solved' in patch ? !!patch.solved : record.solved;
  writeRaw(storageKey(puzzleId), serialize(state, solved, merged));
  return { ...merged, solved };
}

// --- settings ------------------------------------------------------------------

// Muted by default: the brief is 음소거 기본 존중 — nobody gets sound they did not
// ask for on first load. The toggle lives in the game screen's bottom band.
export const DEFAULT_SETTINGS = Object.freeze({
  muted: true,
  // 'auto' follows prefers-reduced-motion; true/false override it.
  reducedMotion: 'auto',
});

export function loadSettings() {
  const raw = readJson(SETTINGS_KEY);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  return {
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_SETTINGS.muted,
    reducedMotion:
      raw.reducedMotion === true || raw.reducedMotion === false ? raw.reducedMotion : 'auto',
  };
}

export function saveSettings(patch = {}) {
  const next = { ...loadSettings(), ...patch };
  writeRaw(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
