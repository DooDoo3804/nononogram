import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateSolution, computeClues, isSolved, idx, mulberry32 } from './puzzle.js';

// Cell states, cycled by clicking: BLANK -> FILLED -> MARKED (player's "not a block" note) -> BLANK.
const BLANK = 0, FILLED = 1, MARKED = 2;
const GAP = 1.15;

// For now every puzzle lives under Level 1 — add more levels/puzzles here later.
// Each puzzle has a fixed seed so its solution (and therefore its saved progress) stays stable.
const LEVELS = [
  {
    id: 'level-1',
    name: 'Level 1',
    puzzles: [
      { id: 'l1-1', dims: { x: 3, y: 3, z: 3 }, seed: 101 },
      { id: 'l1-2', dims: { x: 3, y: 3, z: 3 }, seed: 202 },
      { id: 'l1-3', dims: { x: 4, y: 3, z: 3 }, seed: 303 },
      { id: 'l1-4', dims: { x: 4, y: 4, z: 3 }, seed: 404 },
      { id: 'l1-5', dims: { x: 4, y: 4, z: 4 }, seed: 505 },
      { id: 'l1-6', dims: { x: 5, y: 4, z: 3 }, seed: 606 },
      { id: 'l1-7', dims: { x: 3, y: 4, z: 3 }, seed: 707 },
      { id: 'l1-8', dims: { x: 5, y: 3, z: 3 }, seed: 808 },
      { id: 'l1-9', dims: { x: 3, y: 5, z: 4 }, seed: 909 },
      { id: 'l1-10', dims: { x: 5, y: 5, z: 3 }, seed: 1010 },
      { id: 'l1-11', dims: { x: 4, y: 5, z: 4 }, seed: 1111 },
      { id: 'l1-12', dims: { x: 5, y: 5, z: 4 }, seed: 1212 },
    ],
  },
];

// --- progress persistence (per puzzle id) -----------------------------------

function loadProgress(puzzleId) {
  try {
    const raw = localStorage.getItem(`no-nonogram:${puzzleId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveProgress(puzzleId, stateArr, solvedFlag) {
  try {
    localStorage.setItem(`no-nonogram:${puzzleId}`, JSON.stringify({ state: Array.from(stateArr), solved: solvedFlag }));
  } catch {
    // storage unavailable (private mode, quota) — progress just won't persist
  }
}

// --- screen navigation --------------------------------------------------------

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== id;
}

// --- thumbnail preview: plain 2D isometric voxels, no need for a second WebGL renderer ---

function drawThumb(canvas, dims, cells) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ecdfc0';
  ctx.fillRect(0, 0, w, h);

  const s = Math.min(w, h) / (dims.x + dims.y + dims.z);
  const cx = w / 2;
  const cy = h / 2 + (dims.y * s) / 2;

  const voxels = [];
  for (let x = 0; x < dims.x; x++)
    for (let y = 0; y < dims.y; y++)
      for (let z = 0; z < dims.z; z++)
        if (cells[idx(dims, x, y, z)]) voxels.push([x, y, z]);
  voxels.sort((a, b) => a[0] + a[2] - a[1] - (b[0] + b[2] - b[1]));

  for (const [x, y, z] of voxels) {
    const ix = cx + (x - z) * s;
    const iy = cy + (x + z) * s * 0.5 - y * s;
    ctx.fillStyle = '#2c2417';
    ctx.beginPath();
    ctx.moveTo(ix, iy - s * 0.5);
    ctx.lineTo(ix + s, iy);
    ctx.lineTo(ix, iy + s * 0.5);
    ctx.lineTo(ix - s, iy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ecdfc0';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.strokeStyle = '#b6934f';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
}

// --- level / puzzle list screens ----------------------------------------------

let currentLevel = null;
let currentPuzzle = null;

function renderLevels() {
  const grid = document.getElementById('levels-grid');
  grid.innerHTML = '';
  for (const level of LEVELS) {
    const card = document.createElement('button');
    card.className = 'level-card';
    card.innerHTML = `
      <svg class="level-cube-icon" viewBox="0 0 100 116" aria-hidden="true">
        <path d="M50 0 L100 29 L50 58 L0 29 Z" fill="url(#cube-top-grad)" />
        <path d="M0 29 L50 58 L50 116 L0 87 Z" fill="url(#cube-left-grad)" />
        <path d="M100 29 L50 58 L50 116 L100 87 Z" fill="url(#cube-right-grad)" />
      </svg>
      <span class="level-name">${level.name}</span>
    `;
    card.addEventListener('click', () => openLevel(level));
    grid.appendChild(card);
  }
}

function openLevel(level) {
  currentLevel = level;
  document.getElementById('puzzles-title').textContent = level.name;
  renderPuzzles(level);
  showScreen('screen-puzzles');
}

function renderPuzzles(level) {
  const grid = document.getElementById('puzzles-grid');
  grid.innerHTML = '';
  level.puzzles.forEach((spec, i) => {
    const progress = loadProgress(spec.id);
    const cellCount = spec.dims.x * spec.dims.y * spec.dims.z;
    const cells = progress ? progress.state.map((v) => (v === FILLED ? 1 : 0)) : new Array(cellCount).fill(0);

    const card = document.createElement('button');
    card.className = 'puzzle-card';

    const thumb = document.createElement('canvas');
    thumb.width = 100;
    thumb.height = 100;
    drawThumb(thumb, spec.dims, cells);
    card.appendChild(thumb);

    const name = document.createElement('div');
    name.className = 'puzzle-name';
    name.textContent = `#${i + 1}`;
    card.appendChild(name);

    const statusModifier = progress?.solved ? ' puzzle-status--solved' : progress ? ' puzzle-status--progress' : '';
    const status = document.createElement('div');
    status.className = 'puzzle-status' + statusModifier;
    status.textContent = progress?.solved ? '완료' : progress ? '진행중' : '미완료';
    card.appendChild(status);

    card.addEventListener('click', () => openPuzzle(spec));
    grid.appendChild(card);
  });
}

