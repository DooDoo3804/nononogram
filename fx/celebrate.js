// fx/celebrate.js — the clear celebration. The payoff the whole track exists for.
//
// OWNER: game-design track (연출).
//
// ## The sequence
//
//   0ms    the board is wiped to blank and the clear arpeggio fires
//   0-640  the solution re-assembles bottom-up, one y-layer per step — *this* is the
//          "완성 모양 공개": the marks never come back, so what builds itself in front
//          of the player is the pure shape, with none of their working-out on it
//   140ms  the camera starts a slow auto-rotate, so the shape is read in 3D, not as a
//          silhouette from whatever angle the last click happened to leave
//   700ms  the card fades in: shape name, time, mistakes, hints, and the record line
//
// The reveal deliberately wipes first. At the moment of solving, the board already *is*
// the shape plus the player's marks, so "removing the marks" would be a non-event on a
// board solved without any. Rebuilding from empty always reads as a reveal.
//
// Only `grid.setState` and `view.controls` are used, both public API, so DOO-7's
// instancing rewrite and this file do not collide.
//
// Public API — createCelebration({ doc, root, sfx, motion }) returns:
//   .run(options)    start the sequence;  see `run` below
//   .close()
//   .isOpen()
//   .dispose()

import { formatDuration } from '../state/attempt.js';
import { BLANK } from '../state/cells.js';

const WIPE_AT = 0;
const ASSEMBLE_MS = 640;
const SPIN_AT = 140;
const CARD_AT = 700;
const AUTO_ROTATE_SPEED = 1.5;
// Camera distance multiplier for the reveal. 0.78 roughly doubles the shape's screen
// area without clipping the corners of a 6³ box at the framing scene.js picks.
const DOLLY_IN = 0.78;
// Below this width the card is stacked under the shape and the camera has to lift the
// shape clear of it; above it the card sits beside the shape and no lift is needed.
// Must match the `min-width: 900px` breakpoint in fx/styles.js.
const SIDE_CARD_QUERY = '(min-width: 900px)';
// How far up the shape moves in the stacked layout, as a fraction of what the camera
// can see. Derived from the camera rather than from dims, so it holds for every box
// size and whatever framing scene.js picks.
const LIFT_FRACTION = 0.14;
const SPARK_COUNT = 14;

