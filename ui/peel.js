// ui/peel.js — the on-screen control for the depth cursor, and the one-time lesson
// that tells the player it is there.
//
// ## Why this exists (DOO-28)
//
// `render/peel.js` takes the front layers off the box, which is what turns an interior
// cell from a sliver between the cells in front of it into a full cell-sized target.
// DOO-17 measured it on the shipped opening camera: `l4-cat` went from 26 of its 112
// required cells reachable to all 112, with nothing left under 24×24.
//
// It shipped bound to `[` / `]` / `\` and nothing else. So on touch the feature did not
// exist — there is no key to press — and on desktop nobody had a reason to try `]`.
// A mechanism the player cannot reach is worth exactly as much as one that is absent,
// which is why the render half landed with this issue attached to it.
//
// This module is the affordance: a stepper in the bottom band carrying the depth and
// the axis, plus a coach mark the first time a level-3 board opens.
//
// ## Why the readout names an axis, and sometimes two
//
// `render/peel.js` re-aims at the face the camera is on *when the player steps*, never
// while they rotate — deliberately, so the exposed layer never walks around under them
// mid-rotation. The price is a discontinuity: peel two layers off X, turn to look down
// Z, and the next `+` lands on "Z, one layer", not "X, three". The board still visibly
// has X peeled, so the readout keeps saying X and adds `→ Z` for where the next press
// goes. Naming only the pending axis would lie about what is on screen; naming only the
// applied one would make the jump read as a bug. The arrow is the whole fix for the
// confusion the issue predicted, and it costs one 34px slot that is reserved whether or
// not it is showing, so the band never reflows mid-rotation.
//
// ## Why the keyboard binding stays in render/peel.js
//
// The issue offered `keyTarget: null` and moving the keys here. Declined: `[`/`]` are
// how `scripts/probe-aim.mjs` drives the cursor — real CDP key events, so the numbers
// in DOO-17 are measurements of the binding a player actually uses, not of a test hook.
// Moving the keys would either break that probe or force it onto a code path no player
// takes. `sync()` reads back from `peel.state()` instead, so a key press and a button
// press land on the same readout.
//
// Public API — mountPeelControl({ doc, peel, view, getDims, storage }) returns:
//   .sync(dtMs)        refresh from peel.state()/view.facing() — cheap, call per frame
//   .openPuzzle(spec)  new board: resync, and teach once when spec.level >= TEACH_LEVEL
//   .teach()           show the coach mark now, ignoring the seen-it flag
//   .dismiss()         hide it and remember it was seen
//   .model()           the readout's current model (read-only; for tests and QA)
//   .dispose()

/** The level where a board first has cells the cursor is the only way to reach. */
export const TEACH_LEVEL = 3;

/** Flag store for UI lessons the player only needs once. Shares progress.js's prefix. */
export const COACH_KEY = 'no-nonogram:@coach';

/** How often the readout re-reads the cursor, in ms. */
const SYNC_MS = 100;

const AXIS_LETTER = { x: 'X', y: 'Y', z: 'Z' };

function readSeen(storage) {
  try {
    const raw = storage?.getItem?.(COACH_KEY);
    return raw ? !!JSON.parse(raw)?.peel : false;
  } catch {
    // A corrupt or unreadable flag means "not taught yet", which costs one extra
    // coach mark. Treating it as taught would cost the lesson entirely.
    return false;
  }
}

function writeSeen(storage) {
  try {
    storage?.setItem?.(COACH_KEY, JSON.stringify({ peel: true }));
  } catch {
    /* private mode: the in-memory flag below still holds for this session */
  }
}

