// ui/menu.js — the level grid and the puzzle grid (cards with 2D thumbnails and
// a completion badge).
//
// Public API — mountMenu({ levels, getProgress, onOpenPuzzle, show }) returns:
//   .renderLevels()          repaint the level grid
//   .openLevel(level)        repaint the puzzle grid for a level and show it
//   .reopenCurrentLevel()    same, for whichever level is open (progress changed)

import { drawThumb } from '../render/thumbnail.js';
import { resolvePixelRatio } from '../render/scene.js';
import { FILLED } from '../state/cells.js';

/** The thumbnail's CSS box. The drawing buffer is this times the display's ratio. */
export const THUMB_SIZE = 100;

/**
 * Give a thumbnail canvas the pixels the display actually has (DOO-21).
 *
 * `canvas.width` is the drawing buffer, not the layout box — a 2D canvas is no
 * different from WebGL here. Left at `THUMB_SIZE` it is 100x100 real pixels stretched
 * over a 100 CSS px box, which on a DPR-2 phone is a quarter of the pixels under it
 * and on DPR 3 a ninth, upscaled by the compositor. So the buffer gets the ratio and
 * the CSS box is pinned, which is the part that keeps the card layout from moving.
 *
 * The ratio is `render/scene.js`'s, cap included, deliberately rather than raw
 * `devicePixelRatio`: one retina policy for the app is worth more than the extra
 * sharpness a 3x thumbnail would buy. DOO-19 capped at 2 to protect the board's fill
 * rate, and a static 100px raster has no frame budget to defend — but a thumbnail
 * that renders at 3x while the board it previews renders at 2x is a seam a future
 * reader has to re-derive, and at this size 2x is already past where the voxel edges
 * resolve (see the before/after crops on DOO-21).
 *
 * `drawThumb` needs no change for this: it derives every coordinate from
 * `canvas.width`/`height`, so a bigger buffer draws the same picture bigger. Its two
 * stroke widths are the exception — they are literals, so they stay device pixels and
 * get finer as the ratio rises. At 2x that reads as a crisper hairline rather than a
 * thinner line, which is the direction a retina fix should move anyway.
 *
 * @returns {number} the ratio applied, so a caller can report it
 */
export function sizeThumbCanvas(canvas, size = THUMB_SIZE, dpr = globalThis.devicePixelRatio) {
  const ratio = resolvePixelRatio(dpr);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  return ratio;
}

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
      sizeThumbCanvas(thumb);
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
