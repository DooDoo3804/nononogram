// tests/voxels.test.js — the instanced voxel grid.
//
// Three kinds of test here:
//
//   - the geometry helpers, which are pure and carry the whole cell layout;
//   - the three.js behaviours the instanced grid *relies on* — instance raycasting
//     reporting an `instanceId`, `Raycaster` still hitting an object whose `visible`
//     is false, `count` bounding the raycast, and the bounding sphere being cached
//     after the first one. Every one of those is load-bearing, and a three upgrade
//     that changes any of them breaks every click in the game silently;
//   - the grid itself, including `pick()` under a layer window. `createVoxelGrid`
//     only touches the DOM to rasterize the MARKED cross into a CanvasTexture, so a
//     six-method canvas stub is enough to build and raycast the real thing in node.
//     Worth the stub: whether a peeled layer stops swallowing clicks is the whole of
//     DOO-17, and it is not a property of a pure helper.
//
// End-to-end picking through a real WebGL context is covered by
// `scripts/verify-browser.mjs`, `scripts/bench-render.mjs` and `scripts/probe-aim.mjs`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import {
  cellCenters,
  outlinePositions,
  cellLayer,
  normalizeLayerWindow,
  layerWindowHolds,
  createVoxelGrid,
  GAP,
  CELL_SIZE,
} from '../render/voxels.js';
import { idx } from '../puzzle.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

const DIMS = [
  { x: 3, y: 3, z: 3 },
  { x: 6, y: 6, z: 6 },
  { x: 5, y: 3, z: 4 }, // non-cubic: level variants are boxes, not only cubes
  { x: 1, y: 1, z: 1 },
];

describe('cellCenters', () => {
  it.each(DIMS)('has one centre per cell for $x×$y×$z', (dims) => {
    expect(cellCenters(dims).length).toBe(dims.x * dims.y * dims.z * 3);
  });

  it.each(DIMS)('indexes centres exactly like puzzle.js idx() for $x×$y×$z', (dims) => {
    const centers = cellCenters(dims, GAP);
    const ox = (dims.x - 1) / 2;
    const oy = (dims.y - 1) / 2;
    const oz = (dims.z - 1) / 2;
    for (let x = 0; x < dims.x; x++)
      for (let y = 0; y < dims.y; y++)
        for (let z = 0; z < dims.z; z++) {
          const i = idx(dims, x, y, z);
          expect(centers[i * 3]).toBeCloseTo((x - ox) * GAP, 5);
          expect(centers[i * 3 + 1]).toBeCloseTo((y - oy) * GAP, 5);
          expect(centers[i * 3 + 2]).toBeCloseTo((z - oz) * GAP, 5);
        }
  });

  it.each(DIMS)('centres $x×$y×$z on the origin, so frameCamera() can aim at 0,0,0', (dims) => {
    const centers = cellCenters(dims);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < centers.length; i += 3) {
      sx += centers[i];
      sy += centers[i + 1];
      sz += centers[i + 2];
    }
    expect(sx).toBeCloseTo(0, 5);
    expect(sy).toBeCloseTo(0, 5);
    expect(sz).toBeCloseTo(0, 5);
  });

  it('spaces neighbours exactly one GAP apart', () => {
    const dims = { x: 2, y: 1, z: 1 };
    const c = cellCenters(dims, GAP);
    expect(c[3] - c[0]).toBeCloseTo(GAP, 5);
  });
});

