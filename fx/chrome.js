// fx/chrome.js — the reward layer's own HUD: timer, mistake count, best time, the hint
// button, the mute button, the hint banner and the toast.
//
// OWNER: game-design track (연출).
//
// ## Why these elements are built here instead of in index.html
//
// `index.html` belongs to the UI track and DOO-5 is rewriting it. So this module
// *appends into* the containers that already exist rather than declaring new ones:
// the readouts join `.puzzle-info` in the top band, the buttons join the bottom band.
// They inherit the band's flex layout, so they move with whatever DOO-5 does to it
// instead of floating over it — which is what the brief means by not redesigning the
// responsive layout. Every selector has a fallback, so a renamed container costs the
// controls their ideal position, not their existence.
//
// The buttons deliberately reuse the UI track's own `.tag-btn` class: they are the same
// 44px round tag as undo, and a restyle there restyles these for free.
//
// Public API — mountChrome({ doc, sfx, onHint, onToggleMute }) returns:
//   .setTimer(text) .setMistakes(n) .setBest(msText|null)
//   .setHintStage(1|2) .setMuted(bool) .setControlsEnabled(bool)
//   .banner(html, ms) .hideBanner()
//   .toast(text, ms)
//   .dispose()

const TAG_BTN_CLASS = 'tag-btn';

function pick(doc, selectors) {
  for (const sel of selectors) {
    const found = doc.querySelector(sel);
    if (found) return found;
  }
  return null;
}

const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function mountChrome({ doc = document, sfx = null, onHint, onToggleMute } = {}) {
  // --- readouts in the top band ------------------------------------------------
  const infoHost =
    pick(doc, ['#screen-game .puzzle-info', '#screen-game .band--top', '#screen-game header']) ??
    doc.body;

  const timerEl = el(doc, 'span', 'fx-stat', '⏱ 00:00');
  timerEl.title = '경과 시간';
  const mistakeEl = el(doc, 'span', 'fx-stat', '✖ 0');
  mistakeEl.title = '실수 — 틀린 칸을 그대로 둔 횟수';
  const bestEl = el(doc, 'span', 'fx-stat fx-stat--best', '');
  bestEl.title = '최고 기록';
  bestEl.hidden = true;
  infoHost.append(timerEl, mistakeEl, bestEl);

  // --- buttons in the bottom band ----------------------------------------------
  const barHost =
    pick(doc, ['#screen-game .band--bottom', '#screen-game footer']) ?? doc.body;

  const buttons = el(doc, 'div', 'fx-row fx-row--end');
  const hintBtn = el(doc, 'button', TAG_BTN_CLASS, '💡');
  hintBtn.title = '힌트';
  hintBtn.setAttribute('aria-label', '힌트');
  const muteBtn = el(doc, 'button', TAG_BTN_CLASS, '🔇');
  muteBtn.title = '소리 켜기';
  muteBtn.setAttribute('aria-label', '소리 켜기');
  buttons.append(hintBtn, muteBtn);
  barHost.appendChild(buttons);

  // --- overlays ----------------------------------------------------------------
  const banner = el(doc, 'div', 'fx-banner');
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  doc.body.appendChild(banner);

  const toastEl = el(doc, 'div', 'fx-toast');
  toastEl.hidden = true;
  toastEl.setAttribute('role', 'status');
  doc.body.appendChild(toastEl);

  let bannerTimer = 0;
  let toastTimer = 0;
  let bumpTimer = 0;

  hintBtn.addEventListener('click', () => onHint?.());
  muteBtn.addEventListener('click', () => onToggleMute?.());

  return {
    setTimer(text) {
      if (timerEl.textContent !== `⏱ ${text}`) timerEl.textContent = `⏱ ${text}`;
    },

    setMistakes(n, { bump = false } = {}) {
      const next = `✖ ${n}`;
      if (mistakeEl.textContent !== next) mistakeEl.textContent = next;
      mistakeEl.classList.toggle('fx-stat--alert', n > 0);
      if (!bump) return;
      clearTimeout(bumpTimer);
      mistakeEl.classList.remove('fx-stat--bump');
      // Force a reflow so re-adding the class restarts the animation.
      void mistakeEl.offsetWidth;
      mistakeEl.classList.add('fx-stat--bump');
      bumpTimer = setTimeout(() => mistakeEl.classList.remove('fx-stat--bump'), 400);
    },

    setBest(text) {
      bestEl.hidden = !text;
      bestEl.textContent = text ? `🏆 ${text}` : '';
    },

    /** The button shows which rung the next press buys, so the cost is never a surprise. */
    setHintStage(stage) {
      const label = stage === 2 ? '힌트 — 칸 하나 확정 (2점)' : '힌트 — 볼 줄 알려주기 (1점)';
      hintBtn.title = label;
      hintBtn.setAttribute('aria-label', label);
      hintBtn.textContent = stage === 2 ? '💡!' : '💡';
    },

    setMuted(muted) {
      muteBtn.textContent = muted ? '🔇' : '🔈';
      const label = muted ? '소리 켜기' : '소리 끄기';
      muteBtn.title = label;
      muteBtn.setAttribute('aria-label', label);
      muteBtn.setAttribute('aria-pressed', String(muted));
    },

    /** A solved board has nothing left to hint at. */
    setControlsEnabled(enabled) {
      hintBtn.disabled = !enabled;
      hintBtn.style.opacity = enabled ? '' : '0.4';
    },

    banner(html, ms = 7000) {
      clearTimeout(bannerTimer);
      banner.innerHTML = html;
      banner.hidden = false;
      // Two frames: the element has to be laid out before the transition can run.
      requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add('fx-banner--on')));
      if (ms > 0) bannerTimer = setTimeout(() => this.hideBanner(), ms);
    },

    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('fx-banner--on');
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, 250);
    },

    toast(text, ms = 3200) {
      clearTimeout(toastTimer);
      toastEl.textContent = text;
      toastEl.hidden = false;
      sfx?.play('tap');
      requestAnimationFrame(() => requestAnimationFrame(() => toastEl.classList.add('fx-toast--on')));
      toastTimer = setTimeout(() => {
        toastEl.classList.remove('fx-toast--on');
        toastTimer = setTimeout(() => {
          toastEl.hidden = true;
        }, 250);
      }, ms);
    },

    dispose() {
      clearTimeout(bannerTimer);
      clearTimeout(toastTimer);
      clearTimeout(bumpTimer);
      for (const node of [timerEl, mistakeEl, bestEl, buttons, banner, toastEl]) node.remove();
    },
  };
}
