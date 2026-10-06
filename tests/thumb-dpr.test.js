// The puzzle-card thumbnail's retina policy (DOO-21). `sizeThumbCanvas` is pure enough
// to drive with a plain object — the only DOM it touches is `width`, `height` and
// `style` — so the contract is testable without a browser. The browser-side assertion
// that a real card on a real DPR-2 viewport ends up this way lives in
// `tests/thumb-dpr.mjs`.
//
// The defect being guarded: `canvas.width` is the drawing buffer, not the layout box.
// Set to the CSS size it renders at 1x on every retina screen and the compositor
// upscales the result.

import { describe, it, expect } from 'vitest';
import { sizeThumbCanvas, THUMB_SIZE } from '../ui/menu.js';
import { MAX_PIXEL_RATIO } from '../render/scene.js';

const fakeCanvas = () => ({ width: 0, height: 0, style: {} });

describe('sizeThumbCanvas', () => {
  it('leaves a 1x display alone — desktop pays nothing for this fix', () => {
    const c = fakeCanvas();
    expect(sizeThumbCanvas(c, 100, 1)).toBe(1);
    expect([c.width, c.height]).toEqual([100, 100]);
    expect([c.style.width, c.style.height]).toEqual(['100px', '100px']);
  });

  it('gives a DPR-2 phone a 2x buffer behind an unchanged CSS box', () => {
    const c = fakeCanvas();
    expect(sizeThumbCanvas(c, 100, 2)).toBe(2);
    expect([c.width, c.height]).toEqual([200, 200]);
    // The CSS box must not move: the card grid is laid out around 100px, and a canvas
    // with no style falls back to its buffer size as its intrinsic size — which would
    // make the DPR-2 card twice as wide as the DPR-1 one.
    expect([c.style.width, c.style.height]).toEqual(['100px', '100px']);
  });

  it('shares the board’s cap, so one retina policy covers the app', () => {
    for (const dpr of [2.625, 3, 4]) {
      const c = fakeCanvas();
      expect(sizeThumbCanvas(c, 100, dpr)).toBe(MAX_PIXEL_RATIO);
      expect(c.width).toBe(100 * MAX_PIXEL_RATIO);
    }
  });

  it('never leaves a 1x buffer on a retina display — the bug itself', () => {
    for (const dpr of [1.5, 2, 2.625, 3]) {
      const c = fakeCanvas();
      sizeThumbCanvas(c, 100, dpr);
      expect(c.width).toBeGreaterThan(100);
    }
  });

  it('falls back to 1x rather than a zero-area buffer on a nonsense ratio', () => {
    // A 0 or NaN ratio is worse than a blurry thumbnail: `canvas.width = NaN` is a
    // 0x0 drawing buffer, and `getImageData` on one throws.
    for (const bad of [undefined, null, NaN, 0, -2, Infinity, 'two']) {
      const c = fakeCanvas();
      expect(sizeThumbCanvas(c, 100, bad)).toBe(1);
      expect([c.width, c.height]).toEqual([100, 100]);
    }
  });

  it('keeps the buffer a whole number of pixels', () => {
    // `canvas.width` truncates whatever it is handed, so a fractional product would
    // silently lose the last column. Not reachable at today's integer cap and size;
    // it is the guard for raising either.
    const c = fakeCanvas();
    sizeThumbCanvas(c, 99.5, 2);
    expect(c.width).toBe(199);
    expect(c.style.width).toBe('99.5px');
  });

  it('defaults to the size the menu actually uses', () => {
    const c = fakeCanvas();
    sizeThumbCanvas(c, undefined, 1);
    expect(c.width).toBe(THUMB_SIZE);
  });
});
