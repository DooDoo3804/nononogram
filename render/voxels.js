// render/voxels.js — the grid of clickable cells.
//
// The internals are private on purpose: callers only ever address cells by their
// linear `idx()` index, so the draw-call shape of the board is a change inside this
// file. That is what made the instancing rewrite below a one-file change.
//
// Four objects on the default board, five once a layer window is in effect, no matter
// how many cells:
//
//   filled   InstancedMesh, one instance per FILLED cell     1 draw call
//            that the layer window holds
//   marked   InstancedMesh, one instance per MARKED cell     1 draw call
//            that the layer window holds
//   ghost    InstancedMesh over the FILLED cells the window  1 draw call,
//            does *not* hold, drawn at a sixth of the        only while a
//            fill's weight                                   window is set
//   outline  every cell's 12 box edges merged into one
//            LineSegments geometry. The positions never
//            change; a per-vertex alpha fades the cells the
//            window does not hold                           1 draw call
//   hit      InstancedMesh over the cells the window holds,
//            invisible. Raycast target, so BLANK cells stay
//            clickable.                                     0 draw calls
//
// Instances are compacted rather than hidden with a zero scale: `count` is the
// number of live instances, so the vertex shader and `renderer.info.triangles`
// only ever see cells that are actually on screen.
//
// ## The layer window (DOO-17)
//
// `pick()` takes the nearest hit, so the cell a click lands on is the frontmost cell
// of the box along that ray. On a 6³ board that left interior cells addressable only
// through the gaps between nearer cells — QA measured a median clickable area of
// 2,300 CSS px² and a minimum of 100 px² (10×10), against a 24×24 px floor for a
// mouse, and 125 of 216 cells needed the camera moved before they could be hit at all.
// A puzzle whose answer needs those cells is a pixel hunt, not a logic puzzle.
//
// The fix is not to change which cell a ray picks — "nearest hit" is the only rule a
// player can predict — but to let the caller take layers *out of the board*:
//
//   setLayerWindow({ axis: 'z', from: 0, to: 3 })
//
// keeps layers z=0..3 solid and clickable and peels z=4..5 off the front, so whatever
// is behind them becomes the frontmost thing along every ray through it. Each cell of
// the newly exposed layer is then a full cell-sized target. `render/peel.js` drives
// this from the camera; this file only knows how to apply it.
//
// Nothing about the window is persisted or visible to `state/`: it is a view onto the
// board, not part of it. `setState`/`setAll` keep writing every cell, so a peeled cell
// the player had already filled is still filled, still saved, and still counted
// towards the clues — it is only dimmed and un-clickable.
//
// Public API — createVoxelGrid(dims, { gap }) returns:
//   .group                 a THREE.Group to add to the scene
//   .dims                  a copy of the dims it was built for
//   .setState(i, value)    paint one cell
//   .setAll(cells)         paint the whole board from a state array
//   .setLayerWindow(win)   restrict render+picking to a slab of layers; null = all.
//                          -> the window actually applied (clamped), or null
//   .layerWindow()         -> the window in effect, or null
//   .pick(raycaster)       -> cell index | null
//   .stats()               -> { cells, objects, instanced, filled, marked, ghost,
//                               pickable, window }
//   .dispose()             free geometries/materials and empty the group
//
// Pure helpers, exported for tests (no THREE, no DOM):
//   cellCenters(dims, gap)            -> Float32Array, 3 floats per cell
//   outlinePositions(dims, gap, size) -> Float32Array, the merged edge soup
//   cellLayer(dims, i, axis)          -> which layer cell `i` sits on
//   normalizeLayerWindow(dims, win)   -> clamped window | null
//   layerWindowHolds(dims, win, i)    -> boolean

import * as THREE from 'three';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

export const GAP = 1.15;
/** Edge length of one cell cube. Slightly under `GAP` so cells read as separate. */
export const CELL_SIZE = 0.9;

/** Axis names in `idx()` nesting order, so the index of a name is its stride rank. */
export const AXES = ['x', 'y', 'z'];

const axisRank = (axis) => (typeof axis === 'number' ? axis : AXES.indexOf(axis));

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