export function mountPeelControl({
  doc = globalThis.document,
  peel,
  view,
  getDims,
  storage = globalThis.localStorage ?? null,
} = {}) {
  const $ = (id) => doc?.getElementById?.(id) ?? null;

  const root = $('peel');
  const lessBtn = $('peel-less');
  const moreBtn = $('peel-more');
  const resetBtn = $('peel-readout');
  const dotEl = $('peel-dot');
  const axisEl = $('peel-axis');
  const depthEl = $('peel-depth');
  const nextEl = $('peel-next');
  const nextDotEl = $('peel-next-dot');
  const nextAxisEl = $('peel-next-axis');
  const liveEl = $('peel-live');
  const coachEl = $('peel-coach');
  const coachCloseEl = $('peel-coach-close');

  let seen = readSeen(storage);
  let sinceSync = SYNC_MS; // sync on the very first frame, not 100ms into play
  let signature = null;
  let announced = null;
  let current = null;

  const axisMax = (dims, axis) => Math.max(0, (dims?.[axis] ?? 0) - 1);

  /**
   * What the readout should say. Everything the DOM write needs, and nothing that
   * touches the DOM — so a test can assert the labels without a document.
   */
  function model() {
    const st = peel?.state?.() ?? { depth: 0, axis: 'x', sign: -1, max: 0 };
    const dims = getDims?.() ?? null;
    const facing = view?.facing?.() ?? null;
    // A sign flip on the same axis re-aims too: the camera crossed to the other end of
    // the box, so the near face — the one `+` takes off — is the opposite one.
    const reaim = !!facing && (facing.axis !== st.axis || facing.sign !== st.sign);
    const nextAxis = facing?.axis ?? st.axis;

    // Depth 0 peels nothing, so there is no applied face worth naming; name the one the
    // next press will take off instead. That also makes the readout teach the mechanism
    // before it has ever been used — the dot tracks the camera as the player rotates.
    const axis = st.depth > 0 ? st.axis : nextAxis;
    const max = st.depth > 0 ? st.max : dims ? axisMax(dims, axis) : st.max;
    const pending = st.depth > 0 && reaim ? nextAxis : null;

    return {
      depth: st.depth,
      axis,
      max,
      pending,
      pendingMax: pending ? axisMax(dims, pending) : max,
      // `+` only runs out at the bottom of the current face. With a re-aim pending it
      // always does something: it moves to the new face and takes one layer off it.
      canMore: !!pending || st.depth < max,
      canLess: st.depth > 0,
    };
  }

  function labels(m) {
    const here = AXIS_LETTER[m.axis] ?? '?';
    const there = m.pending ? (AXIS_LETTER[m.pending] ?? '?') : null;
    return {
      more: there ? `${there}축으로 옮겨 한 겹 벗기기 (])` : `한 겹 벗기기 (])`,
      less: there ? `${there}축으로 옮기고 전체 보기 ([)` : `한 겹 덮기 ([)`,
      reset: m.depth > 0 ? `전체 보기 (\\) — 지금 ${here}축 ${m.depth}겹 벗김` : '벗긴 겹 없음',
      live: m.depth > 0
        ? `${here}축 ${m.depth}겹 벗김${there ? `, 다음 조작은 ${there}축` : ''}`
        : `전체 보기, 다음 조작은 ${here}축`,
    };
  }

  function paint(m) {
    const text = labels(m);
    if (dotEl) dotEl.className = `axis-dot axis-dot--${m.axis}`;
    if (axisEl) axisEl.textContent = AXIS_LETTER[m.axis] ?? '?';
    if (depthEl) depthEl.textContent = `${m.depth}/${m.max}`;

    // The slot keeps its box when empty (`visibility`, not `hidden`), so turning the
    // camera never reflows the band under the player's thumb.
    if (nextEl) nextEl.style.visibility = m.pending ? 'visible' : 'hidden';
    if (m.pending) {
      if (nextDotEl) nextDotEl.className = `axis-dot axis-dot--${m.pending}`;
      if (nextAxisEl) nextAxisEl.textContent = AXIS_LETTER[m.pending] ?? '?';
    }

    if (root) root.dataset.peeled = m.depth > 0 ? '1' : '0';
    if (moreBtn) {
      moreBtn.disabled = !m.canMore;
      moreBtn.title = text.more;
      moreBtn.setAttribute('aria-label', text.more);
    }
    if (lessBtn) {
      lessBtn.disabled = !m.canLess;
      lessBtn.title = text.less;
      lessBtn.setAttribute('aria-label', text.less);
    }
    if (resetBtn) {
      resetBtn.disabled = m.depth === 0;
      resetBtn.title = text.reset;
      resetBtn.setAttribute('aria-label', text.reset);
    }
    // Announce the board moving, not the camera moving. At depth 0 the dot follows the
    // facing axis, and `pending` flips whenever a rotation crosses a face — a live
    // region wired straight to the readout would read itself out several times per drag
    // to say nothing had happened. Keyed on the cursor's own position instead, so every
    // depth-0 state collapses to one announcement and only a press can trigger another;
    // the full picture, pending axis included, is still on the buttons' aria-labels.
    const key = m.depth > 0 ? `${m.axis}/${m.depth}` : '0';
    if (liveEl && key !== announced) {
      announced = key;
      liveEl.textContent = text.live;
    }
  }

  /**
   * Re-read the cursor and repaint if anything moved.
   *
   * Throttled to SYNC_MS and guarded by a signature string, because this runs off the
   * frame loop: at 60fps an unguarded version would build a model and five label
   * strings 60 times a second to change nothing. The 100ms lag is invisible on a
   * readout — and the button handlers below paint synchronously, so a press never waits
   * for the next tick.
   */
  function sync(dtMs = SYNC_MS) {
    sinceSync += Number.isFinite(dtMs) ? dtMs : SYNC_MS;
    if (sinceSync < SYNC_MS) return current;
    sinceSync = 0;
    return repaint();
  }

  function repaint() {
    const m = model();
    const next = `${m.depth}/${m.max}/${m.axis}/${m.pending ?? '-'}/${m.canMore}/${m.canLess}`;
    if (next === signature) return m;
    signature = next;
    current = m;
    paint(m);
    return m;
  }

  // --- the coach mark ------------------------------------------------------------
  // Non-modal on purpose: `role="status"` and no focus trap, so it cannot strand a
  // player who taps it away by starting to play. It goes away on its close button, on
  // Escape, and on the first use of the control it is pointing at — using the thing is
  // the lesson, so holding the card up afterwards would just be in the way.

  function dismiss() {
    if (!coachEl || coachEl.hidden) return;
    coachEl.classList.remove('peel-coach--on');
    coachEl.hidden = true;
    if (root) delete root.dataset.coach;
    seen = true;
    writeSeen(storage);
  }

  function teach() {
    if (!coachEl) return false;
    coachEl.hidden = false;
    // The card names the pill but has no tail pointing at it — three layouts, three
    // chances to point at the wrong place. The pill lights up instead.
    if (root) root.dataset.coach = '1';
    // Two frames: the element has to be laid out before the transition can run. Same
    // shape as fx/chrome.js's banner, for the same reason.
    const raf = doc?.defaultView?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
    if (raf) raf(() => raf(() => coachEl.classList.add('peel-coach--on')));
    else coachEl.classList.add('peel-coach--on');
    return true;
  }

  function openPuzzle(spec) {
    sinceSync = SYNC_MS;
    repaint();
    if (seen || !spec || (spec.level ?? 0) < TEACH_LEVEL) return false;
    // Marked seen on show, not on dismiss: a player who ignores the card and plays on
    // has still been told, and a lesson that re-appears every time they open a 5³ board
    // is worse than one they skimmed.
    seen = true;
    writeSeen(storage);
    return teach();
  }

  // --- wiring --------------------------------------------------------------------

  function act(fn) {
    return (event) => {
      event?.preventDefault?.();
      fn();
      dismiss();
      sinceSync = SYNC_MS;
      repaint();
    };
  }

  const onMore = act(() => peel?.step?.(1));
  const onLess = act(() => peel?.step?.(-1));
  const onReset = act(() => peel?.reset?.());
  const onCoachClose = act(() => {});

  function onKeyDown(event) {
    if (event.key === 'Escape') dismiss();
  }

  moreBtn?.addEventListener?.('click', onMore);
  lessBtn?.addEventListener?.('click', onLess);
  resetBtn?.addEventListener?.('click', onReset);
  coachCloseEl?.addEventListener?.('click', onCoachClose);
  doc?.defaultView?.addEventListener?.('keydown', onKeyDown);

  repaint();

  return {
    sync,
    openPuzzle,
    dismiss,
    teach() {
      return teach();
    },
    model: () => current ?? model(),

    dispose() {
      moreBtn?.removeEventListener?.('click', onMore);
      lessBtn?.removeEventListener?.('click', onLess);
      resetBtn?.removeEventListener?.('click', onReset);
      coachCloseEl?.removeEventListener?.('click', onCoachClose);
      doc?.defaultView?.removeEventListener?.('keydown', onKeyDown);
    },
  };
}
