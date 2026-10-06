// tests/ui-peel.test.js — the depth cursor's on-screen control (DOO-28).
//
// What is worth pinning here is the *readout*, not the cursor: render/peel.js already
// has tests/peel.test.js, and the bug this control exists to avoid is a label that
// disagrees with the board. Three cases carry that:
//
//   1. At depth 0 the readout names the face the next press will take off, so the dot
//      follows the camera before the cursor has ever been used.
//   2. Past depth 0 it names the face that is *actually peeled* — and when the camera
//      has moved off it, adds the one the next press will switch to. Naming only one of
//      the two is how this reads as a bug (DOO-17's own prediction).
//   3. `max` comes from the shown axis, which on a non-cubic box is not the applied
//      axis's max. A 5×4×3 board is a level-3 variant, so this is reachable in play.
//
// The DOM is hand-rolled rather than jsdom, same as tests/gestures-stroke.test.js: the
// module touches ids, textContent, className, dataset, disabled and two attributes, all
// of which is cheaper to fake than to install.

import { describe, it, expect, beforeEach } from 'vitest';
import { mountPeelControl, COACH_KEY, TEACH_LEVEL } from '../ui/peel.js';
import { peelWindow } from '../render/peel.js';

const IDS = [
  'peel',
  'peel-less',
  'peel-more',
  'peel-readout',
  'peel-dot',
  'peel-axis',
  'peel-depth',
  'peel-next',
  'peel-next-dot',
  'peel-next-axis',
  'peel-live',
  'peel-coach',
  'peel-coach-close',
];

