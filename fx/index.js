// fx/index.js — mountRewards(): everything DOO-6 adds, behind one call.
//
// OWNER: game-design track (연출).
//
// `main.js` is the only file in the repo that knows all the layers exist, so it is the
// only place this can be wired in — but the wiring is kept to three lines (mount, open,
// close) so the reward layer stays a single unit that can be read, tested or ripped out
// on its own. Everything else it needs it discovers:
//
//   - the game screen's visibility, via a MutationObserver on `#screen-game[hidden]`,
//     so the timer pauses when the player walks back to the menu without `main.js`
//     having to tell us
//   - the level grid, via `fx/locks.js`
//   - shape names, via `state/shape-name.js` against the shape catalogue
//
// Public API — mountRewards({ levels, view, openPuzzle, backToList }) returns:
//   .openPuzzle({ session, grid })   start tracking a playthrough
//   .closePuzzle()
//   .unlocks()                       the level unlock table (locks.js reads this)
//   .dispose()

import { SHAPES } from '../shapes/index.js';
import { createSfx } from '../audio/sfx.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';
import { createAttempt, formatDuration } from '../state/attempt.js';
import { difficultyFor } from '../state/difficulty.js';
import { createHints } from '../state/hints.js';
import { loadRecord, loadSettings, saveSettings } from '../state/progress.js';
import { buildNameIndex, resolveShapeName } from '../state/shape-name.js';
import { computeUnlocks } from '../state/unlock.js';
import { createCelebration } from './celebrate.js';
import { mountChrome } from './chrome.js';
import { createHighlight } from './highlight.js';
import { mountLocks } from './locks.js';
import { injectStyles } from './styles.js';

const TIMER_INTERVAL_MS = 500;
const AXIS_LABEL = { x: 'X', y: 'Y', z: 'Z' };

/** Which two coordinates index a line along `axis` — mirrors puzzle.js' clue grids. */
const LINE_COORDS = {
  x: (a, b) => `y=${a}, z=${b}`,
  y: (a, b) => `x=${a}, z=${b}`,
  z: (a, b) => `x=${a}, y=${b}`,
};

