// state/progress.js — per-puzzle progress persistence.
//
// OWNER: game-design track (진행·기록). Platform created the skeleton; the storage
// key and payload shape below are a compatibility contract with already-saved
// browsers, so changing them needs a migration, not an edit.
//
// Public API:
//   loadProgress(puzzleId)                  -> { state: number[], solved: boolean } | null
//   saveProgress(puzzleId, cells, solved)   -> void
//   setStorage(storageLike)                 -> void   (tests inject a fake)

const storageKey = (puzzleId) => `no-nonogram:${puzzleId}`;

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

export function loadProgress(puzzleId) {
  try {
    const raw = storage?.getItem(storageKey(puzzleId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProgress(puzzleId, cells, solved) {
  try {
    storage?.setItem(
      storageKey(puzzleId),
      JSON.stringify({ state: Array.from(cells), solved: !!solved }),
    );
  } catch {
    // storage unavailable (private mode, quota) — progress just won't persist
  }
}
