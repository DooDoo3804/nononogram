// tests/unlock.test.js — the level unlock curve.
//
// Two jobs. The first describe block pins the *rule* against fake levels with round
// numbers, so the arithmetic is readable. The second runs it against the real shipped
// catalogue and asserts the property the brief actually asked for — 답답하지 않게: you
// are never required to clear a level's hardest puzzle, and the whole game is finishable
// without clearing everything.

import { describe, it, expect } from 'vitest';
import { UNLOCK_SHARE, computeUnlocks, isPuzzleUnlocked } from '../state/unlock.js';
import { difficultyFor } from '../state/difficulty.js';
import { LEVELS } from '../levels.js';

/** Levels from a map of level id -> puzzle scores. */
function fakeLevels(shape) {
  return Object.entries(shape).map(([id, scores]) => ({
    id,
    name: id,
    puzzles: scores.map((score, i) => ({ id: `${id}-${i}`, score })),
  }));
}

// The fake-level block pins the *arithmetic* at an explicit share, so retuning
// UNLOCK_SHARE cannot quietly rewrite what these tests claim. The shipped value is
// pinned separately, against the real catalogue, further down.
const RULE_SHARE = 0.6;

const run = (levels, solvedIds, share = RULE_SHARE) =>
  computeUnlocks(levels, {
    isSolved: (id) => solvedIds.includes(id),
    scoreFor: (spec) => spec.score,
    share,
  });

describe('unlock rule', () => {
  const levels = fakeLevels({ a: [10, 20, 30, 40], b: [50, 50] });

  it('always opens the first level', () => {
    expect(run(levels, [])[0].unlocked).toBe(true);
  });

  it('keeps the next level shut until the share is earned', () => {
    // total 100, share 0.6 -> 60 needed, and the cap (100 - 40 = 60) ties with it.
    expect(run(levels, [])[1].unlocked).toBe(false);
    expect(run(levels, ['a-0', 'a-1'])[1].unlocked).toBe(false); // 10+20 = 30
    expect(run(levels, ['a-0', 'a-1', 'a-2'])[1].unlocked).toBe(true); // 10+20+30 = 60
    expect(run(levels, ['a-1', 'a-3'])[1].unlocked).toBe(true); // 20+40 = 60
    expect(run(levels, ['a-0', 'a-3'])[1].unlocked).toBe(false); // 10+40 = 50
  });

  it('reports the gap so the UI can show progress, not just a padlock', () => {
    const [a] = run(levels, ['a-0']);
    expect(a.total).toBe(100);
    expect(a.required).toBe(60);
    expect(a.earned).toBe(10);
    expect(a.remaining).toBe(50);
    expect(a.cleared).toBe(1);
    expect(a.puzzleCount).toBe(4);
  });

  it('never requires the hardest puzzle of a level', () => {
    // A two-puzzle level: 60% of 90 would be 54, which only the 60 satisfies — so the
    // share alone would make the hard one compulsory. The cap drops it to 90-60 = 30.
    const short = fakeLevels({ a: [30, 60], b: [10] });
    expect(run(short, [])[0].required).toBe(30);
    expect(run(short, ['a-0'])[1].unlocked).toBe(true);
  });

  it('still requires the only puzzle of a one-puzzle level', () => {
    const single = fakeLevels({ a: [40], b: [10] });
    expect(run(single, [])[1].unlocked).toBe(false);
    expect(run(single, ['a-0'])[1].unlocked).toBe(true);
  });

  it('does not let an empty level become a wall', () => {
    // DOO-4 filled the catalogue level by level; a level with nothing in it yet must
    // pass progression straight through rather than dead-end the game.
    const gappy = fakeLevels({ a: [10], b: [], c: [10] });
    const u = run(gappy, ['a-0']);
    expect(u[1].unlocked).toBe(true);
    expect(u[2].unlocked).toBe(true);
  });

  it('opens every puzzle in an unlocked level at once', () => {
    const u = run(levels, []);
    expect(isPuzzleUnlocked(u, 'a-3', levels)).toBe(true); // hardest of level 1
    expect(isPuzzleUnlocked(u, 'b-0', levels)).toBe(false);
  });

  it('locks nothing behind a later level', () => {
    const u = run(levels, ['a-1', 'a-3']);
    expect(u.map((x) => x.unlocked)).toEqual([true, true]);
  });
});

describe('unlock curve against the shipped catalogue', () => {
  const unlocks = (solved) =>
    computeUnlocks(LEVELS, { isSolved: (id) => solved.has(id), scoreFor: difficultyFor });

  /** How many puzzles the cheapest-first and dearest-first routes need to pass a gate. */
  function routes(level, required) {
    const scores = level.puzzles.map(difficultyFor);
    const count = (ordered) => {
      let acc = 0;
      let n = 0;
      for (const s of ordered) {
        if (acc >= required) break;
        acc += s;
        n++;
      }
      return n;
    };
    return {
      easy: count([...scores].sort((a, b) => a - b)),
      hard: count([...scores].sort((a, b) => b - a)),
    };
  }

  it('is tuned so every level reads the same: 4 of 6 easy, 3 of 6 hard', () => {
    // This is the number the unlock curve is *designed* around, so it is pinned rather
    // than derived — a catalogue change that breaks the uniformity should fail here and
    // get the share retuned, not silently shift the curve under the player.
    expect(UNLOCK_SHARE).toBe(0.5);

    const u = unlocks(new Set());
    for (const [i, level] of LEVELS.entries()) {
      expect(level.puzzles).toHaveLength(6);
      expect(routes(level, u[i].required), level.id).toEqual({ easy: 4, hard: 3 });
    }
  });

  it('starts with level 1 open and everything after it shut', () => {
    const u = unlocks(new Set());
    expect(u[0].unlocked).toBe(true);
    for (const level of u.slice(1)) expect(level.unlocked).toBe(false);
  });

  it('opens every level once everything is cleared', () => {
    const all = new Set(LEVELS.flatMap((l) => l.puzzles.map((p) => p.id)));
    for (const level of unlocks(all)) expect(level.unlocked).toBe(true);
  });

  it('never requires a level’s hardest puzzle — the anti-frustration guarantee', () => {
    // Clear everything except, in each level, the single highest-scoring puzzle.
    const solved = new Set();
    for (const level of LEVELS) {
      const scored = level.puzzles.map((p) => ({ p, score: difficultyFor(p) }));
      const hardest = scored.reduce((hi, c) => (c.score > hi.score ? c : hi), scored[0]);
      for (const { p } of scored) if (p.id !== hardest.p.id) solved.add(p.id);
    }

    for (const level of unlocks(solved)) expect(level.unlocked).toBe(true);
  });

  it('reaches the last level without clearing every puzzle', () => {
    const solved = new Set();
    for (const level of LEVELS) {
      const scored = level.puzzles
        .map((p) => ({ p, score: difficultyFor(p) }))
        .sort((a, b) => a.score - b.score);
      // Cheapest-first until this level's gate opens — the lazy route.
      const required = unlocks(solved).find((u) => u.levelId === level.id).required;
      let acc = 0;
      for (const { p, score } of scored) {
        if (acc >= required) break;
        solved.add(p.id);
        acc += score;
      }
    }

    const total = LEVELS.reduce((n, l) => n + l.puzzles.length, 0);
    expect(unlocks(solved).at(-1).unlocked).toBe(true);
    expect(solved.size).toBeLessThan(total);
  });
});