export function mountRewards({ levels, view, openPuzzle, backToList, doc = document } = {}) {
  injectStyles(doc);

  const nameIndex = buildNameIndex(SHAPES);
  const settings = loadSettings();

  // Reduced motion: the stored setting wins, otherwise the OS preference.
  const prefersReduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const motion = () =>
    settings.reducedMotion === true
      ? false
      : settings.reducedMotion === false
        ? true
        : !prefersReduced?.matches;

  const applyMotionClass = () => doc.documentElement.classList.toggle('fx-motion', motion());
  applyMotionClass();
  prefersReduced?.addEventListener?.('change', applyMotionClass);

  const sfx = createSfx({
    muted: settings.muted,
    onMutedChange: (muted) => {
      settings.muted = muted;
      saveSettings({ muted });
      chrome.setMuted(muted);
    },
  });

  // --- unlocks -----------------------------------------------------------------

  const unlocks = () =>
    computeUnlocks(levels, {
      isSolved: (puzzleId) => loadRecord(puzzleId).solved,
      scoreFor: difficultyFor,
    });

  // --- chrome ------------------------------------------------------------------

  const chrome = mountChrome({
    doc,
    sfx,
    onHint: () => requestHint(),
    onToggleMute: () => {
      const nowMuted = sfx.toggleMuted();
      // Confirm the unmute audibly — otherwise the only feedback is an icon.
      if (!nowMuted) sfx.play('reveal');
    },
  });
  chrome.setMuted(sfx.muted());

  const celebration = createCelebration({ doc, sfx });

  const locks = mountLocks({
    doc,
    levels,
    getUnlocks: unlocks,
    onBlocked: ({ level, previous }) => {
      const short = previous ? Math.max(0, Math.round(previous.required - previous.earned)) : 0;
      chrome.toast(
        previous
          ? `${level.name} 잠김 — 앞 레벨에서 난이도 ${short}점 더 모으면 열립니다`
          : `${level.name} 잠김`,
      );
    },
  });

  // --- the live playthrough ----------------------------------------------------

  let session = null;
  let grid = null;
  let attempt = null;
  let hints = null;
  let highlight = null;
  let offFrame = null;
  let unlockedBefore = null;

  function refreshStats({ bump = false } = {}) {
    if (!attempt) return;
    chrome.setTimer(formatDuration(attempt.elapsedMs()));
    chrome.setMistakes(attempt.mistakes(), { bump });
    const best = attempt.best();
    chrome.setBest(best ? formatDuration(best.ms) : null);
    chrome.setHintStage(hints?.peek() ?? 1);
    chrome.setControlsEnabled(!session?.solved);
  }

  const timerTick = setInterval(() => {
    if (attempt?.running()) chrome.setTimer(formatDuration(attempt.elapsedMs()));
  }, TIMER_INTERVAL_MS);

  function requestHint() {
    if (!hints || !session || session.solved) return;
    const hint = hints.next();
    if (!hint) {
      chrome.banner('더 알려줄 게 없습니다 — 이미 다 풀렸어요');
      return;
    }

    if (hint.stage === 1) {
      sfx.play('hint');
      highlight?.showLine(hint.line.indices, hint.line.axis);
      const where = LINE_COORDS[hint.line.axis](hint.line.a, hint.line.b);
      const clue = hint.clue.length ? hint.clue.join(' ') : '0';
      chrome.banner(
        `<b>${AXIS_LABEL[hint.line.axis]}축</b> 줄 (${where}) 을 다시 읽어보세요 · ` +
          `클루 <span class="fx-clue">${clue}</span> · 지금 <b>${hint.gains}칸</b>이 결정됩니다`,
      );
    } else {
      sfx.play('reveal');
      if (hint.line) highlight?.showLine(hint.line.indices, hint.line.axis);
      const c = hint.applied;
      const kind = hint.applied.value === 1 ? '블록' : '빈 칸';
      chrome.banner(`(x, y, z) = (${c.x}, ${c.y}, ${c.z}) 은 <b>${kind}</b> 입니다`);
    }

    refreshStats();
  }

  function onCell({ value }) {
    sfx.play(value === FILLED ? 'fill' : value === MARKED ? 'mark' : 'erase');
    refreshStats();
  }

  function onMistake() {
    sfx.play('mistake');
    refreshStats({ bump: true });
  }

  function onCleared(result) {
    highlight?.clear();
    chrome.hideBanner();
    chrome.setControlsEnabled(false);
    refreshStats();

    // Which level, if any, this clear just opened.
    //
    // The puzzle we are celebrating is passed in as solved explicitly rather than read
    // back from storage: `session` emits 'solved' from inside `set()` and only persists
    // *after* the listeners run, so at this instant storage still says unsolved. Asking
    // it would mean the unlock never gets announced on the clear that earned it.
    const after = computeUnlocks(levels, {
      isSolved: (puzzleId) => puzzleId === session.spec.id || loadRecord(puzzleId).solved,
      scoreFor: difficultyFor,
    });
    const opened = after.find((u, i) => u.unlocked && unlockedBefore?.[i]?.unlocked === false);
    locks.refresh();
    // Keep the snapshot current, or a second clear in the same session would report the
    // same level as freshly opened all over again.
    unlockedBefore = after;

    const { spec } = session;
    const found = levels.find((l) => l.puzzles.some((p) => p.id === spec.id));
    const index = found ? found.puzzles.findIndex((p) => p.id === spec.id) : -1;
    const nextSpec = found && index >= 0 ? found.puzzles[index + 1] : null;

    const { name } = resolveShapeName(spec, session.solution, {
      index: nameIndex,
      fallback: found && index >= 0 ? `${found.name} #${index + 1}` : spec.id,
    });

    celebration.run({
      name,
      subtitle: `${spec.dims.x}×${spec.dims.y}×${spec.dims.z} · 난이도 ${difficultyFor(spec)}`,
      result,
      grid,
      view,
      dims: spec.dims,
      solution: session.solution,
      filledValue: FILLED,
      motion: motion(),
      unlocked: opened ? levels[opened.index]?.name ?? null : null,
      hasNext: !!nextSpec,
      onNext: () => (nextSpec ? openPuzzle?.(nextSpec) : backToList?.()),
      onMenu: () => backToList?.(),
    });
  }

  // --- pausing: screen changes and tab switches --------------------------------

  const gameScreen = doc.getElementById('screen-game');
  const onScreen = () => !!gameScreen && !gameScreen.hidden;

  function syncRunning() {
    if (!attempt) return;
    const shouldRun = onScreen() && !doc.hidden && !session?.solved;
    if (shouldRun) attempt.resume();
    else attempt.pause();
  }

  const screenObserver = gameScreen
    ? new MutationObserver(() => syncRunning())
    : null;
  screenObserver?.observe(gameScreen, { attributes: true, attributeFilter: ['hidden'] });

  const onVisibility = () => syncRunning();
  doc.addEventListener('visibilitychange', onVisibility);

  // A pagehide/beforeunload flush is what keeps the last few seconds of the timer.
  const onLeave = () => attempt?.flush();
  globalThis.addEventListener?.('pagehide', onLeave);

  function closePuzzle() {
    celebration.close();
    chrome.hideBanner();
    offFrame?.();
    offFrame = null;
    highlight?.dispose();
    highlight = null;
    attempt?.dispose();
    attempt = null;
    hints = null;
    session = null;
    grid = null;
  }

  return {
    openPuzzle({ session: nextSession, grid: nextGrid }) {
      closePuzzle();
      session = nextSession;
      grid = nextGrid;
      unlockedBefore = unlocks();

      attempt = createAttempt({ session });
      hints = createHints({ session, onSpend: ({ cost }) => attempt.noteHint(cost) });

      if (view?.scene) {
        highlight = createHighlight({ scene: view.scene, dims: session.dims });
        offFrame = view.onFrame?.((dt) => highlight?.tick(dt));
      }

      session.on('cell', onCell);
      attempt.on('mistake', onMistake);
      attempt.on('cleared', onCleared);

      refreshStats();
      syncRunning();
    },

    closePuzzle,
    unlocks,
    refreshLocks: () => locks.refresh(),

    // A handle for QA and for the screenshot runs, matching main.js' `__nonogram`.
    debug: {
      attempt: () => attempt,
      hint: () => requestHint(),
      unlocks,
      solveNow() {
        if (!session) return false;
        for (let i = 0; i < session.solution.length; i++) {
          session.set(i, session.solution[i] ? FILLED : BLANK);
        }
        return true;
      },
    },

    dispose() {
      closePuzzle();
      clearInterval(timerTick);
      screenObserver?.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      globalThis.removeEventListener?.('pagehide', onLeave);
      locks.dispose();
      celebration.dispose();
      chrome.dispose();
      sfx.dispose();
    },
  };
}
