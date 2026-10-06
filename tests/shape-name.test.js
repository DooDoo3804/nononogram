// tests/shape-name.test.js — the celebration headline resolves to a real shape name.
//
// This is the acceptance criterion "클리어 시 완성 모양이 공개되고 이름이 표시됨" at the
// data level: whatever the puzzle track does to levels.js, a solved puzzle has a name to
// show. Both routes are covered — the spec field, and the fingerprint lookup that
// exists so this track is not blocked on the other one.

import { describe, it, expect } from 'vitest';
import { buildNameIndex, fingerprint, resolveShapeName } from '../state/shape-name.js';
import { SHAPES } from '../shapes/index.js';
import { LEVELS, solutionFor } from '../levels.js';

const index = buildNameIndex(SHAPES);
const ALL = LEVELS.flatMap((level) => level.puzzles);

describe('shape names', () => {
  it('prefers the name on the spec', () => {
    const got = resolveShapeName({ id: 'x', name: '하트', dims: { x: 1, y: 1, z: 1 } }, null, {
      index,
    });
    expect(got).toEqual({ name: '하트', source: 'spec' });
  });

  it('falls back to a fingerprint lookup when the spec has no name', () => {
    const shape = SHAPES[0];
    const got = resolveShapeName({ id: 'anon', dims: shape.dims }, shape.cells, { index });

    expect(got.source).toBe('catalogue');
    expect(got.name).toBe(shape.name);
  });

  it('falls back to the caller’s label when nothing matches', () => {
    const got = resolveShapeName(
      { id: 'mystery', dims: { x: 2, y: 1, z: 1 } },
      new Uint8Array([1, 0]),
      { index, fallback: 'Level 1 #3' },
    );
    expect(got).toEqual({ name: 'Level 1 #3', source: 'fallback' });
  });

  it('keys on dims as well as cells, so same-bits different-box cannot collide', () => {
    const cells = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(fingerprint({ x: 2, y: 2, z: 2 }, cells)).not.toBe(
      fingerprint({ x: 8, y: 1, z: 1 }, cells),
    );
  });

  it('gives every shipped puzzle a real name — not an id, not a fallback', () => {
    for (const spec of ALL) {
      const { name, source } = resolveShapeName(spec, solutionFor(spec), {
        index,
        fallback: null,
      });
      expect(source, `${spec.id} resolved via ${source}`).not.toBe('fallback');
      expect(name).toBeTruthy();
      expect(name).not.toBe(spec.id);
    }
  });

  it('covers all 24 puzzles', () => {
    expect(ALL).toHaveLength(24);
  });
});
