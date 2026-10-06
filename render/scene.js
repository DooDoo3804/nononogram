// render/scene.js — the single WebGL view: scene, camera, lights, orbit controls,
// the render loop, and pointer->ray conversion.
//
// Public API — createView(canvas, opts?) returns:
//   .scene .camera .renderer .controls     (escape hatches; prefer the methods)
//   .resize()                 match the drawing buffer to the CSS box x pixel ratio
//   .pixelRatio()             the ratio currently in the drawing buffer
//   .frameCamera(dims)        place the camera to fit a dims-sized puzzle
//   .onFrame(cb)              cb(dtMs) each frame, before render. -> unsubscribe fn
//   .onFrameEnd(cb)           cb() right after renderer.render(). -> unsubscribe fn
//   .start() / .stop()        drive / halt the requestAnimationFrame loop
//   .facingAxis()             'x'|'y'|'z' — the axis the camera looks most along
//   .facing()                 { axis, sign } — that axis, plus which end is nearest
//   .rayFrom(event)           a Raycaster aimed at the pointer event
//   .dispose()
//
// opts.maxPixelRatio   override the retina cap (default MAX_PIXEL_RATIO) — the
//                      bench page sweeps it to pick the shipped value.
// opts.fitMargin       override the framing slack (default FIT_MARGIN). Same reason
//                      as above: the margin sets how much of the canvas the board
//                      covers, which sets the fragment count, so it is an axis the
//                      bench has to be able to sweep rather than a constant nobody
//                      can price. See DOO-22.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CELL_SIZE, GAP } from './voxels.js';

const BACKGROUND = 0xecdfc0;

// How much slack to leave around what has to stay in frame; 1 inscribes the fit sphere
// exactly tangent to the narrower frustum plane.
//
// Calibrated, not chosen: a landscape phone has ~363 CSS px of board to work with and
// the gate's cell-aperture floor needs ~341 of them, so there is very little room to
// spend here. `tests/framing.test.js` pins the no-clip property at this value, and
// `bench/?fitmargin=` prices what raising it would buy and cost.
export const FIT_MARGIN = 1;

// The opening view direction. Unchanged — what changed is that it no longer also
// encodes the distance, which is why the old framing could not react to canvas shape.
const VIEW_DIR = new THREE.Vector3(1, 0.85, 1).normalize();

// Enough depth for every shipped board at every sane canvas shape; `setDepthRange`
// only ever grows it, and only in the degenerate aspects that need it.
const DEFAULT_FAR = 100;

/**
 * Radius of the sphere the camera has to keep in frame for a dims-sized puzzle.
 *
 * A sphere rather than the box's eight corners because OrbitControls lets the player
 * look from anywhere: a fit computed for one orientation clips the board at others, a
 * cube's projected width swinging 22% between corner-on and face-on. The sphere costs
 * ~10% at the opening angle and is never wrong at any other.
 */
export function fitRadiusFor(dims) {
  const span = (n) => (n - 1) * GAP + CELL_SIZE;
  const box = 0.5 * Math.hypot(span(dims.x), span(dims.y), span(dims.z));
  // render/gizmo.js puts each axis label at 1.15x its line's length and the sprite is
  // 0.5 units across, so on a small puzzle the labels reach past the box corners and
  // they, not the box, set the frame.
  const label = ((Math.max(dims.x, dims.y, dims.z) * GAP) / 2 + 0.6) * 1.15 + 0.25;
  return Math.max(box, label);
}

/**
 * Distance at which a sphere of `radius` is exactly tangent to the narrower of the two
 * frustum side planes — `margin` scales that distance outwards.
 *
 * `sin`, not `tan`, and the difference is not cosmetic. `radius / tan(halfAngle)` is
 * the *orthographic* fit: it inscribes a flat disc of that radius in the frame plane
 * through the sphere's centre. Under perspective the frustum keeps narrowing in front
 * of that plane, so the near half of the sphere pokes out — by `1/cos(halfAngle) - 1`,
 * which at this camera's 45° fov is 8.2%. That is the whole of the clipping DOO-22
 * asked about: at `tan` and margin 1, 6³ put its near-bottom corner 9.9% past the
 * bottom of the canvas *at the opening shot*, on every canvas wider than it is tall —
 * desktop included. `radius / sin(halfAngle)` is tangency, so the fit sphere is inside
 * the frustum by construction and nothing can clip at any orbit angle.
 *
 * The horizontal half-angle is `atan(aspect * tan(halfV))`, so a portrait canvas is
 * limited by its *width*. The old framing read neither axis: it fit to height alone and
 * ignored the canvas shape entirely, so a tall narrow canvas ran the board off the sides
 * while a short wide one used 58% of the height it had.
 */
