// fx/styles.js — the reward layer's stylesheet, injected from JS.
//
// OWNER: game-design track (연출).
//
// ## Why this is not in style.css
//
// `index.html` and `style.css` belong to the UI track, and DOO-5 is rewriting both for
// responsive clue panels right now. A stylesheet injected at mount time gives this
// track its own surface with zero merge conflicts, and it keeps the celebration
// self-contained: one `mountRewards()` call brings its own markup *and* its own CSS.
//
// Everything is namespaced `fx-`, and every colour is read from the `:root` custom
// properties the UI track already defines, with a literal fallback. So a palette change
// in style.css carries into the celebration for free, and a renamed variable degrades
// to a sane colour instead of transparent.
//
// Motion: every animation sits behind `.fx-motion` on the root element. The mount drops
// that class when the player's reduced-motion setting says so, which collapses the
// celebration to a cross-fade — the shape reveal and the card still happen, the spin
// and the sparkles do not.

const CSS = `
.fx-row { display: flex; align-items: center; gap: 0.5rem; }
/* Pushes the hint/mute pair to the far end of the bottom band without touching the
   band's own flex rules. */
.fx-row--end { margin-left: auto; }

/* --- the extra HUD readouts, appended into the existing bands ---------------- */
.fx-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--band-fg, #eee0bd);
  white-space: nowrap;
}
.fx-stat small { opacity: 0.6; font-size: 0.75em; font-weight: 400; }
.fx-stat--alert { color: #e8a08f; }
.fx-stat--best { color: var(--gold, #b6934f); }

/* A mistake landing: one quick nudge, never a layout shift. */
.fx-motion .fx-stat--bump { animation: fx-bump 0.32s ease-out; }
@keyframes fx-bump {
  0%   { transform: none; }
  35%  { transform: translateY(-3px) scale(1.14); }
  100% { transform: none; }
}

/* --- hint banner: sits over the board, never in the layout ------------------- */
/* fixed, not absolute: the UI track's #board carries no positioning context and
   giving it one would be an edit to their layout. Bottom offset clears the 72px
   bottom band plus a margin. */
.fx-banner {
  position: fixed;
  left: 50%;
  bottom: 5.75rem;
  transform: translateX(-50%);
  z-index: 6;
  max-width: min(92%, 32rem);
  padding: 0.6rem 1rem;
  border-radius: 14px;
  border: 1px solid var(--gold, #b6934f);
  background: rgba(20, 16, 13, 0.92);
  color: var(--band-fg, #eee0bd);
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  line-height: 1.45;
  text-align: center;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.fx-banner[hidden] { display: none; }
.fx-banner--on { opacity: 1; }
.fx-motion .fx-banner { transform: translateX(-50%) translateY(6px); }
.fx-motion .fx-banner--on { transform: translateX(-50%) translateY(0); }
.fx-banner b { color: var(--accent, #d9a441); }
.fx-banner .fx-clue {
  display: inline-block;
  margin: 0 0.15rem;
  padding: 0.05rem 0.4rem;
  border-radius: 6px;
  background: rgba(217, 164, 65, 0.18);
  font-variant-numeric: tabular-nums;
}

/* --- toast: unlock news and locked-level refusals ---------------------------- */
.fx-toast {
  position: fixed;
  left: 50%;
  top: 1.25rem;
  transform: translateX(-50%);
  z-index: 40;
  padding: 0.65rem 1.1rem;
  border-radius: 999px;
  border: 1px solid rgba(217, 164, 65, 0.5);
  background: rgba(20, 16, 13, 0.95);
  color: var(--hub-fg, #f2e8d5);
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}
.fx-toast[hidden] { display: none; }
.fx-toast--on { opacity: 1; }
.fx-motion .fx-toast { transform: translateX(-50%) translateY(-8px); }
.fx-motion .fx-toast--on { transform: translateX(-50%) translateY(0); }

/* --- locked level cards ------------------------------------------------------ */
.fx-locked { position: relative; filter: grayscale(0.75) brightness(0.72); cursor: not-allowed; }
.fx-locked:hover { transform: none !important; border-color: rgba(255, 255, 255, 0.08) !important; }
.fx-lock-badge {
  position: absolute;
  inset: auto 0 0.55rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  font-family: system-ui, sans-serif;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--hub-fg, #f2e8d5);
  filter: grayscale(0) brightness(1.5);
}
.fx-lock-bar {
  width: 68%;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  overflow: hidden;
}
.fx-lock-bar > i { display: block; height: 100%; background: var(--accent, #d9a441); }

/* --- the clear celebration -------------------------------------------------- */
/* Never centred. The shape that just assembled is the point of the whole sequence, and
   a centred card sits exactly on top of it.
   Narrow screens: the card goes to the bottom and the camera lifts the shape above it
   (fx/celebrate.js reads the same breakpoint).
   Wide screens: the card goes beside the shape instead, which is the only layout where
   neither has to give up room — see the media query below.
   The backdrop is a gradient for the same reason: barely tinted over the board, dark
   behind the card so its text keeps contrast. */
.fx-clear {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1.25rem 1.25rem 5.5rem;
  background: linear-gradient(
    180deg,
    rgba(20, 16, 13, 0.06) 0%,
    rgba(20, 16, 13, 0.22) 38%,
    rgba(20, 16, 13, 0.78) 78%
  );
  opacity: 0;
  transition: opacity 0.35s ease;
}

/* Keep this breakpoint in step with SIDE_CARD_QUERY in fx/celebrate.js. */
@media (min-width: 900px) {
  .fx-clear {
    align-items: center;
    justify-content: flex-end;
    padding: 1.5rem 2.5rem 1.5rem 1.5rem;
    background: linear-gradient(
      90deg,
      rgba(20, 16, 13, 0.04) 0%,
      rgba(20, 16, 13, 0.18) 45%,
      rgba(20, 16, 13, 0.72) 82%
    );
  }
}
.fx-clear[hidden] { display: none; }
.fx-clear--on { opacity: 1; }

.fx-card {
  width: min(100%, 23rem);
  padding: 1.6rem 1.5rem 1.25rem;
  border-radius: 22px;
  border: 1px solid var(--gold, #b6934f);
  background: linear-gradient(165deg, #262019, #15110d);
  color: var(--hub-fg, #f2e8d5);
  font-family: system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.fx-motion .fx-card { animation: fx-card-in 0.42s cubic-bezier(0.16, 0.9, 0.3, 1.1) both; }
@keyframes fx-card-in {
  from { opacity: 0; transform: translateY(18px) scale(0.94); }
  to   { opacity: 1; transform: none; }
}

.fx-card-eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--accent, #d9a441);
}
.fx-card-name {
  margin: 0.5rem 0 0.1rem;
  font-family: var(--font-display, Georgia, serif);
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.1;
}
.fx-card-sub { font-size: 0.78rem; color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55)); }

.fx-card-best {
  display: inline-block;
  margin-top: 0.7rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: rgba(217, 164, 65, 0.16);
  color: var(--accent, #d9a441);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.fx-card-best[hidden] { display: none; }
.fx-motion .fx-card-best { animation: fx-pop 0.5s 0.3s ease-out both; }
@keyframes fx-pop {
  0%   { opacity: 0; transform: scale(0.6); }
  60%  { opacity: 1; transform: scale(1.12); }
  100% { opacity: 1; transform: scale(1); }
}

.fx-card-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin: 1.15rem 0 0.4rem;
}
.fx-card-stat {
  padding: 0.6rem 0.25rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
}
.fx-card-stat b {
  display: block;
  font-size: 1.15rem;
  font-variant-numeric: tabular-nums;
}
.fx-card-stat span {
  font-size: 0.66rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55));
}
.fx-card-prev {
  min-height: 1.1rem;
  font-size: 0.72rem;
  color: var(--hub-fg-dim, rgba(242, 232, 213, 0.55));
  font-variant-numeric: tabular-nums;
}

.fx-card-unlock {
  margin-top: 0.75rem;
  padding: 0.45rem 0.75rem;
  border-radius: 12px;
  background: rgba(143, 214, 148, 0.14);
  color: #8fd694;
  font-size: 0.8rem;
  font-weight: 700;
}
.fx-card-unlock[hidden] { display: none; }
.fx-motion .fx-card-unlock { animation: fx-pop 0.5s 0.55s ease-out both; }

.fx-card-actions { display: flex; gap: 0.6rem; margin-top: 1.1rem; }
.fx-btn {
  flex: 1;
  padding: 0.75rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--hub-fg, #f2e8d5);
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}
.fx-btn:hover { background: rgba(255, 255, 255, 0.13); }
.fx-btn:active { transform: scale(0.97); }
.fx-btn--primary {
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent, #d9a441), var(--accent-deep, #c98f2e));
  color: #241a0c;
}
.fx-btn--primary:hover { filter: brightness(1.08); background: linear-gradient(135deg, var(--accent, #d9a441), var(--accent-deep, #c98f2e)); }

/* Sparkles: pure CSS, only under .fx-motion, and purely decorative. */
.fx-sparks { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.fx-sparks i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--accent, #d9a441);
  opacity: 0;
}
.fx-motion .fx-sparks i { animation: fx-spark 1.5s ease-out forwards; }
@keyframes fx-spark {
  0%   { opacity: 0; transform: translate(0, 0) scale(0.4) rotate(0deg); }
  12%  { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(1) rotate(var(--rot)); }
}

/* Narrow *and* short: nowhere to put the shape, so centre the card and darken the
   backdrop rather than pretending there is a reveal to look at. */
@media (max-width: 899px) and (max-height: 620px) {
  .fx-clear {
    align-items: center;
    padding: 1rem;
    background: radial-gradient(ellipse at center, rgba(20, 16, 13, 0.45), rgba(20, 16, 13, 0.85));
  }
}

@media (max-width: 480px) {
  .fx-card { padding: 1.3rem 1.1rem 1rem; }
  .fx-card-name { font-size: 1.7rem; }
  .fx-stat { font-size: 0.78rem; }
}
`;

const STYLE_ID = 'fx-rewards-styles';

/** Inject once. Safe to call repeatedly (hot reload, re-mount). */
export function injectStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}
