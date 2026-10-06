// state/unlock.js — which levels are open, from the solver's difficulty scores.
//
// OWNER: game-design track. Pure rules: the score source and the "is it cleared"
// lookup are injected, so this file is a table of numbers and a loop, testable in node
// with fake puzzles.
//
// ## The rule
//
//   Level 1 is always open.
//   Level N+1 opens when the puzzles you have cleared in level N add up to
//   UNLOCK_SHARE (50%) of level N's **total difficulty score** — but never more than
//   "everything except the single hardest puzzle".
//   Inside a level, every puzzle is open from the start.
//
// In the shipped catalogue that works out to the same shape on every level:
//
//   **clear 4 of 6 — or 3 of 6 if you take the hard ones.**
//
// ## Why score-weighted rather than a puzzle count
//
// Counting puzzles would make every puzzle a toll gate: get stuck on the one nasty 6³
// and the game stops. Weighting by difficulty means the half you may skip is the half
// that is hardest to earn, *and* that doing hard puzzles gets you out of a level faster
// — three of level 1's harder shapes (25+28+19 = 72) clears its 66-point gate, where
// three of its easiest (17+19+19 = 55) does not.
//
// ## Why 50%
//
// Measured against DOO-4's 24 shapes. "easy" is how many puzzles the cheapest-first
// route needs, "hard" the dearest-first route:
//
//   share          L1            L2            L3            L4
//   0.45    4 easy / 3 hard  4 / 2         4 / 2         4 / 3
//   0.50    4 easy / 3 hard  4 / 3         4 / 3         4 / 3    <- chosen
//   0.55    4 / 3           5 / 3         5 / 3         4 / 3
//   0.60    5 / 4           5 / 4         5 / 3         5 / 4
//
// 0.50 is the only value that is uniform across all four levels on both routes, so the
// rule can be stated to the player in one sentence instead of varying per level. The
// reason the band is this low is that the hand-authored catalogue has a much flatter
// difficulty spread than the seeded-random puzzles this rule was first tuned against
// (level 1 now runs 17-28, a 1.65x spread, where the random set ran 37-86). On a flat
// level, "share of score" and "share of puzzles" converge — 0.60 of a flat level's score
// is 5 of 6 puzzles, which leaves only one skippable and misses the point. At 0.45 the
// hard route collapses to 2 of 6, which is too cheap a way past a level.
//
// Reaching level 4 therefore takes 12 clears of the 24, and level 4 itself is ungated
// from above, so nothing in the game is compulsory beyond those 12.
//
// ## The hardest-puzzle cap
//
// A percentage alone misbehaves on a short level: a 2-puzzle level scoring 39 and 54.5
// needs 56.1 at 60%, i.e. *both* — the gate would demand the hard one. So the
// requirement is also capped at `total - (hardest puzzle's score)`, which makes a
// standing promise: **the single hardest puzzle in a level is never required.** On the
// shipped 6-puzzle levels the cap sits well above the share (level 1: 104 vs 66) and
// never binds; it is insurance for short or lopsided levels.
//
// Inside a level nothing is gated at all. A per-puzzle chain is the classic way a
// nonogram game dead-ends a player, and the level gate above already paces things.
//
// Public API:
//   UNLOCK_SHARE
//   computeUnlocks(levels, { isSolved, scoreFor, share? })
//     -> [{ levelId, index, unlocked, cleared, puzzleCount,
//           earned, total, required, remaining }]
//   isPuzzleUnlocked(unlocks, puzzleId, levels)

export const UNLOCK_SHARE = 0.5;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Walk the levels in order, deciding each from the previous level's earned score.
 * `isSolved(puzzleId)` and `scoreFor(spec)` are injected; nothing here reads storage.
 */
export function computeUnlocks(levels, { isSolved, scoreFor, share = UNLOCK_SHARE } = {}) {
  const out = [];
  let previousOpen = true; // level 1

  for (let index = 0; index < levels.length; index++) {
    const level = levels[index];
    const puzzles = level.puzzles ?? [];

    let total = 0;
    let earned = 0;
    let cleared = 0;
    let hardest = 0;
    for (const spec of puzzles) {
      const score = scoreFor(spec);
      total += score;
      if (score > hardest) hardest = score;
      if (isSolved(spec.id)) {
        earned += score;
        cleared++;
      }
    }

    // The cap is the promise that the hardest puzzle is always skippable — but a
    // one-puzzle level has nothing to skip, so there the share stands alone.
    const cap = puzzles.length >= 2 ? total - hardest : total;
    const required = Math.min(total * share, cap);
    out.push({
      levelId: level.id,
      index,
      unlocked: previousOpen,
      cleared,
      puzzleCount: puzzles.length,
      earned: round1(earned),
      total: round1(total),
      required: round1(required),
      remaining: round1(Math.max(0, required - earned)),
    });

    // An empty level must not become a wall while the catalogue is still being filled
    // in (DOO-4 lands 24 shapes level by level). Compare on the unrounded requirement
    // so the gate never disagrees with the number shown next to it.
    previousOpen = total === 0 ? previousOpen : earned >= required;
  }

  return out;
}

/** A puzzle is open exactly when its level is: no per-puzzle chain inside a level. */
export function isPuzzleUnlocked(unlocks, puzzleId, levels) {
  for (let i = 0; i < levels.length; i++) {
    if ((levels[i].puzzles ?? []).some((p) => p.id === puzzleId)) {
      return !!unlocks[i]?.unlocked;
    }
  }
  return true;
}
