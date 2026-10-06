// ui/clues.js — the clue tables: three panels framing the board where there is room
// for three, one tab-switched panel everywhere else.
//
// Free rotation means "top/left/right" never reliably maps to a fixed axis, so instead
// of relying on panel position we follow the axis the camera currently looks most
// directly along — that's the axis you're filling in. On a wide screen that shows up as
// a highlight on one of the three panels; on a narrow one it *opens* that panel, which
// is what makes the tabbed layout cost nothing in normal play: the camera has already
// selected the table you were about to read.
//
// Public API — mountClues() returns:
//   .render(dims, clues, currentRuns)   repaint all three panels
//   .setActiveAxis('x'|'y'|'z')         the axis the camera is looking along
//   .showAxis('x'|'y'|'z')              open one panel (what a tab press calls)
//   .shownAxis()                        -> 'x'|'y'|'z'
//   .dispose()

const AXES = ['x', 'y', 'z'];

// Must stay identical to the wide query in style.css — it is the one thing that knows
// whether the tab bar is on screen, and therefore whether its ARIA roles describe
// anything real. Roles that outlive their layout are worse than no roles: a screen
// reader would announce three simultaneously visible tables as a tab set with three
// selected tabs.
export const CLUE_WIDE_QUERY = '(min-width: 980px) and (min-height: 750px)';

export function mountClues() {
  const gridEls = {
    x: document.getElementById('clues-x'),
    y: document.getElementById('clues-y'),
    z: document.getElementById('clues-z'),
  };
  const panelEls = {
    x: document.querySelector('.clue-panel--left'),
    y: document.querySelector('.clue-panel--top'),
    z: document.querySelector('.clue-panel--right'),
  };
  const tabList = document.getElementById('clue-tabs');
  const tabEls = {};
  for (const el of tabList?.querySelectorAll('.clue-tab') ?? []) tabEls[el.dataset.axis] = el;

  const wide = window.matchMedia(CLUE_WIDE_QUERY);

  // Two separate pieces of state, because a tab press and the camera must not fight.
  // `facing` is the last axis the camera reported; `shown` is the panel that is open.
  // A press moves `shown` only, so the selection sticks while the camera sits still —
  // and the next time the camera turns to a *different* axis it takes the selection
  // back, which is what you want when you rotate to look at a face.
  let facing = null;
  let shown = 'x';

  function paint() {
    for (const axis of AXES) {
      panelEls[axis]?.classList.toggle('clue-panel--shown', axis === shown);
      panelEls[axis]?.classList.toggle('clue-panel--active', axis === facing);
      const tab = tabEls[axis];
      if (!tab) continue;
      tab.setAttribute('aria-selected', String(axis === shown));
      // Only one tab is a tab stop; the arrow keys move between them. Outside the
      // tabbed layout the bar is `display: none` and out of the tab order anyway.
      tab.tabIndex = axis === shown ? 0 : -1;
    }
  }

  /** Add the tablist semantics only while the tab bar is the live layout. */
  function syncRoles() {
    const tabbed = !wide.matches;
    tabList?.setAttribute('role', tabbed ? 'tablist' : 'presentation');
    for (const axis of AXES) {
      const tab = tabEls[axis];
      const panel = panelEls[axis];
      if (tab && panel) {
        tab.setAttribute('role', tabbed ? 'tab' : 'button');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', tabbed ? 'tabpanel' : 'group');
        panel.setAttribute('aria-labelledby', tabbed ? tab.id : '');
      }
    }
  }

  function show(axis) {
    if (!AXES.includes(axis) || axis === shown) return;
    shown = axis;
    paint();
  }

  for (const axis of AXES) {
    tabEls[axis]?.addEventListener('click', () => show(axis));
    // Roving-tabindex arrow keys, the behaviour a tablist is expected to have. Left and
    // up both step back so the binding holds whichever way the bar is laid out — it is
    // a row in portrait and a row in a side column in landscape, but the same three
    // keys should work either way.
    tabEls[axis]?.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = AXES[(AXES.indexOf(axis) + step + AXES.length) % AXES.length];
      show(next);
      tabEls[next]?.focus();
    });
  }

  const onWideChange = () => {
    syncRoles();
    paint();
  };
  wide.addEventListener('change', onWideChange);
  syncRoles();
  paint();

  return {
    // A clue number gets struck through as soon as the player's current board has a
    // run of that length in that position of the line — it doesn't have to be the
    // *correct* run, just a plausible reading of the clue from what's filled in so far.
    render(dims, clues, currentRuns) {
      for (const axis of AXES) {
        const el = gridEls[axis];
        el.innerHTML = '';
        const grid = clues[axis];
        const curGrid = currentRuns[axis];
        el.style.gridTemplateColumns = `repeat(${grid[0].length}, auto)`;
        grid.forEach((row, a) => {
          row.forEach((runs, b) => {
            const cur = curGrid[a][b];
            const cell = document.createElement('div');
            cell.className = 'clue-cell';
            runs.forEach((n, k) => {
              const span = document.createElement('span');
              span.textContent = n;
              if (cur[k] === n) span.className = 'clue-num--done';
              cell.appendChild(span);
            });
            el.appendChild(cell);
          });
        });
      }
    },

    setActiveAxis(axis) {
      if (axis === facing) return;
      facing = axis;
      shown = axis;
      paint();
    },

    showAxis: show,
    shownAxis: () => shown,

    dispose() {
      wide.removeEventListener('change', onWideChange);
    },
  };
}
