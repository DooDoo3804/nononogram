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
//   .rayFrom(event)           a Raycaster aimed at the pointer event
//   .dispose()
//
// opts.maxPixelRatio   override the retina cap (default MAX_PIXEL_RATIO) — the
//                      bench page sweeps it to pick the shipped value.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BACKGROUND = 0xecdfc0;

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

export function createView(canvas, { maxPixelRatio = MAX_PIXEL_RATIO } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
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
  }

  function frameCamera(dims) {
    const radius = Math.max(dims.x, dims.y, dims.z) * 1.8 + 1;
    camera.position.set(radius, radius * 0.85, radius);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function facingAxis() {
    camera.getWorldDirection(viewDir);
    const ax = Math.abs(viewDir.x);
    const ay = Math.abs(viewDir.y);
    const az = Math.abs(viewDir.z);
    return ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
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