export function fitDistanceFor(radius, { fov = 45, aspect = 1, margin = FIT_MARGIN } = {}) {
  const halfV = (fov * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 1e-6));
  return (radius * margin) / Math.sin(Math.min(halfV, halfH));
}

/**
 * Where to put the camera when the canvas changes shape, given where it is now.
 *
 * Zoom survives as a *ratio* of the framing distance, not as a distance: someone who
 * had pulled in to half the opening shot is still at half of it after rotating the
 * phone, rather than being thrown back out. Separated from `createView` so the property
 * that matters can actually be asserted — this is idempotent, so the burst of resize
 * events a mobile URL bar fires on every scroll cannot walk the camera anywhere.
 */
export function refitDistance(current, previousFit, nextFit) {
  if (!(previousFit > 0)) return nextFit;
  return (current / previousFit) * nextFit;
}

// Retina policy.
//
// The drawing buffer must be devicePixelRatio times the CSS box, or the board is
// rasterized at 1/4 (DPR 2) to 1/9 (DPR 3) of the screen's pixels and upscaled —
// blurry voxels, mush for grid lines, and antialias wasted on a 1x buffer. Three's
// default pixel ratio is 1 and `setSize(w, h, false)` only means "don't touch the CSS
// style", so without `setPixelRatio` every phone and tablet gets the 1x buffer.
//
// But fragment cost scales with buffer *area*: uncapped, a DPR 3 phone pays 9x the
// fill rate, and with 9 draw calls and a few thousand triangles this renderer's cost
// is overwhelmingly per-pixel. Hence a cap. 2 is measured, not idiomatic:
//
// `bench/?maxdpr=` sweeps the cap, and bench.js' readPixels probe prices the raster
// that vsync otherwise hides. On 6³ the marginal fill cost came out at 0.95ms per
// million buffer pixels (412x915 viewport) and 0.75 (360x740), measured on an M1 Pro
// via ANGLE Metal, r² > 0.99 across caps 1 / 1.5 / 2 / 2.625 / 3, 3 reps each.
//
// Project that onto a mid-range Android, whose ROP throughput is roughly 5-10x below
// an M1 Pro's, and the cap decides the budget:
//
//   cap 2     phone 1.41M px → 1.34ms fill here → ~13.4ms at 10x, +0.6ms cpu. Inside.
//   cap 2.625 phone 2.42M px → 2.30ms           → ~23ms. Blows the 16.7ms frame.
//   cap 3     360x740 2.20M px → 1.65ms         → ~16.5ms. Blows it.
//
// So 2 is the last ratio that survives the pessimistic projection — and it is also
// the exact device ratio on DPR-2 tablets, so they pay no approximation at all. The
// 5-10x multiplier is literature, not a reading off a handset; a physical-device
// number is still owed and belongs to the QA track.
//
// How far the 5-10x projection is from the pessimistic end (DOO-20). Re-running the
// same sweep against forced SwiftShader — the backend the first draft of this comment
// wrongly believed it had already been using — prices fill at ~61ms per million buffer
// pixels, roughly 65-95x the M1 Pro reading above rather than 5-10x. Nothing passes
// there, 1x included: 6³ p95 goes 33ms at cap 1 to 72ms at cap 2.625. That is not a
// phone verdict, because no phone GPU is two orders of magnitude off a laptop's. What
// it does establish is that the slow end of the fill axis was measured and not merely
// assumed, and that 5-10x sits well inside the bracket rather than at its edge. The
// knee's real location is still DOO-12's to find; this constant is the knob it moves.
export const MAX_PIXEL_RATIO = 2;

/** The ratio actually handed to WebGL: the device's, clamped to `cap`. */
export function resolvePixelRatio(dpr, cap = MAX_PIXEL_RATIO) {
  const device = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const ceiling = Number.isFinite(cap) && cap > 0 ? cap : 1;
  return Math.min(device, ceiling);
}

