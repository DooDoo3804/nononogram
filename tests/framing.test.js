// tests/framing.test.js — the camera framing contract (DOO-22).
//
// The one property worth a test here is "the whole board is on screen", and it is not
// a property of a formula — it is a property of the eight projected corners of the cell
// box plus the gizmo's label sprites, under the real perspective matrix, at every angle
// OrbitControls lets a player reach. So that is what this asserts: THREE's own camera,
// THREE's own `project()`, and a sweep of orbit directions.
//
// It is here rather than in the browser gates because it needs no GL — projection is
// matrix maths — which makes it the cheap check that runs on every commit, with
// `scripts/bench-render.mjs`'s `cover`/`clipped` column as the in-browser backstop.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FIT_MARGIN, fitDistanceFor, fitRadiusFor, refitDistance } from '../render/scene.js';
import { CELL_SIZE, GAP } from '../render/voxels.js';

const FOV = 45;

// Every shipped box shape, plus the two extremes of the level curve.
const DIMS = [
  { x: 3, y: 3, z: 3 },
  { x: 4, y: 4, z: 4 },
  { x: 5, y: 4, z: 5 },
  { x: 5, y: 5, z: 5 },
  { x: 6, y: 5, z: 6 },
  { x: 6, y: 6, z: 6 },
  { x: 3, y: 3, z: 2 },
];

// Canvas aspects the DOO-18 layout actually produces, measured off
// `tests/board-viewport.mjs`'s matrix, plus two beyond either end as guard rails.
const ASPECTS = [
  { label: 'phone portrait', aspect: 402 / 579 },
  { label: 'phone landscape', aspect: 585 / 402 },
  { label: 'iphone-se square-ish', aspect: 365 / 360 },
  { label: 'ipad portrait', aspect: 758 / 688 },
  { label: 'desktop', aspect: 848 / 462 },
  { label: 'absurdly wide', aspect: 8 },
  { label: 'absurdly tall', aspect: 0.125 },
];

/** Everything that must stay in frame, in world space. */
function boardPoints(dims) {
  const span = (n) => (n - 1) * GAP + CELL_SIZE;
  const h = [span(dims.x) / 2, span(dims.y) / 2, span(dims.z) / 2];
  const pts = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) pts.push(new THREE.Vector3(sx * h[0], sy * h[1], sz * h[2]));
  return pts;
}

/** The gizmo's three label sprites, as their centres (extent added at project time). */
function labelCentres(dims) {
  return [
    new THREE.Vector3(((dims.x * GAP) / 2 + 0.6) * 1.15, 0, 0),
    new THREE.Vector3(0, ((dims.y * GAP) / 2 + 0.6) * 1.15, 0),
    new THREE.Vector3(0, 0, ((dims.z * GAP) / 2 + 0.6) * 1.15),
  ];
}

/**
 * Worst |x| / |y| in NDC over a sweep of orbit directions. Anything above 1 is off the
 * canvas — that is the entire definition of "the board got clipped".
 */
function worstExcursion(dims, aspect, { margin = FIT_MARGIN, fit = fitDistanceFor, steps = 24 } = {}) {
  const radius = fitRadiusFor(dims);
  const distance = fit(radius, { fov: FOV, aspect, margin });
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 1000);
  const corners = boardPoints(dims);
  const labels = labelCentres(dims);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  let worst = 0;

  for (let i = 0; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const theta = (i / steps) * Math.PI * 2;
      const phi = (j / steps) * Math.PI;
      camera.position.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ).multiplyScalar(distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);

      for (const p of corners) {
        const n = p.clone().project(camera);
        worst = Math.max(worst, Math.abs(n.x), Math.abs(n.y));
      }
      // A sprite is camera-facing and size-attenuated, so its half-extent is 0.25 world
      // units along camera-right and camera-up whatever the view direction.
      for (const c of labels) {
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const n = c.clone().addScaledVector(right, sx * 0.25).addScaledVector(up, sy * 0.25).project(camera);
            worst = Math.max(worst, Math.abs(n.x), Math.abs(n.y));
          }
        }
      }
    }
  }
  return worst;
}

/** The framing this replaced: `radius / tan`, which is the orthographic fit. */
const tanFit = (radius, { fov, aspect, margin }) =>
  (radius * margin) / (Math.tan((fov * Math.PI) / 360) * Math.min(1, aspect));

describe('fitRadiusFor', () => {
  it('bounds the whole cell box, not just the centres', () => {
    // Half the body diagonal of the 6³ box: cells are GAP apart and CELL_SIZE across.
    const span = 5 * GAP + CELL_SIZE;
    expect(fitRadiusFor({ x: 6, y: 6, z: 6 })).toBeCloseTo(0.5 * Math.hypot(span, span, span), 6);
  });

  it('lets the gizmo labels set the frame on small puzzles, where they reach past the box', () => {
    // At 3³ the X/Y/Z sprites sit outside the box corners, so a box-only fit would cut
    // them off; at 6³ the box has overtaken them again.
    const small = { x: 3, y: 3, z: 3 };
    const span3 = 2 * GAP + CELL_SIZE;
    expect(fitRadiusFor(small)).toBeGreaterThan(0.5 * Math.hypot(span3, span3, span3));
    const big = { x: 6, y: 6, z: 6 };
    const span6 = 5 * GAP + CELL_SIZE;
    expect(fitRadiusFor(big)).toBeCloseTo(0.5 * Math.hypot(span6, span6, span6), 6);
  });

  it('grows with the longest side, so a flat box is not framed like a cube', () => {
    expect(fitRadiusFor({ x: 6, y: 6, z: 6 })).toBeGreaterThan(fitRadiusFor({ x: 6, y: 6, z: 2 }));
  });
});

