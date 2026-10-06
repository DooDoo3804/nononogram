// render/gizmo.js — the colored X/Y/Z axis gizmo.
//
// It sits in the same (static) scene as the puzzle cube. OrbitControls only ever
// moves the camera — the cube and this gizmo never move relative to each other —
// so as the player orbits around the puzzle, the gizmo turns right along with it,
// keeping "which way is X/Y/Z" legible from any angle.
//
// Public API — createAxisGizmo(dims, { gap }) returns { group, dispose() }

import * as THREE from 'three';
import { GAP } from './voxels.js';

export const AXIS_COLORS = { x: '#b5533f', y: '#5f8a52', z: '#4a6fa5' };

function makeAxisLabelSprite(text, color) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 2);
  const texture = new THREE.CanvasTexture(c);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

export function createAxisGizmo(dims, { gap = GAP } = {}) {
  const group = new THREE.Group();
  const disposables = [];

  const axes = [
    { dir: [1, 0, 0], label: 'X', len: (dims.x * gap) / 2 + 0.6 },
    { dir: [0, 1, 0], label: 'Y', len: (dims.y * gap) / 2 + 0.6 },
    { dir: [0, 0, 1], label: 'Z', len: (dims.z * gap) / 2 + 0.6 },
  ];

  for (const axis of axes) {
    const color = AXIS_COLORS[axis.label.toLowerCase()];
    const end = new THREE.Vector3(...axis.dir).multiplyScalar(axis.len);

    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]);
    const mat = new THREE.LineBasicMaterial({ color });
    group.add(new THREE.Line(geo, mat));
    disposables.push(geo, mat);

    const sprite = makeAxisLabelSprite(axis.label, color);
    sprite.position.copy(end).multiplyScalar(1.15);
    group.add(sprite);
    disposables.push(sprite.material, sprite.material.map);
  }

  return {
    group,
    dispose() {
      group.clear();
      for (const d of disposables) d.dispose();
    },
  };
}
