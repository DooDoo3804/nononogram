// render/voxels.js — the grid of clickable cells.
//
// The internals are private on purpose: callers only ever address cells by their
// linear `idx()` index, so the draw-call shape of the board is a change inside this
// file. That is what made the instancing rewrite below a one-file change.
//
// Four objects, no matter how many cells:
//
//   filled   InstancedMesh, one instance per FILLED cell     1 draw call
//   marked   InstancedMesh, one instance per MARKED cell     1 draw call
//   outline  every cell's 12 box edges merged into one
//            LineSegments geometry — it never changes         1 draw call
//   hit      InstancedMesh over *every* cell, invisible.
//            Raycast target, so BLANK cells stay clickable.   0 draw calls
//
// Instances are compacted rather than hidden with a zero scale: `count` is the
// number of live instances, so the vertex shader and `renderer.info.triangles`
// only ever see cells that are actually on screen.
//
// Public API — createVoxelGrid(dims, { gap }) returns:
//   .group                 a THREE.Group to add to the scene
//   .setState(i, value)    paint one cell
//   .setAll(cells)         paint the whole board from a state array
//   .pick(raycaster)       -> cell index | null
//   .stats()               -> { cells, objects, instanced, filled, marked }
//   .dispose()             free geometries/materials and empty the group
//
// Pure helpers, exported for tests (no THREE, no DOM):
//   cellCenters(dims, gap)            -> Float32Array, 3 floats per cell
//   outlinePositions(dims, gap, size) -> Float32Array, the merged edge soup

import * as THREE from 'three';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

export const GAP = 1.15;
/** Edge length of one cell cube. Slightly under `GAP` so cells read as separate. */
export const CELL_SIZE = 0.9;

/**
 * World-space centre of every cell, in `idx()` order.
 * Mirrors `puzzle.js`'s `idx(dims, x, y, z) = (x * dims.y + y) * dims.z + z` — the
 * loop nesting here *is* that index, which is why this file does not import it.
 */
export function cellCenters(dims, gap = GAP) {
  const out = new Float32Array(dims.x * dims.y * dims.z * 3);
  const ox = (dims.x - 1) / 2;
  const oy = (dims.y - 1) / 2;
  const oz = (dims.z - 1) / 2;
  let at = 0;
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++) {
        out[at++] = (x - ox) * gap;
        out[at++] = (y - oy) * gap;
        out[at++] = (z - oz) * gap;
      }
  return out;
}

// The 12 edges of a unit cube as 24 endpoints, in units of half the cell size.
const UNIT_CUBE_EDGES = (() => {
  const c = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0], // back face
    [4, 5], [5, 6], [6, 7], [7, 4], // front face
    [0, 4], [1, 5], [2, 6], [3, 7], // the four struts
  ];
  return pairs.flatMap(([a, b]) => [...c[a], ...c[b]]);
})();

/**
 * Every cell's box outline merged into one position buffer.
 *
 * One LineSegments over this is a single draw call that never has to be touched
 * again — the outlines are the same whatever the player does to the board. The old
 * renderer gave each cell its own LineSegments, which is where half of the per-cell
 * draw calls came from.
 */
export function outlinePositions(dims, gap = GAP, size = CELL_SIZE) {
  const centers = cellCenters(dims, gap);
  const cells = centers.length / 3;
  const out = new Float32Array(cells * UNIT_CUBE_EDGES.length);
  const h = size / 2;
  let at = 0;
  for (let c = 0; c < cells; c++) {
    const cx = centers[c * 3];
    const cy = centers[c * 3 + 1];
    const cz = centers[c * 3 + 2];
    for (let e = 0; e < UNIT_CUBE_EDGES.length; e += 3) {
      out[at++] = cx + UNIT_CUBE_EDGES[e] * h;
      out[at++] = cy + UNIT_CUBE_EDGES[e + 1] * h;
      out[at++] = cz + UNIT_CUBE_EDGES[e + 2] * h;
    }
  }
  return out;
}

function makeMarkTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#6b5a3c';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  const pad = 32;
  ctx.beginPath();
  ctx.moveTo(pad, pad); ctx.lineTo(size - pad, size - pad);
  ctx.moveTo(size - pad, pad); ctx.lineTo(pad, size - pad);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