export function createView(canvas, { maxPixelRatio = MAX_PIXEL_RATIO, fitMargin = FIT_MARGIN } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, DEFAULT_FAR);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const viewDir = new THREE.Vector3();

  const frameCbs = new Set();
  // Separate from frameCbs so the perf monitor can bracket the whole frame —
  // callbacks, controls and the draw call — and read the CPU cost of one frame.
  const frameEndCbs = new Set();
  let rafId = 0;
  let lastFrameAt = 0;

  // What frameCamera was last asked to fit, and the distance that fit needed. Kept so
  // resize() can re-fit for a new canvas shape without forgetting how far in the player
  // had zoomed.
  let fitRadius = 0;
  let fitDistance = 0;

  const distanceToFit = () =>
    fitDistanceFor(fitRadius, { fov: camera.fov, aspect: camera.aspect, margin: fitMargin });

  // Let OrbitControls re-derive its spherical state from the position we just wrote,
  // then publish the result to the camera's world matrix.
  //
  // `controls.update()` only aims the camera (`lookAt` writes the quaternion);
  // `matrixWorld` is refreshed by the *renderer*, one frame later. So without this,
  // anything that reads the camera between a re-frame and the next draw — `rayFrom`
  // above all — works off the previous pose. It cost the bench its cell-pick for one
  // run, and it is the sort of bug that stays invisible in the app only because a
  // player cannot tap inside the same tick as a resize.
  function settle() {
    controls.update();
    camera.updateMatrixWorld();
  }

  // The fit distance grows without bound as the canvas narrows (radius / sin -> inf as
  // the half-angle -> 0), where the old aspect-blind framing was capped at ~19.5 units
  // for 6³. A fixed far plane of 100 would therefore cull the whole board on a canvas
  // under ~0.15 aspect instead of merely shrinking it — a black screen, which is worse
  // than a small board. Keep the default depth range when the fit is inside it.
  function setDepthRange(distance) {
    const far = Math.max(DEFAULT_FAR, distance + fitRadius * 2);
    if (far !== camera.far) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  /** Re-apply the fit for the current aspect, keeping orbit direction and zoom. */
  function refit() {
    if (!fitRadius) return;
    const want = distanceToFit();
    // The current distance is read off the live camera rather than tracked alongside it,
    // so a pinch OrbitControls has already applied is in the number. Deliberately
    // unclamped at the near end: OrbitControls' own minDistance is where to bound how
    // far in a player may go, and a second clamp here would fight it.
    const next = refitDistance(camera.position.distanceTo(controls.target), fitDistance, want);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() === 0) offset.copy(VIEW_DIR);
    camera.position.copy(controls.target).add(offset.setLength(next));
    fitDistance = want;
    setDepthRange(Math.max(next, want));
    settle();
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Re-read the ratio every resize, not once at construction: browser zoom and
    // dragging the window to a second monitor change devicePixelRatio and both fire
    // a resize event.
    renderer.setPixelRatio(resolvePixelRatio(globalThis.devicePixelRatio, maxPixelRatio));
    renderer.setSize(w, h, false);
    // The canvas' shape is half of the framing, so every resize is a re-fit. This is
    // also the call that does the *first* fit: main.js frames a puzzle while the game
    // screen is still hidden, where the canvas has no size to read yet.
    refit();
  }

  function frameCamera(dims) {
    fitRadius = fitRadiusFor(dims);
    controls.target.set(0, 0, 0);
    fitDistance = distanceToFit();
    camera.position.copy(VIEW_DIR).multiplyScalar(fitDistance);
    setDepthRange(fitDistance);
    settle();
  }

  function facingAxis() {
    camera.getWorldDirection(viewDir);
    const ax = Math.abs(viewDir.x);
    const ay = Math.abs(viewDir.y);
    const az = Math.abs(viewDir.z);
    return ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
  }

  /**
   * The facing axis plus which end of it the camera is on.
   *
   * `sign` is the sign of the view *direction* along that axis, so `-1` means the
   * camera looks towards decreasing coordinates and the high layers are the near ones.
   * render/peel.js needs both halves: the axis says which way to slice, the sign says
   * which end to take the slices off. Allocates, unlike `facingAxis()`, which runs
   * every frame — this one runs on a keypress.
   */
  function facing() {
    const axis = facingAxis(); // also refreshes viewDir
    return { axis, sign: viewDir[axis] < 0 ? -1 : 1 };
  }

  function rayFrom(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = lastFrameAt ? now - lastFrameAt : 0;
    lastFrameAt = now;
    for (const cb of frameCbs) cb(dt);
    controls.update();
    renderer.render(scene, camera);
    for (const cb of frameEndCbs) cb(dt);
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    resize,
    pixelRatio: () => renderer.getPixelRatio(),
    frameCamera,
    facingAxis,
    facing,
    rayFrom,
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onFrameEnd(cb) {
      frameEndCbs.add(cb);
      return () => frameEndCbs.delete(cb);
    },
    start() {
      if (!rafId) rafId = requestAnimationFrame(tick);
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastFrameAt = 0;
    },
    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      controls.dispose();
      renderer.dispose();
    },
  };
}