describe('fitDistanceFor', () => {
  it('fits to the narrower half-angle, so a portrait canvas is limited by its width', () => {
    const radius = fitRadiusFor({ x: 6, y: 6, z: 6 });
    const portrait = fitDistanceFor(radius, { fov: FOV, aspect: 0.5 });
    const square = fitDistanceFor(radius, { fov: FOV, aspect: 1 });
    const landscape = fitDistanceFor(radius, { fov: FOV, aspect: 2 });
    expect(portrait).toBeGreaterThan(square);
    // Past square the vertical angle is the narrow one and nothing more is gained, which
    // is why a landscape canvas and a square one frame the board identically.
    expect(landscape).toBeCloseTo(square, 6);
  });

  it('is sphere tangency, not the orthographic fit — 1/cos(fov/2) farther', () => {
    const radius = fitRadiusFor({ x: 6, y: 6, z: 6 });
    const ours = fitDistanceFor(radius, { fov: FOV, aspect: 2 });
    const ortho = tanFit(radius, { fov: FOV, aspect: 2, margin: 1 });
    expect(ours / ortho).toBeCloseTo(1 / Math.cos((FOV * Math.PI) / 360), 6);
    expect(ours / ortho).toBeCloseTo(1.0824, 3);
  });

  it('scales linearly with the margin', () => {
    const radius = fitRadiusFor({ x: 5, y: 5, z: 5 });
    const one = fitDistanceFor(radius, { fov: FOV, aspect: 1.5, margin: 1 });
    expect(fitDistanceFor(radius, { fov: FOV, aspect: 1.5, margin: 1.25 })).toBeCloseTo(one * 1.25, 6);
  });
});

describe('nothing leaves the canvas at the shipped margin', () => {
  for (const { label, aspect } of ASPECTS) {
    it(`${label} (aspect ${aspect.toFixed(3)}): every box corner and axis label stays in frame at every orbit angle`, () => {
      for (const dims of DIMS) {
        const worst = worstExcursion(dims, aspect);
        expect(
          worst,
          `${dims.x}x${dims.y}x${dims.z} reached ${worst.toFixed(4)} of the frame`,
        ).toBeLessThanOrEqual(1 + 1e-6);
      }
    });
  }

  it('fits tightly rather than timidly — the board reaches the frame edge somewhere', () => {
    // A fit that never approaches 1 is wasting the canvas, which on a landscape phone is
    // the difference between clearing the cell-aperture floor and missing it. Tangency
    // means some orbit angle must put the board right on the edge.
    const worst = worstExcursion({ x: 6, y: 6, z: 6 }, 585 / 402, { steps: 48 });
    expect(worst).toBeGreaterThan(0.97);
  });

  it('catches the orthographic fit it replaced — which clipped by ~10%', () => {
    // Guards the guard: if `worstExcursion` were measuring nothing, the known-bad
    // framing would pass it too.
    const worst = worstExcursion({ x: 6, y: 6, z: 6 }, 848 / 462, { fit: tanFit });
    expect(worst).toBeGreaterThan(1.09);
  });

  it('a bigger margin only ever pulls back', () => {
    expect(worstExcursion({ x: 6, y: 6, z: 6 }, 1.5, { margin: 1.2 })).toBeLessThan(
      worstExcursion({ x: 6, y: 6, z: 6 }, 1.5, { margin: 1 }),
    );
  });
});

describe('refitDistance', () => {
  it('keeps the opening shot at the opening shot', () => {
    expect(refitDistance(20, 20, 14)).toBeCloseTo(14, 9);
  });

  it('preserves zoom as a ratio, so rotating the phone does not undo a pinch', () => {
    // Half the framing distance before the rotation, half of the new one after it.
    expect(refitDistance(10, 20, 14)).toBeCloseTo(7, 9);
    expect(refitDistance(40, 20, 14)).toBeCloseTo(28, 9);
  });

  it('is idempotent, so a burst of resize events cannot walk the camera', () => {
    // A mobile URL bar fires a resize on every scroll; three in a row at the same shape
    // must land in exactly the same place as one.
    let distance = refitDistance(20, 20, 14);
    for (let i = 0; i < 64; i++) distance = refitDistance(distance, 14, 14);
    expect(distance).toBeCloseTo(14, 9);
  });

  it('falls back to the plain fit before anything has been framed', () => {
    expect(refitDistance(0, 0, 14)).toBe(14);
    expect(refitDistance(5, 0, 14)).toBe(14);
  });
});