/**
 * Which layer along `axis` cell `i` sits on — the inverse of `idx()` for one axis.
 *
 * Derived from the index rather than stored per cell: it is two integer ops, the layer
 * window needs it for every cell on every window change, and a parallel coordinate
 * array would be a second copy of the layout to keep in step with `cellCenters`.
 */
export function cellLayer(dims, i, axis) {
  switch (axisRank(axis)) {
    case 0: return Math.floor(i / (dims.y * dims.z));
    case 1: return Math.floor(i / dims.z) % dims.y;
    case 2: return i % dims.z;
    default: return -1;
  }
}

/**
 * Clamp a requested layer window to what `dims` can actually hold.
 *
 * A window that holds every layer normalizes to `null` — the same value as "no window".
 * That is load-bearing rather than tidy: `null` is the one state in which this file
 * renders and picks exactly as it did before DOO-17 (no ghost mesh in the group, hit
 * instances in cell order, every outline at full alpha), so collapsing the degenerate
 * window keeps the default board off the new path entirely.
 */
export function normalizeLayerWindow(dims, win) {
  if (!win) return null;
  const rank = axisRank(win.axis);
  if (rank < 0 || rank > 2) return null;
  const axis = AXES[rank];
  const n = dims[axis];
  const clamp = (v, fallback) => {
    const at = Math.trunc(Number(v));
    return Number.isFinite(at) ? Math.max(0, Math.min(n - 1, at)) : fallback;
  };
  let from = clamp(win.from, 0);
  let to = clamp(win.to, n - 1);
  if (from > to) [from, to] = [to, from];
  if (from === 0 && to === n - 1) return null;
  return { axis, from, to };
}

/** Does `win` (already normalized, or null) hold cell `i`? */
export function layerWindowHolds(dims, win, i) {
  if (!win) return true;
  const layer = cellLayer(dims, i, win.axis);
  return layer >= win.from && layer <= win.to;
}

const sameWindow = (a, b) =>
  a === b || (!!a && !!b && a.axis === b.axis && a.from === b.from && a.to === b.to);

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

/** Endpoints per cell in the merged outline buffer — 12 edges, two ends each. */
const EDGE_VERTS = UNIT_CUBE_EDGES.length / 3;

/**
 * Every cell's box outline merged into one position buffer.
 *
 * One LineSegments over this is a single draw call that never has to be touched
 * again — the outlines are the same whatever the player does to the board, layer
 * window included: the window changes each cell's *alpha*, in a parallel colour
 * attribute, not its geometry. The old renderer gave each cell its own LineSegments,
 * which is where half of the per-cell draw calls came from.
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

const FILL_COLOR = 0x2c2417;
const EDGE_COLOR = 0x4a3d26;
/** Material opacity of the outlines — a cell the window holds keeps all of it. */
const EDGE_OPACITY = 0.55;
/**
 * Alpha multiplier on the wireframe of a cell the layer window does not hold, so the
 * peeled slab reads as "taken off" rather than as a board that got busier. 0.18 of
 * 0.55 is an effective 0.10 — present enough to keep the box's silhouette, which is
 * what a player orients by, and far enough down that the exposed layer is obvious.
 */
const PEELED_EDGE_ALPHA = 0.18;
/** Same idea for a peeled cell the player had already filled. */
const GHOST_OPACITY = 0.16;

