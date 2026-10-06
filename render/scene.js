// render/scene.js — the single WebGL view: scene, camera, lights, orbit controls,
// the render loop, and pointer->ray conversion.
//
// Public API — createView(canvas) returns:
//   .scene .camera .renderer .controls     (escape hatches; prefer the methods)
//   .resize()                 match the renderer to the canvas' CSS box
//   .frameCamera(dims)        place the camera to fit a dims-sized puzzle
//   .onFrame(cb)              cb(dtMs) each frame, before render. -> unsubscribe fn
//   .start() / .stop()        drive / halt the requestAnimationFrame loop
//   .facingAxis()             'x'|'y'|'z' — the axis the camera looks most along
//   .rayFrom(event)           a Raycaster aimed at the pointer event
//   .dispose()

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BACKGROUND = 0xecdfc0;

export function createView(canvas) {
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
  let rafId = 0;
  let lastFrameAt = 0;

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    resize,
    frameCamera,
    facingAxis,
    rayFrom,
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
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