describe('outlinePositions', () => {
  it.each(DIMS)('emits 12 edges (24 endpoints) per cell for $x×$y×$z', (dims) => {
    const cells = dims.x * dims.y * dims.z;
    expect(outlinePositions(dims).length).toBe(cells * 24 * 3);
  });

  it('matches what EdgesGeometry(BoxGeometry) produces for one cell', () => {
    // The old renderer drew one EdgesGeometry LineSegments per cell. Merging them by
    // hand must describe the same 12 segments, or the board changes appearance.
    const mine = outlinePositions({ x: 1, y: 1, z: 1 }, GAP, CELL_SIZE);
    const box = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const theirs = new THREE.EdgesGeometry(box).getAttribute('position').array;

    const key = (a, i) => [a[i], a[i + 1], a[i + 2]].map((n) => n.toFixed(4)).join(',');
    const segments = (a) => {
      const out = [];
      for (let i = 0; i < a.length; i += 6) out.push([key(a, i), key(a, i + 3)].sort().join(' -> '));
      return out.sort();
    };

    expect(segments(mine)).toEqual(segments(theirs));
  });

  it('builds each cell edge soup around that cell centre', () => {
    const dims = { x: 2, y: 1, z: 1 };
    const centers = cellCenters(dims, GAP);
    const pos = outlinePositions(dims, GAP, CELL_SIZE);
    const perCell = 24 * 3;
    for (let c = 0; c < 2; c++) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = c * perCell; i < (c + 1) * perCell; i += 3) {
        minX = Math.min(minX, pos[i]);
        maxX = Math.max(maxX, pos[i]);
      }
      expect((minX + maxX) / 2).toBeCloseTo(centers[c * 3], 5);
      expect(maxX - minX).toBeCloseTo(CELL_SIZE, 5);
    }
  });
});

// The two three.js guarantees the instanced grid is built on.
describe('three.js instance raycasting contract', () => {
  const build = () => {
    const geo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), 3);
    const m = new THREE.Matrix4();
    // three cells in a row along x, 2 units apart
    [-2, 0, 2].forEach((x, i) => mesh.setMatrixAt(i, m.makeTranslation(x, 0, 0)));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.updateMatrixWorld(true);
    return mesh;
  };

  /** A ray aimed straight down -z at (x, 0). */
  const rayAt = (x) => {
    const r = new THREE.Raycaster();
    r.set(new THREE.Vector3(x, 0, 10), new THREE.Vector3(0, 0, -1));
    return r;
  };

  it('reports the instanceId of the instance that was hit', () => {
    const mesh = build();
    expect(rayAt(-2).intersectObject(mesh, false)[0]?.instanceId).toBe(0);
    expect(rayAt(0).intersectObject(mesh, false)[0]?.instanceId).toBe(1);
    expect(rayAt(2).intersectObject(mesh, false)[0]?.instanceId).toBe(2);
  });

  it('misses cleanly between instances', () => {
    expect(rayAt(1).intersectObject(build(), false).length).toBe(0);
  });

  it('still raycasts an InstancedMesh whose visible is false', () => {
    // LOAD-BEARING: render/voxels.js hides its hit mesh to spend 0 draw calls on it
    // while keeping BLANK cells clickable. If this ever fails, picking is broken —
    // give the hit mesh a colorWrite:false material and pay the one draw call.
    const mesh = build();
    mesh.visible = false;
    expect(rayAt(0).intersectObject(mesh, false)[0]?.instanceId).toBe(1);
  });

  it('keeps hidden children of a hidden parent matrix-current', () => {
    // The hit mesh lives under the grid group; the renderer updates world matrices
    // for the whole scene graph, visible or not.
    const mesh = build();
    mesh.visible = false;
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(5, 0, 0);
    group.updateMatrixWorld(true);
    expect(rayAt(5).intersectObject(mesh, false)[0]?.instanceId).toBe(1);
  });

  it('raycasts only the first `count` instances', () => {
    // LOAD-BEARING: the layer window is applied by compacting the held cells into the
    // front of the hit mesh and shrinking `count`. If a three upgrade ever raycast the
    // whole instanceMatrix instead, peeled cells would keep swallowing clicks and
    // DOO-17 would be back with no test failing.
    const mesh = build();
    mesh.count = 1;
    expect(rayAt(-2).intersectObject(mesh, false)[0]?.instanceId).toBe(0);
    expect(rayAt(2).intersectObject(mesh, false).length).toBe(0);
  });

  it('computes its bounding sphere once and caches it, stale count and all', () => {
    // LOAD-BEARING, and the reason render/voxels.js nulls `hit.boundingSphere` on every
    // window change. `InstancedMesh.raycast` early-outs on this sphere and only computes
    // it when it is null, so a sphere first computed over a narrow window survives the
    // window widening — and every ray that misses the old slab returns nothing. The
    // board would go dead to clicks at most angles, intermittently, depending on which
    // window happened to be set the first time the player clicked.
    const mesh = build();
    mesh.count = 1;
    expect(rayAt(-2).intersectObject(mesh, false)[0]?.instanceId).toBe(0); // caches
    mesh.count = 3;
    expect(rayAt(2).intersectObject(mesh, false).length).toBe(0); // stale sphere rejects
    mesh.boundingSphere = null;
    expect(rayAt(2).intersectObject(mesh, false)[0]?.instanceId).toBe(2);
  });
});