export function createVoxelGrid(dims, { gap = GAP } = {}) {
  const total = dims.x * dims.y * dims.z;
  const centers = cellCenters(dims, gap);
  const state = new Uint8Array(total);
  /** The layer window in effect, already normalized. `null` = the whole board. */
  let win = null;

  const cellGeo = new THREE.BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
  const filledMat = new THREE.MeshStandardMaterial({ color: FILL_COLOR });
  const markTexture = makeMarkTexture();
  const markedMat = new THREE.MeshBasicMaterial({ map: markTexture, transparent: true, depthWrite: false });
  // Unlit, because a ghost is a reminder and not a surface: shading it would make some
  // faces read as nearly solid at the angles the peel is used from.
  const ghostMat = new THREE.MeshBasicMaterial({
    color: FILL_COLOR, transparent: true, opacity: GHOST_OPACITY, depthWrite: false,
  });
  // `vertexColors` with an itemSize-4 colour attribute: three sets USE_COLOR_ALPHA for
  // a vec4 colour, so `vColor.a` scales the material opacity per vertex. That is what
  // lets one LineSegments carry both the held cells (alpha 1) and the peeled ones
  // without a second draw call — LineBasicMaterial has no per-instance anything, and
  // fading by *colour* instead would have had to mix towards the scene background,
  // putting a fifth copy of that constant in the repo for DOO-11's guard to chase.
  // `tests/voxels.test.js` pins the vec4 contract.
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: EDGE_OPACITY,
  });
  // The hit mesh never reaches the rasterizer, so its material only has to exist.
  const hitMat = new THREE.MeshBasicMaterial();

  const group = new THREE.Group();
  const scratch = new THREE.Matrix4();
  const place = (i) => scratch.makeTranslation(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);

  const filled = new THREE.InstancedMesh(cellGeo, filledMat, total);
  const marked = new THREE.InstancedMesh(cellGeo, markedMat, total);
  const ghost = new THREE.InstancedMesh(cellGeo, ghostMat, total);
  for (const mesh of [filled, marked, ghost]) {
    mesh.count = 0;
    // `count` changes on every edit, and three caches an InstancedMesh's bounding
    // sphere on first use — a stale sphere would cull cells at some camera angles.
    // The board fills the view anyway, so per-object culling buys nothing here.
    mesh.frustumCulled = false;
  }
  group.add(filled);
  group.add(marked);
  // `ghost` joins the group only while a window is set (see setLayerWindow), so the
  // default board still costs exactly the draw calls every earlier measurement
  // recorded for it.
  let ghostInGroup = false;

  const outlineGeo = new THREE.BufferGeometry();
  outlineGeo.setAttribute('position', new THREE.BufferAttribute(outlinePositions(dims, gap), 3));
  const edgeColors = new Float32Array(total * EDGE_VERTS * 4);
  {
    const live = new THREE.Color(EDGE_COLOR);
    for (let v = 0; v < total * EDGE_VERTS; v++) {
      edgeColors[v * 4] = live.r;
      edgeColors[v * 4 + 1] = live.g;
      edgeColors[v * 4 + 2] = live.b;
      edgeColors[v * 4 + 3] = 1;
    }
  }
  const edgeColorAttr = new THREE.BufferAttribute(edgeColors, 4);
  outlineGeo.setAttribute('color', edgeColorAttr);
  const outline = new THREE.LineSegments(outlineGeo, edgeMat);
  outline.frustumCulled = false;
  group.add(outline);

  // One instance per cell the window holds, so `instanceId` indexes `hitCell` rather
  // than being the cell index itself. With no window the two are equal, which is the
  // only case that existed before DOO-17.
  //
  // `visible = false` keeps it out of the render (0 draw calls) without keeping it
  // out of the raycast: three's `intersectObject` filters on layers, not on
  // visibility, and `Object3D.updateMatrixWorld` recurses through hidden children.
  // `tests/voxels.test.js` pins that behaviour so a three upgrade that changes it
  // fails the suite instead of silently breaking every click.
  const hit = new THREE.InstancedMesh(cellGeo, hitMat, total);
  hit.visible = false;
  const hitCell = new Int32Array(total);
  group.add(hit);

  /**
   * Rebuild what the window decides: which cells are raycast targets, and which
   * wireframes are faded. Window changes are rare (a keypress, a new puzzle), so this
   * is kept off `repack`'s path — a click must not pay for it.
   */
  function rebuildWindow() {
    let live = 0;
    for (let i = 0; i < total; i++) {
      const held = layerWindowHolds(dims, win, i);
      const alpha = held ? 1 : PEELED_EDGE_ALPHA;
      const base = i * EDGE_VERTS * 4;
      for (let v = 0; v < EDGE_VERTS; v++) edgeColors[base + v * 4 + 3] = alpha;
      if (!held) continue;
      hitCell[live] = i;
      hit.setMatrixAt(live, place(i));
      live++;
    }
    hit.count = live;
    hit.instanceMatrix.needsUpdate = true;
    // LOAD-BEARING. `InstancedMesh.raycast` early-outs on `this.boundingSphere` and
    // computes it lazily *once*, over whatever `count` was at the first raycast — it
    // never invalidates it afterwards. Shrink the window, then widen it again, and
    // every ray that misses the narrow slab's stale sphere would return no hit at all:
    // the board would go dead to clicks at most angles. Dropping it to null here makes
    // three recompute on the next raycast, which is once per window change, not once
    // per click. Pinned by tests/voxels.test.js.
    hit.boundingSphere = null;
    edgeColorAttr.needsUpdate = true;
  }

  /**
   * Repack the instanced meshes from `state` and the window.
   *
   * A full repack on every edit, rather than a surgical per-instance patch: it is
   * one linear pass over at most a few hundred cells (measured at ~0.01ms for 6³),
   * and it keeps "what is on screen" a pure function of the board — no incremental
   * bookkeeping to drift out of sync with the player's clicks.
   */
  function repack() {
    let nFilled = 0;
    let nMarked = 0;
    let nGhost = 0;
    for (let i = 0; i < total; i++) {
      const value = state[i];
      // BLANK draws nothing at all — its outline comes from the static `outline`
      // mesh, so a blank cell costs no instance in any mesh.
      if (value !== FILLED && value !== MARKED) continue;
      if (!layerWindowHolds(dims, win, i)) {
        // Peeled. A fill is progress, so it survives as a ghost; a ✕ is a note about a
        // cell the player has already ruled out, and ghosting it only adds clutter to
        // the slab they are trying to see past. It comes back when the window does.
        if (value === FILLED) ghost.setMatrixAt(nGhost++, place(i));
        continue;
      }
      const target = value === FILLED ? filled : marked;
      const at = value === FILLED ? nFilled++ : nMarked++;
      target.setMatrixAt(at, place(i));
    }
    filled.count = nFilled;
    marked.count = nMarked;
    ghost.count = nGhost;
    filled.instanceMatrix.needsUpdate = true;
    marked.instanceMatrix.needsUpdate = true;
    ghost.instanceMatrix.needsUpdate = true;
  }

  rebuildWindow();

  return {
    group,
    // A copy: dims belongs to the puzzle spec, and render/peel.js reads this every
    // keypress. Handing out the spec's own object would make the renderer a way to
    // corrupt the catalogue.
    dims: { x: dims.x, y: dims.y, z: dims.z },

    setState(i, value) {
      if (i < 0 || i >= total) return;
      state[i] = value;
      repack();
    },

    setAll(cells) {
      for (let i = 0; i < total; i++) state[i] = cells[i] ?? BLANK;
      repack();
    },

    setLayerWindow(next) {
      const norm = normalizeLayerWindow(dims, next);
      if (sameWindow(norm, win)) return win ? { ...win } : null;
      win = norm;
      if (!!win !== ghostInGroup) {
        if (win) group.add(ghost);
        else group.remove(ghost);
        ghostInGroup = !!win;
      }
      rebuildWindow();
      repack();
      return win ? { ...win } : null;
    },

    layerWindow() {
      return win ? { ...win } : null;
    },

    pick(raycaster) {
      const hitInfo = raycaster.intersectObject(hit, false)[0];
      return hitInfo ? hitCell[hitInfo.instanceId] : null;
    },

    stats() {
      return {
        cells: total,
        objects: group.children.length,
        instanced: true,
        filled: filled.count,
        marked: marked.count,
        ghost: ghost.count,
        pickable: hit.count,
        window: win ? { ...win } : null,
      };
    },

    dispose() {
      group.clear();
      filled.dispose();
      marked.dispose();
      ghost.dispose();
      hit.dispose();
      cellGeo.dispose();
      outlineGeo.dispose();
      filledMat.dispose();
      markedMat.dispose();
      ghostMat.dispose();
      edgeMat.dispose();
      hitMat.dispose();
      markTexture.dispose();
    },
  };
}
