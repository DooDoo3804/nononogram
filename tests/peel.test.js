// tests/peel.test.js — the depth cursor (DOO-17).
//
// `peelWindow` is pure, and `mountPeel` needs nothing but a `facing()` and a grid with
// `dims` / `setLayerWindow`, so the whole controller runs in node against two fakes.
// What is worth pinning here is not the arithmetic but the three rules that decide
// whether the cursor feels predictable:
//
//   - it never moves on its own (rotating the camera does not re-aim it);
//   - stepping re-aims to the face the camera is actually on, and a new face starts
//     from zero instead of carrying the old axis' depth over;
//   - a new puzzle resets it, without main.js having to remember to say so;
//   - and `state()` at depth 0 names the face the next press will take off, not the one
//     the last puzzle happened to end on (DOO-36 — the QA harness sizes its depth plan
//     off that `max`, so a stale axis there measures fewer layers than it reports).
//
// Whether the exposed layer is then actually clickable is `tests/voxels.test.js`
// (geometry, in node) and `scripts/probe-aim.mjs` (pixels, in a browser).

import { describe, it, expect } from 'vitest';
import { peelWindow, mountPeel } from '../render/peel.js';

describe('peelWindow', () => {
  const dims = { x: 6, y: 5, z: 4 };

  it('is null at depth 0 — the board as it opens', () => {
    expect(peelWindow(dims, { axis: 'z', sign: -1 }, 0)).toBe(null);
  });

  it('takes layers off the high end when the camera looks down the axis', () => {
    // sign -1 = looking towards decreasing coordinates, so the high layers are near.
    expect(peelWindow(dims, { axis: 'x', sign: -1 }, 1)).toEqual({ axis: 'x', from: 0, to: 4 });
    expect(peelWindow(dims, { axis: 'x', sign: -1 }, 3)).toEqual({ axis: 'x', from: 0, to: 2 });
  });

  it('takes them off the low end when the camera is on the other side', () => {
    expect(peelWindow(dims, { axis: 'x', sign: 1 }, 1)).toEqual({ axis: 'x', from: 1, to: 5 });
    expect(peelWindow(dims, { axis: 'x', sign: 1 }, 3)).toEqual({ axis: 'x', from: 3, to: 5 });
  });

  it('never peels the last layer away', () => {
    expect(peelWindow(dims, { axis: 'z', sign: -1 }, 99)).toEqual({ axis: 'z', from: 0, to: 0 });
    expect(peelWindow(dims, { axis: 'z', sign: 1 }, 99)).toEqual({ axis: 'z', from: 3, to: 3 });
  });

  it('reads the depth off the axis it is peeling, not off the longest edge', () => {
    // z is 4 deep where x is 6: a depth of 3 is the floor on z and mid-board on x.
    expect(peelWindow(dims, { axis: 'z', sign: -1 }, 3)).toEqual({ axis: 'z', from: 0, to: 0 });
    expect(peelWindow(dims, { axis: 'x', sign: -1 }, 3)).toEqual({ axis: 'x', from: 0, to: 2 });
  });

  it('returns null rather than guessing for an axis the box does not have', () => {
    expect(peelWindow(dims, { axis: 'w', sign: 1 }, 2)).toBe(null);
    expect(peelWindow(dims, {}, 2)).toBe(null);
    expect(peelWindow(undefined, { axis: 'x', sign: 1 }, 2)).toBe(null);
  });
});

// --- the controller ------------------------------------------------------------

function fakeGrid(dims = { x: 6, y: 6, z: 6 }) {
  let win = null;
  return {
    dims,
    applied: [],
    setLayerWindow(next) {
      win = next;
      this.applied.push(next);
      return next;
    },
    layerWindow: () => win,
  };
}

function fakeView(axis = 'x', sign = -1) {
  return {
    facing: () => ({ axis, sign }),
    turnTo(nextAxis, nextSign) {
      axis = nextAxis;
      sign = nextSign;
    },
  };
}