describe('cellLayer', () => {
  it.each(DIMS)('inverts idx() on every axis for $x×$y×$z', (dims) => {
    for (let x = 0; x < dims.x; x++)
      for (let y = 0; y < dims.y; y++)
        for (let z = 0; z < dims.z; z++) {
          const i = idx(dims, x, y, z);
          expect(cellLayer(dims, i, 'x')).toBe(x);
          expect(cellLayer(dims, i, 'y')).toBe(y);
          expect(cellLayer(dims, i, 'z')).toBe(z);
        }
  });

  it('accepts an axis rank as well as a name', () => {
    const dims = { x: 3, y: 4, z: 5 };
    const i = idx(dims, 2, 1, 3);
    expect([cellLayer(dims, i, 0), cellLayer(dims, i, 1), cellLayer(dims, i, 2)]).toEqual([2, 1, 3]);
  });
});

describe('normalizeLayerWindow', () => {
  const dims = { x: 6, y: 5, z: 4 };

  it('passes a window that is already inside the box through unchanged', () => {
    expect(normalizeLayerWindow(dims, { axis: 'z', from: 1, to: 2 })).toEqual({ axis: 'z', from: 1, to: 2 });
  });

  it('clamps both ends to the axis it is on', () => {
    expect(normalizeLayerWindow(dims, { axis: 'y', from: -3, to: 99 })).toBe(null); // -> full span
    expect(normalizeLayerWindow(dims, { axis: 'y', from: -3, to: 2 })).toEqual({ axis: 'y', from: 0, to: 2 });
    expect(normalizeLayerWindow(dims, { axis: 'y', from: 2, to: 99 })).toEqual({ axis: 'y', from: 2, to: 4 });
  });

  it('collapses a window that holds every layer to null', () => {
    // Not cosmetic: null is the one state that renders and picks exactly as the board
    // did before DOO-17, so the degenerate window must not put it on the new path.
    expect(normalizeLayerWindow(dims, { axis: 'x', from: 0, to: 5 })).toBe(null);
    expect(normalizeLayerWindow(dims, { axis: 'z', from: 0, to: 3 })).toBe(null);
  });

  it('sorts a reversed window rather than emptying the board', () => {
    expect(normalizeLayerWindow(dims, { axis: 'x', from: 4, to: 1 })).toEqual({ axis: 'x', from: 1, to: 4 });
  });

  it('rejects nonsense instead of inventing a window', () => {
    expect(normalizeLayerWindow(dims, null)).toBe(null);
    expect(normalizeLayerWindow(dims, { axis: 'w', from: 0, to: 1 })).toBe(null);
    expect(normalizeLayerWindow(dims, { axis: 'x', from: 'nope', to: 2 })).toEqual({ axis: 'x', from: 0, to: 2 });
  });

  it('holds exactly the cells between its ends', () => {
    const win = normalizeLayerWindow(dims, { axis: 'z', from: 1, to: 2 });
    for (let i = 0; i < dims.x * dims.y * dims.z; i++) {
      const z = cellLayer(dims, i, 'z');
      expect(layerWindowHolds(dims, win, i)).toBe(z >= 1 && z <= 2);
    }
  });

  it('holds everything when there is no window', () => {
    expect(layerWindowHolds(dims, null, 0)).toBe(true);
    expect(layerWindowHolds(dims, null, 119)).toBe(true);
  });
});

// --- the grid itself, raycast in node ------------------------------------------

