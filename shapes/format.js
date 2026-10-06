// shapes/format.js — the hand-authored voxel shape format.
//
// A shape is written as ASCII z-slices so you can read the silhouette straight out of
// the source. One slice per z (z = 0 first, i.e. nearest the viewer's front face), each
// slice a list of rows printed top-down (first row = highest y). '#' is a filled voxel,
// anything else ('.', ' ') is empty.
//
//   defineShape({
//     id: 'l1-plus', name: '십자', level: 1,
//     slices: [
//       ['...',       // z = 0
//        '.#.',
//        '...'],
//       ['.#.',       // z = 1
//        '###',
//        '.#.'],
//     ],
//   })
//
// Every slice must be the same size: that size is the shape's (x, y) and the slice
// count is its z, so `dims` is derived — never hand-written, never out of sync.
// `cells` comes out as a Uint8Array of 0/1 in puzzle.js' `idx` order, which is exactly
// what `computeClues`, `validatePuzzle` and the renderer already expect.

import { idx } from '../puzzle.js';

export const FILLED_CHAR = '#';

/** @returns {{id, name, level, dims, cells, slices}} */
export function defineShape(spec) {
  const { id, name, level, slices, tags = [] } = spec;
  if (!id) throw new Error('shape is missing an id');
  if (!Array.isArray(slices) || slices.length === 0) throw new Error(`shape ${id}: slices must be a non-empty array`);

  const z = slices.length;
  const y = slices[0].length;
  const x = slices[0][0].length;
  if (!y || !x) throw new Error(`shape ${id}: slice 0 is empty`);

  slices.forEach((slice, zi) => {
    if (slice.length !== y) throw new Error(`shape ${id}: slice ${zi} has ${slice.length} rows, expected ${y}`);
    slice.forEach((row, ri) => {
      if (row.length !== x) throw new Error(`shape ${id}: slice ${zi} row ${ri} is ${row.length} wide, expected ${x}`);
    });
  });

  const dims = { x, y, z };
  const cells = new Uint8Array(x * y * z);
  for (let zi = 0; zi < z; zi++) {
    for (let row = 0; row < y; row++) {
      // Rows are printed top-down, so the first row is the highest y.
      const yi = y - 1 - row;
      for (let xi = 0; xi < x; xi++) {
        if (slices[zi][row][xi] === FILLED_CHAR) cells[idx(dims, xi, yi, zi)] = 1;
      }
    }
  }

  let filled = 0;
  for (let i = 0; i < cells.length; i++) filled += cells[i];
  if (filled === 0) throw new Error(`shape ${id}: no filled cells`);

  return { id, name: name ?? id, level: level ?? 1, tags, dims, cells, slices };
}

/** Inverse of defineShape's slice parsing — used to print repaired shapes back out. */
export function slicesFromCells(dims, cells) {
  const slices = [];
  for (let z = 0; z < dims.z; z++) {
    const rows = [];
    for (let y = dims.y - 1; y >= 0; y--) {
      let row = '';
      for (let x = 0; x < dims.x; x++) row += cells[idx(dims, x, y, z)] ? FILLED_CHAR : '.';
      rows.push(row);
    }
    slices.push(rows);
  }
  return slices;
}

/** Pretty-print all slices side by side, labelled — for test failures and shape review. */
export function shapeToAscii(dims, cells) {
  const slices = slicesFromCells(dims, cells);
  const header = slices.map((_, z) => `z=${z}`.padEnd(dims.x + 2)).join('');
  const body = [];
  for (let row = 0; row < dims.y; row++) {
    body.push(slices.map((s) => s[row].padEnd(dims.x + 2)).join(''));
  }
  return [header, ...body].join('\n');
}

/** Re-emit a shape as source you can paste back into a shape file. */
export function shapeToSource(shape, cells = shape.cells) {
  const slices = slicesFromCells(shape.dims, cells);
  const body = slices
    .map((rows, z) => `    [${rows.map((r) => `'${r}'`).join(',\n     ')}], // z = ${z}`)
    .join('\n');
  return `defineShape({\n  id: '${shape.id}', name: '${shape.name}', level: ${shape.level},\n  slices: [\n${body}\n  ],\n})`;
}
