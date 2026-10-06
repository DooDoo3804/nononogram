// fx/locks.js — locked level cards: the grey-out, the progress badge, and the refusal.
//
// OWNER: game-design track.
//
// ## Why this decorates the DOM instead of living in ui/menu.js
//
// The level grid is the UI track's (`ui/menu.js`, DOO-5, in flight). Rather than edit
// their renderer, this module watches `#levels-grid` with a MutationObserver and
// re-applies lock state every time they repaint it. The cost is a selector contract
// instead of a function contract; the benefit is that neither track blocks the other,
// and `getUnlocks()` is re-read on every repaint so the badge can never go stale.
//
// Cards are matched to levels **by position**, which is exactly how `ui/menu.js` builds
// them (one card per level, in order). If the card count ever stops matching the level
// count the module does nothing at all rather than mislabel a card.
//
// The refusal is a capture-phase listener on the grid: `stopPropagation()` there keeps
// the event from ever reaching the card's own click handler, so a locked level cannot be
// opened even though the UI track still wires every card the same way.
//
// Public API — mountLocks({ doc, levels, getUnlocks, onBlocked }) returns:
//   .refresh()   re-apply now
//   .dispose()

const BADGE_CLASS = 'fx-lock-badge';
const LOCKED_CLASS = 'fx-locked';

export function mountLocks({ doc = document, levels, getUnlocks, onBlocked } = {}) {
  const grid = doc.getElementById('levels-grid');
  if (!grid) return { refresh() {}, dispose() {} };

  let applying = false;
  let unlocks = [];

  const cards = () => [...grid.children].filter((n) => n.nodeType === 1);

  function refresh() {
    if (applying) return;
    applying = true;
    try {
      unlocks = getUnlocks?.() ?? [];
      const list = cards();
      // Positional matching only holds when the counts agree.
      if (list.length !== levels.length) return;

      list.forEach((card, i) => {
        const info = unlocks[i];
        card.querySelector(`.${BADGE_CLASS}`)?.remove();
        const locked = info && !info.unlocked;
        card.classList.toggle(LOCKED_CLASS, !!locked);
        card.dataset.fxLevel = levels[i].id;
        if (!locked) {
          card.removeAttribute('aria-disabled');
          return;
        }

        card.setAttribute('aria-disabled', 'true');
        const prev = unlocks[i - 1];
        const badge = doc.createElement('div');
        badge.className = BADGE_CLASS;

        const share = prev && prev.required > 0 ? Math.min(1, prev.earned / prev.required) : 0;
        const bar = doc.createElement('div');
        bar.className = 'fx-lock-bar';
        const fill = doc.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        bar.appendChild(fill);

        const label = doc.createElement('span');
        label.textContent = prev
          ? `🔒 ${Math.round(prev.earned)} / ${Math.round(prev.required)}`
          : '🔒';

        badge.append(label, bar);
        card.appendChild(badge);
      });
    } finally {
      applying = false;
    }
  }

  function onClickCapture(event) {
    const card = event.target.closest?.(`#levels-grid > *`);
    if (!card || !card.classList.contains(LOCKED_CLASS)) return;
    event.stopPropagation();
    event.preventDefault();
    const i = cards().indexOf(card);
    onBlocked?.({ level: levels[i], info: unlocks[i], previous: unlocks[i - 1] });
  }

  grid.addEventListener('click', onClickCapture, true);

  // The UI track repaints the grid wholesale (`innerHTML = ''` then append), so watch
  // children rather than trying to hook their render function.
  const observer = new MutationObserver(() => refresh());
  observer.observe(grid, { childList: true });

  refresh();

  return {
    refresh,
    dispose() {
      observer.disconnect();
      grid.removeEventListener('click', onClickCapture, true);
      for (const card of cards()) {
        card.classList.remove(LOCKED_CLASS);
        card.querySelector(`.${BADGE_CLASS}`)?.remove();
      }
    },
  };
}