const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createCelebration({ doc = document, root = doc.body, sfx = null } = {}) {
  const overlay = el(doc, 'div', 'fx-clear');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '퍼즐 완료');

  const sparks = el(doc, 'div', 'fx-sparks');
  const card = el(doc, 'div', 'fx-card');

  const eyebrow = el(doc, 'div', 'fx-card-eyebrow', 'SOLVED');
  const nameEl = el(doc, 'h2', 'fx-card-name', '');
  const subEl = el(doc, 'div', 'fx-card-sub', '');
  const bestEl = el(doc, 'div', 'fx-card-best', '🏆 신기록');
  bestEl.hidden = true;

  const stats = el(doc, 'div', 'fx-card-stats');
  const statNodes = {};
  for (const [key, label] of [['time', '시간'], ['mistakes', '실수'], ['hints', '힌트']]) {
    const box = el(doc, 'div', 'fx-card-stat');
    const value = el(doc, 'b', null, '-');
    box.append(value, el(doc, 'span', null, label));
    stats.appendChild(box);
    statNodes[key] = value;
  }

  const prevEl = el(doc, 'div', 'fx-card-prev', '');
  const unlockEl = el(doc, 'div', 'fx-card-unlock', '');
  unlockEl.hidden = true;
  const actions = el(doc, 'div', 'fx-card-actions');
  const menuBtn = el(doc, 'button', 'fx-btn', '목록으로');
  const nextBtn = el(doc, 'button', 'fx-btn fx-btn--primary', '다음 퍼즐');
  actions.append(menuBtn, nextBtn);

  card.append(eyebrow, nameEl, subEl, bestEl, stats, prevEl, unlockEl, actions);
  overlay.append(sparks, card);
  root.appendChild(overlay);

  const timers = [];
  let open = false;
  let handlers = {};
  let restoreSpin = null;

  const after = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
  };

  function buildSparks(motion) {
    sparks.replaceChildren();
    if (!motion) return;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spark = el(doc, 'i');
      // Deterministic fan rather than Math.random: a fixed starburst looks composed,
      // and it makes the celebration identical across screenshot runs.
      const angle = (i / SPARK_COUNT) * Math.PI * 2 + (i % 2 ? 0.22 : 0);
      const dist = 150 + (i % 4) * 46;
      spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.72}px`);
      spark.style.setProperty('--rot', `${(i % 2 ? 1 : -1) * (180 + i * 24)}deg`);
      spark.style.animationDelay = `${(i % 5) * 70}ms`;
      sparks.appendChild(spark);
    }
  }

  /**
   * Rebuild the shape bottom-up. Cells are grouped by y so the shape grows as layers
   * rather than in index order, which scans as assembly instead of as noise.
   */
  function assemble({ grid, dims, solution, filledValue, motion }) {
    const layers = [];
    for (let y = 0; y < dims.y; y++) {
      const cells = [];
      for (let x = 0; x < dims.x; x++) {
        for (let z = 0; z < dims.z; z++) {
          const i = (x * dims.y + y) * dims.z + z;
          if (solution[i]) cells.push(i);
        }
      }
      if (cells.length) layers.push(cells);
    }

    const paint = (cells) => {
      for (const i of cells) grid.setState(i, filledValue);
    };

    // Wipe to blank first — the board stops being the player's working-out.
    after(WIPE_AT, () => {
      for (let i = 0; i < solution.length; i++) grid.setState(i, BLANK);
      if (!motion) layers.forEach(paint);
    });

    if (!motion) return;
    const step = ASSEMBLE_MS / Math.max(1, layers.length);
    layers.forEach((cells, k) => {
      after(WIPE_AT + 40 + step * k, () => {
        paint(cells);
        sfx?.play('tap');
      });
    });
  }

  /**
   * Spin the shape, and dolly in a little.
   *
   * The camera is framed to fit the whole clue-panel layout during play, which leaves
   * the cube small in the middle of the board. Once the puzzle is over the clues do not
   * matter any more, so the celebration pulls in to make the shape the subject. Both
   * changes are undone on close — the player may reopen the puzzle to look at it.
   */
  function startSpin(view, motion) {
    if (!view?.controls) return;
    const { controls, camera } = view;
    const was = {
      autoRotate: controls.autoRotate,
      speed: controls.autoRotateSpeed,
      position: camera?.position.clone(),
      target: controls.target?.clone(),
    };
    restoreSpin = () => {
      controls.autoRotate = was.autoRotate;
      controls.autoRotateSpeed = was.speed;
      if (was.position) camera.position.copy(was.position);
      if (was.target) controls.target.copy(was.target);
      controls.update?.();
      restoreSpin = null;
    };

    after(SPIN_AT, () => {
      if (camera) {
        // The two layouts want opposite things, so each gets only the move it needs.
        //
        // Side-card (wide): the board keeps its whole height, so pull in and make the
        // shape the subject.
        // Stacked (narrow): the canvas is already the cramped dimension — a phone's
        // board is a tall slot between the clue panels — so pulling in would push the
        // shape straight off the edges. Lift it clear of the card instead, and leave
        // the framing scene.js chose alone.
        if (globalThis.matchMedia?.(SIDE_CARD_QUERY).matches) {
          camera.position.sub(controls.target).multiplyScalar(DOLLY_IN).add(controls.target);
        } else {
          // Sliding camera and target together keeps the view direction, so the scene
          // shifts up on screen without tilting.
          const distance = camera.position.distanceTo(controls.target);
          const visibleHeight = 2 * distance * Math.tan((camera.fov * Math.PI) / 360);
          const lift = visibleHeight * LIFT_FRACTION;
          controls.target.y -= lift;
          camera.position.y -= lift;
        }
      }
      controls.update?.();
      if (!motion) return;
      controls.autoRotate = true;
      controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    });
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimers();
    restoreSpin?.();
    overlay.classList.remove('fx-clear--on');
    overlay.hidden = true;
    sparks.replaceChildren();
    handlers = {};
  }

  menuBtn.addEventListener('click', () => {
    sfx?.play('tap');
    const go = handlers.onMenu;
    close();
    go?.();
  });
  nextBtn.addEventListener('click', () => {
    sfx?.play('tap');
    const go = handlers.onNext;
    close();
    go?.();
  });

  return {
    /**
     * @param {object} o
     * @param {string} o.name           the shape's name — the headline
     * @param {string} o.subtitle       dims / puzzle position, under the name
     * @param {object} o.result         { ms, mistakes, hints, hintUses, isBest, previousBest }
     * @param {object} o.grid           the voxel grid (setState only)
     * @param {object} o.view           the render view (controls only)
     * @param {object} o.dims
     * @param {Uint8Array} o.solution
     * @param {number} o.filledValue    the FILLED cell state
     * @param {boolean} o.motion        false -> reduced motion: no wave, spin or sparks
     * @param {string|null} o.unlocked  a level name that just opened, if any
     * @param {boolean} o.hasNext       whether a "next puzzle" action makes sense
     */
    run(o) {
      clearTimers();
      open = true;
      handlers = { onNext: o.onNext, onMenu: o.onMenu };
      const motion = o.motion !== false;

      nameEl.textContent = o.name;
      subEl.textContent = o.subtitle ?? '';
      statNodes.time.textContent = formatDuration(o.result.ms);
      statNodes.mistakes.textContent = String(o.result.mistakes);
      statNodes.hints.textContent = String(o.result.hintUses ?? 0);
      bestEl.hidden = !o.result.isBest;

      const prev = o.result.previousBest;
      prevEl.textContent = o.result.isBest
        ? prev
          ? `이전 최고 ${formatDuration(prev.ms)}`
          : '첫 클리어'
        : prev
          ? `최고 기록 ${formatDuration(prev.ms)}`
          : '';

      // The unlock gets its own line rather than relabelling the button: "다음 퍼즐"
      // moves to the next puzzle *in this level*, and a level can unlock partway
      // through one — a button reading "Level 2 열림" that went somewhere else would
      // be a lie.
      unlockEl.hidden = !o.unlocked;
      unlockEl.textContent = o.unlocked ? `🔓 ${o.unlocked} 해금!` : '';

      nextBtn.hidden = !o.hasNext;
      nextBtn.textContent = '다음 퍼즐';

      buildSparks(motion);
      if (o.grid && o.solution) {
        assemble({
          grid: o.grid,
          dims: o.dims,
          solution: o.solution,
          filledValue: o.filledValue,
          motion,
        });
      }
      startSpin(o.view, motion);

      sfx?.play('clear');
      if (o.unlocked) after(CARD_AT + 260, () => sfx?.play('unlock'));

      overlay.hidden = false;
      after(motion ? CARD_AT : 60, () => {
        overlay.classList.add('fx-clear--on');
        nextBtn.focus?.();
      });
    },

    close,
    isOpen: () => open,

    dispose() {
      close();
      overlay.remove();
    },
  };
}