export function createVoxelGrid(dims, { gap = GAP } = {}) {
  const total = dims.x * dims.y * dims.z;
  const centers = cellCenters(dims, gap);
  const state = new Uint8Array(total);

  const cellGeo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
  const filledMat = new THREE.MeshStandardMaterial({ color: 0x2c2417 });
  const markTexture = makeMarkTexture();
  const markedMat = new THREE.MeshBasicMaterial({ map: markTexture, transparent: true, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a3d26, transparent: true, opacity: 0.55 });
  // The hit mesh never reaches the rasterizer, so its material only has to exist.
  const hitMat = new THREE.MeshBasicMaterial();

  const group = new THREE.Group();
  const scratch = new THREE.Matrix4();

  const filled = new THREE.InstancedMesh(cellGeo, filledMat, total);
  const marked = new THREE.InstancedMesh(cellGeo, markedMat, total);
  for (const mesh of [filled, marked]) {
    mesh.count = 0;
    // `count` changes on every edit, and three caches an InstancedMesh's bounding
    // sphere on first use — a stale sphere would cull cells at some camera angles.
    // The board fills the view anyway, so per-object culling buys nothing here.
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.BufferAttribute(outlinePositions(dims, gap), 3));
  const outline = new THREE.LineSegments(outlineGeo, edgeMat);
  outline.frustumCulled = false;
  group.add(outline);

  // One instance per cell, in `idx()` order, so `instanceId` *is* the cell index.
  //
  // `visible = false` keeps it out of the render (0 draw calls) without keeping it
  // out of the raycast: three's `intersectObject` filters on layers, not on
  // visibility, and `Object3D.updateMatrixWorld` recurses through hidden children.
  // `tests/voxels.test.js` pins that behaviour so a three upgrade that changes it
  // fails the suite instead of silently breaking every click.
  const hit = new THREE.InstancedMesh(cellGeo, hitMat, total);
  hit.visible = false;
  for (let i = 0; i < total; i++) {
    hit.setMatrixAt(i, scratch.makeTranslation(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]));
  }
  hit.instanceMatrix.needsUpdate = true;
  group.add(hit);

  /**
   * Repack both instanced meshes from `state`.
   *
   * A full repack on every edit, rather than a surgical per-instance patch: it is
   * one linear pass over at most a few hundred cells (measured at ~0.01ms for 6³),
   * and it keeps "what is on screen" a pure function of the board — no incremental
   * bookkeeping to drift out of sync with the player's clicks.
   */
  function repack() {
    let nFilled = 0;
    let nMarked = 0;
    for (let i = 0; i < total; i++) {
      const value = state[i];
      // BLANK draws nothing at all — its outline comes from the static `outline`
      // mesh, so a blank cell costs no instance in either mesh.
      if (value !== FILLED && value !== MARKED) continue;
      const target = value === FILLED ? filled : marked;
      const at = value === FILLED ? nFilled++ : nMarked++;
      target.setMatrixAt(at, scratch.makeTranslation(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]));
    }
    filled.count = nFilled;
    marked.count = nMarked;
    filled.instanceMatrix.needsUpdate = true;
    marked.instanceMatrix.needsUpdate = true;
  }

  return {
    group,

    setState(i, value) {
      if (i < 0 || i >= total) return;
      state[i] = value;
      repack();
    },

    setAll(cells) {
      for (let i = 0; i < total; i++) state[i] = cells[i] ?? BLANK;
      repack();
    },

    pick(raycaster) {
      const hitInfo = raycaster.intersectObject(hit, false)[0];
      return hitInfo ? hitInfo.instanceId : null;
    },

    stats() {
      return {
        cells: total,
        objects: group.children.length,
        instanced: true,
        filled: filled.count,
        marked: marked.count,
      };
    },

    dispose() {
      group.clear();
      filled.dispose();
      marked.dispose();
      hit.dispose();
      cellGeo.dispose();
      outlineGeo.dispose();
      filledMat.dispose();
      markedMat.dispose();
      edgeMat.dispose();
      hitMat.dispose();
      markTexture.dispose();
    },
  };
}
