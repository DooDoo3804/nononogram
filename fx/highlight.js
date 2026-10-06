// fx/highlight.js — the 3D glow that points at a hint's line, and the clear pulse.
//
// OWNER: game-design track (연출). This is the one place this track touches WebGL, and
// it only *adds* objects to the scene it is handed — `render/` is not modified, and the
// cell positions come from `cellCenters`, the same pure helper the voxel grid uses, so
// a highlight can never drift out of alignment with the board.
//
// A hint highlight is one InstancedMesh (one draw call) of slightly oversized
// translucent cubes along the line, pulsing. It expires on its own after
// HIGHLIGHT_MS so a player who walks away is not left with a permanent marker.
//
// Public API — createHighlight({ scene, dims, gap }) returns:
//   .showLine(indices, axis)   light up a line; replaces any previous highlight
//   .clear()
//   .tick(dtMs)                drive the pulse and the expiry
//   .dispose()

import * as THREE from 'three';
import { AXIS_COLORS } from '../render/gizmo.js';
import { CELL_SIZE, GAP, cellCenters } from '../render/voxels.js';

/** How long a hint highlight stays up. Long enough to rotate the cube and look. */
export const HIGHLIGHT_MS = 6000;

const PULSE_PERIOD_MS = 1100;
const SCALE = 1.22; // a touch bigger than a cell, so it reads as a shell around it

export function createHighlight({ scene, dims, gap = GAP }) {
  const centers = cellCenters(dims, gap);
  const geo = new THREE.BoxGeometry(CELL_SIZE * SCALE, CELL_SIZE * SCALE, CELL_SIZE * SCALE);
  const mat = new THREE.MeshBasicMaterial({
    color: AXIS_COLORS.x,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  const max = Math.max(dims.x, dims.y, dims.z);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // draw over the solid cells it wraps
  scene.add(mesh);

  const scratch = new THREE.Matrix4();
  let elapsed = 0;
  let live = false;

  function clear() {
    live = false;
    elapsed = 0;
    mesh.count = 0;
    mat.opacity = 0;
  }

  return {
    showLine(indices, axis = 'x') {
      clear();
      if (!indices?.length) return;
      mat.color.set(AXIS_COLORS[axis] ?? AXIS_COLORS.x);
      let at = 0;
      for (const i of indices) {
        if (at >= mesh.instanceMatrix.count) break;
        scratch.makeTranslation(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
        mesh.setMatrixAt(at++, scratch);
      }
      mesh.count = at;
      mesh.instanceMatrix.needsUpdate = true;
      live = true;
      elapsed = 0;
    },

    clear,

    tick(dtMs) {
      if (!live) return;
      elapsed += dtMs;
      if (elapsed >= HIGHLIGHT_MS) {
        clear();
        return;
      }
      // Pulse between a whisper and a clear glow, fading out over the last second.
      const pulse = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin((elapsed / PULSE_PERIOD_MS) * Math.PI * 2));
      const fade = Math.min(1, (HIGHLIGHT_MS - elapsed) / 900);
      mat.opacity = pulse * fade;
    },

    dispose() {
      scene.remove(mesh);
      mesh.dispose?.();
      geo.dispose();
      mat.dispose();
    },
  };
}
