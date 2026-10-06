// tests/thumb-framing.test.js — the puzzle-card thumbnail's framing contract (DOO-24).
//
// The same question `tests/framing.test.js` asks of the 3D camera, asked of the 2D
// preview: **does the drawing use the canvas it was given, centred?** It was the same
// answer in both places, too — a fit formula that charged a dimension to the wrong axis,
// here leaving a box-filling shape on 33-38% of the canvas and 16% low.
//
// ## Why a recording context rather than a real canvas
//
// Node has no `CanvasRenderingContext2D`, and installing one to read back pixels would
// buy nothing: the property under test is where `drawThumb` *puts* its geometry, which
// its own draw calls state exactly. So the stub below records every path vertex and the
// bbox falls out of it. That runs on every commit with no browser, while the in-browser
// backstop — a real card, a real DPR, real pixels — is `tests/thumb-dpr.mjs`.
//
// The one thing this cannot see is the half-pixel the 1px voxel stroke adds outside the
// path, which is why the numbers here sit ~1.5pp under the rasterised ones in DOO-24.
//
// ## Why 85% on both axes is not the gate
//
// DOO-24 asked for an ink bbox at >= 85% of the canvas on *each* axis. That is
// unreachable, and not because of the margin: the projection's aspect is fixed by the
// box, at `(dx + dz) : ((dx + dz - 2) / 2 + dy)` — 6:5 for a 3³ puzzle. Uniform scale in
// a square canvas therefore caps 3³'s short axis at 83.3% even with zero margin, and the
// only ways past it are a non-square canvas (the card grid is built on a 100px square) or
// an anisotropic scale (which stops the diamonds tiling). So the gate is the two
// properties that *are* achievable and that the defect violated: the binding axis spans
// the full margin, and the bbox is centred.

import { describe, expect, it } from 'vitest';
import { drawThumb, thumbFit, THUMB_MARGIN } from '../render/thumbnail.js';

// Every shipped box shape plus the level-curve extremes, matching tests/framing.test.js.
const DIMS = [
  { x: 3, y: 3, z: 3 },
  { x: 4, y: 4, z: 4 },
  { x: 5, y: 4, z: 5 },
  { x: 5, y: 5, z: 5 },
  { x: 6, y: 5, z: 6 },
  { x: 6, y: 6, z: 6 },
  { x: 3, y: 3, z: 2 },
  { x: 5, y: 4, z: 3 },
  { x: 6, y: 5, z: 4 },
];

/** A 2D context that draws nothing and remembers where it was asked to. */
function recordingCanvas(width, height = width) {
  const path = [];
  const rects = [];
  const ctx = {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    strokeRect(...args) { rects.push(args); },
    // `drawThumb` assigns these; a plain object would accept them, but spelling them out
    // keeps the stub from silently absorbing a future call it should have failed on.
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };
  return { canvas: { width, height, getContext: () => ctx }, path, rects };
}

/**
 * Where the ink lands for a *box-filling* shape, as a share of the canvas. Filling every
 * cell is what makes this a framing measurement rather than a shape one: it is the
 * largest silhouette the puzzle can produce, so it is the one the fit has to hold.
 */
function inkBox(dims, size, cells) {
  const filled = cells ?? new Array(dims.x * dims.y * dims.z).fill(1);
  const rec = recordingCanvas(size);
  drawThumb(rec.canvas, dims, filled);
  expect(rec.path.length, 'drawThumb drew no voxels').toBeGreaterThan(0);
  const xs = rec.path.map((p) => p[0]);
  const ys = rec.path.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return {
    width: (x1 - x0) / size,
    height: (y1 - y0) / size,
    offsetX: ((x0 + x1) / 2 - size / 2) / size,
    offsetY: ((y0 + y1) / 2 - size / 2) / size,
    bounds: { x0, x1, y0, y1 },
  };
}

/** The fit this replaced: one scale per axis-sum, origin at the box rather than the ink. */
function legacyFit(dims, w, h) {
  const s = Math.min(w, h) / (dims.x + dims.y + dims.z);
  return { s, cx: w / 2, cy: h / 2 + (dims.y * s) / 2 };
}

