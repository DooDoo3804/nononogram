// ui/clues.js — the three clue panels (one per axis) and the "which axis am I
// looking along" highlight.
//
// Free rotation means "top/left/right" never reliably maps to a fixed axis, so
// instead of relying on panel position we highlight whichever panel corresponds to
// the axis the camera currently looks most directly along — that's the axis you're
// filling in.
//
// Public API — mountClues() returns:
//   .render(dims, clues, currentRuns)   repaint all three panels
//   .setActiveAxis('x'|'y'|'z')         no-op when already active

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

  let activeAxis = null;

  return {
    // A clue number gets struck through as soon as the player's current board has a
    // run of that length in that position of the line — it doesn't have to be the
    // *correct* run, just a plausible reading of the clue from what's filled in so far.
    render(dims, clues, currentRuns) {
      for (const axis of ['x', 'y', 'z']) {
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
      if (axis === activeAxis) return;
      activeAxis = axis;
      for (const a of ['x', 'y', 'z']) {
        panelEls[a]?.classList.toggle('clue-panel--active', a === axis);
      }
    },
  };
}
