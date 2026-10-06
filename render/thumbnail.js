// render/thumbnail.js — puzzle-list preview.
//
// Plain 2D isometric voxels on a 2D canvas: a second WebGL context per card would
// cost far more than this, and browsers cap how many live contexts exist at once.
//
// Public API:
//   THUMB_THEME                              the default palette (override to restyle)
//   drawThumb(canvas, dims, cells, theme?)   paint one preview

import { idx } from '../puzzle.js';

export const THUMB_THEME = {
  background: '#ecdfc0',
  voxel: '#2c2417',
  voxelEdge: '#ecdfc0',
  frame: '#b6934f',
};

export function drawThumb(canvas, dims, cells, theme = THUMB_THEME) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  const s = Math.min(w, h) / (dims.x + dims.y + dims.z);
  const cx = w / 2;
  const cy = h / 2 + (dims.y * s) / 2;

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
