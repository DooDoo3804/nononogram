// tests/voxels.test.js — the instanced voxel grid.
//
// `createVoxelGrid` itself needs a canvas (the MARKED cross is a CanvasTexture), so
// what runs in node is split in two:
//
//   - the geometry helpers, which are pure and carry the whole cell layout;
//   - the three.js behaviours the instanced grid *relies on* — instance raycasting
//     reporting an `instanceId`, and `Raycaster` still hitting an object whose
//     `visible` is false. That second one is load-bearing: the hit mesh is hidden so
//     it costs no draw call, and if a three upgrade starts filtering on visibility,
//     every click in the game silently stops working. This pins it.
//
// End-to-end picking through a real WebGL context is covered by
// `scripts/verify-browser.mjs` and `scripts/bench-render.mjs`.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cellCenters, outlinePositions, GAP, CELL_SIZE } from '../render/voxels.js';
import { idx } from '../puzzle.js';

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
});