function node(id) {
  return {
    id,
    textContent: '',
    className: '',
    dataset: {},
    style: {},
    disabled: false,
    hidden: false,
    title: '',
    attrs: new Map(),
    classes: new Set(),
    classList: {
      add(c) {
        this.owner.classes.add(c);
      },
      remove(c) {
        this.owner.classes.delete(c);
      },
    },
    listeners: new Map(),
    setAttribute(k, v) {
      this.attrs.set(k, v);
    },
    getAttribute(k) {
      return this.attrs.get(k) ?? null;
    },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    click() {
      for (const fn of this.listeners.get('click') ?? []) fn({ preventDefault() {} });
    },
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

/**
 * A stand-in for render/peel.js that shares its two load-bearing rules: a step re-aims
 * at the camera's face first (and starts that face from zero), and the depth clamps to
 * the shown axis's length minus one. `peelWindow` is the real one, so a window this
 * fake reports is the window the grid would get.
 */
function fakeCursor(dims, facing) {
  let depth = 0;
  let axis = facing.axis;
  let sign = facing.sign;
  const max = () => Math.max(0, (dims[axis] ?? 1) - 1);
  const reaim = () => {
    if (facing.axis === axis && facing.sign === sign) return;
    axis = facing.axis;
    sign = facing.sign;
    depth = 0;
  };
  return {
    step(delta) {
      reaim();
      depth = Math.max(0, Math.min(max(), depth + delta));
      return depth;
    },
    reset() {
      depth = 0;
      return 0;
    },
    state: () => ({ depth, axis, sign, max: max(), window: peelWindow(dims, { axis, sign }, depth) }),
  };
}

function harness({ dims = { x: 6, y: 6, z: 6 }, facing = { axis: 'z', sign: -1 } } = {}) {
  const nodes = new Map(IDS.map((id) => [id, node(id)]));
  for (const n of nodes.values()) n.classList.owner = n;
  // Mirrors index.html, which declares the card `hidden`. The module never hides it at
  // mount — the markup is where "starts closed" belongs — so a harness that started it
  // open would be testing a page that does not exist.
  nodes.get('peel-coach').hidden = true;

  const win = {
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
    removeEventListener() {},
    // Synchronous, so `teach()` lands its class without the test waiting a frame.
    requestAnimationFrame: (fn) => fn(),
  };
  const doc = { getElementById: (id) => nodes.get(id) ?? null, defaultView: win };
  const cursor = fakeCursor(dims, facing);
  const storage = memoryStorage();
  const control = mountPeelControl({
    doc,
    peel: cursor,
    view: { facing: () => ({ ...facing }) },
    getDims: () => dims,
    storage,
  });

  return {
    control,
    cursor,
    storage,
    facing,
    el: (id) => nodes.get(id),
    /** Turn the camera to a new face, then let the frame loop catch up. */
    turn(next) {
      Object.assign(facing, next);
      return control.sync(200);
    },
  };
}

describe('depth cursor control — the readout', () => {
  let h;
  beforeEach(() => {
    h = harness();
  });

  it('at depth 0 names the face the next press will take off, and follows the camera', () => {
    expect(h.control.model()).toMatchObject({ depth: 0, axis: 'z', max: 5, pending: null });
    expect(h.el('peel-axis').textContent).toBe('Z');
    expect(h.el('peel-dot').className).toBe('axis-dot axis-dot--z');
    expect(h.el('peel-depth').textContent).toBe('0/5');

    // Nothing is peeled, so there is nothing to put back and nothing to reset to.
    expect(h.el('peel-less').disabled).toBe(true);
    expect(h.el('peel-readout').disabled).toBe(true);
    expect(h.el('peel-more').disabled).toBe(false);

    h.turn({ axis: 'x', sign: 1 });
    expect(h.el('peel-axis').textContent).toBe('X');
    expect(h.el('peel-dot').className).toBe('axis-dot axis-dot--x');
    // Still "nothing peeled yet" — the camera moving is not a cursor move.
    expect(h.el('peel-depth').textContent).toBe('0/5');
    expect(h.el('peel-next').style.visibility).toBe('hidden');
  });

  it('a button press drives the cursor and repaints without waiting for the next frame', () => {
    h.el('peel-more').click();
    h.el('peel-more').click();

    expect(h.cursor.state().depth).toBe(2);
    expect(h.el('peel-depth').textContent).toBe('2/5');
    expect(h.el('peel').dataset.peeled).toBe('1');
    expect(h.el('peel-less').disabled).toBe(false);
    expect(h.el('peel-readout').disabled).toBe(false);
    // The window the grid would actually get, to keep the readout honest about the board.
    expect(h.cursor.state().window).toEqual({ axis: 'z', from: 0, to: 3 });

    h.el('peel-readout').click();
    expect(h.cursor.state().depth).toBe(0);
    expect(h.el('peel-depth').textContent).toBe('0/5');
    expect(h.el('peel').dataset.peeled).toBe('0');
  });

  it('keeps naming the peeled face after the camera moves, and names where the next press goes', () => {
    h.el('peel-more').click();
    h.el('peel-more').click();
    h.turn({ axis: 'x', sign: 1 });

    // Two layers are still off the Z face — that is what is on screen, so that is what
    // the readout says. The arrow is the only warning the player gets that `+` is about
    // to jump faces, and this assertion is the whole point of the control.
    expect(h.el('peel-axis').textContent).toBe('Z');
    expect(h.el('peel-depth').textContent).toBe('2/5');
    expect(h.el('peel-next').style.visibility).toBe('visible');
    expect(h.el('peel-next-axis').textContent).toBe('X');
    expect(h.el('peel-next-dot').className).toBe('axis-dot axis-dot--x');
    expect(h.el('peel-more').getAttribute('aria-label')).toContain('X축으로 옮겨');

    // And the jump the arrow promised: one press, new face, one layer.
    h.el('peel-more').click();
    expect(h.cursor.state()).toMatchObject({ axis: 'x', depth: 1 });
    expect(h.el('peel-axis').textContent).toBe('X');
    expect(h.el('peel-depth').textContent).toBe('1/5');
    expect(h.el('peel-next').style.visibility).toBe('hidden');
  });

  it('announces the board moving, not the camera moving', () => {
    h.el('peel-more').click();
    h.el('peel-more').click();
    expect(h.el('peel-live').textContent).toBe('Z축 2겹 벗김');

    // Four faces' worth of rotation. The cursor has not moved, so a screen reader
    // should hear nothing — an announcement per crossed face would make rotating a
    // 6³ board unusable with one on.
    for (const next of [{ axis: 'x', sign: 1 }, { axis: 'y', sign: 1 }, { axis: 'z', sign: 1 }, { axis: 'x', sign: -1 }]) {
      h.turn(next);
      expect(h.el('peel-live').textContent).toBe('Z축 2겹 벗김');
    }
    // Where the next press lands is still spoken — on the button that would do it.
    expect(h.el('peel-more').getAttribute('aria-label')).toContain('X축으로 옮겨');

    // A press does announce, pending face and all.
    h.el('peel-more').click();
    expect(h.el('peel-live').textContent).toBe('X축 1겹 벗김');
    h.el('peel-readout').click();
    expect(h.el('peel-live').textContent).toContain('전체 보기');
  });

  it('treats a sign flip on the same axis as a face change', () => {
    h.el('peel-more').click();
    h.turn({ axis: 'z', sign: 1 });

    // Same axis, opposite end of the box: the near face is the other one, so the next
    // press re-aims. A readout that compared axes only would show no arrow here.
    expect(h.el('peel-next').style.visibility).toBe('visible');
    expect(h.el('peel-next-axis').textContent).toBe('Z');
  });

  it('takes max from the shown axis, not the applied one', () => {
    // A level-3 non-cubic variant. Peel the 3-deep Z face, then look down the 5-deep X.
    const nc = harness({ dims: { x: 5, y: 4, z: 3 }, facing: { axis: 'z', sign: -1 } });
    nc.el('peel-more').click();
    expect(nc.el('peel-depth').textContent).toBe('1/2');

    nc.turn({ axis: 'x', sign: -1 });
    // Still showing Z's own ceiling, because Z is what is peeled.
    expect(nc.el('peel-depth').textContent).toBe('1/2');
    nc.el('peel-more').click();
    expect(nc.el('peel-depth').textContent).toBe('1/4');

    // And `+` stays live at the end of a shallow face as long as a re-aim is pending:
    // the press has somewhere to go, it just goes to a different face.
    nc.el('peel-readout').click();
    nc.turn({ axis: 'z', sign: -1 });
    nc.el('peel-more').click();
    nc.el('peel-more').click();
    expect(nc.el('peel-depth').textContent).toBe('2/2');
    expect(nc.el('peel-more').disabled).toBe(true);
    nc.turn({ axis: 'y', sign: 1 });
    expect(nc.el('peel-more').disabled).toBe(false);
  });
});

describe('depth cursor control — teaching it once', () => {
  it('teaches on the first level-3 board and never again', () => {
    const h = harness();
    expect(h.control.openPuzzle({ id: 'l1-a', level: 1 })).toBe(false);
    expect(h.el('peel-coach').hidden).toBe(true);

    expect(h.control.openPuzzle({ id: 'l3-rocket', level: TEACH_LEVEL })).toBe(true);
    expect(h.el('peel-coach').hidden).toBe(false);
    expect(h.el('peel-coach').classes.has('peel-coach--on')).toBe(true);
    expect(h.el('peel').dataset.coach).toBe('1');
    // Written on show, not on dismiss: a player who answers the card by starting to
    // play has still been told, and a lesson that comes back every 5³ board is worse
    // than one they skimmed.
    expect(JSON.parse(h.storage.getItem(COACH_KEY))).toEqual({ peel: true });

    h.control.dismiss();
    expect(h.el('peel-coach').hidden).toBe(true);
    expect(h.el('peel').dataset.coach).toBeUndefined();

    expect(h.control.openPuzzle({ id: 'l4-cat', level: 4 })).toBe(false);
    expect(h.el('peel-coach').hidden).toBe(true);
  });

  it('honours a flag written by an earlier session', () => {
    const h = harness();
    h.storage.setItem(COACH_KEY, JSON.stringify({ peel: true }));
    const fresh = mountPeelControl({
      doc: { getElementById: (id) => h.el(id), defaultView: { addEventListener() {} } },
      peel: h.cursor,
      view: { facing: () => ({ ...h.facing }) },
      getDims: () => ({ x: 6, y: 6, z: 6 }),
      storage: h.storage,
    });
    expect(fresh.openPuzzle({ id: 'l3-rocket', level: 3 })).toBe(false);
  });

  it('drops the card on the first use of the control it points at', () => {
    const h = harness();
    h.control.openPuzzle({ id: 'l3-rocket', level: 3 });
    expect(h.el('peel-coach').hidden).toBe(false);

    h.el('peel-more').click();
    expect(h.el('peel-coach').hidden).toBe(true);
    // Using it is the lesson, so the step still counts.
    expect(h.cursor.state().depth).toBe(1);
  });

  it('survives storage that throws on read and on write', () => {
    const hostile = {
      getItem() {
        throw new Error('nope');
      },
      setItem() {
        throw new Error('nope');
      },
    };
    const h = harness();
    const control = mountPeelControl({
      doc: { getElementById: (id) => h.el(id), defaultView: { addEventListener() {}, requestAnimationFrame: (f) => f() } },
      peel: h.cursor,
      view: { facing: () => ({ ...h.facing }) },
      getDims: () => ({ x: 6, y: 6, z: 6 }),
      storage: hostile,
    });
    // An unreadable flag means "not taught yet" — one extra card beats losing the
    // lesson — and the in-memory flag still keeps it to once per session.
    expect(control.openPuzzle({ id: 'l3-rocket', level: 3 })).toBe(true);
    expect(control.openPuzzle({ id: 'l3-other', level: 3 })).toBe(false);
  });
});

describe('depth cursor control — cost on the frame loop', () => {
  it('reads the cursor at 10Hz, not once a frame', () => {
    let reads = 0;
    const el = new Map(IDS.map((id) => [id, node(id)]));
    for (const n of el.values()) n.classList.owner = n;
    const control = mountPeelControl({
      doc: { getElementById: (id) => el.get(id) ?? null, defaultView: { addEventListener() {} } },
      peel: {
        state() {
          reads += 1;
          return { depth: 0, axis: 'x', sign: -1, max: 5, window: null };
        },
        step: () => 0,
        reset: () => 0,
      },
      view: { facing: () => ({ axis: 'x', sign: -1 }) },
      getDims: () => ({ x: 6, y: 6, z: 6 }),
      storage: memoryStorage(),
    });
    reads = 0; // the mount's own first paint is not what this measures

    // One second of 60fps.
    for (let i = 0; i < 60; i += 1) control.sync(1000 / 60);
    expect(reads).toBeLessThanOrEqual(10);
    expect(reads).toBeGreaterThan(0);
    control.dispose();
  });
});