/**
 * The whole DOM surface `createVoxelGrid` has: one canvas it draws the ✕ onto. Stubbed
 * rather than jsdom'd so `npm test` stays a plain node run (see vitest.config.js).
 */
function installCanvasStub() {
  const ctx2d = {
    strokeStyle: '', lineWidth: 0, lineCap: '',
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
}

describe('createVoxelGrid picking under a layer window', () => {
  // 4 wide, 1 tall, 4 deep: enough depth to have an interior, and enough width that a
  // ray can be aimed off to the side of a peeled slab (which is what the bounding
  // sphere test below needs).
  const dims = { x: 4, y: 1, z: 4 };
  const centers = cellCenters(dims, GAP);
  let had = false;

  beforeAll(() => {
    had = 'document' in globalThis;
    installCanvasStub();
  });
  afterAll(() => {
    if (!had) delete globalThis.document;
  });

  /** A ray straight down -z through the centre of column `x`. */
  function rayDownZ(x) {
    const r = new THREE.Raycaster();
    r.set(new THREE.Vector3(centers[idx(dims, x, 0, 0) * 3], 0, 10), new THREE.Vector3(0, 0, -1));
    return r;
  }

  function build() {
    const grid = createVoxelGrid(dims);
    grid.group.updateMatrixWorld(true);
    return grid;
  }

  const lineSegments = (grid) => grid.group.children.find((c) => c.isLineSegments);

  it('picks the frontmost cell when there is no window — the pre-DOO-17 rule', () => {
    const grid = build();
    expect(grid.pick(rayDownZ(1))).toBe(idx(dims, 1, 0, 3));
    expect(grid.layerWindow()).toBe(null);
    expect(grid.stats().pickable).toBe(dims.x * dims.y * dims.z);
    grid.dispose();
  });

  it('picks the exposed layer once the layers in front of it are peeled', () => {
    const grid = build();
    for (const [to, want] of [[2, 2], [1, 1], [0, 0]]) {
      grid.setLayerWindow({ axis: 'z', from: 0, to });
      expect(grid.pick(rayDownZ(1))).toBe(idx(dims, 1, 0, want));
    }
    grid.dispose();
  });

  it('peels from the other end too, so either face can be the near one', () => {
    const grid = build();
    grid.setLayerWindow({ axis: 'z', from: 2, to: 3 });
    // Nothing changes for a ray coming from +z: the near face is still z=3.
    expect(grid.pick(rayDownZ(1))).toBe(idx(dims, 1, 0, 3));
    grid.setLayerWindow({ axis: 'z', from: 0, to: 1 });
    expect(grid.pick(rayDownZ(1))).toBe(idx(dims, 1, 0, 1));
    grid.dispose();
  });

  it('reports a clamped window back and drops the hit set to match', () => {
    const grid = build();
    expect(grid.setLayerWindow({ axis: 'x', from: 0, to: 1 })).toEqual({ axis: 'x', from: 0, to: 1 });
    expect(grid.stats().pickable).toBe(2 * dims.y * dims.z);
    expect(grid.setLayerWindow({ axis: 'x', from: 0, to: 99 })).toBe(null);
    expect(grid.stats().pickable).toBe(dims.x * dims.y * dims.z);
    grid.dispose();
  });

  it('a peeled cell is not a click target at all', () => {
    const grid = build();
    grid.setLayerWindow({ axis: 'x', from: 0, to: 1 });
    expect(grid.pick(rayDownZ(3))).toBe(null);
    grid.dispose();
  });

  it('gives every cell back when the window is cleared', () => {
    // The bounding-sphere regression, end to end: the first pick happens under a narrow
    // window, which is where three caches the sphere. Clearing the window has to make
    // the far columns clickable again, not merely visible.
    const grid = build();
    grid.setLayerWindow({ axis: 'x', from: 0, to: 1 });
    expect(grid.pick(rayDownZ(0))).toBe(idx(dims, 0, 0, 3)); // caches a slab-sized sphere
    grid.setLayerWindow(null);
    expect(grid.pick(rayDownZ(3))).toBe(idx(dims, 3, 0, 3));
    grid.dispose();
  });

  it('keeps a peeled fill as a ghost and takes a peeled ✕ off the board', () => {
    const grid = build();
    grid.setAll(
      Array.from({ length: dims.x * dims.y * dims.z }, (_, i) =>
        cellLayer(dims, i, 'z') === 3 ? (cellLayer(dims, i, 'x') < 2 ? FILLED : MARKED) : BLANK),
    );
    expect(grid.stats()).toMatchObject({ filled: 2, marked: 2, ghost: 0 });
    grid.setLayerWindow({ axis: 'z', from: 0, to: 2 });
    // Progress survives the peel, dimmed; a ✕ is a note about a cell already ruled out
    // and only adds clutter to the slab the player is looking past.
    expect(grid.stats()).toMatchObject({ filled: 0, marked: 0, ghost: 2 });
    grid.setLayerWindow(null);
    expect(grid.stats()).toMatchObject({ filled: 2, marked: 2, ghost: 0 });
    grid.dispose();
  });

  it('spends the ghost mesh a draw call only while a window is set', () => {
    const grid = build();
    const bare = grid.stats().objects;
    grid.setLayerWindow({ axis: 'z', from: 0, to: 1 });
    expect(grid.stats().objects).toBe(bare + 1);
    grid.setLayerWindow(null);
    expect(grid.stats().objects).toBe(bare);
    grid.dispose();
  });

  it('fades peeled wireframes through a vec4 colour attribute, not a second mesh', () => {
    // itemSize 4 is the contract: three only defines USE_COLOR_ALPHA — and so only
    // honours per-vertex alpha — for a 4-component colour attribute. At itemSize 3 the
    // alphas below would be written and silently ignored, and the peeled slab would
    // look identical to the live one.
    const grid = build();
    const lines = lineSegments(grid);
    const color = lines.geometry.getAttribute('color');
    expect(color.itemSize).toBe(4);
    expect(lines.material.vertexColors).toBe(true);
    expect(lines.material.transparent).toBe(true);

    const alphaOf = (cell) => color.array[cell * 24 * 4 + 3];
    const near = idx(dims, 0, 0, 3);
    const far = idx(dims, 0, 0, 0);
    expect(alphaOf(near)).toBe(1);
    grid.setLayerWindow({ axis: 'z', from: 0, to: 2 });
    expect(alphaOf(near)).toBeLessThan(0.3);
    expect(alphaOf(near)).toBeGreaterThan(0);
    expect(alphaOf(far)).toBe(1);
    grid.setLayerWindow(null);
    expect(alphaOf(near)).toBe(1);
    grid.dispose();
  });

  it('leaves a windowed board solvable: every cell is reachable at some depth', () => {
    // The property DOO-17 is actually about. For each cell, peel to its own layer and
    // check a ray down that column picks it — no camera work, no gap-hunting.
    const grid = build();
    for (let x = 0; x < dims.x; x++)
      for (let z = 0; z < dims.z; z++) {
        grid.setLayerWindow(z === dims.z - 1 ? null : { axis: 'z', from: 0, to: z });
        expect(grid.pick(rayDownZ(x))).toBe(idx(dims, x, 0, z));
      }
    grid.dispose();
  });

  it('hands out a copy of dims rather than the spec object it was given', () => {
    const spec = { x: 2, y: 2, z: 2 };
    const grid = createVoxelGrid(spec);
    expect(grid.dims).toEqual(spec);
    expect(grid.dims).not.toBe(spec);
    grid.dispose();
  });

  it('keeps state writes working on peeled cells, because the window is only a view', () => {
    const grid = build();
    grid.setLayerWindow({ axis: 'z', from: 0, to: 1 });
    const peeled = idx(dims, 0, 0, 3);
    grid.setState(peeled, FILLED);
    expect(grid.stats()).toMatchObject({ filled: 0, ghost: 1 });
    grid.setLayerWindow(null);
    expect(grid.stats()).toMatchObject({ filled: 1, ghost: 0 });
    grid.dispose();
  });
});