function openPuzzle(spec) {
  currentPuzzle = spec;
  loadPuzzle(spec);
  showScreen('screen-game');
  resize();
}

// --- 3D game view --------------------------------------------------------------

const statusEl = document.getElementById('status');
const dimsEl = document.getElementById('dims-label');
const canvas = document.getElementById('scene');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xecdfc0);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

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

const cellGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const edgesGeo = new THREE.EdgesGeometry(cellGeo);
const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a3d26, transparent: true, opacity: 0.55 });

// BLANK cells are invisible to the eye (their box outline comes from a separate
// EdgesGeometry line, not a wireframe mesh — a wireframe mesh draws each face's
// triangle diagonal too, which turns a grid of cubes into a tangle of X's).
const emptyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const filledMat = new THREE.MeshStandardMaterial({ color: 0x2c2417 });
const markedMat = new THREE.MeshBasicMaterial({ map: makeMarkTexture(), transparent: true, depthWrite: false });
const cellMats = { [BLANK]: emptyMat, [FILLED]: filledMat, [MARKED]: markedMat };

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let DIMS, solution, clues, state, meshes, solved, history;

function loadPuzzle(spec) {
  DIMS = spec.dims;
  solution = generateSolution(DIMS, 0.45, mulberry32(spec.seed));
  clues = computeClues(DIMS, solution);

  const saved = loadProgress(spec.id);
  state = saved ? Uint8Array.from(saved.state) : new Uint8Array(DIMS.x * DIMS.y * DIMS.z);
  history = [];
  solved = !!saved?.solved;
  statusEl.textContent = solved ? 'Solved! 🎉' : '';
  dimsEl.textContent = `${DIMS.x}×${DIMS.y}×${DIMS.z}`;

  buildScene();
  renderClues();
}

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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

// A small colored X/Y/Z gizmo sitting in the same (static) scene as the puzzle cube.
// OrbitControls only ever moves the camera — the cube and this gizmo never move relative
// to each other — so as the player orbits around the puzzle, the gizmo turns right along
// with it, keeping "which way is X/Y/Z" legible from any angle.
function buildAxisGizmo() {
  for (const g of scene.children.filter((c) => c.userData.isGizmo)) scene.remove(g);

  const group = new THREE.Group();
  group.userData.isGizmo = true;

  const axes = [
    { dir: [1, 0, 0], color: '#b5533f', label: 'X', len: (DIMS.x * GAP) / 2 + 0.6 },
    { dir: [0, 1, 0], color: '#5f8a52', label: 'Y', len: (DIMS.y * GAP) / 2 + 0.6 },
    { dir: [0, 0, 1], color: '#4a6fa5', label: 'Z', len: (DIMS.z * GAP) / 2 + 0.6 },
  ];

  for (const a of axes) {
    const end = new THREE.Vector3(...a.dir).multiplyScalar(a.len);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end]);
    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: a.color })));

    const sprite = makeAxisLabelSprite(a.label, a.color);
    sprite.position.copy(end).multiplyScalar(1.15);
    group.add(sprite);
  }

  scene.add(group);
}

