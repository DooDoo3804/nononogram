// render/thumbnail.js — puzzle-list preview.
//
// Plain 2D isometric voxels on a 2D canvas: a second WebGL context per card would
// cost far more than this, and browsers cap how many live contexts exist at once.
//
// Public API:
//   THUMB_THEME                              the default palette (override to restyle)
//   THUMB_MARGIN                             how much of the canvas the drawing leaves alone
//   thumbFit(dims, w, h, margin?)            the projection's scale and origin
//   drawThumb(canvas, dims, cells, theme?)   paint one preview

import { idx } from '../puzzle.js';

export const THUMB_THEME = {
  background: '#ecdfc0',
  voxel: '#2c2417',
  voxelEdge: '#ecdfc0',
  frame: '#b6934f',
};

// Share of the canvas the drawing is allowed to span. The rest is the gap between the
// silhouette and the gold frame: 4% a side is 4 buffer px on a 1x card and 8 on a 2x one,
// which clears the 2px frame stroke with room to spare at the worst ratio. It reads wider
// than that, because an isometric silhouette's extremes are the four diamond tips — the
// corners of the bbox this margin is applied to are empty cream.
export const THUMB_MARGIN = 0.92;

/**
 * Scale and origin for the isometric projection `drawThumb` paints with (DOO-24).
 *
 * A voxel at `(x, y, z)` becomes a diamond centred at
 *
 *   ix = cx + (x - z) * s
 *   iy = cy + (x + z) * s / 2 - y * s
 *
 * with half-width `s` and half-height `s / 2`. So the span of a filled box, in units of
 * `s`, is not `dims.x + dims.y + dims.z` — that counts each axis once at full weight,
 * which is neither how wide nor how tall any of them draws:
 *
 *   width   (x - z) runs over dims.x + dims.z - 2, plus a tip either side  ->  dx + dz
 *   height  (x + z) / 2 runs over (dims.x + dims.z - 2) / 2 and y over
 *           dims.y - 1, plus a tip top and bottom                         ->  (dx + dz - 2) / 2 + dy
 *
 * Fitting `min(w, h) / (dx + dy + dz)` instead left a box-filling shape on 33-38% of the
 * canvas: it over-charged the width for `dims.y`, which only draws vertically, and the
 * height for half of `dims.x + dims.z`. Same defect as DOO-22's camera `tan` fit, one
 * dimension down.
 *
 * `cx`/`cy` then centre *that* span. The old origin was the box's own, so the `(x + z)`
 * term pushed the drawing down by half its own depth and nothing pulled it back — a
 * constant 16% low.
 *
 * Fits the whole cell box rather than the filled cells on purpose: the scale has to be a
 * property of the puzzle, not of how much of it the player has solved, or a card would
 * re-zoom on every cell and two cards of different sizes would look the same size.
 */
export function thumbFit(dims, w, h, margin = THUMB_MARGIN) {
  const spanX = dims.x + dims.z;
  const spanY = (dims.x + dims.z - 2) / 2 + dims.y;
  const s = Math.min((w * margin) / spanX, (h * margin) / spanY);
  return {
    s,
    cx: w / 2 - ((dims.x - dims.z) * s) / 2,
    cy: h / 2 - (((dims.x + dims.z - 2) / 2 - (dims.y - 1)) * s) / 2,
  };
}

export function drawThumb(canvas, dims, cells, theme = THUMB_THEME) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  const { s, cx, cy } = thumbFit(dims, w, h);

  const voxels = [];
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++)
        if (cells[idx(dims, x, y, z)]) voxels.push([x, y, z]);

  // Painter's order: nearer voxels (larger x+z, smaller y) drawn last.
  voxels.sort((a, b) => a[0] + a[2] - a[1] - (b[0] + b[2] - b[1]));

  for (const [x, y, z] of voxels) {
    const ix = cx + (x - z) * s;
    const iy = cy + (x + z) * s * 0.5 - y * s;
    ctx.fillStyle = theme.voxel;
    ctx.beginPath();
    ctx.moveTo(ix, iy - s * 0.5);
    ctx.lineTo(ix + s, iy);
    ctx.lineTo(ix, iy + s * 0.5);
    ctx.lineTo(ix - s, iy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = theme.voxelEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}
