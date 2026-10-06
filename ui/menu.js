// ui/menu.js — the level grid and the puzzle grid (cards with 2D thumbnails and
// a completion badge).
//
// Public API — mountMenu({ levels, getProgress, onOpenPuzzle, show }) returns:
//   .renderLevels()          repaint the level grid
//   .openLevel(level)        repaint the puzzle grid for a level and show it
//   .reopenCurrentLevel()    same, for whichever level is open (progress changed)

import { drawThumb } from '../render/thumbnail.js';
import { FILLED } from '../state/cells.js';

const THUMB_SIZE = 100;

export function mountMenu({ levels, getProgress, onOpenPuzzle, show }) {
  const levelsGrid = document.getElementById('levels-grid');
  const puzzlesGrid = document.getElementById('puzzles-grid');
  const puzzlesTitle = document.getElementById('puzzles-title');

  let currentLevel = null;

  function renderPuzzles(level) {
    puzzlesGrid.innerHTML = '';
    level.puzzles.forEach((spec, i) => {
      const progress = getProgress(spec.id);
      const cellCount = spec.dims.x * spec.dims.y * spec.dims.z;
      const cells = progress
        ? progress.state.map((v) => (v === FILLED ? 1 : 0))
        : new Array(cellCount).fill(0);

      const card = document.createElement('button');
      card.className = 'puzzle-card';

      const thumb = document.createElement('canvas');
      thumb.width = THUMB_SIZE;
      thumb.height = THUMB_SIZE;
      drawThumb(thumb, spec.dims, cells);
      card.appendChild(thumb);

      const name = document.createElement('div');
      name.className = 'puzzle-name';
      name.textContent = `#${i + 1}`;
      card.appendChild(name);

      const statusModifier = progress?.solved
        ? ' puzzle-status--solved'
        : progress
          ? ' puzzle-status--progress'
          : '';
      const status = document.createElement('div');
      status.className = 'puzzle-status' + statusModifier;
      status.textContent = progress?.solved ? '완료' : progress ? '진행중' : '미완료';
      card.appendChild(status);

      card.addEventListener('click', () => onOpenPuzzle(spec));
      puzzlesGrid.appendChild(card);
    });
  }

  function openLevel(level) {
    currentLevel = level;
    puzzlesTitle.textContent = level.name;
    renderPuzzles(level);
    show('screen-puzzles');
  }

  return {
    renderLevels() {
      levelsGrid.innerHTML = '';
      for (const level of levels) {
        const card = document.createElement('button');
        card.className = 'level-card';
        card.innerHTML = `
      <svg class="level-cube-icon" viewBox="0 0 100 116" aria-hidden="true">
        <path d="M50 0 L100 29 L50 58 L0 29 Z" fill="url(#cube-top-grad)" />
        <path d="M0 29 L50 58 L50 116 L0 87 Z" fill="url(#cube-left-grad)" />
        <path d="M100 29 L50 58 L50 116 L100 87 Z" fill="url(#cube-right-grad)" />
      </svg>
      <span class="level-name">${level.name}</span>
    `;
        card.addEventListener('click', () => openLevel(level));
        levelsGrid.appendChild(card);
      }
    },

    openLevel,

    reopenCurrentLevel() {
      if (currentLevel) openLevel(currentLevel);
    },
  };
}