describe('thumbFit', () => {
  for (const dims of DIMS) {
    const label = `${dims.x}x${dims.y}x${dims.z}`;

    it(`${label}: the binding axis spans the whole margin`, () => {
      const ink = inkBox(dims, 200);
      // One axis reaches the margin exactly and the other is its aspect-bound ceiling;
      // which of the two binds depends on the box, so assert the max.
      expect(Math.max(ink.width, ink.height)).toBeCloseTo(THUMB_MARGIN, 6);
    });

    it(`${label}: the ink is centred, not pushed off by the depth term`, () => {
      const ink = inkBox(dims, 200);
      expect(Math.abs(ink.offsetX)).toBeLessThan(0.005);
      expect(Math.abs(ink.offsetY)).toBeLessThan(0.005);
    });

    it(`${label}: the short axis sits at its geometric ceiling, margin / aspect`, () => {
      // The real assertion against a half-fixed formula: getting the span of one axis
      // right while the other stays over-charged would pass the test above.
      const ink = inkBox(dims, 200);
      const spanX = dims.x + dims.z;
      const spanY = (dims.x + dims.z - 2) / 2 + dims.y;
      expect(ink.width / ink.height).toBeCloseTo(spanX / spanY, 6);
      expect(Math.min(ink.width, ink.height)).toBeCloseTo(
        THUMB_MARGIN / Math.max(spanX / spanY, spanY / spanX),
        6,
      );
    });

    it(`${label}: nothing is drawn outside the canvas`, () => {
      const { bounds } = inkBox(dims, 200);
      // Half a pixel of slack for the 1px voxel stroke straddling the path.
      expect(bounds.x0).toBeGreaterThanOrEqual(0.5);
      expect(bounds.y0).toBeGreaterThanOrEqual(0.5);
      expect(bounds.x1).toBeLessThanOrEqual(199.5);
      expect(bounds.y1).toBeLessThanOrEqual(199.5);
    });

    it(`${label}: beats the fit it replaced on area by at least 1.6x`, () => {
      // Guards the guard. DOO-24 measured 33-38% of the canvas before; if `inkBox` were
      // measuring nothing in particular, the known-bad fit would look fine to it too.
      //
      // Measured gain over the shipped box shapes: 1.29-1.47x on the voxel's edge, so
      // 1.66-2.17x on area. The floor is the boxes with the shallowest `dims.y` relative
      // to `dims.x + dims.z` (5x4x5, 6x5x6), where the old denominator was least wrong.
      const ink = inkBox(dims, 200);
      const legacy = legacyFit(dims, 200, 200);
      const now = thumbFit(dims, 200, 200);
      expect((now.s / legacy.s) ** 2).toBeGreaterThan(1.6);
      // And in absolute terms: 67.7-77.6% of the canvas now, 35.2-40.7% before. The
      // spread is the projection aspect, which the margin cannot flatten.
      expect(ink.width * ink.height).toBeGreaterThan(0.67);
    });
  }

  it('is independent of the buffer size, so the DOO-21 retina fix cannot shift it', () => {
    // `drawThumb` derives everything from `canvas.width`, and DOO-21 made that 1x or 2x
    // depending on the display. The framing has to be the same picture either way.
    for (const dims of DIMS) {
      const small = inkBox(dims, 100);
      const large = inkBox(dims, 200);
      expect(large.width).toBeCloseTo(small.width, 9);
      expect(large.height).toBeCloseTo(small.height, 9);
      expect(large.offsetX).toBeCloseTo(small.offsetX, 9);
      expect(large.offsetY).toBeCloseTo(small.offsetY, 9);
    }
  });

  it('lets height bind on a tall box, rather than overflowing it', () => {
    // No shipped puzzle is this shape, but `Math.min` is the only thing standing between
    // one and a drawing that runs off the top of the card.
    const tall = { x: 2, y: 8, z: 2 };
    const ink = inkBox(tall, 200);
    expect(ink.height).toBeCloseTo(THUMB_MARGIN, 6);
    expect(ink.width).toBeLessThan(THUMB_MARGIN);
    expect(ink.bounds.y0).toBeGreaterThanOrEqual(0.5);
  });

  it('frames a non-square canvas by its narrower axis', () => {
    const rec = recordingCanvas(300, 150);
    drawThumb(rec.canvas, { x: 4, y: 4, z: 4 }, new Array(64).fill(1));
    const ys = rec.path.map((p) => p[1]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(149.5);
    // Still centred on both axes, which is the half of the bug that had nothing to do
    // with scale.
    const xs = rec.path.map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(150, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(75, 6);
  });

  it('centres a partly-solved card the same as a full one — the scale is the puzzle’s', () => {
    // A thumbnail shows progress, so its contents change as the player fills cells. If
    // the fit followed the ink, every cell would re-zoom the card and the sizes of two
    // different puzzles would stop being comparable.
    const dims = { x: 4, y: 4, z: 4 };
    const one = new Array(64).fill(0);
    one[0] = 1;
    const sparse = thumbFit(dims, 200, 200);
    const full = thumbFit(dims, 200, 200);
    expect(sparse).toEqual(full);
    const ink = inkBox(dims, 200, one);
    // One voxel, so the bbox is that diamond: 2s wide, s tall, somewhere inside.
    expect(ink.width).toBeCloseTo((2 * full.s) / 200, 9);
    expect(ink.height).toBeCloseTo(full.s / 200, 9);
  });

  it('leaves the gold frame its own pixels at the smallest shipped buffer', () => {
    // The frame is `strokeRect(1, 1, ...)` at lineWidth 2, so it owns buffer px 0-2. On a
    // 1x card that is 2% of the canvas and the margin is the only thing keeping the
    // silhouette off it.
    //
    // Measured against the *stroked* edge, not the path: the voxel outline is lineWidth 1
    // and straddles the path, so ink reaches half a pixel outside the bbox this records
    // (the same slack the overflow test above allows). Clearing the frame therefore needs
    // 2.5, and that is the assertion that actually prices the margin — at a 100px buffer
    // the inset is 100 * (1 - margin) / 2, so 0.92 clears by 1.5px, 0.94 by 0.5px, and
    // 0.96 lands the tips *on* the frame stroke at -0.5. 1x is the binding case: a 2x card
    // gets twice the inset against the same literal stroke widths.
    const FRAME_PX = 2.5;
    const ink = inkBox({ x: 6, y: 6, z: 6 }, 100);
    expect(ink.bounds.x0).toBeGreaterThan(FRAME_PX);
    expect(100 - ink.bounds.x1).toBeGreaterThan(FRAME_PX);
    expect(ink.bounds.y0).toBeGreaterThan(FRAME_PX);
    expect(100 - ink.bounds.y1).toBeGreaterThan(FRAME_PX);
  });

  it('keeps a margin worth having — between touching the frame and wasting the card', () => {
    // The loose end of the band. The tight end is the frame-clearance test above, which
    // is arithmetic rather than taste: it caps the margin just under 0.95.
    expect(THUMB_MARGIN).toBeGreaterThan(0.85);
    expect(THUMB_MARGIN).toBeLessThan(0.97);
  });
});
