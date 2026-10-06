// render/voxels.js — the grid of clickable cells.
//
// The internals (one Mesh per cell today, an InstancedMesh later) are private on
// purpose: callers only ever address cells by their linear `idx()` index, so the
// draw-call rewrite is a change inside this file.
//
// Public API — createVoxelGrid(dims, { gap }) returns:
//   .group                 a THREE.Group to add to the scene
//   .setState(i, value)    paint one cell
//   .setAll(cells)         paint the whole board from a state array
//   .pick(raycaster)       -> cell index | null
//   .stats()               -> { cells, objects }
//   .dispose()             free geometries/materials and empty the group

import * as THREE from 'three';
import { idx } from '../puzzle.js';
import { BLANK, FILLED, MARKED } from '../state/cells.js';

export const GAP = 1.15;

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
  const cellGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const edgesGeo = new THREE.EdgesGeometry(cellGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a3d26, transparent: true, opacity: 0.55 });

  // BLANK cells are invisible to the eye (their box outline comes from a separate
  // EdgesGeometry line, not a wireframe mesh — a wireframe mesh draws each face's
  // triangle diagonal too, which turns a grid of cubes into a tangle of X's).
  const emptyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const filledMat = new THREE.MeshStandardMaterial({ color: 0x2c2417 });
  const markTexture = makeMarkTexture();
  const markedMat = new THREE.MeshBasicMaterial({ map: markTexture, transparent: true, depthWrite: false });
  const cellMats = { [BLANK]: emptyMat, [FILLED]: filledMat, [MARKED]: markedMat };

  const group = new THREE.Group();
  const meshes = [];

  const offsetX = (dims.x - 1) / 2;
  const offsetY = (dims.y - 1) / 2;
  const offsetZ = (dims.z - 1) / 2;

  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++) {
        const cell = new THREE.Group();
        cell.position.set((x - offsetX) * gap, (y - offsetY) * gap, (z - offsetZ) * gap);

        const i = idx(dims, x, y, z);
        const mesh = new THREE.Mesh(cellGeo, cellMats[BLANK]);
        mesh.userData.index = i;
        cell.add(mesh);
        cell.add(new THREE.LineSegments(edgesGeo, edgeMat));

        group.add(cell);
        meshes[i] = mesh;
      }

  return {
    group,

    setState(i, value) {
      const mesh = meshes[i];
      if (mesh) mesh.material = cellMats[value];
    },

    setAll(cells) {
      for (let i = 0; i < meshes.length; i++) meshes[i].material = cellMats[cells[i]];
    },

    pick(raycaster) {
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit ? hit.object.userData.index : null;
    },

    stats() {
      return { cells: meshes.length, objects: group.children.length };
    },

    dispose() {
      group.clear();
      meshes.length = 0;
      cellGeo.dispose();
      edgesGeo.dispose();
      edgeMat.dispose();
      emptyMat.dispose();
      filledMat.dispose();
      markedMat.dispose();
      markTexture.dispose();
    },
  };
}
