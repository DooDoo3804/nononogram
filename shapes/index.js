// shapes/index.js — the hand-authored voxel shape catalogue.
//
// This is the DOO-3 seed set: enough shapes across 3³/4³/5³/6³ and two non-cubic boxes
// to exercise the validator gate and show the difficulty curve. DOO-4 grows this to the
// full 24. Every shape here has been through `validatePuzzle` and is unique + no-guess;
// tests/gate.test.js re-proves that on every run, so a shape that loses those
// properties cannot be merged.
//
// Authoring notes: see shapes/format.js. Slices are z = 0 first, rows printed top-down
// (first row = highest y). Run `node shapes/report.mjs` to print the verdict and
// difficulty numbers for a shape you are working on, and `node shapes/report.mjs
// --repair` to get a minimal cell-toggle fix for one that fails.

import { defineShape } from './format.js';

// --- Level 1 — 3×3×3 ---------------------------------------------------------

export const l1Plus = defineShape({
  id: 'l1-plus',
  name: '십자',
  level: 1,
  tags: ['symmetric'],
  slices: [
    ['...',
     '.#.',
     '...'], // z = 0
    ['.#.',
     '###',
     '.#.'], // z = 1
    ['...',
     '.#.',
     '...'], // z = 2
  ],
});

export const l1Stairs = defineShape({
  id: 'l1-stairs',
  name: '계단',
  level: 1,
  slices: [
    ['..#',
     '.##',
     '###'], // z = 0
    ['..#',
     '.##',
     '###'], // z = 1
    ['..#',
     '.##',
     '###'], // z = 2
  ],
});

export const l1Mushroom = defineShape({
  id: 'l1-mushroom',
  name: '버섯',
  level: 1,
  slices: [
    ['###',
     '...',
     '...'], // z = 0
    ['###',
     '.#.',
     '.#.'], // z = 1
    ['###',
     '...',
     '...'], // z = 2
  ],
});

// --- Level 2 — 4×4×4 and the first non-cubic boxes ---------------------------

export const l2Heart = defineShape({
  id: 'l2-heart',
  name: '하트',
  level: 2,
  slices: [
    ['....',
     '.##.',
     '.##.',
     '....'], // z = 0
    ['#..#',
     '####',
     '####',
     '.##.'], // z = 1
    ['#..#',
     '####',
     '####',
     '.##.'], // z = 2
    ['....',
     '.##.',
     '.##.',
     '....'], // z = 3
  ],
});

export const l2Mug = defineShape({
  id: 'l2-mug',
  name: '컵',
  level: 2,
  tags: ['non-cubic'],
  slices: [
    ['###.',
     '###.',
     '###.',
     '###.'], // z = 0
    ['#.#.',
     '#.##',
     '#.##',
     '###.'], // z = 1
    ['###.',
     '###.',
     '###.',
     '###.'], // z = 2
  ],
});

// --- Level 3 — 5×5×5 and non-cubic boxes up to 5 -----------------------------

export const l3House = defineShape({
  id: 'l3-house',
  name: '집',
  level: 3,
  tags: ['non-cubic'],
  slices: [
    ['..#..',
     '.###.',
     '#####',
     '#####'], // z = 0
    ['..#..',
     '.###.',
     '#...#',
     '#...#'], // z = 1
    ['..#..',
     '.###.',
     '#####',
     '#####'], // z = 2
  ],
});

export const l3Rocket = defineShape({
  id: 'l3-rocket',
  name: '로켓',
  level: 3,
  slices: [
    ['.....',
     '.....',
     '.....',
     '.....',
     '..#..'], // z = 0
    ['.....',
     '..#..',
     '.###.',
     '.###.',
     '.###.'], // z = 1
    ['..#..',
     '.###.',
     '.###.',
     '.###.',
     '#####'], // z = 2
    ['.....',
     '..#..',
     '.###.',
     '.###.',
     '.###.'], // z = 3
    ['.....',
     '.....',
     '.....',
     '.....',
     '..#..'], // z = 4
  ],
});

// --- Level 4 — 6×6×6 ---------------------------------------------------------

export const l4Dog = defineShape({
  id: 'l4-dog',
  name: '강아지',
  level: 4,
  slices: [
    ['......',
     '......',
     '......',
     '......',
     '......',
     '......'], // z = 0
    ['......',
     '......',
     '......',
     '......',
     '......',
     '......'], // z = 1
    ['.....#',
     '....##',
     '.####.',
     '.####.',
     '.#..#.',
     '.#..#.'], // z = 2
    ['......',
     '....##',
     '######',
     '.####.',
     '......',
     '......'], // z = 3
    ['.....#',
     '....##',
     '.####.',
     '.####.',
     '.#..#.',
     '.#..#.'], // z = 4
    ['......',
     '......',
     '......',
     '......',
     '......',
     '......'], // z = 5
  ],
});

export const SHAPES = [
  l1Plus,
  l1Stairs,
  l1Mushroom,
  l2Heart,
  l2Mug,
  l3House,
  l3Rocket,
  l4Dog,
];

export function shapesByLevel(level) {
  return SHAPES.filter((s) => s.level === level);
}

export function shapeById(id) {
  return SHAPES.find((s) => s.id === id);
}

export { defineShape };
