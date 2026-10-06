// shapes/index.js — the hand-authored voxel shape catalogue. 24 shapes, 6 per level.
//
// Every shape here is hand-placed voxel by voxel and has been through `validatePuzzle`:
// uniquely solvable, and solvable by pure line logic with zero guesses.
// tests/gate.test.js re-proves that on every run, so a shape that loses those
// properties cannot be merged.
//
// ORDER MATTERS. Within a level, shapes are listed in ascending difficulty score —
// that is the play order, and tests/gate.test.js enforces it. If you insert a shape,
// run `node shapes/report.mjs` and put it where its score belongs.
//
// The difficulty curve is the level's *box*, i.e. its longest edge: L1 3 -> L2 4 ->
// L3 5 -> L4 6. Non-cubic boxes are the variants inside a level, so a 5x4x3 shape is
// level 3 even though it holds fewer cells than a 4x4x4 one.
//
// Authoring notes: see shapes/format.js. Slices are z = 0 first, rows printed top-down
// (first row = highest y). Run `node shapes/report.mjs` to print the verdict and
// difficulty numbers for a shape you are working on, `node shapes/report.mjs --ascii`
// to eyeball the silhouette, and `--repair` to get a minimal cell-toggle fix for one
// that fails.

import { defineShape } from './format.js';

// --- Level 1 — box 3 ---------------------------------------------------------
// Shallow by design: one wave of reasoning, read straight off the clues.

export const l1Flag = defineShape({
  id: 'l1-flag',
  name: '깃발',
  level: 1,
  tags: ['non-cubic'],
  slices: [
    // Pole at x=0 runs the full depth; the pennant is one slice thick.
    ['###',
     '##.',
     '#..'], // z = 0
    ['#..',
     '#..',
     '#..'], // z = 1
  ],
});

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