function fakeKeys() {
  const listeners = [];
  return {
    addEventListener(type, fn) {
      if (type === 'keydown') listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    bound: () => listeners.length,
    press(key, extra = {}) {
      let prevented = false;
      const event = { key, preventDefault: () => { prevented = true; }, ...extra };
      for (const fn of [...listeners]) fn(event);
      return prevented;
    },
  };
}

const mount = (over = {}) => {
  const view = over.view ?? fakeView();
  const grid = over.grid ?? fakeGrid();
  const keys = over.keys ?? fakeKeys();
  // `?? (() => grid)` on the function, not on its result: an override that returns null
  // means "no puzzle open", and falling back on a null result would hide that case.
  const getGrid = over.getGrid ?? (() => grid);
  const peel = mountPeel({ view, getGrid, keyTarget: keys });
  return { peel, view, grid, keys };
};

describe('mountPeel', () => {
  it('starts on the whole board', () => {
    const { peel, grid } = mount();
    expect(peel.depth()).toBe(0);
    expect(grid.layerWindow()).toBe(null);
  });

  it('steps in and back out again', () => {
    const { peel, grid } = mount();
    expect(peel.step(1)).toBe(1);
    expect(grid.layerWindow()).toEqual({ axis: 'x', from: 0, to: 4 });
    expect(peel.step(1)).toBe(2);
    expect(peel.step(-1)).toBe(1);
    expect(peel.step(-1)).toBe(0);
    expect(grid.layerWindow()).toBe(null);
  });

  it('cannot step past either end', () => {
    const { peel } = mount();
    expect(peel.step(-5)).toBe(0);
    expect(peel.setDepth(99)).toBe(5); // 6 layers: depth 5 leaves one
    expect(peel.step(1)).toBe(5);
  });

  it('does not move when the camera does', () => {
    // The whole point of re-aiming on keypress instead of per frame: a rotation must
    // not walk the exposed layer around under the player mid-drag.
    const { peel, view, grid } = mount();
    peel.step(1);
    const before = grid.layerWindow();
    view.turnTo('z', 1);
    expect(peel.depth()).toBe(1);
    expect(grid.layerWindow()).toEqual(before);
    expect(peel.state().axis).toBe('x');
  });

  it('re-aims at the face the camera is on when it is next stepped', () => {
    const { peel, view, grid } = mount();
    peel.step(2);
    view.turnTo('z', 1);
    // A new face starts from zero rather than inheriting depth 2 from the old axis,
    // which would expose a layer the player never asked for.
    expect(peel.step(1)).toBe(1);
    expect(grid.layerWindow()).toEqual({ axis: 'z', from: 1, to: 5 });
  });

  it('treats the far side of the same axis as a new face', () => {
    const { peel, view, grid } = mount();
    peel.step(3);
    view.turnTo('x', 1);
    expect(peel.step(1)).toBe(1);
    expect(grid.layerWindow()).toEqual({ axis: 'x', from: 1, to: 5 });
  });

  it('resets when the grid underneath it is replaced', () => {
    // main.js builds a fresh grid per puzzle and never calls reset(); the cursor
    // noticing for itself is what keeps the two from drifting apart.
    let grid = fakeGrid();
    const { peel } = mount({ getGrid: () => grid });
    peel.step(3);
    expect(peel.depth()).toBe(3);
    grid = fakeGrid();
    expect(peel.depth()).toBe(3); // not read yet
    expect(peel.state().depth).toBe(0);
    expect(grid.layerWindow()).toBe(null);
  });

  describe('state() at depth 0 (DOO-36)', () => {
    it('names the face the camera is on before any key is pressed', () => {
      // The module starts on x-, so a z-facing camera is the case that used to lie.
      const { peel } = mount({ view: fakeView('z', 1) });
      expect(peel.state()).toMatchObject({ depth: 0, axis: 'z', sign: 1 });
    });

    it('does not carry the previous puzzle axis into the next one', () => {
      // The reported bug: peel on z in one box, open another, and `state()` still said z
      // while the first `]` peeled x. 5 of the 14 shipped boxes hit this in catalog order.
      const view = fakeView('z', -1);
      let grid = fakeGrid({ x: 5, y: 4, z: 3 });
      const { peel } = mount({ view, getGrid: () => grid });
      peel.step(2);
      expect(peel.state()).toMatchObject({ depth: 2, axis: 'z', max: 2 });

      grid = fakeGrid({ x: 5, y: 4, z: 3 }); // next puzzle
      view.turnTo('x', -1);
      expect(peel.state()).toMatchObject({ depth: 0, axis: 'x', sign: -1, max: 4 });
      // and the first press agrees with what was reported, which is the whole claim
      expect(peel.step(1)).toBe(1);
      expect(grid.layerWindow()).toEqual({ axis: 'x', from: 0, to: 3 });
    });

    it('reports max off the axis it names, not off a leftover one', () => {
      // 3x3x2 reported max 2 from a stale x while the real near face had max 1, and the
      // harness then asked for a depth that cannot exist and dropped the step.
      const { peel } = mount({ view: fakeView('z', -1), grid: fakeGrid({ x: 3, y: 3, z: 2 }) });
      expect(peel.state().max).toBe(1);
      expect(peel.setDepth(99)).toBe(1);
    });

    it('still reports the applied face past depth 0, camera or no camera', () => {
      // The depth-0 derivation must not become a per-frame re-aim: once a window is
      // applied, its axis is the answer even after the player rotates away.
      const { peel, view } = mount();
      peel.step(2);
      view.turnTo('z', 1);
      expect(peel.state()).toMatchObject({ depth: 2, axis: 'x', sign: -1 });
      // Back at 0 the camera takes over again — turned back first so that the step's own
      // reaim is a no-op and the derivation is the only thing that can answer.
      view.turnTo('x', -1);
      expect(peel.step(-2)).toBe(0);
      view.turnTo('y', 1);
      expect(peel.state()).toMatchObject({ depth: 0, axis: 'y', sign: 1, max: 5 });
    });

    it('falls back to its own cursor when the view cannot say', () => {
      const { peel } = mount({ view: { facing: () => null } });
      expect(peel.state()).toMatchObject({ depth: 0, axis: 'x', sign: -1, max: 5 });
    });
  });

  it('is inert with no puzzle open', () => {
    const { peel } = mount({ getGrid: () => null });
    expect(peel.step(1)).toBe(0);
    expect(peel.setDepth(3)).toBe(0);
    expect(peel.reset()).toBe(0);
    expect(peel.state()).toMatchObject({ depth: 0, max: 0, window: null });
  });

  it('reads the depth limit off the axis being peeled', () => {
    const view = fakeView('y', -1);
    const { peel } = mount({ view, grid: fakeGrid({ x: 6, y: 2, z: 6 }) });
    expect(peel.setDepth(5)).toBe(1);
  });

  describe('keyboard', () => {
    it('steps on ] and [ and resets on backslash', () => {
      const { peel, keys, grid } = mount();
      expect(keys.press(']')).toBe(true);
      expect(peel.depth()).toBe(1);
      keys.press(']');
      expect(peel.depth()).toBe(2);
      keys.press('[');
      expect(peel.depth()).toBe(1);
      expect(keys.press('\\')).toBe(true);
      expect(peel.depth()).toBe(0);
      expect(grid.layerWindow()).toBe(null);
    });

    it('leaves other keys and every modified chord alone', () => {
      const { peel, keys } = mount();
      expect(keys.press('p')).toBe(false);
      expect(keys.press(']', { metaKey: true })).toBe(false);
      expect(keys.press(']', { ctrlKey: true })).toBe(false);
      expect(keys.press(']', { altKey: true })).toBe(false);
      expect(peel.depth()).toBe(0);
    });

    it('unbinds on dispose', () => {
      const { peel, keys } = mount();
      expect(keys.bound()).toBe(1);
      peel.dispose();
      expect(keys.bound()).toBe(0);
      keys.press(']');
      expect(peel.depth()).toBe(0);
    });
  });

  it('binds nothing when there is no key target, so node can mount it', () => {
    const peel = mountPeel({ view: fakeView(), getGrid: () => fakeGrid(), keyTarget: null });
    expect(peel.depth()).toBe(0);
    expect(() => peel.dispose()).not.toThrow();
  });
});