function buildScene() {
  for (const g of scene.children.filter((c) => c.userData.isCell)) scene.remove(g);
  meshes = [];

  const offsetX = (DIMS.x - 1) / 2;
  const offsetY = (DIMS.y - 1) / 2;
  const offsetZ = (DIMS.z - 1) / 2;

  for (let x = 0; x < DIMS.x; x++)
    for (let y = 0; y < DIMS.y; y++)
      for (let z = 0; z < DIMS.z; z++) {
        const group = new THREE.Group();
        group.position.set((x - offsetX) * GAP, (y - offsetY) * GAP, (z - offsetZ) * GAP);
        group.userData.isCell = true;

        const i = idx(DIMS, x, y, z);
        const mesh = new THREE.Mesh(cellGeo, cellMats[state[i]]);
        mesh.userData.index = i;
        group.add(mesh);
        group.add(new THREE.LineSegments(edgesGeo, edgeMat));

        scene.add(group);
        meshes.push(mesh);
      }

  buildAxisGizmo();

  const radius = Math.max(DIMS.x, DIMS.y, DIMS.z) * 1.8 + 1;
  camera.position.set(radius, radius * 0.85, radius);
  controls.target.set(0, 0, 0);
  controls.update();
}

// A clue number gets struck through as soon as the player's current board has a run of
// that length in that position of the line — it doesn't have to be the *correct* run,
// just a plausible reading of the clue from what's filled in so far.
function renderClues() {
  const filledOnly = Array.from(state, (v) => (v === FILLED ? 1 : 0));
  const currentRuns = computeClues(DIMS, filledOnly);

  for (const axis of ['x', 'y', 'z']) {
    const el = document.getElementById(`clues-${axis}`);
    el.innerHTML = '';
    const grid = clues[axis];
    const curGrid = currentRuns[axis];
    el.style.gridTemplateColumns = `repeat(${grid[0].length}, auto)`;
    grid.forEach((row, a) => {
      row.forEach((runs, b) => {
        const cur = curGrid[a][b];
        const cell = document.createElement('div');
        cell.className = 'clue-cell';
        runs.forEach((n, k) => {
          const span = document.createElement('span');
          span.textContent = n;
          if (cur[k] === n) span.className = 'clue-num--done';
          cell.appendChild(span);
        });
        el.appendChild(cell);
      });
    });
  }
}

function setCellState(i, s) {
  state[i] = s;
  meshes[i].material = cellMats[s];
}

function onPick(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit || solved) return;

  const i = hit.object.userData.index;
  const prev = state[i];
  history.push({ i, prev });
  setCellState(i, (prev + 1) % 3);
  renderClues();

  const filledOnly = Array.from(state, (v) => (v === FILLED ? 1 : 0));
  if (isSolved(filledOnly, solution)) {
    solved = true;
    statusEl.textContent = 'Solved! 🎉';
  }
  saveProgress(currentPuzzle.id, state, solved);
}

function onUndo() {
  if (solved || history.length === 0) return;
  const { i, prev } = history.pop();
  setCellState(i, prev);
  renderClues();
  saveProgress(currentPuzzle.id, state, solved);
}

// OrbitControls also listens for pointerdown/up on the canvas to rotate the camera,
// so only treat this as a click (toggle a cell) when the pointer barely moved.
const DRAG_THRESHOLD = 5;
let downX = 0, downY = 0;

function onPointerDown(event) {
  downX = event.clientX;
  downY = event.clientY;
}

function onPointerUp(event) {
  const dx = event.clientX - downX;
  const dy = event.clientY - downY;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) onPick(event);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

// Free rotation means "top/left/right" never reliably maps to a fixed axis, so instead
// of relying on panel position, highlight whichever clue panel corresponds to the axis
// the camera currently looks most directly along — that's the axis you're filling in.
const panelEls = {
  x: document.querySelector('.clue-panel--left'),
  y: document.querySelector('.clue-panel--top'),
  z: document.querySelector('.clue-panel--right'),
};
let facingAxis = null;
const viewDir = new THREE.Vector3();

function updateFacingHighlight() {
  camera.getWorldDirection(viewDir);
  const abs = { x: Math.abs(viewDir.x), y: Math.abs(viewDir.y), z: Math.abs(viewDir.z) };
  const axis = abs.x >= abs.y && abs.x >= abs.z ? 'x' : abs.y >= abs.z ? 'y' : 'z';
  if (axis === facingAxis) return;
  facingAxis = axis;
  for (const a of ['x', 'y', 'z']) panelEls[a]?.classList.toggle('clue-panel--active', a === axis);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointerup', onPointerUp);
window.addEventListener('resize', resize);
document.getElementById('undo').addEventListener('click', onUndo);

document.getElementById('btn-start').addEventListener('click', () => {
  renderLevels();
  showScreen('screen-levels');
});
document.getElementById('btn-levels-back').addEventListener('click', () => showScreen('screen-main'));
document.getElementById('btn-puzzles-back').addEventListener('click', () => showScreen('screen-levels'));
document.getElementById('btn-game-back').addEventListener('click', () => {
  renderPuzzles(currentLevel);
  showScreen('screen-puzzles');
});

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateFacingHighlight();
  renderer.render(scene, camera);
})();