export const l1Chair = defineShape({
  id: 'l1-chair',
  name: '의자',
  level: 1,
  slices: [
    // Backrest at x=0, seat across y=1, legs under the two ends.
    ['#..',
     '###',
     '#.#'], // z = 0
    ['#..',
     '###',
     '...'], // z = 1
    ['#..',
     '###',
     '#.#'], // z = 2
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

export const l1Arch = defineShape({
  id: 'l1-arch',
  name: '아치',
  level: 1,
  slices: [
    ['###',
     '#.#',
     '#.#'], // z = 0
    ['###',
     '#.#',
     '#.#'], // z = 1
    ['###',
     '#.#',
     '#.#'], // z = 2
  ],
});

// --- Level 2 — box 4 ---------------------------------------------------------

export const l2Tree = defineShape({
  id: 'l2-tree',
  name: '나무',
  level: 2,
  slices: [
    // Canopy widest at y=2, tapering to a 2x2 crown; 2x2 trunk below.
    ['....',
     '.##.',
     '....',
     '....'], // z = 0
    ['.##.',
     '####',
     '.##.',
     '.##.'], // z = 1
    ['.##.',
     '####',
     '.##.',
     '.##.'], // z = 2
    ['....',
     '.##.',
     '....',
     '....'], // z = 3
  ],
});

export const l2Ladder = defineShape({
  id: 'l2-ladder',
  name: '사다리',
  level: 2,
  tags: ['non-cubic'],
  slices: [
    // Two rails at x=0 and x=3, rungs at y=0 and y=2.
    ['#..#',
     '####',
     '#..#',
     '####'], // z = 0
    ['#..#',
     '####',
     '#..#',
     '####'], // z = 1
  ],
});

export const l2Snowman = defineShape({
  id: 'l2-snowman',
  name: '눈사람',
  level: 2,
  slices: [
    // Wide 4x4 base ball, 2x2 head stacked on top.
    ['....',
     '....',
     '.##.',
     '.##.'], // z = 0
    ['.##.',
     '.##.',
     '####',
     '####'], // z = 1
    ['.##.',
     '.##.',
     '####',
     '####'], // z = 2
    ['....',
     '....',
     '.##.',
     '.##.'], // z = 3
  ],
});

export const l2Fish = defineShape({
  id: 'l2-fish',
  name: '물고기',
  level: 2,
  tags: ['non-cubic'],
  slices: [
    // Body at x=1..3, forked tail at x=0 on the middle slice only.
    ['....',
     '.###',
     '.###',
     '....'], // z = 0
    ['#...',
     '####',
     '####',
     '#...'], // z = 1
    ['....',
     '.###',
     '.###',
     '....'], // z = 2
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

// --- Level 3 — box 5 ---------------------------------------------------------

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

export const l3Pyramid = defineShape({
  id: 'l3-pyramid',
  name: '피라미드',
  level: 3,
  tags: ['non-cubic', 'symmetric'],
  slices: [
    // Three tiers: 5x5 base, 3x3, single capstone.
    ['.....',
     '.....',
     '#####'], // z = 0
    ['.....',
     '.###.',
     '#####'], // z = 1
    ['..#..',
     '.###.',
     '#####'], // z = 2
    ['.....',
     '.###.',
     '#####'], // z = 3
    ['.....',
     '.....',
     '#####'], // z = 4
  ],
});

export const l3Kettle = defineShape({
  id: 'l3-kettle',
  name: '주전자',
  level: 3,
  tags: ['non-cubic'],
  slices: [
    // Body at x=1..3; handle at x=0 and spout at x=4 on the middle slice; knobbed lid.
    ['.....',
     '.....',
     '.###.',
     '.###.',
     '.###.'], // z = 0
    ['..#..',
     '.###.',
     '#####',
     '#####',
     '.###.'], // z = 1
    ['.....',
     '.....',
     '.###.',
     '.###.',
     '.###.'], // z = 2
  ],
});

export const l3Crown = defineShape({
  id: 'l3-crown',
  name: '왕관',
  level: 3,
  tags: ['non-cubic'],
  slices: [
    // Hollow band at y=0..1 around the whole rim, with eight points rising off it:
    // short ones (y=2) at the four corners and tall ones (y=2..3) at the middle of each
    // side. Every point stands on the band — the middle point used to sit at the centre
    // of the box, where the band does not reach, so it floated (DOO-15). All four faces
    // now read the same '..#.. / #.#.# / ##### / #####' silhouette.
    ['..#..',
     '#.#.#',
     '#####',
     '#####'], // z = 0
    ['.....',
     '.....',
     '#...#',
     '#...#'], // z = 1
    ['#...#',
     '#...#',
     '#...#',
     '#...#'], // z = 2
    ['.....',
     '.....',
     '#...#',
     '#...#'], // z = 3
    ['..#..',
     '#.#.#',
     '#####',
     '#####'], // z = 4
  ],
});

export const l3Bird = defineShape({
  id: 'l3-bird',
  name: '새',
  level: 3,
  slices: [
    // Wing slab across y=3, crest above it, body beneath, legs and tail below that.
    ['.....',
     '..#..',
     '.....',
     '.....',
     '.....'], // z = 0
    ['..#..',
     '#####',
     '.###.',
     '..#..',
     '.....'], // z = 1
    ['..##.',
     '#####',
     '.###.',
     '..#..',
     '..#..'], // z = 2
    ['..#..',
     '#####',
     '.###.',
     '..#..',
     '.....'], // z = 3
    ['.....',
     '..#..',
     '.....',
     '.....',
     '.....'], // z = 4
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

// --- Level 4 — box 6 ---------------------------------------------------------

export const l4Car = defineShape({
  id: 'l4-car',
  name: '자동차',
  level: 4,
  tags: ['non-cubic'],
  slices: [
    // Cabin and windows only on the inner slices, so the roof reads as a roof;
    // wheels at x=1 and x=4 run the full depth.
    ['......',
     '......',
     '######',
     '######',
     '.#..#.'], // z = 0
    ['..##..',
     '.####.',
     '######',
     '######',
     '.#..#.'], // z = 1
    ['..##..',
     '.####.',
     '######',
     '######',
     '.#..#.'], // z = 2
    ['......',
     '......',
     '######',
     '######',
     '.#..#.'], // z = 3
  ],
});

export const l4Train = defineShape({
  id: 'l4-train',
  name: '기차',
  level: 4,
  tags: ['non-cubic'],
  slices: [
    // Boiler along the whole length, cab roof at the back, chimney at the front,
    // three wheels per side. The cab is one slice wider on z=2 than on z=1.
    // The chimney is a two-cell stack standing on the boiler roof (y=3..4); its tip used
    // to hang one cell clear of the boiler with nothing underneath it (DOO-15).
    ['......',
     '......',
     '######',
     '######',
     '.#.#.#'], // z = 0
    ['....#.',
     '##..#.',
     '######',
     '######',
     '.#.#.#'], // z = 1
    ['....#.',
     '###.#.',
     '######',
     '######',
     '.#.#.#'], // z = 2
    ['......',
     '......',
     '######',
     '######',
     '.#.#.#'], // z = 3
  ],
});

export const l4Dog = defineShape({
  id: 'l4-dog',
  name: '강아지',
  level: 4,
  tags: ['non-cubic'],
  slices: [
    // Standing dog facing +x. Body spans the full depth; ear, snout and tail sit on
    // the inner two slices; the four legs are on the outer two, so they read as legs
    // rather than as a pair of skirts. The back (y=3) runs the full length so the raised
    // tail at x=0 joins it — x=1 used to be empty there, leaving the tail floating a cell
    // clear of the body (DOO-15).
    ['......',
     '......',
     '.####.',
     '.####.',
     '.#..#.',
     '.#..#.'], // z = 0
    ['....#.',
     '#...##',
     '######',
     '.####.',
     '......',
     '......'], // z = 1
    ['....#.',
     '#...##',
     '######',
     '.####.',
     '......',
     '......'], // z = 2
    ['......',
     '......',
     '.####.',
     '.####.',
     '.#..#.',
     '.#..#.'], // z = 3
  ],
});

export const l4Castle = defineShape({
  id: 'l4-castle',
  name: '성',
  level: 4,
  slices: [
    // Four 2x2 corner towers rising the full height, curtain walls at y=0..2 between
    // them, and a gate punched through the front wall at x=2..3.
    ['##..##',
     '##..##',
     '##..##',
     '######',
     '##..##',
     '##..##'], // z = 0
    ['##..##',
     '##..##',
     '##..##',
     '##..##',
     '##..##',
     '##..##'], // z = 1
    ['......',
     '......',
     '......',
     '#....#',
     '#....#',
     '#....#'], // z = 2
    ['......',
     '......',
     '......',
     '#....#',
     '#....#',
     '#....#'], // z = 3
    ['##..##',
     '##..##',
     '##..##',
     '##..##',
     '##..##',
     '##..##'], // z = 4
    ['##..##',
     '##..##',
     '##..##',
     '######',
     '######',
     '######'], // z = 5
  ],
});

export const l4Turtle = defineShape({
  id: 'l4-turtle',
  name: '거북이',
  level: 4,
  tags: ['non-cubic'],
  slices: [
    // Three-tier domed shell, head poking out at +x on the middle slices, four legs
    // tucked under the shell on z=1 and z=4.
    ['......',
     '......',
     '.###..',
     '......',
     '......'], // z = 0
    ['......',
     '.###..',
     '#####.',
     '#...#.',
     '#...#.'], // z = 1
    ['.###..',
     '#####.',
     '######',
     '......',
     '......'], // z = 2
    ['.###..',
     '#####.',
     '######',
     '......',
     '......'], // z = 3
    ['......',
     '.###..',
     '#####.',
     '#...#.',
     '#...#.'], // z = 4
    ['......',
     '......',
     '.###..',
     '......',
     '......'], // z = 5
  ],
});

export const l4Cat = defineShape({
  id: 'l4-cat',
  name: '고양이',
  level: 4,
  slices: [
    // Sitting cat facing -x: pointed ears on the inner slices, head at x=0..3,
    // haunches filling out the base, tail curling up at x=5.
    ['......',
     '......',
     '......',
     '.####.',
     '.####.',
     '.#..#.'], // z = 0
    ['......',
     '####..',
     '####.#',
     '.#####',
     '.#####',
     '.#..#.'], // z = 1
    ['#.#...',
     '####..',
     '####.#',
     '.#####',
     '.#####',
     '.####.'], // z = 2
    ['#.#...',
     '####..',
     '####.#',
     '.#####',
     '.#####',
     '.####.'], // z = 3
    ['......',
     '####..',
     '####.#',
     '.#####',
     '.#####',
     '.#..#.'], // z = 4
    ['......',
     '......',
     '......',
     '.####.',
     '.####.',
     '.#..#.'], // z = 5
  ],
});

/**
 * The catalogue, in play order: level 1 first, and inside a level easiest first.
 * tests/gate.test.js enforces both of those, so this array is the single source of
 * truth for "which puzzle comes next".
 */
export const SHAPES = [
  // L1 — box 3
  l1Flag,
  l1Plus,
  l1Mushroom,
  l1Chair,
  l1Stairs,
  l1Arch,
  // L2 — box 4
  l2Tree,
  l2Ladder,
  l2Snowman,
  l2Fish,
  l2Mug,
  l2Heart,
  // L3 — box 5
  l3House,
  l3Pyramid,
  l3Kettle,
  l3Crown,
  l3Bird,
  l3Rocket,
  // L4 — box 6
  l4Car,
  l4Train,
  l4Dog,
  l4Castle,
  l4Turtle,
  l4Cat,
];

/** The box budget per level: a level's longest allowed edge. */
export const LEVEL_BOX = { 1: 3, 2: 4, 3: 5, 4: 6 };

/** Levels that actually have shapes, ascending. */
export const LEVELS_PRESENT = [...new Set(SHAPES.map((s) => s.level))].sort((a, b) => a - b);

export function shapesByLevel(level) {
  return SHAPES.filter((s) => s.level === level);
}

export function shapeById(id) {
  return SHAPES.find((s) => s.id === id);
}

export { defineShape };
