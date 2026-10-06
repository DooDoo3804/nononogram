// The retina policy from render/scene.js (DOO-19). Pure function, so it is unit
// testable without a WebGL context — the browser-side assertion that the drawing
// buffer really is this size lives in scripts/bench-render.mjs and the viewport gate.

import { describe, it, expect } from 'vitest';
import { resolvePixelRatio, MAX_PIXEL_RATIO } from '../render/scene.js';

describe('resolvePixelRatio', () => {
  it('passes a desktop 1x through untouched', () => {
    expect(resolvePixelRatio(1)).toBe(1);
  });

  it('honours a DPR-2 device exactly — tablets pay no approximation', () => {
    expect(resolvePixelRatio(2)).toBe(2);
  });

  it('clamps a DPR-3 phone to the cap rather than paying 9x the fill rate', () => {
    expect(resolvePixelRatio(3)).toBe(MAX_PIXEL_RATIO);
    expect(resolvePixelRatio(2.625)).toBe(MAX_PIXEL_RATIO);
  });

  it('still beats the old 1x buffer on every retina device', () => {
    // The bug this replaces: the buffer was CSS pixels whatever the device said.
    for (const dpr of [1.5, 2, 2.625, 3, 4]) {
      expect(resolvePixelRatio(dpr)).toBeGreaterThan(1);
    }
  });

  it('takes a caller-supplied cap, which is how the bench sweeps it', () => {
    expect(resolvePixelRatio(3, 1)).toBe(1);
    expect(resolvePixelRatio(3, 2.625)).toBe(2.625);
    expect(resolvePixelRatio(3, 4)).toBe(3);
  });

  // A canvas sized 0 or NaN is worse than a blurry one: three multiplies the CSS box
  // by this, so a bad ratio is a zero-area drawing buffer and a black screen.
  it('falls back to 1x for a missing or nonsense devicePixelRatio', () => {
    for (const bad of [undefined, null, NaN, 0, -2, Infinity, 'two']) {
      expect(resolvePixelRatio(bad)).toBe(1);
    }
  });

  it('falls back to 1x for a nonsense cap', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(resolvePixelRatio(2, bad)).toBe(1);
    }
  });
});
